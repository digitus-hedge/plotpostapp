// Screen 3 tests: Create Post (photo uploads to Cloudinary, post checks, edits).
// Cloudinary is replaced by a fake, so no real files are uploaded.
// Uses TEST_MONGODB_URI if set, otherwise a temporary MongoDB. Never your real database.
process.env.NODE_ENV = "test";
process.env.JWT_SECRET = "test-secret-that-is-long-enough-for-signing-tokens";
process.env.CLOUDINARY_CLOUD_NAME = "test-cloud";
process.env.CLOUDINARY_API_KEY = "test-key";
process.env.CLOUDINARY_API_SECRET = "test-secret";

const request = require("supertest");
const mongoose = require("mongoose");
const app = require("../server");
const cloudinary = require("../config/cloudinary");
const User = require("../models/User");
const Post = require("../models/Post");

let memoryServer;

beforeAll(async () => {
  let uri = process.env.TEST_MONGODB_URI;
  if (!uri) {
    const { MongoMemoryServer } = require("mongodb-memory-server-core");
    memoryServer = await MongoMemoryServer.create();
    uri = memoryServer.getUri();
  }
  const url = new URL(uri);
  url.pathname = "/plotpost_test_screen3";
  await mongoose.connect(url.toString());
  await mongoose.connection.db.dropDatabase();
  await Promise.all([User.createIndexes(), Post.createIndexes()]);
});

afterEach(async () => {
  await Promise.all([User.deleteMany({}), Post.deleteMany({})]);
  jest.restoreAllMocks();
});

afterAll(async () => {
  await mongoose.connection.db.dropDatabase();
  await mongoose.disconnect();
  if (memoryServer) await memoryServer.stop();
});

let counter = 0;
const newUser = async (name = "Prime Plots") => {
  counter += 1;
  const res = await request(app)
    .post("/api/auth/register")
    .send({ name, email: `c${counter}@example.com`, password: "Password123" });
  return { id: String(res.body.user.id), token: res.body.token };
};
const auth = (user) => ({ Authorization: `Bearer ${user.token}` });

const PHOTO = "https://res.cloudinary.com/test-cloud/image/upload/v1/plotpost/posts/a.jpg";
const PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==",
  "base64"
);

const directPost = (extra = {}) => ({
  title: "10 cent plot near Chevayur",
  type: "Plot",
  deal: "For sale",
  price: "₹38 lakh",
  location: "Chevayur, Kozhikode",
  description: "Level plot with road access",
  sellerPhone: "+91 98950 00002",
  sellerName: "Calicut Prime Properties",
  area: "10 cents",
  platform: "PlotPost",
  video: false,
  imageUrls: [PHOTO],
  ...extra,
});

const linkPost = (extra = {}) => ({
  title: "3 BHK villa tour",
  type: "Villa",
  deal: "For sale",
  location: "West Hill, Kozhikode",
  platform: "YouTube",
  socialUrl: "https://www.youtube.com/watch?v=abc123",
  video: true,
  imageUrls: ["https://img.youtube.com/vi/abc123/hqdefault.jpg"],
  ...extra,
});

// Fake Cloudinary: records the options and answers like Cloudinary would.
const fakeCloudinary = (fail = false) =>
  jest.spyOn(cloudinary.uploader, "upload_stream").mockImplementation((options, callback) => ({
    end: () =>
      fail
        ? callback(new Error("Cloudinary is down"))
        : callback(null, {
            secure_url: "https://res.cloudinary.com/test-cloud/image/upload/v1/plotpost/posts/new.jpg",
            public_id: "plotpost/posts/new",
          }),
  }));

const upload = (user, buffer = PNG, filename = "plot.png", contentType = "image/png") => {
  const req = request(app).post("/api/upload");
  if (user) req.set(auth(user));
  return req.attach("image", buffer, { filename, contentType });
};

// --------------------------------------------------------- photo upload
describe("photo upload (POST /api/upload)", () => {
  test("uploads to Cloudinary: shrunk to 1600 px, saved as JPG, in plotpost/posts", async () => {
    const spy = fakeCloudinary();
    const me = await newUser();
    const res = await upload(me);
    expect(res.status).toBe(200);
    expect(res.body.imageUrl).toMatch(/^https:\/\/res\.cloudinary\.com\//);
    const options = spy.mock.calls[0][0];
    expect(options).toMatchObject({ folder: "plotpost/posts", format: "jpg", resource_type: "image" });
    expect(options.transformation[0]).toMatchObject({ width: 1600, height: 1600, crop: "limit" });
  });

  test("accepts iPhone HEIC photos", async () => {
    fakeCloudinary();
    const me = await newUser();
    expect((await upload(me, PNG, "IMG_0001.heic", "image/heic")).status).toBe(200);
  });

  test("refuses other file types, missing files and guests", async () => {
    fakeCloudinary();
    const me = await newUser();
    const pdf = await upload(me, Buffer.from("%PDF-1.4"), "brochure.pdf", "application/pdf");
    expect(pdf.status).toBe(400);
    expect(pdf.body.message).toMatch(/JPG, PNG, WEBP and HEIC/);
    expect((await request(app).post("/api/upload").set(auth(me))).status).toBe(400);
    expect((await upload(null)).status).toBe(401);
  });

  test("refuses photos over 8 MB", async () => {
    fakeCloudinary();
    const me = await newUser();
    const big = Buffer.alloc(8 * 1024 * 1024 + 1, 1);
    const res = await upload(me, big, "huge.jpg", "image/jpeg");
    expect(res.status).toBe(400);
  });

  test("says so clearly when Cloudinary fails or isn't set up", async () => {
    const me = await newUser();
    fakeCloudinary(true);
    const down = await upload(me);
    expect(down.status).toBe(500);
    expect(down.body.message).toMatch(/upload failed/i);

    const saved = process.env.CLOUDINARY_API_SECRET;
    process.env.CLOUDINARY_API_SECRET = "";
    const notSetUp = await upload(me);
    process.env.CLOUDINARY_API_SECRET = saved;
    expect(notSetUp.status).toBe(503);
    expect(notSetUp.body.message).toMatch(/aren't set up/);
  });
});

// --------------------------------------------------------- create post
describe("create post", () => {
  test("a photo post saves every field, including seller name and photo links", async () => {
    const me = await newUser();
    const res = await request(app).post("/api/posts").set(auth(me)).send(directPost());
    expect(res.status).toBe(201);
    expect(res.body.post).toMatchObject({
      title: "10 cent plot near Chevayur",
      price: "₹38 lakh",
      sellerName: "Calicut Prime Properties",
      platform: "PlotPost",
      video: false,
      imageUrls: [PHOTO],
    });
    expect(res.body.post.user._id).toBe(me.id);
  });

  test("a YouTube link post keeps its video tag and thumbnail", async () => {
    const me = await newUser();
    const res = await request(app).post("/api/posts").set(auth(me)).send(linkPost());
    expect(res.status).toBe(201);
    expect(res.body.post).toMatchObject({ platform: "YouTube", video: true, socialUrl: "https://www.youtube.com/watch?v=abc123" });
  });

  test("the feed shows the new post with its seller name and video tag", async () => {
    const me = await newUser();
    await request(app).post("/api/posts").set(auth(me)).send(linkPost({ sellerName: "Home Tours Calicut" }));
    const feed = await request(app).get("/api/posts");
    expect(feed.body.posts[0]).toMatchObject({ sellerName: "Home Tours Calicut", video: true });
  });

  test("new base64 photos are refused (photos must be uploaded first)", async () => {
    const me = await newUser();
    const res = await request(app)
      .post("/api/posts")
      .set(auth(me))
      .send(directPost({ imageUrls: ["data:image/png;base64,iVBORw0KGgo="] }));
    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/uploaded first/);
    expect(await Post.countDocuments()).toBe(0);
  });

  test("a photo post needs at least one photo, and at most 8", async () => {
    const me = await newUser();
    const none = await request(app).post("/api/posts").set(auth(me)).send(directPost({ imageUrls: [] }));
    expect(none.status).toBe(400);
    expect(none.body.message).toMatch(/at least one photo/);
    const nine = await request(app).post("/api/posts").set(auth(me)).send(directPost({ imageUrls: Array(9).fill(PHOTO) }));
    expect(nine.status).toBe(400);
    expect(nine.body.message).toMatch(/up to 8 photos/);
  });

  test("a link post needs a real web link", async () => {
    const me = await newUser();
    for (const socialUrl of ["", "not a link", "javascript:alert(1)", "ftp://example.com/x"]) {
      const res = await request(app).post("/api/posts").set(auth(me)).send(linkPost({ socialUrl }));
      expect(res.status).toBe(400);
      expect(res.body.message).toMatch(/link/);
    }
  });

  test.each([
    [{ title: "" }, /title/],
    [{ location: "  " }, /location/],
    [{ title: "x".repeat(121) }, /Title is too long/],
    [{ description: "x".repeat(3001) }, /Description is too long/],
    [{ type: "Castle" }, /property type/],
    [{ deal: "Swap" }, /deal/],
    [{ platform: "TikTok" }, /platform/],
    [{ sellerPhone: "call me" }, /phone number/],
    [{ video: "yes" }, /true or false/],
  ])("explains what's wrong with bad input %#", async (override, message) => {
    const me = await newUser();
    const res = await request(app).post("/api/posts").set(auth(me)).send(directPost(override));
    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(message);
  });

  test("can't set the owner, likes or comments from the app", async () => {
    const me = await newUser();
    const other = await newUser("Someone Else");
    const res = await request(app)
      .post("/api/posts")
      .set(auth(me))
      .send(directPost({ user: other.id, likes: [other.id], comments: [{ user: other.id, text: "fake" }] }));
    expect(res.status).toBe(201);
    const stored = await Post.findById(res.body.post._id).lean();
    expect(String(stored.user)).toBe(me.id);
    expect(stored.likes).toEqual([]);
    expect(stored.comments).toEqual([]);
  });

  test("guests can't publish", async () => {
    const res = await request(app).post("/api/posts").send(directPost());
    expect(res.status).toBe(401);
  });
});

// --------------------------------------------------------- edit post
describe("edit post (same save path as Create Post)", () => {
  // An older post whose photo is stored as base64 text, as before Screen 3.
  const OLD_PHOTO = "data:image/png;base64,iVBORw0KGgo=";
  const oldPost = (owner) =>
    Post.create({ user: owner.id, title: "Old post", location: "Kozhikode", platform: "PlotPost", imageUrls: [OLD_PHOTO] });

  test("older posts with base64 photos can still be edited without re-uploading", async () => {
    const me = await newUser();
    const post = await oldPost(me);
    const res = await request(app)
      .put(`/api/posts/${post._id}`)
      .set(auth(me))
      .send({ title: "Old post, new price", price: "₹40 lakh", imageUrls: [OLD_PHOTO] });
    expect(res.status).toBe(200);
    expect(res.body.post).toMatchObject({ title: "Old post, new price", price: "₹40 lakh", imageUrls: [OLD_PHOTO] });
  });

  test("but new base64 photos can't be added on edit", async () => {
    const me = await newUser();
    const post = await oldPost(me);
    const res = await request(app)
      .put(`/api/posts/${post._id}`)
      .set(auth(me))
      .send({ imageUrls: [OLD_PHOTO, "data:image/png;base64,AAAA"] });
    expect(res.status).toBe(400);
  });

  test("photos can be replaced with uploaded ones", async () => {
    const me = await newUser();
    const post = await oldPost(me);
    const res = await request(app).put(`/api/posts/${post._id}`).set(auth(me)).send({ imageUrls: [PHOTO] });
    expect(res.status).toBe(200);
    expect(res.body.post.imageUrls).toEqual([PHOTO]);
  });

  test("a photo post can't end up with no photos", async () => {
    const me = await newUser();
    const post = await oldPost(me);
    const res = await request(app).put(`/api/posts/${post._id}`).set(auth(me)).send({ imageUrls: [] });
    expect(res.status).toBe(400);
  });

  test("edits are checked like new posts, and only the owner can edit", async () => {
    const me = await newUser();
    const stranger = await newUser();
    const post = await oldPost(me);
    expect((await request(app).put(`/api/posts/${post._id}`).set(auth(me)).send({ deal: "Swap" })).status).toBe(400);
    expect((await request(app).put(`/api/posts/${post._id}`).set(auth(stranger)).send({ price: "1" })).status).toBe(403);
  });
});

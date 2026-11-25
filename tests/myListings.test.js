// Screen 5 tests: My Listings and Edit Post (stats, status, edit, delete clean-up).
// Cloudinary is faked: nothing is really deleted. Uses TEST_MONGODB_URI if set,
// otherwise a temporary MongoDB. Never your real database.
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
const Follow = require("../models/Follow");
const PostView = require("../models/PostView");

let memoryServer;

beforeAll(async () => {
  let uri = process.env.TEST_MONGODB_URI;
  if (!uri) {
    const { MongoMemoryServer } = require("mongodb-memory-server-core");
    memoryServer = await MongoMemoryServer.create();
    uri = memoryServer.getUri();
  }
  const url = new URL(uri);
  url.pathname = "/plotpost_test_screen5";
  await mongoose.connect(url.toString());
  await mongoose.connection.db.dropDatabase();
  await Promise.all([User.createIndexes(), Post.createIndexes(), Follow.createIndexes(), PostView.createIndexes()]);
});

let destroyed;
beforeEach(() => {
  destroyed = [];
  jest.spyOn(cloudinary.uploader, "destroy").mockImplementation(async (id) => {
    destroyed.push(id);
    return { result: "ok" };
  });
});

afterEach(async () => {
  jest.restoreAllMocks();
  await Promise.all([User.deleteMany({}), Post.deleteMany({}), Follow.deleteMany({}), PostView.deleteMany({})]);
});

afterAll(async () => {
  await mongoose.connection.db.dropDatabase();
  await mongoose.disconnect();
  if (memoryServer) await memoryServer.stop();
});

let counter = 0;
const newUser = async (name = "Seller") => {
  counter += 1;
  const res = await request(app)
    .post("/api/auth/register")
    .send({ name, email: `m${counter}@example.com`, password: "Password123" });
  return { id: String(res.body.user.id), token: res.body.token };
};
const auth = (user) => ({ Authorization: `Bearer ${user.token}` });

const ours = (name) => `https://res.cloudinary.com/test-cloud/image/upload/v17/plotpost/posts/${name}.jpg`;
const YOUTUBE_THUMB = "https://img.youtube.com/vi/abc/hqdefault.jpg";

const makePost = (seller, extra = {}) =>
  Post.create({
    user: seller.id,
    title: "Plot near Mavoor Road",
    location: "Mavoor Road, Kozhikode",
    platform: "PlotPost",
    imageUrls: [ours("a"), ours("b")],
    ...extra,
  });

const myListings = (user) => request(app).get("/api/posts/my").set(auth(user));
const setStatus = (post, status, user) =>
  request(app).patch(`/api/posts/${post._id}/status`).set(auth(user)).send({ status });

// -------------------------------------------------------- My Listings
describe("My Listings", () => {
  test("only your posts, newest first, with views, likes, comments and tap counts", async () => {
    const me = await newUser();
    const other = await newUser();
    const fan = await newUser();
    await makePost(me, { title: "Older" });
    const newer = await makePost(me, { title: "Newer" });
    await makePost(other, { title: "Not mine" });
    await request(app).post(`/api/posts/${newer._id}/view`).set(auth(fan));
    await request(app).post(`/api/posts/${newer._id}/contact`).set(auth(fan)).send({ action: "call" });
    await request(app).post(`/api/posts/${newer._id}/like`).set(auth(fan));

    const res = await myListings(me);
    expect(res.status).toBe(200);
    expect(res.body.posts.map((p) => p.title)).toEqual(["Newer", "Older"]);
    expect(res.body.posts[0]).toMatchObject({
      status: "active",
      views: 1,
      likesCount: 1,
      commentsCount: 0,
      stats: { calls: 1, linkOpens: 0 },
    });
    expect(res.body.posts[0].likes).toBeUndefined();
  });

  test("includes sold and rented posts; guests are refused", async () => {
    const me = await newUser();
    const post = await makePost(me);
    await setStatus(post, "sold", me);
    expect((await myListings(me)).body.posts[0].status).toBe("sold");
    expect((await request(app).get("/api/posts/my")).status).toBe(401);
  });
});

// ------------------------------------------------------------- status
describe("mark as sold / rented / active", () => {
  test("sold and rented posts leave the home feed and the Following tab, and come back when active", async () => {
    const me = await newUser();
    const fan = await newUser();
    const post = await makePost(me);
    await request(app).post(`/api/users/${me.id}/follow`).set(auth(fan));

    expect((await setStatus(post, "sold", me)).body).toMatchObject({ success: true, status: "sold" });
    expect((await request(app).get("/api/posts")).body.total).toBe(0);
    expect((await request(app).get("/api/posts?feed=following").set(auth(fan))).body.total).toBe(0);

    await setStatus(post, "rented", me);
    expect((await request(app).get("/api/posts")).body.total).toBe(0);

    await setStatus(post, "active", me);
    expect((await request(app).get("/api/posts")).body.total).toBe(1);
  });

  test("a sold post still opens on its own page, showing its status", async () => {
    const me = await newUser();
    const post = await makePost(me);
    await setStatus(post, "sold", me);
    const res = await request(app).get(`/api/posts/${post._id}`);
    expect(res.status).toBe(200);
    expect(res.body.post.status).toBe("sold");
  });

  test("older posts without a status count as active", async () => {
    const me = await newUser();
    const post = await makePost(me);
    await Post.collection.updateOne({ _id: post._id }, { $unset: { status: "" } });
    expect((await request(app).get("/api/posts")).body.total).toBe(1);
  });

  test("only the seller can change it; bad values and IDs are refused", async () => {
    const me = await newUser();
    const stranger = await newUser();
    const post = await makePost(me);
    expect((await setStatus(post, "sold", stranger)).status).toBe(403);
    expect((await setStatus(post, "deleted", me)).status).toBe(400);
    expect((await request(app).patch("/api/posts/nope/status").set(auth(me)).send({ status: "sold" })).status).toBe(400);
    expect((await request(app).patch("/api/posts/64b7f0f0f0f0f0f0f0f0f0f0/status").set(auth(me)).send({ status: "sold" })).status).toBe(404);
    expect((await request(app).patch(`/api/posts/${post._id}/status`).send({ status: "sold" })).status).toBe(401);
    expect((await Post.findById(post._id).lean()).status).toBe("active");
  });
});

// --------------------------------------------------------------- edit
describe("edit post", () => {
  test("updates the same post (never creates a copy)", async () => {
    const me = await newUser();
    const post = await makePost(me);
    const res = await request(app).put(`/api/posts/${post._id}`).set(auth(me)).send({ title: "Plot near Mavoor Road, price cut", price: "₹30 lakh" });
    expect(res.status).toBe(200);
    expect(res.body.post._id).toBe(String(post._id));
    expect(await Post.countDocuments()).toBe(1);
  });

  test("keeping photos and adding new ones keeps them all", async () => {
    const me = await newUser();
    const post = await makePost(me);
    const res = await request(app).put(`/api/posts/${post._id}`).set(auth(me)).send({ imageUrls: [ours("a"), ours("b"), ours("c")] });
    expect(res.body.post.imageUrls).toEqual([ours("a"), ours("b"), ours("c")]);
    expect(destroyed).toEqual([]);
  });

  test("photos removed in an edit are deleted from Cloudinary", async () => {
    const me = await newUser();
    const post = await makePost(me);
    await request(app).put(`/api/posts/${post._id}`).set(auth(me)).send({ imageUrls: [ours("b"), ours("c")] });
    expect(destroyed).toEqual(["plotpost/posts/a"]);
  });

  test("never deletes photos that aren't ours (YouTube, old base64, other Cloudinary accounts)", async () => {
    const me = await newUser();
    const foreign = "https://res.cloudinary.com/someone-else/image/upload/v1/plotpost/posts/x.jpg";
    const post = await makePost(me, { imageUrls: [YOUTUBE_THUMB, "data:image/png;base64,iVBORw0KGgo=", foreign, ours("keep")] });
    await request(app).put(`/api/posts/${post._id}`).set(auth(me)).send({ imageUrls: [ours("keep")] });
    expect(destroyed).toEqual([]);
  });

  test("a failed edit deletes nothing", async () => {
    const me = await newUser();
    const post = await makePost(me);
    const res = await request(app).put(`/api/posts/${post._id}`).set(auth(me)).send({ deal: "Swap", imageUrls: [ours("b")] });
    expect(res.status).toBe(400);
    expect(destroyed).toEqual([]);
    expect((await Post.findById(post._id).lean()).imageUrls).toHaveLength(2);
  });
});

// ------------------------------------------------------------- delete
describe("delete post", () => {
  test("removes the post, its photos, its view records and it from saved lists", async () => {
    const me = await newUser();
    const fan = await newUser();
    const post = await makePost(me, { imageUrls: [ours("a"), YOUTUBE_THUMB] });
    const keep = await makePost(me, { title: "Keep me" });
    await request(app).post(`/api/users/saved/${post._id}`).set(auth(fan));
    await request(app).post(`/api/users/saved/${keep._id}`).set(auth(fan));
    await request(app).post(`/api/posts/${post._id}/view`).set(auth(fan));

    const res = await request(app).delete(`/api/posts/${post._id}`).set(auth(me));
    expect(res.status).toBe(200);
    expect(await Post.findById(post._id)).toBeNull();
    expect(destroyed).toEqual(["plotpost/posts/a"]);
    expect(await PostView.countDocuments({ post: post._id })).toBe(0);
    const fanDoc = await User.findById(fan.id).lean();
    expect(fanDoc.savedPosts.map(String)).toEqual([String(keep._id)]);
    expect((await request(app).get(`/api/posts/${post._id}`)).status).toBe(404);
  });

  test("still deletes the post when Cloudinary fails", async () => {
    cloudinary.uploader.destroy.mockImplementation(async () => {
      throw new Error("Cloudinary is down");
    });
    const me = await newUser();
    const post = await makePost(me);
    expect((await request(app).delete(`/api/posts/${post._id}`).set(auth(me))).status).toBe(200);
    expect(await Post.findById(post._id)).toBeNull();
  });

  test("other people can't delete your post, and nothing is touched", async () => {
    const me = await newUser();
    const stranger = await newUser();
    const post = await makePost(me);
    expect((await request(app).delete(`/api/posts/${post._id}`).set(auth(stranger))).status).toBe(403);
    expect(await Post.findById(post._id)).not.toBeNull();
    expect(destroyed).toEqual([]);
  });
});

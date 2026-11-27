// Posts with an uploaded video: the upload ticket, creating, editing,
// removing and deleting. Cloudinary is replaced by a fake, so no real files
// are checked or deleted.
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
  url.pathname = "/plotpost_test_post_video";
  await mongoose.connect(url.toString());
  await mongoose.connection.db.dropDatabase();
  await Promise.all([User.createIndexes(), Post.createIndexes()]);
});

let resource;
let destroy;
beforeEach(() => {
  // Every video Cloudinary is asked about is 42 seconds and 18 MB unless a
  // test says otherwise.
  resource = jest.spyOn(cloudinary.api, "resource").mockResolvedValue({ duration: 42, bytes: 18 * 1024 * 1024 });
  destroy = jest.spyOn(cloudinary.uploader, "destroy").mockResolvedValue({ result: "ok" });
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
    .send({ name, email: `v${counter}@example.com`, password: "Password123" });
  return { id: String(res.body.user.id), token: res.body.token };
};
const auth = (user) => ({ Authorization: `Bearer ${user.token}` });
const videoOf = (user, tail = "0123456789abcdef") => `plotpost/videos/${user.id}_${tail}`;
const videoDeletes = () => destroy.mock.calls.filter(([, options]) => options?.resource_type === "video").map(([id]) => id);

const videoPost = (extra = {}) => ({
  title: "Walk-through of a 3 BHK house",
  type: "House",
  deal: "For sale",
  price: "₹65 lakh",
  location: "Nadakkavu, Kozhikode",
  platform: "PlotPost",
  imageUrls: [],
  ...extra,
});

describe("upload ticket", () => {
  test("only for logged-in accounts", async () => {
    const res = await request(app).post("/api/upload/video/ticket");
    expect(res.status).toBe(401);
  });

  test("names the video after your account", async () => {
    const me = await newUser();
    const res = await request(app).post("/api/upload/video/ticket").set(auth(me));
    expect(res.status).toBe(200);
    expect(res.body.ticket.publicId).toMatch(new RegExp(`^plotpost/videos/${me.id}_[a-f0-9]{16}$`));
    expect(res.body.ticket.fields).toMatchObject({ api_key: "test-key", public_id: res.body.ticket.publicId });
    expect(res.body.ticket.fields.signature).toBeTruthy();
    expect(res.body.ticket.maxSeconds).toBe(60);
  });
});

describe("a post with a video", () => {
  test("a video and no photos is enough; the post gets the playback link and cover", async () => {
    const me = await newUser();
    const res = await request(app).post("/api/posts").set(auth(me)).send(videoPost({ videoPublicId: videoOf(me) }));

    expect(res.status).toBe(201);
    expect(res.body.post).toMatchObject({
      video: true,
      videoPublicId: videoOf(me),
      videoUrl: `https://res.cloudinary.com/test-cloud/video/upload/c_limit,w_720,q_auto,vc_h264/${videoOf(me)}.mp4`,
      videoPoster: `https://res.cloudinary.com/test-cloud/video/upload/so_1,c_limit,w_1080,q_auto/${videoOf(me)}.jpg`,
      videoDuration: 42,
    });
    expect(resource).toHaveBeenCalledWith(videoOf(me), { resource_type: "video" });

    // The feed and "Videos only" include it; guests get the video too.
    const feed = await request(app).get("/api/posts?video=true");
    expect(feed.body.posts.map((post) => post.videoUrl)).toEqual([res.body.post.videoUrl]);
  });

  test("still needs a photo or a video", async () => {
    const me = await newUser();
    const res = await request(app).post("/api/posts").set(auth(me)).send(videoPost());
    expect(res.status).toBe(400);
    expect(res.body.message).toBe("Please add at least one photo or a video.");
  });

  test("someone else's video is refused, and nothing is saved", async () => {
    const me = await newUser();
    const other = await newUser("Other");
    const res = await request(app).post("/api/posts").set(auth(me)).send(videoPost({ videoPublicId: videoOf(other) }));
    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/wasn't uploaded from your account/);
    expect(await Post.countDocuments()).toBe(0);
  });

  test("a video over 60 seconds is refused and deleted", async () => {
    const me = await newUser();
    resource.mockResolvedValueOnce({ duration: 95, bytes: 1000 });
    const res = await request(app).post("/api/posts").set(auth(me)).send(videoPost({ videoPublicId: videoOf(me) }));
    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/up to 60 seconds/);
    expect(videoDeletes()).toEqual([videoOf(me)]);
    expect(await Post.countDocuments()).toBe(0);
  });

  test("a link post can carry the seller's own copy of the video", async () => {
    const me = await newUser();
    const res = await request(app)
      .post("/api/posts")
      .set(auth(me))
      .send(
        videoPost({
          platform: "Instagram",
          socialUrl: "https://www.instagram.com/reel/abc123/",
          video: true,
          videoPublicId: videoOf(me),
        })
      );
    expect(res.status).toBe(201);
    expect(res.body.post).toMatchObject({ platform: "Instagram", videoPublicId: videoOf(me), video: true });
  });
});

describe("editing and deleting", () => {
  const makeVideoPost = async (me, extra = {}) => {
    const res = await request(app)
      .post("/api/posts")
      .set(auth(me))
      .send(videoPost({ videoPublicId: videoOf(me), ...extra }));
    expect(res.status).toBe(201);
    return res.body.post;
  };

  test("leaving the video out keeps it; Cloudinary isn't asked again", async () => {
    const me = await newUser();
    const post = await makeVideoPost(me);
    resource.mockClear();
    const res = await request(app).put(`/api/posts/${post._id}`).set(auth(me)).send({ title: "New title" });
    expect(res.status).toBe(200);
    expect(res.body.post).toMatchObject({ title: "New title", videoPublicId: videoOf(me) });
    expect(resource).not.toHaveBeenCalled();
    expect(videoDeletes()).toEqual([]);
  });

  test("a new video replaces the old one, which is deleted", async () => {
    const me = await newUser();
    const post = await makeVideoPost(me);
    const next = videoOf(me, "fedcba9876543210");
    const res = await request(app).put(`/api/posts/${post._id}`).set(auth(me)).send({ videoPublicId: next });
    expect(res.status).toBe(200);
    expect(res.body.post.videoPublicId).toBe(next);
    expect(res.body.post.videoUrl).toContain(next);
    expect(videoDeletes()).toEqual([videoOf(me)]);
  });

  test("removing the video needs a photo to be left", async () => {
    const me = await newUser();
    const post = await makeVideoPost(me);
    const refused = await request(app).put(`/api/posts/${post._id}`).set(auth(me)).send({ videoPublicId: "" });
    expect(refused.status).toBe(400);
    expect(refused.body.message).toBe("Please add at least one photo or a video.");

    const photo = "https://res.cloudinary.com/test-cloud/image/upload/v1/plotpost/posts/a.jpg";
    const res = await request(app)
      .put(`/api/posts/${post._id}`)
      .set(auth(me))
      .send({ videoPublicId: "", imageUrls: [photo] });
    expect(res.status).toBe(200);
    expect(res.body.post).toMatchObject({ videoPublicId: "", videoUrl: "", videoPoster: "", videoDuration: null, video: false });
    expect(videoDeletes()).toEqual([videoOf(me)]);
  });

  test("deleting the post deletes its video", async () => {
    const me = await newUser();
    const post = await makeVideoPost(me);
    const res = await request(app).delete(`/api/posts/${post._id}`).set(auth(me));
    expect(res.status).toBe(200);
    expect(videoDeletes()).toEqual([videoOf(me)]);
  });
});

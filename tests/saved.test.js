// Screen 7 tests: saved posts (bookmarks) on the account.
// Uses TEST_MONGODB_URI if set, otherwise a temporary MongoDB. Never your
// real database.
process.env.NODE_ENV = "test";
process.env.JWT_SECRET = "test-secret-that-is-long-enough-for-signing-tokens";

const request = require("supertest");
const mongoose = require("mongoose");
const app = require("../server");
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
  url.pathname = "/plotpost_test_screen7";
  await mongoose.connect(url.toString());
  await mongoose.connection.db.dropDatabase();
  await Promise.all([User.createIndexes(), Post.createIndexes()]);
});

afterEach(async () => {
  await Promise.all([User.deleteMany({}), Post.deleteMany({})]);
});

afterAll(async () => {
  await mongoose.connection.db.dropDatabase();
  await mongoose.disconnect();
  if (memoryServer) await memoryServer.stop();
});

let counter = 0;
const newUser = async (name = "Buyer") => {
  counter += 1;
  const res = await request(app)
    .post("/api/auth/register")
    .send({ name, email: `b${counter}@example.com`, password: "Password123" });
  return { id: String(res.body.user.id), token: res.body.token };
};
const auth = (user) => ({ Authorization: `Bearer ${user.token}` });

const PHOTO = "https://res.cloudinary.com/test-cloud/image/upload/v1/plotpost/posts/a.jpg";
const makePost = (seller, extra = {}) =>
  Post.create({
    user: seller.id,
    title: "Plot near Mavoor Road",
    location: "Mavoor Road, Kozhikode",
    platform: "PlotPost",
    imageUrls: [PHOTO],
    ...extra,
  });

const save = (user, post, saved) => {
  const req = request(app).post(`/api/users/saved/${post._id ?? post}`).set(auth(user));
  return saved === undefined ? req : req.send({ saved });
};
const savedList = (user) => request(app).get("/api/users/saved").set(auth(user));
const savedTitles = async (user) => (await savedList(user)).body.savedPosts.map((p) => p.title);
const fakeId = () => new mongoose.Types.ObjectId().toString();

// ------------------------------------------------------- save / unsave
describe("save and unsave", () => {
  test("saving twice keeps one save; removing twice is fine too", async () => {
    const seller = await newUser("Seller");
    const me = await newUser();
    const post = await makePost(seller);

    for (let i = 0; i < 2; i += 1) {
      const res = await save(me, post, true);
      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({ success: true, isSaved: true, savedCount: 1 });
    }
    expect(await savedTitles(me)).toEqual(["Plot near Mavoor Road"]);

    for (let i = 0; i < 2; i += 1) {
      const res = await save(me, post, false);
      expect(res.body).toMatchObject({ success: true, isSaved: false, savedCount: 0 });
    }
    expect(await savedTitles(me)).toEqual([]);
  });

  test("with no body it still toggles, as before", async () => {
    const seller = await newUser("Seller");
    const me = await newUser();
    const post = await makePost(seller);

    expect((await save(me, post)).body.isSaved).toBe(true);
    expect((await save(me, post)).body.isSaved).toBe(false);
    expect((await save(me, post)).body.isSaved).toBe(true);
  });

  test("each account has its own saves; guests must log in", async () => {
    const seller = await newUser("Seller");
    const me = await newUser();
    const someoneElse = await newUser();
    const post = await makePost(seller);

    await save(me, post, true);
    expect(await savedTitles(me)).toHaveLength(1);
    expect(await savedTitles(someoneElse)).toHaveLength(0);

    expect((await request(app).post(`/api/users/saved/${post._id}`).send({ saved: true })).status).toBe(401);
    expect((await request(app).get("/api/users/saved")).status).toBe(401);
  });

  test("bad IDs and values are refused; a missing post can't be saved but can be removed", async () => {
    const seller = await newUser("Seller");
    const me = await newUser();
    const post = await makePost(seller);

    expect((await save(me, "not-an-id", true)).status).toBe(400);
    expect((await save(me, post, "yes")).status).toBe(400);
    expect((await save(me, fakeId(), true)).status).toBe(404);

    // Saved, then the post disappears without the Screen 5 clean-up.
    await save(me, post, true);
    await Post.collection.deleteOne({ _id: post._id });
    const res = await save(me, post, false);
    expect(res.body).toMatchObject({ success: true, isSaved: false, savedCount: 0 });
  });

  test("500 saves at most, with a clear message", async () => {
    const seller = await newUser("Seller");
    const me = await newUser();
    const post = await makePost(seller);
    const full = Array.from({ length: 500 }, () => new mongoose.Types.ObjectId());
    await User.updateOne({ _id: me.id }, { $set: { savedPosts: full } });

    const refused = await save(me, post, true);
    expect(refused.status).toBe(400);
    expect(refused.body).toMatchObject({ success: false, limitReached: true });
    expect(refused.body.message).toMatch(/up to 500/);

    // Removing one makes room.
    await save(me, full[0].toString(), false);
    expect((await save(me, post, true)).body).toMatchObject({ isSaved: true, savedCount: 500 });
  });
});

// ---------------------------------------------------------- Saved tab
describe("Saved tab list", () => {
  test("newest saved first, in the feed format (counts, no like lists, no emails)", async () => {
    const seller = await newUser("Ravi");
    const me = await newUser();
    const first = await makePost(seller, { title: "Saved first" });
    const second = await makePost(seller, { title: "Saved second" });
    await request(app).post(`/api/posts/${first._id}/like`).set(auth(me));

    await save(me, first, true);
    await save(me, second, true);

    const res = await savedList(me);
    expect(res.status).toBe(200);
    expect(res.body.count).toBe(2);
    expect(res.body.postIds).toEqual([String(second._id), String(first._id)]);
    expect(res.body.savedPosts.map((p) => p.title)).toEqual(["Saved second", "Saved first"]);

    const liked = res.body.savedPosts[1];
    expect(liked).toMatchObject({ likesCount: 1, commentsCount: 0, isLiked: true, status: "active" });
    expect(liked.likes).toBeUndefined();
    expect(liked.comments).toBeUndefined();
    expect(liked.stats).toBeUndefined();
    expect(liked.user).toMatchObject({ name: "Ravi" });
    expect(liked.user.email).toBeUndefined();
  });

  test("sold and rented posts stay with their status; deleted posts drop out", async () => {
    const seller = await newUser("Seller");
    const me = await newUser();
    const sold = await makePost(seller, { title: "Sold one" });
    const kept = await makePost(seller, { title: "Still here" });
    const gone = await makePost(seller, { title: "Deleted" });
    const vanished = await makePost(seller, { title: "Vanished" });
    for (const post of [sold, kept, gone, vanished]) await save(me, post, true);

    await request(app).patch(`/api/posts/${sold._id}/status`).set(auth(seller)).send({ status: "sold" });
    await request(app).delete(`/api/posts/${gone._id}`).set(auth(seller));
    await Post.collection.deleteOne({ _id: vanished._id }); // no clean-up at all

    const res = await savedList(me);
    expect(res.body.savedPosts.map((p) => [p.title, p.status])).toEqual([
      ["Still here", "active"],
      ["Sold one", "sold"],
    ]);
  });
});

// ------------------------------------------------- moving phone saves
describe("moving saves from the phone to the account", () => {
  test("adds the posts that exist and skips the rest; safe to repeat", async () => {
    const seller = await newUser("Seller");
    const me = await newUser();
    const a = await makePost(seller, { title: "A" });
    const b = await makePost(seller, { title: "B" });
    const c = await makePost(seller, { title: "C" });
    await save(me, a, true);

    const phone = [String(a._id), String(b._id), String(b._id), fakeId(), "\u001fPlotPost\u001fSeller\u001fOld", String(c._id)];
    const res = await request(app).post("/api/users/saved/import").set(auth(me)).send({ postIds: phone });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ success: true, added: 2, savedCount: 3, limitReached: false });
    // Phone order kept: C was saved last, so it's first.
    expect(await savedTitles(me)).toEqual(["C", "B", "A"]);

    const again = await request(app).post("/api/users/saved/import").set(auth(me)).send({ postIds: phone });
    expect(again.body).toMatchObject({ added: 0, savedCount: 3 });
  });

  test("stops at 500 and says so; bad requests and guests are refused", async () => {
    const seller = await newUser("Seller");
    const me = await newUser();
    const a = await makePost(seller, { title: "A" });
    const b = await makePost(seller, { title: "B" });
    const almostFull = Array.from({ length: 499 }, () => new mongoose.Types.ObjectId());
    await User.updateOne({ _id: me.id }, { $set: { savedPosts: almostFull } });

    const res = await request(app)
      .post("/api/users/saved/import")
      .set(auth(me))
      .send({ postIds: [String(a._id), String(b._id)] });
    expect(res.body).toMatchObject({ added: 1, savedCount: 500, limitReached: true });
    expect(res.body.message).toMatch(/up to 500/);

    const tooMany = Array.from({ length: 501 }, fakeId);
    expect((await request(app).post("/api/users/saved/import").set(auth(me)).send({ postIds: tooMany })).status).toBe(400);
    expect((await request(app).post("/api/users/saved/import").set(auth(me)).send({ postIds: "abc" })).status).toBe(400);
    expect((await request(app).post("/api/users/saved/import").send({ postIds: [] })).status).toBe(401);
  });
});

// -------------------------------------------------- guests' Saved tab
describe("posts by ID (a guest's Saved tab)", () => {
  test("in the order asked, sold ones included, missing and bad IDs left out", async () => {
    const seller = await newUser("Seller");
    const a = await makePost(seller, { title: "A" });
    const b = await makePost(seller, { title: "B" });
    await request(app).patch(`/api/posts/${b._id}/status`).set(auth(seller)).send({ status: "rented" });

    const ids = [String(b._id), "junk", fakeId(), String(a._id)].join(",");
    const res = await request(app).get(`/api/posts/by-ids?ids=${ids}`);
    expect(res.status).toBe(200);
    expect(res.body.posts.map((p) => [p.title, p.status])).toEqual([["B", "rented"], ["A", "active"]]);
    expect(res.body.posts[0].likes).toBeUndefined();
    expect(res.body.posts[0].user.email).toBeUndefined();

    expect((await request(app).get("/api/posts/by-ids")).body.posts).toEqual([]);
  });

  test("more than 100 at once is refused", async () => {
    const ids = Array.from({ length: 101 }, fakeId).join(",");
    const res = await request(app).get(`/api/posts/by-ids?ids=${ids}`);
    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/up to 100/);
  });
});

// ------------------------------------------------------------ profile
describe("profile", () => {
  test("returns saved post IDs only, not whole posts", async () => {
    const seller = await newUser("Seller");
    const me = await newUser();
    const post = await makePost(seller, { description: "x".repeat(2000) });
    await save(me, post, true);

    const res = await request(app).get("/api/users/profile").set(auth(me));
    expect(res.status).toBe(200);
    expect(res.body.user.savedPosts).toEqual([String(post._id)]);
    expect(res.body.user.password).toBeUndefined();
  });
});

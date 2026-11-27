// Screen 8 tests: comments, reports and share counts.
// Uses TEST_MONGODB_URI if set, otherwise a temporary MongoDB. Never your
// real database.
process.env.NODE_ENV = "test";
process.env.JWT_SECRET = "test-secret-that-is-long-enough-for-signing-tokens";
// Check the comment and report limits (the login limit stays off).
process.env.RATE_LIMIT_SOCIAL_ENABLED = "true";

const request = require("supertest");
const mongoose = require("mongoose");
const app = require("../server");
const User = require("../models/User");
const Post = require("../models/Post");
const PostView = require("../models/PostView");
const Report = require("../models/Report");
const { listReports, markDone } = require("../scripts/listReports");

let memoryServer;

beforeAll(async () => {
  let uri = process.env.TEST_MONGODB_URI;
  if (!uri) {
    const { MongoMemoryServer } = require("mongodb-memory-server-core");
    memoryServer = await MongoMemoryServer.create();
    uri = memoryServer.getUri();
  }
  const url = new URL(uri);
  url.pathname = "/plotpost_test_screen8";
  await mongoose.connect(url.toString());
  await mongoose.connection.db.dropDatabase();
  await Promise.all([User.createIndexes(), Post.createIndexes(), PostView.createIndexes(), Report.createIndexes()]);
});

afterEach(async () => {
  await Promise.all([User.deleteMany({}), Post.deleteMany({}), PostView.deleteMany({}), Report.deleteMany({})]);
});

afterAll(async () => {
  await mongoose.connection.db.dropDatabase();
  await mongoose.disconnect();
  if (memoryServer) await memoryServer.stop();
});

let counter = 0;
const newUser = async (name = "Person") => {
  counter += 1;
  const res = await request(app)
    .post("/api/auth/register")
    .send({ name, email: `c${counter}@example.com`, password: "Password123" });
  return { id: String(res.body.user.id), token: res.body.token, name };
};
const auth = (user) => ({ Authorization: `Bearer ${user.token}` });

const PHOTO = "https://res.cloudinary.com/test-cloud/image/upload/v1/plotpost/posts/a.jpg";
const makePost = (seller, extra = {}) =>
  Post.create({
    user: seller.id,
    title: "Villa in Nadakkavu",
    location: "Nadakkavu, Kozhikode",
    price: "₹1.2 crore",
    platform: "PlotPost",
    imageUrls: [PHOTO],
    ...extra,
  });

const comment = (user, post, text) =>
  request(app).post(`/api/posts/${post._id}/comment`).set(auth(user)).send({ text });
const comments = (post, user, query = "") => {
  const req = request(app).get(`/api/posts/${post._id}/comments${query}`);
  return user ? req.set(auth(user)) : req;
};
const report = (user, post, body) =>
  request(app).post(`/api/posts/${post._id}/report`).set(auth(user)).send(body);

// -------------------------------------------------------------- reading
describe("reading comments", () => {
  test("guests can read; newest first; names and photos but no emails; Seller label", async () => {
    const seller = await newUser("Ravi Seller");
    const buyer = await newUser("Anjali");
    const post = await makePost(seller);
    await comment(buyer, post, "Is the price negotiable?");
    await comment(seller, post, "Yes, a little.");

    const res = await comments(post);
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ total: 2, hasMore: false });
    expect(res.body.comments.map((c) => [c.user.name, c.text, c.isSeller])).toEqual([
      ["Ravi Seller", "Yes, a little.", true],
      ["Anjali", "Is the price negotiable?", false],
    ]);
    expect(res.body.comments[0].user.email).toBeUndefined();
    expect(res.body.comments[0].createdAt).toBeTruthy();
    // Guests can't delete anything.
    expect(res.body.comments.every((c) => c.canDelete === false)).toBe(true);
  });

  test("who may delete: your own comments, and every comment on your post", async () => {
    const seller = await newUser("Seller");
    const buyer = await newUser("Buyer");
    const other = await newUser("Other");
    const post = await makePost(seller);
    await comment(buyer, post, "From the buyer");

    const flag = async (user) => (await comments(post, user)).body.comments[0].canDelete;
    expect(await flag(buyer)).toBe(true);
    expect(await flag(seller)).toBe(true);
    expect(await flag(other)).toBe(false);
  });

  test("20 at a time with hasMore; a deleted post gives 404", async () => {
    const seller = await newUser("Seller");
    const post = await makePost(seller);
    const many = Array.from({ length: 25 }, (_, i) => ({
      user: new mongoose.Types.ObjectId(seller.id),
      text: `Comment ${i}`,
      createdAt: new Date(Date.UTC(2026, 0, 1, 0, i)),
    }));
    await Post.updateOne({ _id: post._id }, { $set: { comments: many } });

    const page1 = await comments(post);
    expect(page1.body.comments).toHaveLength(20);
    expect(page1.body.comments[0].text).toBe("Comment 24");
    expect(page1.body).toMatchObject({ total: 25, hasMore: true });
    const page2 = await comments(post, null, "?page=2");
    expect(page2.body.comments.map((c) => c.text)).toEqual(["Comment 4", "Comment 3", "Comment 2", "Comment 1", "Comment 0"]);
    expect(page2.body.hasMore).toBe(false);

    await Post.deleteOne({ _id: post._id });
    expect((await comments(post)).status).toBe(404);
    expect((await request(app).get("/api/posts/nope/comments")).status).toBe(400);
  });
});

// -------------------------------------------------------------- posting
describe("posting comments", () => {
  test("returns the new comment and the count; the feed count goes up", async () => {
    const seller = await newUser("Seller");
    const buyer = await newUser("Buyer");
    const post = await makePost(seller);
    const before = (await Post.findById(post._id).lean()).updatedAt;

    const res = await comment(buyer, post, "   Road access?   ");
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({
      success: true,
      commentsCount: 1,
      comment: { text: "Road access?", user: { name: "Buyer" }, isSeller: false, canDelete: true },
    });

    const feed = await request(app).get("/api/posts");
    expect(feed.body.posts[0].commentsCount).toBe(1);
    // Commenting doesn't change the post's own date.
    expect((await Post.findById(post._id).lean()).updatedAt).toEqual(before);
  });

  test("needs login; empty and over-long comments are refused", async () => {
    const seller = await newUser("Seller");
    const post = await makePost(seller);

    expect((await request(app).post(`/api/posts/${post._id}/comment`).send({ text: "Hi" })).status).toBe(401);

    const empty = await comment(seller, post, "   ");
    expect(empty.status).toBe(400);
    expect(empty.body.message).toMatch(/write a comment/);

    const long = await comment(seller, post, "x".repeat(1001));
    expect(long.status).toBe(400);
    expect(long.body.message).toMatch(/1,000 characters/);
    expect((await comment(seller, post, "x".repeat(1000))).status).toBe(201);

    expect((await request(app).post(`/api/posts/${new mongoose.Types.ObjectId()}/comment`).set(auth(seller)).send({ text: "Hi" })).status).toBe(404);
  });

  // Real MongoDB (Atlas, or the temporary one `npm test` starts) adds
  // comments in one safe step. FerretDB, used for some test runs, can lose
  // writes that land at the same moment, so this one is skipped there.
  const onRealMongo = process.env.TEST_DB_IS_FERRETDB === "true" ? test.skip : test;
  onRealMongo("people commenting at the same moment all keep their comments", async () => {
    const seller = await newUser("Seller");
    const post = await makePost(seller);
    const people = await Promise.all(Array.from({ length: 6 }, (_, i) => newUser(`P${i}`)));

    const results = await Promise.all(people.map((p) => comment(p, post, `Hello from ${p.name}`)));
    expect(results.every((r) => r.status === 201)).toBe(true);
    expect((await comments(post)).body.total).toBe(6);
  });

  test("20 comments per 10 minutes per account, then a clear message", async () => {
    const seller = await newUser("Seller");
    const chatty = await newUser("Chatty");
    const post = await makePost(seller);

    for (let i = 0; i < 20; i += 1) {
      expect((await comment(chatty, post, `Comment ${i}`)).status).toBe(201);
    }
    const blocked = await comment(chatty, post, "One more");
    expect(blocked.status).toBe(429);
    expect(blocked.body.message).toMatch(/commenting very fast/);
    // Someone else isn't affected.
    expect((await comment(seller, post, "Still fine")).status).toBe(201);
  });
});

// ------------------------------------------------------------- deleting
describe("deleting comments", () => {
  test("you can delete yours; the seller can delete any on their post; others can't", async () => {
    const seller = await newUser("Seller");
    const buyer = await newUser("Buyer");
    const other = await newUser("Other");
    const post = await makePost(seller);
    const mine = (await comment(buyer, post, "Mine")).body.comment;
    const spam = (await comment(other, post, "Spam")).body.comment;
    const keep = (await comment(other, post, "Keep this")).body.comment;
    const del = (user, c) => request(app).delete(`/api/posts/${post._id}/comments/${c._id}`).set(auth(user));

    expect((await del(other, mine)).status).toBe(403);
    const own = await del(buyer, mine);
    expect(own.body).toMatchObject({ success: true, commentsCount: 2 });
    expect((await del(seller, spam)).body).toMatchObject({ success: true, commentsCount: 1 });

    expect((await comments(post)).body.comments.map((c) => c.text)).toEqual(["Keep this"]);
    expect((await del(buyer, mine)).status).toBe(404);
    expect((await request(app).delete(`/api/posts/${post._id}/comments/${keep._id}`)).status).toBe(401);
    expect((await request(app).delete(`/api/posts/${post._id}/comments/bad`).set(auth(seller))).status).toBe(400);
  });
});

// -------------------------------------------------------------- reports
describe("reports", () => {
  test("stored with reason and details; reporting again updates the same report", async () => {
    const seller = await newUser("Seller");
    const buyer = await newUser("Buyer");
    const post = await makePost(seller);

    const first = await report(buyer, post, { reason: "Spam, scam, or fraud", details: "Asked for advance money" });
    expect(first.status).toBe(201);
    expect(first.body).toMatchObject({ success: true, updated: false });

    await markDone(String(post._id), { log: () => {} });
    const again = await report(buyer, post, { reason: "Fake or misleading listing" });
    expect(again.status).toBe(200);
    expect(again.body.updated).toBe(true);

    const all = await Report.find({}).lean();
    expect(all).toHaveLength(1);
    expect(all[0]).toMatchObject({ reason: "Fake or misleading listing", details: "", status: "open" });
    // The post itself is untouched (no auto-hide).
    expect((await request(app).get("/api/posts")).body.total).toBe(1);
  });

  test("needs login; bad reasons, long details and your own post are refused", async () => {
    const seller = await newUser("Seller");
    const buyer = await newUser("Buyer");
    const post = await makePost(seller);

    expect((await request(app).post(`/api/posts/${post._id}/report`).send({ reason: "Other reason" })).status).toBe(401);
    expect((await report(buyer, post, { reason: "I don't like it" })).body.message).toMatch(/choose a reason/);
    expect((await report(buyer, post, { reason: "Other reason", details: "x".repeat(501) })).status).toBe(400);

    const own = await report(seller, post, { reason: "Other reason" });
    expect(own.status).toBe(400);
    expect(own.body.message).toMatch(/your own post/);
    expect((await report(buyer, { _id: new mongoose.Types.ObjectId() }, { reason: "Other reason" })).status).toBe(404);
    expect(await Report.countDocuments()).toBe(0);
  });

  test("10 reports per hour per account", async () => {
    const seller = await newUser("Seller");
    const buyer = await newUser("Buyer");
    const posts = await Promise.all(Array.from({ length: 11 }, (_, i) => makePost(seller, { title: `Post ${i}` })));

    for (let i = 0; i < 10; i += 1) {
      expect((await report(buyer, posts[i], { reason: "Other reason" })).status).toBe(201);
    }
    const blocked = await report(buyer, posts[10], { reason: "Other reason" });
    expect(blocked.status).toBe(429);
    expect(blocked.body.message).toMatch(/Too many reports/);
  });

  test("the review script groups reports by post, most reported first, and marks them done", async () => {
    const seller = await newUser("Seller");
    const a = await newUser("Reporter A");
    const b = await newUser("Reporter B");
    const busy = await makePost(seller, { title: "Busy post" });
    const quiet = await makePost(seller, { title: "Quiet post" });
    const gone = await makePost(seller, { title: "Gone post" });
    await report(a, quiet, { reason: "Incorrect price or location" });
    await report(a, busy, { reason: "Spam, scam, or fraud", details: "Wants advance" });
    await report(b, busy, { reason: "Fake or misleading listing" });
    await report(b, gone, { reason: "Other reason" });
    await Post.deleteOne({ _id: gone._id });

    const lines = [];
    const groups = await listReports({ log: (line) => lines.push(line) });
    expect(groups.map((g) => g.post?.title ?? "(deleted)")).toEqual(["Busy post", expect.any(String), expect.any(String)]);
    const text = lines.join("\n");
    expect(text).toMatch(/Busy post/);
    expect(text).toMatch(/2 reports:/);
    expect(text).toMatch(/"Wants advance"/);
    expect(text).toMatch(/POST \(deleted since\)/);
    expect(text).toMatch(/4 reports on 3 posts/);

    expect(await markDone(String(busy._id), { log: () => {} })).toBe(2);
    const open = await listReports({ log: () => {} });
    expect(open.map((g) => g.post?.title ?? "(deleted)").sort()).toEqual(["(deleted)", "Quiet post"]);
    expect(await listReports({ all: true, log: () => {} })).toHaveLength(3);
  });
});

// --------------------------------------------------------------- shares
describe("share counts", () => {
  test("counted once per person per day, never the seller's own, shown only to the seller", async () => {
    const seller = await newUser("Seller");
    const buyer = await newUser("Buyer");
    const post = await makePost(seller);
    const share = (user) => request(app).post(`/api/posts/${post._id}/contact`).set(auth(user)).send({ action: "share" });

    expect((await share(buyer)).body.counted).toBe(true);
    expect((await share(buyer)).body.counted).toBe(false);
    expect((await share(seller)).body.counted).toBe(false);

    const mine = await request(app).get("/api/posts/my").set(auth(seller));
    expect(mine.body.posts[0].stats).toEqual({ calls: 0, linkOpens: 0, shares: 1 });
    const theirs = await request(app).get(`/api/posts/${post._id}`).set(auth(buyer));
    expect(theirs.body.post.stats).toBeUndefined();

    expect((await request(app).post(`/api/posts/${post._id}/contact`).send({ action: "fax" })).status).toBe(400);
  });
});

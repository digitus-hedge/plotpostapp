// Phase 2, Step 1: reporting comments and people, blocking hides content,
// the offensive-word filter on every route, Terms of Use, and request checks.
// Uses TEST_MONGODB_URI if set, otherwise a temporary MongoDB. Never your
// real database.
process.env.NODE_ENV = "test";
process.env.JWT_SECRET = "test-secret-that-is-long-enough-for-signing-tokens";

const request = require("supertest");
const mongoose = require("mongoose");
const app = require("../server");
const User = require("../models/User");
const Post = require("../models/Post");
const Report = require("../models/Report");
const Enquiry = require("../models/Enquiry");
const Conversation = require("../models/Conversation");
const Message = require("../models/Message");
const Follow = require("../models/Follow");

let memoryServer;

beforeAll(async () => {
  let uri = process.env.TEST_MONGODB_URI;
  if (!uri) {
    const { MongoMemoryServer } = require("mongodb-memory-server-core");
    memoryServer = await MongoMemoryServer.create();
    uri = memoryServer.getUri();
  }
  const url = new URL(uri);
  url.pathname = "/plotpost_test_moderation";
  await mongoose.connect(url.toString());
  await mongoose.connection.db.dropDatabase();
  await Promise.all(Object.values(mongoose.models).map((model) => model.createIndexes()));
});

afterEach(async () => {
  await Promise.all(
    [User, Post, Report, Enquiry, Conversation, Message, Follow].map((model) => model.deleteMany({}))
  );
});

afterAll(async () => {
  await mongoose.connection.db.dropDatabase();
  await mongoose.disconnect();
  if (memoryServer) await memoryServer.stop();
});

let counter = 0;
const newUser = async (name = "Person", extra = {}) => {
  counter += 1;
  const res = await request(app)
    .post("/api/auth/register")
    .send({ name, email: `m${counter}@example.com`, password: "Password123", ...extra });
  expect(res.status).toBe(201);
  return { id: String(res.body.user.id), token: res.body.token, name, user: res.body.user };
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
const block = (me, other) => request(app).post(`/api/users/${other.id}/block`).set(auth(me));
const unblock = (me, other) => request(app).delete(`/api/users/${other.id}/block`).set(auth(me));
const feedTitles = async (user, query = "") =>
  (await request(app).get(`/api/posts${query}`).set(auth(user))).body.posts.map((p) => p.title);

// -------------------------------------------------------------- reports
describe("reporting comments and people", () => {
  test("a comment report stores the comment, its author and a copy of the text; again = update", async () => {
    const seller = await newUser("Seller");
    const rude = await newUser("Rude");
    const reporter = await newUser("Reporter");
    const post = await makePost(seller);
    const posted = await comment(rude, post, "Overpriced, don't buy");
    const commentId = posted.body.comment._id;
    const url = `/api/posts/${post._id}/comments/${commentId}/report`;

    const first = await request(app).post(url).set(auth(reporter)).send({ reason: "Spam or scam" });
    expect(first.status).toBe(201);
    expect(first.body.message).toMatch(/review this comment/);

    const again = await request(app)
      .post(url)
      .set(auth(reporter))
      .send({ reason: "Harassment or bullying", details: "Keeps posting this" });
    expect(again.status).toBe(200);
    expect(again.body.updated).toBe(true);

    const saved = await Report.find({ kind: "comment" }).lean();
    expect(saved).toHaveLength(1);
    expect(saved[0]).toMatchObject({
      reason: "Harassment or bullying",
      details: "Keeps posting this",
      commentText: "Overpriced, don't buy",
      status: "open",
    });
    expect(String(saved[0].reportedUser)).toBe(rude.id);
    expect(String(saved[0].comment)).toBe(String(commentId));
  });

  test("the same person can report a post and a comment on it, and the author", async () => {
    const seller = await newUser("Seller");
    const reporter = await newUser("Reporter");
    const post = await makePost(seller);
    const c = (await comment(seller, post, "Call me now")).body.comment;

    expect((await request(app).post(`/api/posts/${post._id}/report`).set(auth(reporter)).send({ reason: "Spam, scam, or fraud" })).status).toBe(201);
    expect((await request(app).post(`/api/posts/${post._id}/comments/${c._id}/report`).set(auth(reporter)).send({ reason: "Spam or scam" })).status).toBe(201);
    expect((await request(app).post(`/api/users/${seller.id}/report`).set(auth(reporter)).send({ reason: "Pretending to be someone else" })).status).toBe(201);

    const kinds = (await Report.find().lean()).map((r) => r.kind).sort();
    expect(kinds).toEqual(["comment", "post", "user"]);
    const all = await Report.find().lean();
    expect(all.every((r) => String(r.reportedUser) === seller.id)).toBe(true);
  });

  test("refused: guests, your own comment or account, wrong reasons, missing comment", async () => {
    const seller = await newUser("Seller");
    const other = await newUser("Other");
    const post = await makePost(seller);
    const c = (await comment(seller, post, "Hello")).body.comment;
    const url = `/api/posts/${post._id}/comments/${c._id}/report`;

    expect((await request(app).post(url).send({ reason: "Spam or scam" })).status).toBe(401);
    expect((await request(app).post(url).set(auth(seller)).send({ reason: "Spam or scam" })).status).toBe(400);
    expect((await request(app).post(`/api/users/${seller.id}/report`).set(auth(seller)).send({ reason: "Spam or scam" })).status).toBe(400);
    const wrong = await request(app).post(url).set(auth(other)).send({ reason: "Fake or misleading listing" });
    expect(wrong.status).toBe(400);
    expect(wrong.body.message).toMatch(/choose a reason/);
    const missing = `/api/posts/${post._id}/comments/${new mongoose.Types.ObjectId()}/report`;
    expect((await request(app).post(missing).set(auth(other)).send({ reason: "Spam or scam" })).status).toBe(404);
    expect((await request(app).post(`/api/users/${new mongoose.Types.ObjectId()}/report`).set(auth(other)).send({ reason: "Spam or scam" })).status).toBe(404);
  });

  test("reports from before this update are upgraded and the old index is dropped", async () => {
    const seller = await newUser("Seller");
    const reporter = await newUser("Reporter");
    const post = await makePost(seller);
    // An old-style report (no kind) and the old unique index.
    await Report.collection.insertOne({
      post: post._id,
      reporter: new mongoose.Types.ObjectId(reporter.id),
      reason: "Other reason",
      details: "",
      status: "open",
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    await Report.collection.createIndex({ post: 1, reporter: 1 }, { unique: true });

    await Report.upgradeOldReports();
    await Report.upgradeOldReports(); // safe to run again

    expect((await Report.findOne().lean()).kind).toBe("post");
    const names = (await Report.collection.indexes()).map((index) => index.name);
    expect(names).not.toContain("post_1_reporter_1");

    // Reporting the same post again updates the old report.
    const res = await request(app).post(`/api/posts/${post._id}/report`).set(auth(reporter)).send({ reason: "Spam, scam, or fraud" });
    expect(res.body.updated).toBe(true);
    expect(await Report.countDocuments()).toBe(1);
  });
});

// -------------------------------------------------------------- blocking
describe("blocking hides the person's content", () => {
  test("their posts leave your feed, search, Following tab and Saved; others still see them", async () => {
    const me = await newUser("Me");
    const blocked = await newUser("Blocked Seller");
    const friend = await newUser("Friend");
    const theirs = await makePost(blocked, { title: "Blocked villa" });
    await makePost(friend, { title: "Friend villa" });
    await request(app).post(`/api/users/${blocked.id}/follow`).set(auth(me));
    await request(app).post(`/api/users/${friend.id}/follow`).set(auth(me));
    await request(app).post(`/api/users/saved/${theirs._id}`).set(auth(me)).send({ saved: true });

    expect((await feedTitles(me)).sort()).toEqual(["Blocked villa", "Friend villa"]);
    expect((await block(me, blocked)).body.message).toMatch(/won't see their posts/);

    expect(await feedTitles(me)).toEqual(["Friend villa"]);
    expect(await feedTitles(me, "?q=villa")).toEqual(["Friend villa"]);
    expect(await feedTitles(me, "?feed=following")).toEqual(["Friend villa"]);
    const saved = await request(app).get("/api/users/saved").set(auth(me));
    expect(saved.body.savedPosts).toEqual([]);
    const byIds = await request(app).get(`/api/posts/by-ids?ids=${theirs._id}`).set(auth(me));
    expect(byIds.body.posts).toEqual([]);
    const following = await request(app).get("/api/users/following").set(auth(me));
    expect(following.body.following.map((s) => s.name)).toEqual(["Friend"]);
    const suggested = await request(app).get("/api/users/suggested-sellers").set(auth(me));
    expect(suggested.body.sellers.map((s) => s.name)).not.toContain("Blocked Seller");

    // Other people are not affected.
    expect((await feedTitles(friend)).sort()).toEqual(["Blocked villa", "Friend villa"]);

    // The details page still opens by link, marked as blocked.
    const details = await request(app).get(`/api/posts/${theirs._id}`).set(auth(me));
    expect(details.status).toBe(200);
    expect(details.body.seller.blockedByMe).toBe(true);

    // Unblocking brings everything back, saves included.
    await unblock(me, blocked);
    expect((await feedTitles(me)).sort()).toEqual(["Blocked villa", "Friend villa"]);
    expect((await request(app).get("/api/users/saved").set(auth(me))).body.savedPosts).toHaveLength(1);
  });

  test("their comments are hidden from you only", async () => {
    const seller = await newUser("Seller");
    const me = await newUser("Me");
    const troll = await newUser("Troll");
    const post = await makePost(seller);
    await comment(troll, post, "Rubbish post");
    await comment(seller, post, "Still available");

    await block(me, troll);
    const mine = await request(app).get(`/api/posts/${post._id}/comments`).set(auth(me));
    expect(mine.body.comments.map((c) => c.text)).toEqual(["Still available"]);
    expect(mine.body.total).toBe(1);
    const theirs = await request(app).get(`/api/posts/${post._id}/comments`);
    expect(theirs.body.comments).toHaveLength(2);
  });

  test("chats with them leave your Messages list and unread count", async () => {
    const me = await newUser("Me");
    const other = await newUser("Other");
    const chat = await request(app).post("/api/chats").set(auth(other)).send({ userId: me.id });
    const chatId = chat.body.chat._id;
    await request(app).post(`/api/chats/${chatId}/messages`).set(auth(other)).send({ text: "Hello there" });
    expect((await request(app).get("/api/chats").set(auth(me))).body.chats).toHaveLength(1);
    expect((await request(app).get("/api/chats/unread").set(auth(me))).body.unread).toBe(1);

    await block(me, other);
    const list = await request(app).get("/api/chats").set(auth(me));
    expect(list.body.chats).toEqual([]);
    expect(list.body.unread).toBe(0);
    expect((await request(app).get("/api/chats/unread").set(auth(me))).body.unread).toBe(0);
    // They can't send any more messages either (unchanged behaviour).
    const sent = await request(app).post(`/api/chats/${chatId}/messages`).set(auth(other)).send({ text: "Hello?" });
    expect(sent.status).toBe(403);

    await unblock(me, other);
    expect((await request(app).get("/api/chats").set(auth(me))).body.chats).toHaveLength(1);
  });

  test("inquiries: hidden from the seller, and new ones refused with a vague message", async () => {
    const seller = await newUser("Seller");
    const buyer = await newUser("Buyer");
    const post = await makePost(seller);
    const interest = {
      postId: String(post._id),
      name: "Buyer",
      phone: "9895000000",
      message: "I am interested in this villa",
      contactMethod: "Phone call",
    };
    expect((await request(app).post("/api/enquiries").set(auth(buyer)).send(interest)).status).toBe(201);
    expect((await request(app).get("/api/enquiries/received").set(auth(seller))).body.enquiries).toHaveLength(1);

    await block(seller, buyer);
    expect((await request(app).get("/api/enquiries/received").set(auth(seller))).body.enquiries).toEqual([]);
    const again = await request(app).post("/api/enquiries").set(auth(buyer)).send(interest);
    expect(again.status).toBe(403);
    expect(again.body.message).toBe("You can't contact this seller.");
  });

  test("the Blocked people list, newest first; guests and bad IDs refused", async () => {
    const me = await newUser("Me");
    const first = await newUser("First");
    const second = await newUser("Second");
    await block(me, first);
    await block(me, second);
    const list = await request(app).get("/api/users/blocked").set(auth(me));
    expect(list.body.users.map((u) => u.name)).toEqual(["Second", "First"]);
    expect(Object.keys(list.body.users[0]).sort()).toEqual(["_id", "name", "profileImage"]);
    await unblock(me, second);
    expect((await request(app).get("/api/users/blocked").set(auth(me))).body.users.map((u) => u.name)).toEqual(["First"]);
    expect((await request(app).get("/api/users/blocked")).status).toBe(401);
  });
});

// -------------------------------------------------------------- word filter
describe("offensive words are refused", () => {
  test("posts: title, description, seller name and location", async () => {
    const seller = await newUser("Seller");
    const base = { title: "Plot for sale", location: "Chevayur", platform: "Instagram", socialUrl: "https://instagram.com/p/abc" };
    const bad = await request(app).post("/api/posts").set(auth(seller)).send({ ...base, description: "No sh1t buyers" });
    expect(bad.status).toBe(400);
    expect(bad.body).toMatchObject({ offensive: true, field: "description" });
    expect(bad.body.message).toMatch(/offensive language from the description/);
    expect(await Post.countDocuments()).toBe(0);

    const ok = await request(app).post("/api/posts").set(auth(seller)).send({ ...base, title: "Plot near Kunnamangalam" });
    expect(ok.status).toBe(201);
    const edit = await request(app).put(`/api/posts/${ok.body.post._id}`).set(auth(seller)).send({ title: "F*ck this price" });
    expect(edit.status).toBe(400);
    expect((await Post.findById(ok.body.post._id).lean()).title).toBe("Plot near Kunnamangalam");
  });

  test("comments, chat messages, inquiries, profile and sign-up", async () => {
    const seller = await newUser("Seller");
    const buyer = await newUser("Buyer");
    const post = await makePost(seller);

    expect((await comment(buyer, post, "what a bitch")).status).toBe(400);
    expect((await comment(buyer, post, "Is this still available?")).status).toBe(201);

    const chat = await request(app).post("/api/chats").set(auth(buyer)).send({ userId: seller.id });
    const send = (text) => request(app).post(`/api/chats/${chat.body.chat._id}/messages`).set(auth(buyer)).send({ text });
    expect((await send("you are a chutiya")).status).toBe(400);
    expect((await send("Can I visit on Sunday?")).status).toBe(201);

    const enquiry = await request(app).post("/api/enquiries").set(auth(buyer)).send({
      postId: String(post._id),
      name: "Buyer",
      phone: "9895000000",
      message: "Reply fast you bastard",
    });
    expect(enquiry.status).toBe(400);

    expect((await request(app).put("/api/users/profile").set(auth(buyer)).send({ bio: "Total a$$hole" })).status).toBe(400);
    expect((await request(app).put("/api/users/profile").set(auth(buyer)).send({ bio: "Looking for a home" })).status).toBe(200);

    const signUp = await request(app).post("/api/auth/register").send({ name: "Myre Man", email: "x1@example.com", password: "Password123" });
    expect(signUp.status).toBe(400);
  });
});

// -------------------------------------------------------------- terms
describe("Terms of Use", () => {
  test("the sign-up checkbox saves the date; without it the app asks later", async () => {
    const agreed = await newUser("Agreed", { acceptTerms: true });
    expect(agreed.user.termsAcceptedAt).toBeTruthy();
    const later = await newUser("Later");
    expect(later.user.termsAcceptedAt).toBeNull();
    const profile = await request(app).get("/api/users/profile").set(auth(later));
    expect(profile.body.user.termsAcceptedAt).toBeNull();

    const accepted = await request(app).post("/api/users/accept-terms").set(auth(later));
    expect(accepted.status).toBe(200);
    const firstDate = accepted.body.termsAcceptedAt;
    expect(firstDate).toBeTruthy();
    // Agreeing again keeps the first date.
    expect((await request(app).post("/api/users/accept-terms").set(auth(later))).body.termsAcceptedAt).toBe(firstDate);
    expect((await request(app).get("/api/users/profile").set(auth(later))).body.user.termsAcceptedAt).toBe(firstDate);
    expect((await request(app).post("/api/users/accept-terms")).status).toBe(401);
  });
});

// -------------------------------------------------------------- request checks
describe("request checks run again (middleware/validate.js fix)", () => {
  test("empty comments, bad report reasons and short inquiry messages are refused", async () => {
    const seller = await newUser("Seller");
    const buyer = await newUser("Buyer");
    const post = await makePost(seller);
    const empty = await comment(buyer, post, "   ");
    expect(empty.status).toBe(400);
    expect(empty.body.message).toBe("Please write a comment.");
    const reason = await request(app).post(`/api/posts/${post._id}/report`).set(auth(buyer)).send({ reason: "Because" });
    expect(reason.status).toBe(400);
    const short = await request(app).post("/api/enquiries").set(auth(buyer)).send({
      postId: String(post._id),
      name: "Buyer",
      phone: "9895000000",
      message: "Hi",
    });
    expect(short.status).toBe(400);
    expect(short.body.message).toMatch(/at least 10 characters/);
  });
});

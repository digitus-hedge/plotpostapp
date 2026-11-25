// Phase 5 Step 1: deleting an account from the website with an emailed code,
// and the 12-month clean-up of old reports and admin log rows.
// Cloudinary is faked: nothing is really deleted.
// Uses TEST_MONGODB_URI if set, otherwise a temporary MongoDB. Never your real database.
const request = require("supertest");
const app = require("../app");
const db = require("./helpers/db");
const cloudinary = require("../config/cloudinary");
const emailService = require("../services/emailService");
const User = require("../models/User");
const Post = require("../models/Post");
const Follow = require("../models/Follow");
const PostView = require("../models/PostView");
const Enquiry = require("../models/Enquiry");
const Conversation = require("../models/Conversation");
const Message = require("../models/Message");
const Report = require("../models/Report");
const AdminAction = require("../models/AdminAction");
const { runRetentionCleanup } = require("../services/retentionService");

const { outbox } = emailService;

let destroyed;
beforeAll(() => db.connect("account_deletion"));
beforeEach(() => {
  destroyed = [];
  jest.spyOn(cloudinary.uploader, "destroy").mockImplementation(async (id) => {
    destroyed.push(id);
    return { result: "ok" };
  });
});
afterEach(async () => {
  jest.restoreAllMocks();
  outbox.length = 0;
  await db.clear();
});
afterAll(() => db.close());

let counter = 0;
const newUser = async (name = "Asha Nair") => {
  counter += 1;
  const email = `person${counter}@example.com`;
  const res = await request(app)
    .post("/api/auth/register")
    .send({ name, email, password: "Password123", acceptTerms: true });
  return { id: res.body.user.id, token: res.body.token, email };
};
const auth = (who) => ({ Authorization: `Bearer ${who.token}` });
const photo = (name) => `https://res.cloudinary.com/test-cloud/image/upload/v1/plotpost/posts/${name}.jpg`;
const makePost = async (who, extra = {}) => {
  const res = await request(app)
    .post("/api/posts")
    .set(auth(who))
    .send({
      title: "10 cent plot near Chevayur",
      type: "Plot",
      deal: "For sale",
      price: "₹38 lakh",
      location: "Chevayur, Kozhikode",
      description: "Level plot with road access",
      platform: "PlotPost",
      imageUrls: [photo("a")],
      ...extra,
    });
  return res.body.post;
};

const askCode = (email) => request(app).post("/api/auth/delete-account/request-code").send({ email });
const confirm = (email, code) => request(app).post("/api/auth/delete-account/confirm").send({ email, code });
const lastCode = (email) => [...outbox].reverse().find((m) => m.to === email && m.kind === "delete")?.code;
const skipCooldown = (email) =>
  User.collection.updateOne({ email }, { $set: { "accountDeletion.sentAt": new Date(Date.now() - 5 * 60 * 1000) } });

describe("asking for a deletion code", () => {
  test("emails a 6-digit code; the answer is the same whether or not the account exists", async () => {
    const me = await newUser();
    const known = await askCode(me.email);
    const unknown = await askCode("nobody@example.com");
    expect(known.status).toBe(200);
    expect(unknown.status).toBe(200);
    expect(unknown.body.message).toBe(known.body.message);
    expect(lastCode(me.email)).toMatch(/^\d{6}$/);
    expect(outbox.filter((m) => m.to === "nobody@example.com")).toHaveLength(0);
    // Only a hash of the code is stored.
    const saved = await User.findOne({ email: me.email }).select("+accountDeletion").lean();
    expect(saved.accountDeletion.codeHash).toBeTruthy();
    expect(JSON.stringify(saved)).not.toContain(lastCode(me.email));
  });

  test("a second request within a minute sends nothing new but answers the same", async () => {
    const me = await newUser();
    await askCode(me.email);
    const again = await askCode(me.email);
    expect(again.status).toBe(200);
    expect(outbox.filter((m) => m.kind === "delete")).toHaveLength(1);
  });

  test("the email address is matched without caring about capitals", async () => {
    const me = await newUser();
    await askCode(me.email.toUpperCase());
    expect(lastCode(me.email)).toMatch(/^\d{6}$/);
  });
});

describe("confirming with the code", () => {
  test("a wrong code deletes nothing; after 5 wrong tries even the right code stops working", async () => {
    const me = await newUser();
    await askCode(me.email);
    const code = lastCode(me.email);
    const wrong = code === "000000" ? "111111" : "000000";
    for (let i = 0; i < 5; i += 1) {
      expect((await confirm(me.email, wrong)).status).toBe(400);
    }
    expect((await confirm(me.email, code)).status).toBe(400);
    expect(await User.countDocuments({ email: me.email })).toBe(1);

    // A new code works again.
    await skipCooldown(me.email);
    await askCode(me.email);
    expect((await confirm(me.email, lastCode(me.email))).status).toBe(200);
  });

  test("a reset or verification code can't be used to delete", async () => {
    const me = await newUser();
    await request(app).post("/api/auth/forgot-password").send({ email: me.email });
    const resetCode = [...outbox].reverse().find((m) => m.kind === "reset").code;
    const verifyCode = [...outbox].reverse().find((m) => m.kind === "verify").code;
    expect((await confirm(me.email, resetCode)).status).toBe(400);
    expect((await confirm(me.email, verifyCode)).status).toBe(400);
    expect(await User.countDocuments({ email: me.email })).toBe(1);
  });

  test("an unknown email gets the same wrong-code answer", async () => {
    const res = await confirm("nobody@example.com", "123456");
    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/wrong or has expired/);
  });

  test("the right code deletes the account and everything the app's Delete Account removes", async () => {
    const me = await newUser("Leaving");
    const other = await newUser("Staying");

    const mine = await makePost(me, { imageUrls: [photo("mine1"), photo("mine2")] });
    await request(app).post(`/api/posts/${mine._id}/view`).set(auth(other));
    await request(app).post(`/api/users/saved/${mine._id}`).set(auth(other)).send({ saved: true });
    await request(app).post("/api/enquiries").send({
      postId: String(mine._id), name: "Buyer", phone: "9847000000", message: "Please share details.",
    });

    const theirs = await makePost(other, { title: "Their post", imageUrls: [photo("theirs")] });
    await request(app).post(`/api/posts/${theirs._id}/view`).set(auth(me));
    await request(app).post(`/api/posts/${theirs._id}/comment`).set(auth(other)).send({ text: "Seller here." });
    await request(app).post(`/api/posts/${theirs._id}/comment`).set(auth(me)).send({ text: "Mine, please delete." });
    await request(app).post(`/api/posts/${theirs._id}/like`).set(auth(me));
    await request(app).post(`/api/posts/${theirs._id}/report`).set(auth(me)).send({ reason: "Other reason" });
    await request(app).post(`/api/users/${other.id}/follow`).set(auth(me));
    await request(app).post(`/api/users/${me.id}/follow`).set(auth(other));

    const chat = await request(app).post("/api/chats").set(auth(me)).send({ userId: other.id });
    const chatId = chat.body.chat._id;
    await request(app).post(`/api/chats/${chatId}/messages`).set(auth(me)).send({ text: "Hello there" });
    await request(app).post(`/api/chats/${chatId}/messages`).set(auth(other)).send({ text: "Hi!" });

    await askCode(me.email);
    const res = await confirm(me.email, lastCode(me.email));
    expect(res.status).toBe(200);
    expect(res.body.message).toMatch(/deleted/);

    expect(await User.countDocuments({ _id: me.id })).toBe(0);
    expect(await Post.countDocuments({ _id: mine._id })).toBe(0);
    expect(destroyed.sort()).toEqual(["plotpost/posts/mine1", "plotpost/posts/mine2"]);
    expect(await Enquiry.countDocuments()).toBe(0);
    expect(await Follow.countDocuments()).toBe(0);
    expect(await Conversation.countDocuments()).toBe(0);
    expect(await Message.countDocuments()).toBe(0);
    // Their view records of my post, and mine of theirs.
    expect(await PostView.countDocuments({ post: mine._id })).toBe(0);
    expect(await PostView.countDocuments({ viewer: `user:${me.id}` })).toBe(0);

    const theirPost = await Post.findById(theirs._id).lean();
    expect(theirPost.comments.map((c) => c.text)).toEqual(["Seller here."]);
    expect(theirPost.likes.map(String)).toEqual([]);
    expect((await User.findById(other.id).lean()).savedPosts).toEqual([]);
    // Reports stay (deleted 12 months after closing).
    expect(await Report.countDocuments({ post: theirs._id })).toBe(1);

    // The old login stops working; the code can't be used twice.
    expect((await request(app).get("/api/users/profile").set(auth(me))).status).toBe(401);
    expect((await confirm(me.email, "123456")).status).toBe(400);
  });

  test("works for accounts made with Google (no password)", async () => {
    const google = await User.create({ name: "G", email: "g@example.com", googleId: "google-123" });
    await askCode("g@example.com");
    expect((await confirm("g@example.com", lastCode("g@example.com"))).status).toBe(200);
    expect(await User.countDocuments({ _id: google._id })).toBe(0);
  });
});

describe("12-month clean-up", () => {
  test("deletes closed reports and admin log rows older than 12 months, nothing newer or still open", async () => {
    const reporter = await User.create({ name: "R", email: "r@example.com", password: "x" });
    const now = new Date("2027-12-01T00:00:00Z");
    const old = new Date("2026-11-01T00:00:00Z");
    const recent = new Date("2027-06-01T00:00:00Z");
    const base = { kind: "person", reportedUser: reporter._id, reporter: reporter._id, reason: "Spam or scam" };
    const insert = (doc) => Report.collection.insertOne({ ...base, ...doc, createdAt: old, updatedAt: old });
    await insert({ status: "done", resolvedAt: old });
    await insert({ status: "done", resolvedAt: recent });
    await insert({ status: "open", resolvedAt: null });
    await AdminAction.collection.insertMany([
      { admin: reporter._id, action: "ban_user", createdAt: old, updatedAt: old },
      { admin: reporter._id, action: "unban_user", createdAt: recent, updatedAt: recent },
    ]);

    const removed = await runRetentionCleanup(now);
    expect(removed).toEqual({ reports: 1, adminActions: 1 });
    expect(await Report.countDocuments()).toBe(2);
    expect(await Report.countDocuments({ status: "open" })).toBe(1);
    expect(await AdminAction.countDocuments()).toBe(1);
  });
});

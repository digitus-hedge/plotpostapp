// Phase 3 Step 2: sold / rented, listing expiry (90 days), Renew, and the
// "expires in 3 days" / "has expired" notices.
// Uses TEST_MONGODB_URI if set, otherwise a temporary MongoDB. Never your real database.
process.env.NODE_ENV = "test";
process.env.JWT_SECRET = "test-secret-that-is-long-enough-for-signing-tokens";

const request = require("supertest");
const mongoose = require("mongoose");
const app = require("../server");
const User = require("../models/User");
const Post = require("../models/Post");
const Notification = require("../models/Notification");
const PushDevice = require("../models/PushDevice");
const pushService = require("../services/pushService");
const { runExpiryChecks } = require("../services/expiryService");

const DAY = 24 * 60 * 60 * 1000;
const MODELS = [User, Post, Notification, PushDevice];
let memoryServer;

beforeAll(async () => {
  let uri = process.env.TEST_MONGODB_URI;
  if (!uri) {
    const { MongoMemoryServer } = require("mongodb-memory-server-core");
    memoryServer = await MongoMemoryServer.create();
    uri = memoryServer.getUri();
  }
  const url = new URL(uri);
  url.pathname = "/plotpost_test_expiry";
  await mongoose.connect(url.toString());
  await mongoose.connection.db.dropDatabase();
  await Promise.all(MODELS.map((Model) => Model.createIndexes()));
});

afterEach(async () => {
  pushService.outbox.length = 0;
  await Promise.all(MODELS.map((Model) => Model.deleteMany({})));
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
    .send({ name, email: `ex${counter}@example.com`, password: "Password123" });
  return { id: String(res.body.user.id), token: res.body.token, name };
};
const auth = (user) => ({ Authorization: `Bearer ${user.token}` });
const addPhone = (user) =>
  request(app)
    .post("/api/notifications/devices")
    .set(auth(user))
    .send({ token: `fcm-test-token-${user.id}-${"x".repeat(24)}`, platform: "android" });

let made = 0;
const makePost = (seller, extra = {}) => {
  made += 1;
  return Post.create({
    user: seller.id,
    title: `Plot ${made} at Feroke`,
    location: "Feroke, Kozhikode",
    price: "₹30 lakh",
    platform: "Instagram",
    socialUrl: `https://www.instagram.com/p/exp${made}/`,
    ...extra,
  });
};
const inDays = (days) => new Date(Date.now() + days * DAY);
const feedIds = async (user) => {
  const req = request(app).get("/api/posts?limit=50");
  const res = user ? await req.set(auth(user)) : await req;
  return res.body.posts.map((p) => String(p._id));
};

describe("listing expiry", () => {
  test("new listings show for 90 days", async () => {
    const seller = await newUser();
    const post = await makePost(seller);
    const days = (new Date(post.expiresAt) - Date.now()) / DAY;
    expect(days).toBeGreaterThan(89.9);
    expect(days).toBeLessThanOrEqual(90);
  });

  test("expired listings leave the feed, the profile and inquiries, but stay in My Listings", async () => {
    const seller = await newUser("Ravi");
    const buyer = await newUser("Buyer");
    const live = await makePost(seller);
    const old = await makePost(seller, { expiresAt: inDays(-1) });

    expect(await feedIds()).toEqual([String(live._id)]);
    const profile = await request(app).get(`/api/users/${seller.id}`);
    expect(profile.body.user.stats).toMatchObject({ listings: 1, soldOrRented: 0 });
    const tabs = await Promise.all([
      request(app).get(`/api/users/${seller.id}/posts`),
      request(app).get(`/api/users/${seller.id}/posts?tab=sold`),
    ]);
    expect(tabs.map((t) => t.body.total)).toEqual([1, 0]);

    const mine = await request(app).get("/api/posts/my").set(auth(seller));
    const expired = mine.body.posts.find((p) => String(p._id) === String(old._id));
    expect(expired).toMatchObject({ isExpired: true, status: "active" });
    expect(expired).not.toHaveProperty("expiryReminderAt");
    expect(mine.body.posts.find((p) => String(p._id) === String(live._id)).isExpired).toBe(false);

    // Its own page still opens, marked as expired.
    expect((await request(app).get(`/api/posts/${old._id}`)).body.post.isExpired).toBe(true);

    const interest = await request(app)
      .post("/api/enquiries")
      .set(auth(buyer))
      .send({ postId: String(old._id), name: "Buyer", phone: "9895012345", message: "Is this still available?", contactMethod: "Phone call" });
    expect(interest.status).toBe(400);
    expect(interest.body.message).toBe("This listing has expired.");
  });

  test("posts made before expiry existed get 90 days from today", async () => {
    const seller = await newUser();
    const { insertedId } = await Post.collection.insertOne({
      user: new mongoose.Types.ObjectId(seller.id),
      title: "Old post",
      platform: "Facebook",
      socialUrl: "https://facebook.com/x",
      status: "active",
      removedAt: null,
      createdAt: new Date(Date.now() - 400 * DAY),
      updatedAt: new Date(Date.now() - 400 * DAY),
    });
    // Shows before the upgrade too (no date = not expired).
    expect(await feedIds()).toContain(String(insertedId));

    expect(await Post.upgradeOldPosts()).toBe(1);
    expect(await Post.upgradeOldPosts()).toBe(0);
    const upgraded = await Post.collection.findOne({ _id: insertedId });
    expect((upgraded.expiresAt - Date.now()) / DAY).toBeGreaterThan(89.9);
    expect(upgraded.updatedAt.getTime()).toBeLessThan(Date.now() - 399 * DAY);
  });
});

describe("Renew and Sold / Rented", () => {
  test("Renew shows an expired listing for another 90 days; only the seller can", async () => {
    const seller = await newUser();
    const other = await newUser("Other");
    const post = await makePost(seller, { expiresAt: inDays(-5), expiryReminderAt: inDays(-8), expiredNoticeAt: inDays(-5) });
    await Notification.create({ recipient: seller.id, type: "listing", groupKey: `listing:${post._id}`, post: post._id, lastAt: new Date() });

    expect((await request(app).post(`/api/posts/${post._id}/renew`)).status).toBe(401);
    expect((await request(app).post(`/api/posts/${post._id}/renew`).set(auth(other))).status).toBe(403);
    expect((await request(app).post("/api/posts/nope/renew").set(auth(seller))).status).toBe(400);

    const renewed = await request(app).post(`/api/posts/${post._id}/renew`).set(auth(seller));
    expect(renewed.status).toBe(200);
    expect(renewed.body.message).toBe("Renewed. It shows for another 90 days.");
    const fresh = await Post.findById(post._id).lean();
    expect((fresh.expiresAt - Date.now()) / DAY).toBeGreaterThan(89.9);
    expect(fresh).toMatchObject({ expiryReminderAt: null, expiredNoticeAt: null });
    expect(await feedIds()).toContain(String(post._id));
    expect(await Notification.countDocuments({ groupKey: `listing:${post._id}` })).toBe(0);
  });

  test("sold, rented and removed listings can't be renewed", async () => {
    const seller = await newUser();
    const sold = await makePost(seller, { status: "sold" });
    const removed = await makePost(seller, { removedAt: new Date(), removedReason: "Fake" });
    const a = await request(app).post(`/api/posts/${sold._id}/renew`).set(auth(seller));
    expect(a.status).toBe(400);
    expect(a.body.message).toMatch(/Mark it as active/);
    expect((await request(app).post(`/api/posts/${removed._id}/renew`).set(auth(seller))).status).toBe(400);
  });

  test("marking sold or rented leaves the feed; marking active again starts a new 90 days", async () => {
    const seller = await newUser();
    const post = await makePost(seller, { expiresAt: inDays(10) });
    const status = (value) =>
      request(app).patch(`/api/posts/${post._id}/status`).set(auth(seller)).send({ status: value });

    expect((await status("sold")).body).toMatchObject({ status: "sold", message: "Marked as sold." });
    expect(await feedIds()).not.toContain(String(post._id));
    expect((await status("rented")).body.status).toBe("rented");

    const back = await status("active");
    expect(back.body.message).toBe("Marked as active. It shows for 90 days.");
    expect((new Date(back.body.expiresAt) - Date.now()) / DAY).toBeGreaterThan(89.9);
    expect(await feedIds()).toContain(String(post._id));

    // Already active and not expired: the date stays.
    const before = (await Post.findById(post._id).lean()).expiresAt.getTime();
    expect((await status("active")).body.message).toBe("Marked as active.");
    expect((await Post.findById(post._id).lean()).expiresAt.getTime()).toBe(before);

    // Active but expired: marking active renews it.
    await Post.updateOne({ _id: post._id }, { expiresAt: inDays(-1) });
    expect((await status("active")).body.message).toBe("Marked as active. It shows for 90 days.");
    expect(await feedIds()).toContain(String(post._id));
  });
});

describe("expiry notices", () => {
  test("3 days before, and when expired: once each, with a phone alert", async () => {
    const seller = await newUser("Ravi");
    await addPhone(seller);
    const soon = await makePost(seller, { title: "Villa at Kakkodi", expiresAt: inDays(2.5) });
    const gone = await makePost(seller, { title: "Plot at Mavoor", expiresAt: inDays(-0.1) });
    await makePost(seller, { expiresAt: inDays(20) }); // not yet
    await makePost(seller, { status: "sold", expiresAt: inDays(-3) }); // sold: no notice
    await makePost(seller, { removedAt: new Date(), expiresAt: inDays(1) }); // removed: no notice

    expect(await runExpiryChecks()).toEqual({ reminders: 1, expired: 1 });
    expect(await runExpiryChecks()).toEqual({ reminders: 0, expired: 0 });

    const rows = await Notification.find({ recipient: seller.id, type: "listing" }).lean();
    expect(rows.map((r) => r.preview).sort()).toEqual([
      "Expired. It no longer shows in the feed. Renew it in My Listings to show it again.",
      "Expires in 3 days. Renew it in My Listings to keep it in the feed.",
    ]);
    expect(pushService.outbox.map((a) => a.title).sort()).toEqual(["Your listing expires soon", "Your listing has expired"].sort());
    expect(pushService.outbox.find((a) => a.title === "Your listing has expired").data).toEqual({
      type: "listing",
      postId: String(gone._id),
    });

    const list = await request(app).get("/api/notifications").set(auth(seller));
    const item = list.body.notifications.find((n) => n.type === "listing" && String(n.post?._id) === String(soon._id));
    expect(item).toMatchObject({ actorName: "PlotPost" });

    // The reminder becomes the expired notice in the same row.
    await Post.updateOne({ _id: soon._id }, { expiresAt: inDays(-0.01) });
    expect(await runExpiryChecks()).toEqual({ reminders: 0, expired: 1 });
    expect(await Notification.countDocuments({ groupKey: `listing:${soon._id}` })).toBe(1);

    // Renewing clears it, and the next 90 days get their own notices.
    await request(app).post(`/api/posts/${soon._id}/renew`).set(auth(seller));
    await Post.updateOne({ _id: soon._id }, { expiresAt: inDays(1) });
    expect(await runExpiryChecks()).toEqual({ reminders: 1, expired: 0 });
  });

  test("no phone alert when the seller turned alerts off", async () => {
    const seller = await newUser();
    await addPhone(seller);
    await User.updateOne({ _id: seller.id }, { "settings.pushNotifications": false });
    await makePost(seller, { expiresAt: inDays(1) });
    expect(await runExpiryChecks()).toEqual({ reminders: 1, expired: 0 });
    expect(pushService.outbox).toEqual([]);
    expect(await Notification.countDocuments({ type: "listing" })).toBe(1);
  });
});

describe("admin panel", () => {
  test("Expired tab and live counts", async () => {
    const admin = await newUser("Admin");
    await User.updateOne({ _id: admin.id }, { role: "admin" });
    const seller = await newUser();
    await makePost(seller);
    await makePost(seller, { expiresAt: inDays(-2) });
    await makePost(seller, { status: "sold", expiresAt: inDays(-2) });

    const posts = await request(app).get("/api/admin/posts").set(auth(admin));
    expect(posts.body.counts).toMatchObject({ all: 3, live: 1, expired: 1, sold: 1 });
    const expired = await request(app).get("/api/admin/posts?filter=expired").set(auth(admin));
    expect(expired.body.posts).toHaveLength(1);
    expect(expired.body.posts[0]).toMatchObject({ expired: true });
    const summary = await request(app).get("/api/admin/summary").set(auth(admin));
    expect(summary.body.summary.activePosts).toBe(1);
  });
});

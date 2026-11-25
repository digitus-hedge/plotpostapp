// Phase 2, Step 2: the admin panel API — reports queue, removing listings and
// comments, banning people, the audit log, report emails and the /admin page.
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
const AdminAction = require("../models/AdminAction");
const Notification = require("../models/Notification");
const emailService = require("../services/emailService");

let memoryServer;

beforeAll(async () => {
  let uri = process.env.TEST_MONGODB_URI;
  if (!uri) {
    const { MongoMemoryServer } = require("mongodb-memory-server-core");
    memoryServer = await MongoMemoryServer.create();
    uri = memoryServer.getUri();
  }
  const url = new URL(uri);
  url.pathname = "/plotpost_test_admin";
  await mongoose.connect(url.toString());
  await mongoose.connection.db.dropDatabase();
  await Promise.all(Object.values(mongoose.models).map((model) => model.createIndexes()));
});

afterEach(async () => {
  await Promise.all([User, Post, Report, AdminAction, Notification].map((model) => model.deleteMany({})));
  emailService.outbox.length = 0;
});

afterAll(async () => {
  await mongoose.connection.db.dropDatabase();
  await mongoose.disconnect();
  if (memoryServer) await memoryServer.stop();
});

let counter = 0;
const newUser = async (name = "Person") => {
  counter += 1;
  const email = `a${counter}@example.com`;
  const res = await request(app).post("/api/auth/register").send({ name, email, password: "Password123" });
  expect(res.status).toBe(201);
  return { id: String(res.body.user.id), token: res.body.token, name, email };
};
const newAdmin = async (name = "Admin") => {
  const admin = await newUser(name);
  await User.updateOne({ _id: admin.id }, { $set: { role: "admin" } });
  return admin;
};
const auth = (user) => ({ Authorization: `Bearer ${user.token}` });
const as = (user) => ({
  get: (path) => request(app).get(`/api/admin${path}`).set(auth(user)),
  post: (path, body = {}) => request(app).post(`/api/admin${path}`).set(auth(user)).send(body),
});

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
const reportPost = (user, post, reason = "Fake or misleading listing") =>
  request(app).post(`/api/posts/${post._id}/report`).set(auth(user)).send({ reason });
const feedTitles = async (user) => {
  const req = request(app).get("/api/posts");
  return (await (user ? req.set(auth(user)) : req)).body.posts.map((p) => p.title);
};

// -------------------------------------------------------------- access
describe("who can use the admin API", () => {
  test("guests get 401, normal accounts 403, admins get the summary", async () => {
    const user = await newUser("User");
    const admin = await newAdmin();
    expect((await request(app).get("/api/admin/summary")).status).toBe(401);
    const denied = await as(user).get("/summary");
    expect(denied.status).toBe(403);
    expect(denied.body.message).toBe("Admins only.");
    const ok = await as(admin).get("/summary");
    expect(ok.status).toBe(200);
    expect(ok.body.admin.email).toBe(admin.email);
    expect(ok.body.summary).toMatchObject({ openReports: 0, overdueReports: 0, users: 2, bannedUsers: 0 });
  });

  test("the /admin page is served with strict security headers", async () => {
    const page = await request(app).get("/admin/");
    expect(page.status).toBe(200);
    expect(page.text).toMatch(/PlotPost Admin/);
    expect(page.headers["x-frame-options"]).toBe("DENY");
    expect(page.headers["content-security-policy"]).toMatch(/script-src 'self'/);
    expect(page.headers["content-security-policy"]).toMatch(/font-src https:\/\/fonts.gstatic.com/);
    expect(page.headers["content-security-policy"]).not.toMatch(/unsafe-inline/);
    expect((await request(app).get("/admin/app.js")).status).toBe(200);
    expect((await request(app).get("/admin/theme.js")).status).toBe(200);
  });
});

// -------------------------------------------------------------- reports queue
describe("reports queue", () => {
  test("grouped by item, oldest first, overdue after 24 hours; admins are emailed", async () => {
    const admin = await newAdmin();
    const seller = await newUser("Seller");
    const a = await newUser("Reporter A");
    const b = await newUser("Reporter B");
    const old = await makePost(seller, { title: "Old report" });
    const fresh = await makePost(seller, { title: "Fresh report" });
    await reportPost(a, old);
    await reportPost(b, old, "Spam, scam, or fraud");
    await reportPost(a, fresh);
    // One new email per new report, to the admin.
    expect(emailService.outbox.filter((m) => m.kind === "report")).toHaveLength(3);
    expect(emailService.outbox[0].to).toEqual([admin.email]);
    expect(emailService.outbox[0].subject).toMatch(/New report \(listing\)/);

    // Make the first post's reports 30 hours old.
    await Report.collection.updateMany({ post: old._id }, { $set: { updatedAt: new Date(Date.now() - 30 * 3600 * 1000) } });

    const res = await as(admin).get("/reports");
    expect(res.status).toBe(200);
    expect(res.body.groups.map((g) => g.post.title)).toEqual(["Old report", "Fresh report"]);
    const [first, second] = res.body.groups;
    expect(first).toMatchObject({ kind: "post", count: 2, overdue: true });
    expect(first.ageHours).toBeGreaterThanOrEqual(30);
    expect(first.person.name).toBe("Seller");
    expect(second.overdue).toBe(false);

    const summary = (await as(admin).get("/summary")).body.summary;
    expect(summary).toMatchObject({ openReports: 3, overdueReports: 2 });
    expect(summary.oldestOpenHours).toBeGreaterThanOrEqual(30);
  });

  test("dismiss closes the open reports and is logged; reporting again reopens", async () => {
    const admin = await newAdmin();
    const seller = await newUser("Seller");
    const reporter = await newUser("Reporter");
    const post = await makePost(seller);
    await reportPost(reporter, post);

    const res = await as(admin).post("/reports/dismiss", { kind: "post", post: String(post._id), reason: "Looks fine" });
    expect(res.status).toBe(200);
    expect(res.body.reportsClosed).toBe(1);
    expect((await as(admin).get("/reports")).body.groups).toEqual([]);
    const done = (await as(admin).get("/reports?status=done")).body.groups;
    expect(done[0].reports[0].resolution).toBe("dismissed");
    const log = await AdminAction.findOne().lean();
    expect(log).toMatchObject({ action: "dismiss_reports", reason: "Looks fine", reportsClosed: 1, adminName: "Admin" });

    await reportPost(reporter, post, "Spam, scam, or fraud");
    expect((await as(admin).get("/reports")).body.groups).toHaveLength(1);
    expect((await Report.findOne().lean()).resolution).toBe("");
  });
});

// -------------------------------------------------------------- listings
describe("removing listings", () => {
  test("hidden from everyone but the seller, who is told why; restore brings it back", async () => {
    const admin = await newAdmin();
    const seller = await newUser("Seller");
    const buyer = await newUser("Buyer");
    const reporter = await newUser("Reporter");
    const post = await makePost(seller, { title: "Fake villa" });
    await makePost(seller, { title: "Real villa" });
    await request(app).post(`/api/users/saved/${post._id}`).set(auth(buyer)).send({ saved: true });
    await reportPost(reporter, post);

    // A reason is required.
    expect((await as(admin).post(`/posts/${post._id}/remove`, { reason: "" })).status).toBe(400);
    const removed = await as(admin).post(`/posts/${post._id}/remove`, { reason: "Fake listing" });
    expect(removed.status).toBe(200);
    expect(removed.body.reportsClosed).toBe(1);

    expect(await feedTitles(buyer)).toEqual(["Real villa"]);
    expect(await feedTitles(null)).toEqual(["Real villa"]);
    expect((await request(app).get("/api/users/saved").set(auth(buyer))).body.savedPosts).toEqual([]);
    expect((await request(app).get(`/api/posts/by-ids?ids=${post._id}`)).body.posts).toEqual([]);
    const details = await request(app).get(`/api/posts/${post._id}`).set(auth(buyer));
    expect(details.status).toBe(404);
    expect(details.body.message).toBe("This listing was removed by PlotPost.");
    // Can't be liked, commented on or enquired about.
    expect((await request(app).post(`/api/posts/${post._id}/like`).set(auth(buyer))).status).toBe(404);
    expect((await request(app).post(`/api/posts/${post._id}/comment`).set(auth(buyer)).send({ text: "Hello" })).status).toBe(404);

    // The seller still sees it, with the reason, and got a notification.
    const mine = await request(app).get("/api/posts/my").set(auth(seller));
    const own = mine.body.posts.find((p) => p.title === "Fake villa");
    expect(own.removedReason).toBe("Fake listing");
    expect(own.removedAt).toBeTruthy();
    expect(own.removedBy).toBeUndefined();
    expect((await request(app).get(`/api/posts/${post._id}`).set(auth(seller))).status).toBe(200);
    const notes = (await request(app).get("/api/notifications").set(auth(seller))).body.notifications;
    expect(notes[0]).toMatchObject({ type: "moderation", actorName: "PlotPost", preview: "Fake listing" });

    // Restore.
    expect((await as(admin).post(`/posts/${post._id}/restore`)).status).toBe(200);
    expect((await feedTitles(buyer)).sort()).toEqual(["Fake villa", "Real villa"]);
    expect((await request(app).get("/api/notifications").set(auth(seller))).body.notifications).toEqual([]);
    expect((await AdminAction.find().sort({ createdAt: 1 }).lean()).map((a) => a.action)).toEqual(["remove_post", "restore_post"]);
  });

  test("listing search finds by title or seller, and can show only removed ones", async () => {
    const admin = await newAdmin();
    const ravi = await newUser("Ravi Kumar");
    const anu = await newUser("Anu");
    const gone = await makePost(ravi, { title: "Plot in Chevayur" });
    await makePost(anu, { title: "House in Eranhipalam" });
    await as(admin).post(`/posts/${gone._id}/remove`, { reason: "Spam listing" });

    expect((await as(admin).get("/posts?q=ravi")).body.posts.map((p) => p.title)).toEqual(["Plot in Chevayur"]);
    expect((await as(admin).get("/posts?q=eranhi")).body.posts.map((p) => p.title)).toEqual(["House in Eranhipalam"]);
    const removedOnly = (await as(admin).get("/posts?filter=removed")).body.posts;
    expect(removedOnly.map((p) => p.title)).toEqual(["Plot in Chevayur"]);
    expect(removedOnly[0]).toMatchObject({ removed: true, removedReason: "Spam listing" });
  });
});

// -------------------------------------------------------------- comments
describe("removing comments", () => {
  test("the comment is deleted, its reports closed, and the author told why", async () => {
    const admin = await newAdmin();
    const seller = await newUser("Seller");
    const troll = await newUser("Troll");
    const reporter = await newUser("Reporter");
    const post = await makePost(seller);
    const c = (await request(app).post(`/api/posts/${post._id}/comment`).set(auth(troll)).send({ text: "Rubbish seller" })).body.comment;
    await request(app)
      .post(`/api/posts/${post._id}/comments/${c._id}/report`)
      .set(auth(reporter))
      .send({ reason: "Harassment or bullying" });

    const queue = (await as(admin).get("/reports?kind=comment")).body.groups;
    expect(queue[0]).toMatchObject({ kind: "comment", comment: { text: "Rubbish seller" } });
    expect(queue[0].person.name).toBe("Troll");

    const res = await as(admin).post(`/posts/${post._id}/comments/${c._id}/remove`, { reason: "Abusive language" });
    expect(res.status).toBe(200);
    expect(res.body.reportsClosed).toBe(1);
    expect((await request(app).get(`/api/posts/${post._id}/comments`)).body.comments).toEqual([]);
    const notes = (await request(app).get("/api/notifications").set(auth(troll))).body.notifications;
    expect(notes[0]).toMatchObject({ type: "moderation", preview: "Abusive language" });
    expect(notes[0].commentId).toBeTruthy();

    // Again (already gone): still fine.
    expect((await as(admin).post(`/posts/${post._id}/comments/${c._id}/remove`, { reason: "Abusive language" })).status).toBe(200);
  });
});

// -------------------------------------------------------------- bans
describe("banning people", () => {
  test("logged out, can't log in, listings and comments hidden; unban restores", async () => {
    const admin = await newAdmin();
    const bad = await newUser("Bad Seller");
    const buyer = await newUser("Buyer");
    const post = await makePost(bad, { title: "Scam plot" });
    const other = await makePost(buyer, { title: "Buyer plot" });
    await request(app).post(`/api/posts/${other._id}/comment`).set(auth(bad)).send({ text: "Call me for a better deal" });
    await request(app).post(`/api/users/${bad.id}/report`).set(auth(buyer)).send({ reason: "Spam or scam" });

    // Admins and yourself can't be banned; a reason is required.
    expect((await as(admin).post(`/users/${admin.id}/ban`, { reason: "Test" })).status).toBe(400);
    const otherAdmin = await newAdmin("Second Admin");
    expect((await as(admin).post(`/users/${otherAdmin.id}/ban`, { reason: "Test" })).status).toBe(400);
    expect((await as(admin).post(`/users/${bad.id}/ban`, {})).status).toBe(400);

    const banned = await as(admin).post(`/users/${bad.id}/ban`, { reason: "Scam listings" });
    expect(banned.status).toBe(200);
    expect(banned.body.reportsClosed).toBe(1);

    // Their existing login ends with a clear message.
    const ended = await request(app).get("/api/users/profile").set(auth(bad));
    expect(ended.status).toBe(401);
    expect(ended.body).toMatchObject({ sessionEnded: true, banned: true });
    expect(ended.body.message).toMatch(/suspended/);
    // New logins are refused.
    const login = await request(app).post("/api/auth/login").send({ email: bad.email, password: "Password123" });
    expect(login.status).toBe(403);
    expect(login.body.banned).toBe(true);

    // Their listings and comments are hidden.
    expect(await feedTitles(buyer)).toEqual(["Buyer plot"]);
    expect((await request(app).get(`/api/posts/${post._id}`)).status).toBe(404);
    expect((await request(app).get(`/api/posts/${other._id}/comments`)).body.comments).toEqual([]);
    expect((await as(admin).get("/users?filter=banned")).body.users.map((u) => u.name)).toEqual(["Bad Seller"]);

    // Unban.
    expect((await as(admin).post(`/users/${bad.id}/unban`)).status).toBe(200);
    expect((await request(app).post("/api/auth/login").send({ email: bad.email, password: "Password123" })).status).toBe(200);
    expect((await feedTitles(buyer)).sort()).toEqual(["Buyer plot", "Scam plot"]);
    expect((await request(app).get(`/api/posts/${other._id}/comments`)).body.comments).toHaveLength(1);
    // The old login stays ended (they log in again).
    expect((await request(app).get("/api/users/profile").set(auth(bad))).status).toBe(401);
  });

  test("people search, one account's page, and the audit log", async () => {
    const admin = await newAdmin();
    const ravi = await newUser("Ravi Kumar");
    await newUser("Anu");
    const post = await makePost(ravi);
    await as(admin).post(`/posts/${post._id}/remove`, { reason: "Fake listing" });
    await as(admin).post(`/users/${ravi.id}/ban`, { reason: "Repeated fake listings" });

    const found = (await as(admin).get("/users?q=ravi")).body.users;
    expect(found.map((u) => u.name)).toEqual(["Ravi Kumar"]);
    expect(found[0]).toMatchObject({ banned: true, banReason: "Repeated fake listings", posts: 1 });

    const one = await as(admin).get(`/users/${ravi.id}`);
    expect(one.body.user).toMatchObject({ name: "Ravi Kumar", banned: true });
    expect(one.body.posts[0]).toMatchObject({ removed: true, removedReason: "Fake listing" });
    expect(one.body.actions.map((a) => a.action).sort()).toEqual(["ban_user", "remove_post"]);

    const audit = (await as(admin).get("/audit")).body.actions;
    expect(audit.map((a) => a.action)).toEqual(["ban_user", "remove_post"]);
    expect(audit[0]).toMatchObject({ adminName: "Admin", reason: "Repeated fake listings" });
    expect(audit[0].summary).toMatch(/Ravi Kumar/);
  });
});

describe("dashboard numbers and tab counts (restyled panel)", () => {
  test("active posts, this week, per-day chart, platform mix, views and taps", async () => {
    const admin = await newAdmin();
    const ravi = await newUser("Ravi Kumar");
    const anu = await newUser("Anu");
    await makePost(ravi, { platform: "Instagram", views: 10, stats: { calls: 2, linkOpens: 3, shares: 1 } });
    await makePost(ravi, { platform: "Instagram", views: 5 });
    await makePost(anu, { platform: "YouTube", status: "sold" });
    const removed = await makePost(anu, { platform: "Facebook" });
    await as(admin).post(`/posts/${removed._id}/remove`, { reason: "Fake listing" });
    // An old post: counts in totals but not in this week or the chart.
    const old = await makePost(anu, { platform: "Facebook" });
    await Post.collection.updateOne({ _id: old._id }, { $set: { createdAt: new Date(Date.now() - 30 * 86400000) } });

    const summary = (await as(admin).get("/summary")).body.summary;
    expect(summary).toMatchObject({
      posts: 5,
      activePosts: 3,
      removedPosts: 1,
      newThisWeek: 4,
      newToday: 4,
      sellersWhoPosted: 2,
      views: 15,
      contactTaps: 5,
      shares: 1,
    });
    expect(summary.newPostsPerDay).toHaveLength(14);
    expect(summary.newPostsPerDay.at(-1).count).toBe(4);
    expect(summary.newPostsPerDay.reduce((n, d) => n + d.count, 0)).toBe(4);
    expect(summary.byPlatform).toEqual([
      { platform: "Instagram", count: 2 },
      { platform: "Facebook", count: 1 },
    ]);
  });

  test("listings, people and reports come with counts for each tab", async () => {
    const admin = await newAdmin();
    const ravi = await newUser("Ravi Kumar");
    const buyer = await newUser("Buyer");
    await makePost(ravi, { platform: "Instagram" });
    await makePost(ravi, { platform: "YouTube", status: "sold" });
    const bad = await makePost(ravi, { platform: "Instagram" });
    await reportPost(buyer, bad);
    await as(admin).post(`/posts/${bad._id}/remove`, { reason: "Fake listing" });

    const posts = (await as(admin).get("/posts")).body;
    expect(posts.counts).toEqual({ all: 3, live: 1, expired: 0, removed: 1, sold: 1, banned: 0 });
    const insta = (await as(admin).get("/posts?platform=Instagram&filter=live")).body;
    expect(insta.posts).toHaveLength(1);
    expect(insta.counts).toMatchObject({ all: 2, live: 1, removed: 1 });
    expect(insta.posts[0]).toMatchObject({ platform: "Instagram", views: 0 });

    await as(admin).post(`/users/${buyer.id}/ban`, { reason: "Spam account" });
    const people = (await as(admin).get("/users")).body;
    expect(people.counts).toEqual({ all: 3, active: 2, banned: 1, admins: 1 });

    const reports = (await as(admin).get("/reports?status=done")).body;
    expect(reports.counts).toEqual({ open: 0, done: 1 });

    const audit = (await as(admin).get("/audit?q=spam")).body;
    expect(audit.actions.map((a) => a.action)).toEqual(["ban_user"]);
    expect(audit.admins).toEqual(["Admin"]);
    expect((await as(admin).get("/audit?who=Nobody")).body.actions).toEqual([]);
  });
});

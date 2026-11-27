// Screen 12 tests: Notifications list, the bell's number, phone alerts
// (checked with a fake sender; nothing reaches Firebase) and inquiry emails.
// Uses TEST_MONGODB_URI if set, otherwise a temporary MongoDB. Never your
// real database.
process.env.NODE_ENV = "test";
process.env.JWT_SECRET = "test-secret-that-is-long-enough-for-signing-tokens";

const request = require("supertest");
const mongoose = require("mongoose");
const app = require("../server");
const User = require("../models/User");
const Post = require("../models/Post");
const Follow = require("../models/Follow");
const Enquiry = require("../models/Enquiry");
const Conversation = require("../models/Conversation");
const Message = require("../models/Message");
const Notification = require("../models/Notification");
const PushDevice = require("../models/PushDevice");
const pushService = require("../services/pushService");
const emailService = require("../services/emailService");

const MODELS = [User, Post, Follow, Enquiry, Conversation, Message, Notification, PushDevice];
let memoryServer;

beforeAll(async () => {
  let uri = process.env.TEST_MONGODB_URI;
  if (!uri) {
    const { MongoMemoryServer } = require("mongodb-memory-server-core");
    memoryServer = await MongoMemoryServer.create();
    uri = memoryServer.getUri();
  }
  const url = new URL(uri);
  url.pathname = "/plotpost_test_screen12";
  await mongoose.connect(url.toString());
  await mongoose.connection.db.dropDatabase();
  await Promise.all(MODELS.map((Model) => Model.createIndexes()));
});

afterEach(async () => {
  jest.restoreAllMocks();
  pushService.outbox.length = 0;
  emailService.outbox.length = 0;
  await Promise.all(MODELS.map((Model) => Model.deleteMany({})));
});

afterAll(async () => {
  await mongoose.connection.db.dropDatabase();
  await mongoose.disconnect();
  if (memoryServer) await memoryServer.stop();
});

const pause = (ms = 15) => new Promise((resolve) => setTimeout(resolve, ms));

let counter = 0;
const newUser = async (name = "Person") => {
  counter += 1;
  const email = `n${counter}@example.com`;
  const res = await request(app).post("/api/auth/register").send({ name, email, password: "Password123" });
  if (!res.body.user) throw new Error(`register failed: ${res.status} ${JSON.stringify(res.body)}`);
  return { id: String(res.body.user.id), token: res.body.token, name, email };
};
const auth = (user) => ({ Authorization: `Bearer ${user.token}` });

const PHOTO = "https://res.cloudinary.com/test-cloud/image/upload/v1/plotpost/posts/a.jpg";
const makePost = (seller, extra = {}) =>
  Post.create({
    user: seller.id,
    title: "Villa in Nadakkavu",
    price: "₹1.2 crore",
    location: "Nadakkavu",
    platform: "PlotPost",
    imageUrls: [PHOTO],
    ...extra,
  });

const phoneToken = (label) => `fcm-test-token-${label}-${"x".repeat(24)}`;
const addPhone = (user, label = user.name) =>
  request(app).post("/api/notifications/devices").set(auth(user)).send({ token: phoneToken(label), platform: "android" });

const list = (user, page) =>
  request(app).get(`/api/notifications${page ? `?page=${page}` : ""}`).set(auth(user));
const unread = async (user) => (await request(app).get("/api/notifications/unread").set(auth(user))).body.count;
const seen = (user, upTo) =>
  request(app).post("/api/notifications/seen").set(auth(user)).send(upTo ? { upTo } : {});
const rows = async (user) => (await list(user)).body.notifications;

const like = (user, post, liked) =>
  request(app).post(`/api/posts/${post._id}/like`).set(auth(user)).send(liked === undefined ? {} : { like: liked });
const comment = (user, post, text) =>
  request(app).post(`/api/posts/${post._id}/comment`).set(auth(user)).send({ text });
const follow = (user, target) => request(app).post(`/api/users/${target.id}/follow`).set(auth(user));
const unfollow = (user, target) => request(app).delete(`/api/users/${target.id}/follow`).set(auth(user));
const block = (user, target) => request(app).post(`/api/users/${target.id}/block`).set(auth(user));
const unblock = (user, target) => request(app).delete(`/api/users/${target.id}/block`).set(auth(user));
const interest = (post, user, extra = {}) => {
  const req = request(app)
    .post("/api/enquiries")
    .send({
      postId: String(post._id),
      name: "Meera Nair",
      phone: "+91 98950 54321",
      email: "meera@example.com",
      message: "Is car parking covered? I'd like to visit.",
      contactMethod: "WhatsApp",
      wantsVisit: true,
      ...extra,
    });
  return user ? req.set(auth(user)) : req;
};
const alertsFor = (user) => pushService.outbox.filter((alert) => alert.user === user.id);

// --------------------------------------------------------------- basics
describe("Notifications list", () => {
  test("needs a login", async () => {
    expect((await request(app).get("/api/notifications")).status).toBe(401);
    expect((await request(app).get("/api/notifications/unread")).status).toBe(401);
    expect((await request(app).post("/api/notifications/devices").send({ token: phoneToken("x") })).status).toBe(401);
  });

  test("starts empty", async () => {
    const me = await newUser("Asha");
    const res = await list(me);
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ success: true, notifications: [], unread: 0, page: 1, hasMore: false });
    expect(new Date(res.body.serverTime).toString()).not.toBe("Invalid Date");
  });

  test("likes are grouped per post, newest people first; your own like and repeat taps don't count", async () => {
    const seller = await newUser("Asha");
    const [anu, biju, chitra] = [await newUser("Anu"), await newUser("Biju"), await newUser("Chitra")];
    const post = await makePost(seller);
    await addPhone(seller);

    await like(anu, post);
    await like(biju, post);
    await like(chitra, post);
    await like(seller, post); // own like
    let [row] = await rows(seller);
    expect(await rows(seller)).toHaveLength(1);
    expect(row).toMatchObject({ type: "like", count: 3, isNew: true });
    expect(row.actors.map((a) => a.name)).toEqual(["Chitra", "Biju", "Anu"]);
    expect(row.post).toMatchObject({ title: "Villa in Nadakkavu", image: PHOTO, status: "active" });

    // A double-tap "like" when already liked doesn't move it up again.
    const before = row.at;
    await pause();
    await like(anu, post, true);
    [row] = await rows(seller);
    expect(row.at).toBe(before);

    // Unliking takes people out; the last unlike removes the row.
    await like(chitra, post, false);
    [row] = await rows(seller);
    expect(row).toMatchObject({ count: 2 });
    expect(row.actors.map((a) => a.name)).toEqual(["Biju", "Anu"]);
    await like(anu, post, false);
    await like(biju, post, false);
    expect(await rows(seller)).toEqual([]);

    // Likes never send a phone alert; the likers get nothing.
    expect(pushService.outbox).toHaveLength(0);
    expect(await rows(anu)).toEqual([]);
  });

  test("comments are grouped per post with the latest text, and send a phone alert", async () => {
    const seller = await newUser("Asha");
    const [anu, biju] = [await newUser("Anu"), await newUser("Biju")];
    const post = await makePost(seller);
    await addPhone(seller);

    await comment(anu, post, "Is the price negotiable?");
    await comment(seller, post, "Yes, a little."); // the seller's own reply: nothing
    const second = await comment(biju, post, "Any   road\naccess?");

    let [row] = await rows(seller);
    expect(row).toMatchObject({ type: "comment", count: 2, preview: "Any road access?" });
    expect(row.actors.map((a) => a.name)).toEqual(["Biju", "Anu"]);

    const alerts = alertsFor(seller);
    expect(alerts).toHaveLength(2);
    expect(alerts[1]).toMatchObject({
      title: "Biju commented on Villa in Nadakkavu",
      body: "Any road access?",
      tag: `comment:${post._id}`,
      data: { type: "comment", postId: String(post._id) },
      token: phoneToken("Asha"),
    });

    // Deleting a comment shows what's left; deleting all removes the row.
    await request(app).delete(`/api/posts/${post._id}/comments/${second.body.comment._id}`).set(auth(seller));
    [row] = await rows(seller);
    expect(row).toMatchObject({ count: 1, preview: "Is the price negotiable?" });
    const left = (await Post.findById(post._id).lean()).comments.filter((c) => String(c.user) === anu.id);
    await request(app).delete(`/api/posts/${post._id}/comments/${left[0]._id}`).set(auth(anu));
    expect(await rows(seller)).toEqual([]);
  });

  test("new followers, with Follow back; unfollowing removes it; repeat taps don't duplicate", async () => {
    const me = await newUser("Asha");
    const anu = await newUser("Anu");
    await follow(anu, me);
    await follow(anu, me);
    let all = await rows(me);
    expect(all).toHaveLength(1);
    expect(all[0]).toMatchObject({ type: "follow", isFollowing: false, count: 1 });
    expect(all[0].actors[0]).toMatchObject({ name: "Anu" });

    await follow(me, anu); // follow back
    all = await rows(me);
    expect(all[0].isFollowing).toBe(true);
    expect(await rows(anu)).toHaveLength(1); // Anu sees Asha followed back

    await unfollow(anu, me);
    expect(await rows(me)).toEqual([]);
    expect(pushService.outbox).toHaveLength(0);
  });

  test("buyer inquiries: list row, phone alert and email copy; a repeat updates the same row", async () => {
    const seller = await newUser("Asha");
    const buyer = await newUser("Biju");
    const post = await makePost(seller);
    await addPhone(seller);

    const first = await interest(post, buyer);
    expect(first.status).toBe(201);
    let [row] = await rows(seller);
    expect(row).toMatchObject({
      type: "enquiry",
      actorName: "Meera Nair",
      preview: "Is car parking covered? I'd like to visit.",
      enquiryId: first.body.enquiry._id,
    });
    expect(row.actors[0]).toMatchObject({ name: "Biju" });
    expect(alertsFor(seller)[0]).toMatchObject({
      title: "New buyer inquiry",
      body: "Meera Nair is interested in Villa in Nadakkavu",
      data: { type: "enquiry", enquiryId: first.body.enquiry._id },
    });
    expect(emailService.outbox).toEqual([
      expect.objectContaining({ to: seller.email, kind: "enquiry", subject: "New inquiry: Villa in Nadakkavu" }),
    ]);

    await pause();
    await interest(post, buyer, { message: "Can I visit this Sunday morning?" });
    const all = await rows(seller);
    expect(all).toHaveLength(1);
    expect(all[0].preview).toBe("Can I visit this Sunday morning?");
    expect(new Date(all[0].at) > new Date(row.at)).toBe(true);
    expect(alertsFor(seller)[1].title).toBe("Updated buyer inquiry");
    expect(emailService.outbox[1].subject).toBe("Updated inquiry: Villa in Nadakkavu");

    // The buyer deletes it: gone from the seller's notifications too.
    await request(app).delete(`/api/enquiries/${first.body.enquiry._id}`).set(auth(buyer));
    expect(await rows(seller)).toEqual([]);
  });

  test("guest inquiries show the typed name; Email Inquiries off means no email", async () => {
    const seller = await newUser("Asha");
    const post = await makePost(seller);
    await request(app).put("/api/users/profile").set(auth(seller)).send({ settings: { emailInquiries: false } });

    expect((await interest(post, null, { name: "Guest Ravi" })).status).toBe(201);
    const [row] = await rows(seller);
    expect(row).toMatchObject({ type: "enquiry", actorName: "Guest Ravi", actors: [] });
    expect(emailService.outbox).toEqual([]);
  });

  test("chat messages send a phone alert (one per chat) but aren't listed", async () => {
    const asha = await newUser("Asha");
    const biju = await newUser("Biju");
    await addPhone(asha);
    const chat = await request(app).post("/api/chats").set(auth(biju)).send({ userId: asha.id });
    const chatId = chat.body.chat._id;
    await request(app).post(`/api/chats/${chatId}/messages`).set(auth(biju)).send({ text: "Hello, is the plot still available?" });

    expect(alertsFor(asha)).toEqual([
      expect.objectContaining({
        title: "Biju",
        body: "Hello, is the plot still available?",
        tag: `chat:${chatId}`,
        data: { type: "message", chatId, senderId: biju.id },
      }),
    ]);
    expect(await rows(asha)).toEqual([]);
    expect(alertsFor(biju)).toEqual([]); // no alert to yourself
  });

  test("Push Notifications off: the list still fills, but no phone alerts", async () => {
    const seller = await newUser("Asha");
    const buyer = await newUser("Biju");
    const post = await makePost(seller);
    await addPhone(seller);
    await request(app).put("/api/users/profile").set(auth(seller)).send({ settings: { pushNotifications: false } });

    await comment(buyer, post, "Nice place!");
    await interest(post, buyer);
    const chat = await request(app).post("/api/chats").set(auth(buyer)).send({ userId: seller.id });
    await request(app).post(`/api/chats/${chat.body.chat._id}/messages`).set(auth(buyer)).send({ text: "Hi" });

    expect(await rows(seller)).toHaveLength(2);
    expect(pushService.outbox).toEqual([]);
  });

  test("pages of 20, newest first", async () => {
    const me = await newUser("Asha");
    for (let i = 0; i < 23; i += 1) {
      const fan = await newUser(`Fan${i}`);
      await follow(fan, me);
    }
    const first = await list(me);
    expect(first.body.notifications).toHaveLength(20);
    expect(first.body.hasMore).toBe(true);
    expect(first.body.notifications[0].actors[0].name).toBe("Fan22");
    const second = await list(me, 2);
    expect(second.body.notifications).toHaveLength(3);
    expect(second.body.hasMore).toBe(false);
    expect(second.body.notifications[2].actors[0].name).toBe("Fan0");
  });

  test("a deleted post takes its notifications with it", async () => {
    const seller = await newUser("Asha");
    const anu = await newUser("Anu");
    const post = await makePost(seller);
    await like(anu, post);
    await comment(anu, post, "Lovely");
    expect(await rows(seller)).toHaveLength(2);
    await request(app).delete(`/api/posts/${post._id}`).set(auth(seller));
    expect(await rows(seller)).toEqual([]);
    expect(await Notification.countDocuments({ post: post._id })).toBe(0);
  });

  test("a notification problem never breaks the like or comment itself", async () => {
    const seller = await newUser("Asha");
    const anu = await newUser("Anu");
    const post = await makePost(seller);
    jest.spyOn(Notification, "updateOne").mockRejectedValue(new Error("database hiccup"));
    jest.spyOn(console, "error").mockImplementation(() => {});

    expect((await like(anu, post)).status).toBe(200);
    expect((await comment(anu, post, "Still works")).status).toBe(201);
    expect((await follow(anu, seller)).status).toBe(200);
    expect((await Post.findById(post._id).lean()).likes.map(String)).toEqual([anu.id]);
  });
});

// ----------------------------------------------------------- bell number
describe("The bell's number", () => {
  test("counts what's new since you last opened the list", async () => {
    const seller = await newUser("Asha");
    const [anu, biju] = [await newUser("Anu"), await newUser("Biju")];
    const post = await makePost(seller);
    await like(anu, post);
    await follow(biju, seller);
    expect(await unread(seller)).toBe(2);

    const opened = await list(seller);
    expect(opened.body.unread).toBe(2);
    expect(opened.body.notifications.every((row) => row.isNew)).toBe(true);
    const done = await seen(seller, opened.body.serverTime);
    expect(done.body).toEqual({ success: true, unread: 0 });
    expect(await unread(seller)).toBe(0);

    // Something new after that: only it counts, and only it is marked new.
    await pause();
    await comment(anu, post, "When can I visit?");
    expect(await unread(seller)).toBe(1);
    const again = await rows(seller);
    expect(again.map((row) => [row.type, row.isNew])).toEqual([
      ["comment", true],
      ["follow", false],
      ["like", false],
    ]);

    // A like group that gets a new like comes back to the top as new.
    await pause();
    await like(biju, post);
    expect(await unread(seller)).toBe(2);
    expect((await rows(seller))[0]).toMatchObject({ type: "like", isNew: true, count: 2 });
  });

  test("seen only moves forward and never past now; bad times are refused", async () => {
    const me = await newUser("Asha");
    const anu = await newUser("Anu");
    await follow(anu, me);

    const future = new Date(Date.now() + 60 * 60 * 1000).toISOString();
    expect((await seen(me, future)).body.unread).toBe(0);
    const saved = (await User.findById(me.id).lean()).notificationsSeenAt;
    expect(saved <= new Date()).toBe(true);

    await seen(me, "2020-01-01T00:00:00.000Z");
    expect((await User.findById(me.id).lean()).notificationsSeenAt).toEqual(saved);

    const bad = await seen(me, "yesterday");
    expect(bad.status).toBe(400);
  });
});

// --------------------------------------------------------------- blocking
describe("Blocking and deleted accounts", () => {
  test("blocked people disappear from your notifications and can't add new ones", async () => {
    const seller = await newUser("Asha");
    const [anu, biju] = [await newUser("Anu"), await newUser("Biju")];
    const post = await makePost(seller);
    await addPhone(seller);
    await like(anu, post);
    await like(biju, post);
    await follow(biju, seller);
    await interest(post, biju);
    await comment(biju, post, "Hello");
    pushService.outbox.length = 0;

    await block(seller, biju);
    let all = await rows(seller);
    expect(all.map((row) => row.type).sort()).toEqual(["like"]);
    expect(all[0]).toMatchObject({ count: 1 });
    expect(all[0].actors.map((a) => a.name)).toEqual(["Anu"]);

    await unfollow(biju, seller);
    await follow(biju, seller);
    await comment(biju, post, "Hello again");
    await interest(post, biju, { message: "Please reply to my inquiry." });
    expect((await rows(seller)).map((row) => row.type)).toEqual(["like"]);
    expect(pushService.outbox).toEqual([]);

    // Unblocking brings their likes back into the existing row (not as new).
    await unblock(seller, biju);
    const [row] = await rows(seller);
    expect(row).toMatchObject({ type: "like", count: 2 });
  });

  test("deleting an account removes its notifications, its phones and its name from others' rows", async () => {
    const seller = await newUser("Asha");
    const leaver = await newUser("Biju");
    const anu = await newUser("Anu");
    const post = await makePost(seller);
    const leaversPost = await makePost(leaver, { title: "Plot in Chevayur" });
    await addPhone(leaver);

    await like(anu, post);
    await like(leaver, post);
    await comment(leaver, post, "Interested");
    await follow(leaver, seller);
    await interest(post, leaver);
    await like(seller, leaversPost);
    expect(await rows(leaver)).toHaveLength(1);

    const res = await request(app).delete("/api/users/me").set(auth(leaver)).send({ password: "Password123" });
    expect(res.status).toBe(200);

    const left = await rows(seller);
    expect(left.map((row) => row.type)).toEqual(["like"]);
    expect(left[0]).toMatchObject({ count: 1 });
    expect(left[0].actors.map((a) => a.name)).toEqual(["Anu"]);
    expect(await Notification.countDocuments({ recipient: leaver.id })).toBe(0);
    expect(await PushDevice.countDocuments({ user: leaver.id })).toBe(0);
  });
});

// ------------------------------------------------------------------ phones
describe("Phones for alerts", () => {
  test("register, move to another account, log out; tokens are never shown", async () => {
    const asha = await newUser("Asha");
    const biju = await newUser("Biju");
    const res = await addPhone(asha, "shared");
    expect(res.body).toEqual({ success: true, alertsReady: true });
    await addPhone(asha, "shared"); // again: still one row
    expect(await PushDevice.countDocuments({ user: asha.id })).toBe(1);

    // Biju logs in on the same phone: it now belongs to Biju.
    await addPhone(biju, "shared");
    expect(await PushDevice.countDocuments({ user: asha.id })).toBe(0);
    expect(await PushDevice.countDocuments({ user: biju.id })).toBe(1);

    // Asha can't remove Biju's phone; Biju can.
    await request(app).delete("/api/notifications/devices").set(auth(asha)).send({ token: phoneToken("shared") });
    expect(await PushDevice.countDocuments({})).toBe(1);
    await request(app).delete("/api/notifications/devices").set(auth(biju)).send({ token: phoneToken("shared") });
    expect(await PushDevice.countDocuments({})).toBe(0);

    const profile = await request(app).get("/api/users/profile").set(auth(biju));
    expect(JSON.stringify(profile.body)).not.toMatch(/fcm-test-token/);
  });

  test("checks the token and phone type", async () => {
    const me = await newUser("Asha");
    const short = await request(app).post("/api/notifications/devices").set(auth(me)).send({ token: "abc" });
    expect(short.status).toBe(400);
    const odd = await request(app)
      .post("/api/notifications/devices")
      .set(auth(me))
      .send({ token: phoneToken("a"), platform: "nokia" });
    expect(odd.status).toBe(400);
    expect(odd.body.message).toBe("Unknown phone type.");
  });

  test("up to 10 phones per account; the longest-unused one is dropped", async () => {
    const me = await newUser("Asha");
    for (let i = 0; i < 11; i += 1) {
      await addPhone(me, `phone${i}`);
      await pause(3);
    }
    const tokens = (await PushDevice.find({ user: me.id }).lean()).map((device) => device.token);
    expect(tokens).toHaveLength(10);
    expect(tokens).not.toContain(phoneToken("phone0"));
  });

  test("password change, password reset and 'log out of all devices' stop alerts to every phone", async () => {
    const me = await newUser("Asha");
    await addPhone(me, "p1");
    await addPhone(me, "p2");
    const changed = await request(app)
      .post("/api/auth/change-password")
      .set(auth(me))
      .send({ currentPassword: "Password123", newPassword: "NewPassword456" });
    expect(changed.status).toBe(200);
    expect(await PushDevice.countDocuments({ user: me.id })).toBe(0);

    me.token = changed.body.token;
    await addPhone(me, "p1");
    expect((await request(app).post("/api/auth/logout-all").set(auth(me))).status).toBe(200);
    expect(await PushDevice.countDocuments({ user: me.id })).toBe(0);

    await addPhone(me, "p1");
    await request(app).post("/api/auth/forgot-password").send({ email: me.email });
    const code = [...emailService.outbox].reverse().find((mail) => mail.to === me.email)?.code;
    const reset = await request(app)
      .post("/api/auth/reset-password")
      .send({ email: me.email, code, newPassword: "Another789pass" });
    expect(reset.status).toBe(200);
    expect(await PushDevice.countDocuments({ user: me.id })).toBe(0);
  });
});

// ------------------------------------------------------- sending to Firebase
describe("Sending to Firebase (fake network)", () => {
  const alert = { title: "Biju", body: "Hello", tag: "chat:abc", data: { type: "message", chatId: "abc", n: 5 } };

  test("builds the message Firebase expects", () => {
    expect(pushService.buildMessage("tok", alert)).toEqual({
      message: {
        token: "tok",
        notification: { title: "Biju", body: "Hello" },
        data: { type: "message", chatId: "abc", n: "5" },
        android: { priority: "HIGH", notification: { tag: "chat:abc" } },
      },
    });
    expect(pushService.buildMessage("tok", { title: "t", body: "b" }).message.android).toEqual({ priority: "HIGH" });
  });

  test("sends to each phone and removes phones Firebase says are gone", async () => {
    const me = await newUser("Asha");
    for (const label of ["ok", "gone", "invalid", "busy", "offline"]) await addPhone(me, label);

    const calls = [];
    const fakeFetch = async (url, options) => {
      const body = JSON.parse(options.body);
      calls.push({ url, auth: options.headers.Authorization, token: body.message.token });
      const token = body.message.token;
      if (token === phoneToken("ok")) return { ok: true, status: 200, json: async () => ({ name: "m1" }) };
      if (token === phoneToken("gone"))
        return {
          ok: false,
          status: 404,
          json: async () => ({ error: { status: "NOT_FOUND", details: [{ errorCode: "UNREGISTERED" }] } }),
        };
      if (token === phoneToken("invalid"))
        return {
          ok: false,
          status: 400,
          json: async () => ({ error: { message: "The registration token is not a valid FCM registration token" } }),
        };
      if (token === phoneToken("busy")) return { ok: false, status: 503, json: async () => ({}) };
      throw new Error("network down");
    };
    jest.spyOn(console, "error").mockImplementation(() => {});

    const tokens = (await PushDevice.find({ user: me.id }).lean()).map((device) => device.token);
    const result = await pushService.deliver(tokens, alert, { projectId: "plotpost-test", bearer: "test-bearer", fetchImpl: fakeFetch });

    expect(result).toEqual({ sent: 1, removed: 2, failed: 2 });
    expect(calls).toHaveLength(5);
    expect(calls[0].url).toBe("https://fcm.googleapis.com/v1/projects/plotpost-test/messages:send");
    expect(calls.every((call) => call.auth === "Bearer test-bearer")).toBe(true);
    const left = (await PushDevice.find({ user: me.id }).lean()).map((device) => device.token).sort();
    expect(left).toEqual([phoneToken("busy"), phoneToken("offline"), phoneToken("ok")].sort());
  });

  test("dead-token check", () => {
    expect(pushService.isDeadToken(404, {})).toBe(true);
    expect(pushService.isDeadToken(403, { error: { details: [{ errorCode: "SENDER_ID_MISMATCH" }] } })).toBe(true);
    expect(pushService.isDeadToken(400, { error: { message: "Invalid JSON payload" } })).toBe(false);
    expect(pushService.isDeadToken(500, {})).toBe(false);
  });
});

// ------------------------------------------------------------------- setup
describe("Database setup", () => {
  test("old notifications are deleted after 90 days (on MongoDB Atlas)", () => {
    jest.isolateModules(() => {
      const before = process.env.DB_TTL_INDEXES;
      process.env.DB_TTL_INDEXES = "true";
      try {
        const Fresh = require("../models/Notification");
        const ttl = Fresh.schema.indexes().find(([fields, options]) => fields.lastAt === 1 && options.expireAfterSeconds);
        expect(ttl[1].expireAfterSeconds).toBe(90 * 24 * 60 * 60);
      } finally {
        if (before === undefined) delete process.env.DB_TTL_INDEXES;
        else process.env.DB_TTL_INDEXES = before;
      }
    });
  });
});

// ----------------------------------------------- follow alerts (Phase 3)
describe("New follower phone alert", () => {
  test("one alert per new follower; repeat taps, yourself and blocked people send none", async () => {
    const seller = await newUser("Asha");
    const anu = await newUser("Anu");
    const biju = await newUser("Biju");
    await addPhone(seller);

    await follow(anu, seller);
    await follow(anu, seller); // a repeat tap
    expect(alertsFor(seller)).toEqual([
      expect.objectContaining({
        title: "New follower",
        body: "Anu started following you",
        tag: `follow:${anu.id}`,
        data: { type: "follow", userId: anu.id },
      }),
    ]);

    await block(seller, biju);
    await follow(biju, seller);
    expect(alertsFor(seller)).toHaveLength(1);

    await request(app).put("/api/users/profile").set(auth(seller)).send({ settings: { pushNotifications: false } });
    await unfollow(anu, seller);
    await follow(anu, seller);
    expect(alertsFor(seller)).toHaveLength(1);
    expect((await rows(seller)).map((row) => row.type)).toEqual(["follow"]);
  });
});

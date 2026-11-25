// Screen 10 tests: Profile, Edit Profile, Change Password, logging out other
// devices and Delete account. Cloudinary is faked: nothing is really uploaded
// or deleted. Uses TEST_MONGODB_URI if set, otherwise a temporary MongoDB.
// Never your real database.
process.env.NODE_ENV = "test";
process.env.JWT_SECRET = "test-secret-that-is-long-enough-for-signing-tokens";
process.env.CLOUDINARY_CLOUD_NAME = "test-cloud";
process.env.CLOUDINARY_API_KEY = "test-key";
process.env.CLOUDINARY_API_SECRET = "test-secret";

const request = require("supertest");
const mongoose = require("mongoose");
const app = require("../server");
const cloudinary = require("../config/cloudinary");
const { outbox } = require("../services/emailService");
const User = require("../models/User");
const Post = require("../models/Post");
const Follow = require("../models/Follow");
const PostView = require("../models/PostView");
const Enquiry = require("../models/Enquiry");
const Report = require("../models/Report");

let memoryServer;

beforeAll(async () => {
  let uri = process.env.TEST_MONGODB_URI;
  if (!uri) {
    const { MongoMemoryServer } = require("mongodb-memory-server-core");
    memoryServer = await MongoMemoryServer.create();
    uri = memoryServer.getUri();
  }
  const url = new URL(uri);
  url.pathname = "/plotpost_test_screen10";
  await mongoose.connect(url.toString());
  await mongoose.connection.db.dropDatabase();
  await Promise.all(
    [User, Post, Follow, PostView, Enquiry, Report].map((Model) => Model.createIndexes())
  );
});

let destroyed;
beforeEach(() => {
  outbox.length = 0;
  destroyed = [];
  jest.spyOn(cloudinary.uploader, "destroy").mockImplementation(async (id) => {
    destroyed.push(id);
    return { result: "ok" };
  });
});

afterEach(async () => {
  jest.restoreAllMocks();
  await Promise.all([User, Post, Follow, PostView, Enquiry, Report].map((Model) => Model.deleteMany({})));
});

afterAll(async () => {
  await mongoose.connection.db.dropDatabase();
  await mongoose.disconnect();
  if (memoryServer) await memoryServer.stop();
});

let counter = 0;
const newUser = async (name = "Person", password = "Password123") => {
  counter += 1;
  const email = `p${counter}@example.com`;
  const res = await request(app).post("/api/auth/register").send({ name, email, password });
  return { id: String(res.body.user.id), token: res.body.token, email, password };
};
const auth = (tokenOrUser) => ({
  Authorization: `Bearer ${typeof tokenOrUser === "string" ? tokenOrUser : tokenOrUser.token}`,
});
const profile = (who) => request(app).get("/api/users/profile").set(auth(who));
const update = (who, body) => request(app).put("/api/users/profile").set(auth(who)).send(body);

const avatar = (name) => `https://res.cloudinary.com/test-cloud/image/upload/v9/plotpost/avatars/${name}.jpg`;
const postPhoto = (name) => `https://res.cloudinary.com/test-cloud/image/upload/v9/plotpost/posts/${name}.jpg`;

const makePost = (seller, extra = {}) =>
  Post.create({
    user: seller.id,
    title: "Villa in Nadakkavu",
    location: "Nadakkavu, Kozhikode",
    platform: "PlotPost",
    imageUrls: [postPhoto("a")],
    ...extra,
  });

// ------------------------------------------------------------ profile
describe("profile", () => {
  test("your real details and numbers, with nothing secret", async () => {
    const me = await newUser("Asha Menon");
    const fan = await newUser("Fan");
    await makePost(me);
    await makePost(me, { title: "Second" });
    await request(app).post(`/api/users/${me.id}/follow`).set(auth(fan));

    const res = await profile(me);
    expect(res.status).toBe(200);
    expect(res.body.user).toMatchObject({
      name: "Asha Menon",
      email: me.email,
      phone: "",
      bio: "",
      agency: "",
      profession: "",
      location: "",
      profileImage: "",
      hasPassword: true,
      googleLinked: false,
      settings: { pushNotifications: true, emailInquiries: true },
      stats: { listings: 2, followers: 1, following: 0 },
    });
    for (const secret of ["password", "googleId", "passwordReset", "tokenVersion"]) {
      expect(res.body.user[secret]).toBeUndefined();
    }
  });

  test("an old photo saved as a phone file path is not sent", async () => {
    const me = await newUser();
    await User.updateOne({ _id: me.id }, { $set: { profileImage: "/data/user/0/app/cache/photo.jpg" } });
    expect((await profile(me)).body.user.profileImage).toBe("");
  });
});

// -------------------------------------------------------- edit profile
describe("edit profile", () => {
  test("saves only what you send, trimmed; email can't be changed here", async () => {
    const me = await newUser("Asha");
    const res = await update(me, {
      name: "  Asha Menon ",
      phone: "+91 98950 12345",
      bio: "Plots in Kozhikode.",
      agency: "Malabar Homes",
      profession: "Real estate agent",
      location: "West Hill, Kozhikode",
      email: "hacker@example.com",
    });
    expect(res.status).toBe(200);
    expect(res.body.user).toMatchObject({
      name: "Asha Menon",
      phone: "+91 98950 12345",
      agency: "Malabar Homes",
      profession: "Real estate agent",
      location: "West Hill, Kozhikode",
      email: me.email,
    });

    // Partial: only the bio changes.
    const again = await update(me, { bio: "" });
    expect(again.body.user).toMatchObject({ bio: "", agency: "Malabar Homes", name: "Asha Menon" });
  });

  test("bad values are refused with the reason", async () => {
    const me = await newUser();
    const reason = async (body) => {
      const res = await update(me, body);
      expect(res.status).toBe(400);
      return res.body.message;
    };
    expect(await reason({ name: " " })).toMatch(/enter your name/);
    expect(await reason({ phone: "123" })).toMatch(/valid phone/);
    expect(await reason({ bio: "x".repeat(301) })).toMatch(/too long/);
    expect(await reason({ agency: "x".repeat(81) })).toMatch(/too long/);
    expect(await reason({ settings: { pushNotifications: "yes" } })).toMatch(/true or false/);
    // Phone file paths, base64 and other sites' photos aren't accepted.
    expect(await reason({ profileImage: "/data/user/0/photo.jpg" })).toMatch(/upload the photo first/);
    expect(await reason({ profileImage: "https://example.com/me.jpg" })).toMatch(/upload the photo first/);
    expect(await reason({ profileImage: postPhoto("x") })).toMatch(/upload the photo first/);
    expect((await update(me, { phone: "" })).status).toBe(200);
  });

  test("a new photo replaces the old one in Cloudinary; removing it deletes it", async () => {
    const me = await newUser();
    expect((await update(me, { profileImage: avatar("one") })).body.user.profileImage).toBe(avatar("one"));
    expect(destroyed).toEqual([]);

    await update(me, { profileImage: avatar("two") });
    expect(destroyed).toEqual(["plotpost/avatars/one"]);

    expect((await update(me, { profileImage: "" })).body.user.profileImage).toBe("");
    expect(destroyed).toEqual(["plotpost/avatars/one", "plotpost/avatars/two"]);

    // Saving other fields leaves the photo alone.
    await update(me, { profileImage: avatar("three") });
    await update(me, { bio: "New bio" });
    expect(destroyed).toHaveLength(2);
  });

  test("notification switches are saved", async () => {
    const me = await newUser();
    await update(me, { settings: { pushNotifications: false } });
    expect((await profile(me)).body.user.settings).toEqual({ pushNotifications: false, emailInquiries: true });
    await update(me, { settings: { emailInquiries: false, pushNotifications: true } });
    expect((await profile(me)).body.user.settings).toEqual({ pushNotifications: true, emailInquiries: false });
  });

  test("profile photo upload: square, 400 px, in plotpost/avatars", async () => {
    const me = await newUser();
    const spy = jest.spyOn(cloudinary.uploader, "upload_stream").mockImplementation((options, callback) => ({
      end: () => callback(null, { secure_url: avatar("new"), public_id: "plotpost/avatars/new" }),
    }));
    const png = Buffer.from(
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==",
      "base64"
    );

    const res = await request(app)
      .post("/api/upload/avatar")
      .set(auth(me))
      .attach("image", png, { filename: "me.png", contentType: "image/png" });
    expect(res.status).toBe(200);
    expect(res.body.imageUrl).toBe(avatar("new"));
    expect(spy.mock.calls[0][0]).toMatchObject({
      folder: "plotpost/avatars",
      format: "jpg",
      transformation: [{ width: 400, height: 400, crop: "fill", gravity: "face" }, { quality: "auto" }],
    });
    // And it can be saved as the profile photo.
    expect((await update(me, { profileImage: res.body.imageUrl })).status).toBe(200);
    expect((await request(app).post("/api/upload/avatar").attach("image", png, "me.png")).status).toBe(401);
  });
});

// ----------------------------------------------------- change password
describe("change password", () => {
  const change = (who, body) => request(app).post("/api/auth/change-password").set(auth(who)).send(body);
  const login = (email, password) => request(app).post("/api/auth/login").send({ email, password });

  test("logs out other phones; this phone gets a new login", async () => {
    const me = await newUser();
    const otherPhone = (await login(me.email, me.password)).body.token;

    const res = await change(me, { currentPassword: me.password, newPassword: "NewPass456" });
    expect(res.status).toBe(200);
    expect(res.body.message).toMatch(/logged out on other devices/);

    expect((await profile(res.body.token)).status).toBe(200);
    const old = await profile(otherPhone);
    expect(old.status).toBe(401);
    expect(old.body).toMatchObject({ sessionEnded: true });
    expect(old.body.message).toMatch(/log in again/);
    expect((await profile(me.token)).status).toBe(401);

    expect((await login(me.email, "NewPass456")).status).toBe(200);
    expect((await login(me.email, me.password)).status).toBe(401);
  });

  test("wrong current password, same password and weak passwords are refused", async () => {
    const me = await newUser();
    expect((await change(me, { currentPassword: "Wrong123", newPassword: "NewPass456" })).body.message).toMatch(/current password is incorrect/);
    expect((await change(me, { currentPassword: me.password, newPassword: me.password })).body.message).toMatch(/different/);
    expect((await change(me, { currentPassword: me.password, newPassword: "short1" })).status).toBe(400);
    expect((await change(me, { currentPassword: me.password, newPassword: "lettersonly" })).body.message).toMatch(/number/);
    // Nothing changed: the old login still works.
    expect((await profile(me)).status).toBe(200);
  });

  test("Google-only accounts are sent to Forgot Password", async () => {
    const google = await User.create({ name: "G User", email: "g@example.com", googleId: "google-123" });
    const token = require("../controllers/authController").generateToken(google);
    const res = await change(token, { currentPassword: "anything1", newPassword: "NewPass456" });
    expect(res.status).toBe(400);
    expect(res.body).toMatchObject({ noPassword: true });
    expect(res.body.message).toMatch(/Forgot Password/);
    expect((await profile(token)).body.user).toMatchObject({ hasPassword: false, googleLinked: true });
  });
});

// ------------------------------------------- log out of other devices
describe("log out of all devices", () => {
  test("ends every other login, including on pages guests can see", async () => {
    const me = await newUser();
    const otherPhone = (await request(app).post("/api/auth/login").send({ email: me.email, password: me.password })).body.token;

    const res = await request(app).post("/api/auth/logout-all").set(auth(me));
    expect(res.status).toBe(200);
    expect((await profile(res.body.token)).status).toBe(200);
    expect((await profile(otherPhone)).status).toBe(401);

    // On the feed an ended login just counts as a guest.
    const post = await makePost(me);
    await request(app).post(`/api/posts/${post._id}/like`).set(auth(res.body.token));
    const asOldPhone = await request(app).get("/api/posts").set(auth(otherPhone));
    expect(asOldPhone.status).toBe(200);
    expect(asOldPhone.body.posts[0].isLiked).toBe(false);
  });

  test("resetting the password with the emailed code also logs out other phones", async () => {
    const me = await newUser();
    await request(app).post("/api/auth/forgot-password").send({ email: me.email });
    const code = [...outbox].reverse().find((m) => m.to === me.email).code;
    const res = await request(app)
      .post("/api/auth/reset-password")
      .send({ email: me.email, code, newPassword: "Reset789xyz" });
    expect(res.status).toBe(200);
    expect((await profile(res.body.token)).status).toBe(200);
    expect((await profile(me.token)).status).toBe(401);
  });
});

// ------------------------------------------------------ delete account
describe("delete account", () => {
  const remove = (who, body) => request(app).delete("/api/users/me").set(auth(who)).send(body);

  test("needs your password (or DELETE for Google-only accounts)", async () => {
    const me = await newUser();
    expect((await remove(me, {})).body.message).toMatch(/enter your password/);
    expect((await remove(me, { password: "Wrong123" })).body.message).toMatch(/incorrect/);
    expect((await remove(me, { confirm: "DELETE" })).status).toBe(400);
    expect(await User.countDocuments({ _id: me.id })).toBe(1);

    const google = await User.create({ name: "G", email: "g2@example.com", googleId: "google-456" });
    const token = require("../controllers/authController").generateToken(google);
    expect((await remove(token, { confirm: "delete please" })).body.message).toMatch(/type DELETE/);
    expect((await remove(token, { confirm: "DELETE" })).status).toBe(200);
    expect(await User.countDocuments({ _id: google._id })).toBe(0);
  });

  test("removes your posts, comments, likes, follows and enquiries, and nobody else's", async () => {
    const me = await newUser("Leaving");
    const other = await newUser("Staying");
    await update(me, { profileImage: avatar("me") });

    // My post, with a buyer's lead, a view record and someone's save.
    const mine = await makePost(me, { imageUrls: [postPhoto("mine1"), postPhoto("mine2")] });
    await request(app).post("/api/enquiries").send({
      postId: String(mine._id), name: "Buyer", phone: "9847000000", message: "Please share details.",
    });
    await request(app).post(`/api/posts/${mine._id}/view`).set(auth(other));
    await request(app).post(`/api/users/saved/${mine._id}`).set(auth(other)).send({ saved: true });

    // Their post: my comment and like next to theirs; my enquiry; my report.
    const theirs = await makePost(other, { title: "Their post", imageUrls: [postPhoto("theirs")] });
    await request(app).post(`/api/posts/${theirs._id}/comment`).set(auth(other)).send({ text: "Seller here." });
    await request(app).post(`/api/posts/${theirs._id}/comment`).set(auth(me)).send({ text: "Mine, please delete." });
    await request(app).post(`/api/posts/${theirs._id}/like`).set(auth(me));
    await request(app).post(`/api/posts/${theirs._id}/like`).set(auth(other));
    await request(app).post("/api/enquiries").set(auth(me)).send({
      postId: String(theirs._id), name: "Leaving", phone: "9847111111", message: "I'm interested in this.",
    });
    await request(app).post(`/api/posts/${theirs._id}/report`).set(auth(me)).send({ reason: "Other reason" });

    // Follows both ways.
    await request(app).post(`/api/users/${other.id}/follow`).set(auth(me));
    await request(app).post(`/api/users/${me.id}/follow`).set(auth(other));

    const res = await remove(me, { password: me.password });
    expect(res.status).toBe(200);
    expect(res.body.message).toMatch(/deleted/);

    expect(await User.countDocuments({ _id: me.id })).toBe(0);
    expect(await Post.countDocuments({ user: me.id })).toBe(0);
    expect(await PostView.countDocuments({ post: mine._id })).toBe(0);
    expect(await Enquiry.countDocuments()).toBe(0);
    expect(await Follow.countDocuments()).toBe(0);
    expect(destroyed.sort()).toEqual(["plotpost/avatars/me", "plotpost/posts/mine1", "plotpost/posts/mine2"]);

    const theirPost = await Post.findById(theirs._id).lean();
    expect(theirPost.comments.map((c) => c.text)).toEqual(["Seller here."]);
    expect(theirPost.likes.map(String)).toEqual([other.id]);
    expect((await User.findById(other.id).lean()).savedPosts).toEqual([]);
    // Reports you made stay, without you.
    expect(await Report.countDocuments({ post: theirs._id })).toBe(1);

    // Your login no longer works; the other account is untouched.
    const gone = await profile(me);
    expect(gone.status).toBe(401);
    expect(gone.body.sessionEnded).toBe(true);
    expect((await profile(other)).body.user.stats).toEqual({ listings: 1, followers: 0, following: 0 });
  });
});

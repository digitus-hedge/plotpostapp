// Accounts: sign-up, login, email verification, forgot / reset / change
// password, Google sign-in. (Replaces the older test file that was written
// for refresh tokens, which this backend doesn't use.)
// Uses TEST_MONGODB_URI if set, otherwise a temporary MongoDB. Never your real database.
const request = require("supertest");
const app = require("../app");
const db = require("./helpers/db");
const User = require("../models/User");
const emailService = require("../services/emailService");
const googleAuthService = require("../services/googleAuthService");

const { outbox } = emailService;

beforeAll(() => db.connect("auth"));
afterEach(async () => {
  jest.restoreAllMocks();
  outbox.length = 0;
  process.env.EMAIL_VERIFICATION_REQUIRED = "false";
  await db.clear();
});
afterAll(() => db.close());

let counter = 0;
const register = async (extra = {}) => {
  counter += 1;
  const body = { name: "Asha Nair", email: `asha${counter}@example.com`, password: "Password123", acceptTerms: true, ...extra };
  const res = await request(app).post("/api/auth/register").send(body);
  return { res, email: body.email, password: body.password, token: res.body.token, id: res.body.user?.id };
};
const bearer = (token) => ({ Authorization: `Bearer ${token}` });
const lastCode = (email, kind) => [...outbox].reverse().find((m) => m.to === email && m.kind === kind)?.code;
// Lets a test ask for another code without waiting out the 60-second cooldown.
const skipCooldown = (email, field) =>
  User.collection.updateOne({ email }, { $set: { [`${field}.sentAt`]: new Date(Date.now() - 5 * 60 * 1000) } });

const PHOTO = "https://res.cloudinary.com/test-cloud/image/upload/v1/plotpost/posts/a.jpg";
const newPost = {
  title: "10 cent plot near Chevayur",
  type: "Plot",
  deal: "For sale",
  price: "₹38 lakh",
  location: "Chevayur, Kozhikode",
  description: "Level plot with road access",
  platform: "PlotPost",
  imageUrls: [PHOTO],
};

describe("sign-up", () => {
  test("creates an account, logs in and emails a 6-digit code", async () => {
    const { res, email } = await register();
    expect(res.status).toBe(201);
    expect(res.body.token).toEqual(expect.any(String));
    expect(res.body.verificationEmailSent).toBe(true);
    expect(res.body.user).toMatchObject({ email, isEmailVerified: false });
    expect(res.body.user.termsAcceptedAt).toBeTruthy();
    expect(lastCode(email, "verify")).toMatch(/^\d{6}$/);
    // Only a hash of the code is stored.
    const saved = await User.findOne({ email }).select("+emailVerification").lean();
    expect(JSON.stringify(saved)).not.toContain(lastCode(email, "verify"));
  });

  test("refuses a duplicate email (any letter case) and can't make itself an admin", async () => {
    const { email } = await register({ role: "admin" });
    expect((await User.findOne({ email }).lean()).role).toBe("user");
    const again = await request(app).post("/api/auth/register").send({ name: "Copy", email: email.toUpperCase(), password: "Password123" });
    expect(again.status).toBe(400);
  });
});

describe("login", () => {
  test("works with the right password in any email case; wrong password and unknown email look the same", async () => {
    const { email, password } = await register();
    const ok = await request(app).post("/api/auth/login").send({ email: email.toUpperCase(), password });
    expect(ok.status).toBe(200);
    expect(ok.body.user.isEmailVerified).toBe(false);
    const wrong = await request(app).post("/api/auth/login").send({ email, password: "Wrong12345" });
    const unknown = await request(app).post("/api/auth/login").send({ email: "nobody@example.com", password: "Wrong12345" });
    expect([wrong.status, unknown.status]).toEqual([401, 401]);
    expect(wrong.body.message).toBe(unknown.body.message);
  });

  test("protected routes need a valid login", async () => {
    expect((await request(app).get("/api/users/profile")).status).toBe(401);
    expect((await request(app).get("/api/users/profile").set(bearer("garbage"))).status).toBe(401);
  });
});

describe("email verification", () => {
  test("the emailed code confirms the email", async () => {
    const { email, token } = await register();
    const res = await request(app).post("/api/auth/verify-email").set(bearer(token)).send({ code: lastCode(email, "verify") });
    expect(res.status).toBe(200);
    expect(res.body.user.isEmailVerified).toBe(true);
    expect((await User.findOne({ email }).lean()).emailVerifiedAt).toBeTruthy();
    const profile = await request(app).get("/api/users/profile").set(bearer(token));
    expect(profile.body.user.isEmailVerified).toBe(true);
    const again = await request(app).post("/api/auth/verify-email").set(bearer(token)).send({ code: "123456" });
    expect(again.body.message).toBe("Your email is already verified.");
  });

  test("wrong codes fail, and 5 wrong tries end the code", async () => {
    const { email, token } = await register();
    const code = lastCode(email, "verify");
    const wrong = code === "000000" ? "111111" : "000000";
    for (let i = 0; i < 5; i += 1) {
      const res = await request(app).post("/api/auth/verify-email").set(bearer(token)).send({ code: wrong });
      expect(res.status).toBe(400);
    }
    const locked = await request(app).post("/api/auth/verify-email").set(bearer(token)).send({ code });
    expect(locked.status).toBe(400);
    expect((await request(app).post("/api/auth/verify-email").set(bearer(token)).send({ code: "12ab" })).status).toBe(400);
  });

  test("a new code needs a minute's wait, then replaces the old one", async () => {
    const { email, token } = await register();
    const first = lastCode(email, "verify");
    expect((await request(app).post("/api/auth/resend-verification").set(bearer(token))).status).toBe(429);
    await skipCooldown(email, "emailVerification");
    const res = await request(app).post("/api/auth/resend-verification").set(bearer(token));
    expect(res.status).toBe(200);
    expect(outbox.filter((m) => m.to === email && m.kind === "verify")).toHaveLength(2);
    const second = lastCode(email, "verify");
    if (first !== second) {
      expect((await request(app).post("/api/auth/verify-email").set(bearer(token)).send({ code: first })).status).toBe(400);
    }
    expect((await request(app).post("/api/auth/verify-email").set(bearer(token)).send({ code: second })).status).toBe(200);
    expect((await request(app).post("/api/auth/resend-verification").set(bearer(token))).status).toBe(400);
  });

  test("unverified accounts can browse, like and save, but not post, comment, chat or send interest", async () => {
    process.env.EMAIL_VERIFICATION_REQUIRED = "true";
    const seller = await register({ name: "Ravi" });
    await request(app).post("/api/auth/verify-email").set(bearer(seller.token)).send({ code: lastCode(seller.email, "verify") });
    const post = await request(app).post("/api/posts").set(bearer(seller.token)).send(newPost);
    expect(post.status).toBe(201);
    const postId = post.body.post._id;

    const buyer = await register({ name: "Biju" });
    const refused = [
      await request(app).post("/api/posts").set(bearer(buyer.token)).send(newPost),
      await request(app).post(`/api/posts/${postId}/comment`).set(bearer(buyer.token)).send({ text: "Still available?" }),
      await request(app).post("/api/chats").set(bearer(buyer.token)).send({ userId: seller.id }),
      await request(app)
        .post("/api/enquiries")
        .set(bearer(buyer.token))
        .send({ postId, name: "Biju", phone: "9895012345", message: "Is this still available?", contactMethod: "Phone call" }),
    ];
    for (const res of refused) {
      expect(res.status).toBe(403);
      expect(res.body).toMatchObject({ emailNotVerified: true, email: buyer.email });
    }
    expect((await request(app).get("/api/posts").set(bearer(buyer.token))).status).toBe(200);
    expect((await request(app).post(`/api/posts/${postId}/like`).set(bearer(buyer.token))).status).toBe(200);
    expect((await request(app).post(`/api/users/saved/${postId}`).set(bearer(buyer.token)).send({ saved: true })).status).toBe(200);

    // Once verified, the same actions work.
    await request(app).post("/api/auth/verify-email").set(bearer(buyer.token)).send({ code: lastCode(buyer.email, "verify") });
    expect((await request(app).post(`/api/posts/${postId}/comment`).set(bearer(buyer.token)).send({ text: "Still available?" })).status).toBe(201);
    expect((await request(app).post("/api/chats").set(bearer(buyer.token)).send({ userId: seller.id })).status).toBeLessThan(300);
  });

  test("not required while no email service is set up (nobody could get a code)", async () => {
    process.env.EMAIL_VERIFICATION_REQUIRED = "true";
    const { token } = await register();
    jest.spyOn(emailService, "canSend").mockReturnValue(false);
    expect((await request(app).post("/api/posts").set(bearer(token)).send(newPost)).status).toBe(201);
  });

  test("accounts made before verification existed count as verified", async () => {
    await User.collection.insertOne({ name: "Old", email: "old@example.com", password: "x", createdAt: new Date("2025-01-01") });
    expect(await User.upgradeOldUsers()).toBe(1);
    expect((await User.findOne({ email: "old@example.com" }).lean()).emailVerifiedAt).toBeTruthy();
    // New accounts aren't touched.
    const { email } = await register();
    expect(await User.upgradeOldUsers()).toBe(0);
    expect((await User.findOne({ email }).lean()).emailVerifiedAt).toBeNull();
  });
});

describe("forgot and reset password", () => {
  test("known and unknown emails get the same answer; only real accounts get a code", async () => {
    const { email } = await register();
    const known = await request(app).post("/api/auth/forgot-password").send({ email });
    const unknown = await request(app).post("/api/auth/forgot-password").send({ email: "nobody@example.com" });
    expect([known.status, unknown.status]).toEqual([200, 200]);
    expect(known.body.message).toBe(unknown.body.message);
    expect(lastCode(email, "reset")).toMatch(/^\d{6}$/);
    expect(outbox.some((m) => m.to === "nobody@example.com")).toBe(false);
    // A second request within a minute sends nothing new (same answer).
    expect((await request(app).post("/api/auth/forgot-password").send({ email })).status).toBe(200);
    expect(outbox.filter((m) => m.to === email && m.kind === "reset")).toHaveLength(1);
  });

  test("the code sets a new password, ends other logins, confirms the email and works once", async () => {
    const { email, token } = await register();
    await request(app).post("/api/auth/forgot-password").send({ email });
    const code = lastCode(email, "reset");

    const bad = await request(app).post("/api/auth/reset-password").send({ email, code: code === "000000" ? "111111" : "000000", newPassword: "NewPass456" });
    expect(bad.status).toBe(400);

    const res = await request(app).post("/api/auth/reset-password").send({ email, code, newPassword: "NewPass456" });
    expect(res.status).toBe(200);
    expect(res.body.token).toEqual(expect.any(String));
    expect(res.body.user.isEmailVerified).toBe(true);
    expect((await request(app).get("/api/users/profile").set(bearer(token))).status).toBe(401);
    expect((await request(app).post("/api/auth/login").send({ email, password: "NewPass456" })).status).toBe(200);

    const reuse = await request(app).post("/api/auth/reset-password").send({ email, code, newPassword: "Another789" });
    expect(reuse.status).toBe(400);
  });
});

describe("change password", () => {
  test("needs the right current password and a different new one; other logins end", async () => {
    const { email, password, token } = await register();
    const second = await request(app).post("/api/auth/login").send({ email, password });
    expect((await request(app).post("/api/auth/change-password").set(bearer(token)).send({ currentPassword: "Wrong1234", newPassword: "NewPass456" })).status).toBe(400);
    expect((await request(app).post("/api/auth/change-password").set(bearer(token)).send({ currentPassword: password, newPassword: password })).status).toBe(400);
    const ok = await request(app).post("/api/auth/change-password").set(bearer(token)).send({ currentPassword: password, newPassword: "NewPass456" });
    expect(ok.status).toBe(200);
    expect((await request(app).get("/api/users/profile").set(bearer(second.body.token))).status).toBe(401);
    expect((await request(app).get("/api/users/profile").set(bearer(ok.body.token))).status).toBe(200);
  });
});

describe("Google sign-in", () => {
  const googleProfile = (overrides = {}) => ({
    googleId: "google-sub-123",
    email: "gina@example.com",
    emailVerified: true,
    name: "Gina George",
    picture: "https://lh3.googleusercontent.com/photo.jpg",
    ...overrides,
  });
  const google = () => request(app).post("/api/auth/google").send({ idToken: "a".repeat(50) });

  test("creates an account with a confirmed email and no password", async () => {
    jest.spyOn(googleAuthService, "verifyGoogleIdToken").mockResolvedValue(googleProfile());
    const res = await google();
    expect(res.status).toBe(201);
    expect(res.body.isNewUser).toBe(true);
    expect(res.body.user).toMatchObject({ email: "gina@example.com", isEmailVerified: true });
    expect((await User.findOne({ email: "gina@example.com" }).lean()).password).toBeFalsy();
    const again = await google();
    expect(again.status).toBe(200);
    expect(again.body.isNewUser).toBe(false);
  });

  test("links to an existing account only when Google confirmed the email", async () => {
    const { email } = await register();
    jest.spyOn(googleAuthService, "verifyGoogleIdToken").mockResolvedValue(googleProfile({ email, emailVerified: false }));
    expect((await google()).status).toBe(409);
    googleAuthService.verifyGoogleIdToken.mockResolvedValue(googleProfile({ email }));
    const linked = await google();
    expect(linked.status).toBe(200);
    expect(linked.body.user).toMatchObject({ email, isEmailVerified: true });
  });
});

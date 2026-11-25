// Phase 3 Step 1: the public seller profile, and hiding phone numbers from
// people who aren't logged in.
// Uses TEST_MONGODB_URI if set, otherwise a temporary MongoDB. Never your real database.
process.env.NODE_ENV = "test";
process.env.JWT_SECRET = "test-secret-that-is-long-enough-for-signing-tokens";

const request = require("supertest");
const mongoose = require("mongoose");
const app = require("../server");
const User = require("../models/User");
const Post = require("../models/Post");
const Follow = require("../models/Follow");
const { HIDDEN } = require("../utils/phoneMask");

let memoryServer;

beforeAll(async () => {
  let uri = process.env.TEST_MONGODB_URI;
  if (!uri) {
    const { MongoMemoryServer } = require("mongodb-memory-server-core");
    memoryServer = await MongoMemoryServer.create();
    uri = memoryServer.getUri();
  }
  const url = new URL(uri);
  url.pathname = "/plotpost_test_public_profile";
  await mongoose.connect(url.toString());
  await mongoose.connection.db.dropDatabase();
  await Promise.all([User.createIndexes(), Post.createIndexes(), Follow.createIndexes()]);
});

afterEach(async () => {
  await Promise.all([User.deleteMany({}), Post.deleteMany({}), Follow.deleteMany({})]);
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
    .send({ name, email: `pp${counter}@example.com`, password: "Password123" });
  return { id: String(res.body.user.id), token: res.body.token, name };
};
const auth = (user) => ({ Authorization: `Bearer ${user.token}` });
const get = (path, user) => {
  const req = request(app).get(path);
  return user ? req.set(auth(user)) : req;
};

let made = 0;
const makePost = (seller, extra = {}) => {
  made += 1;
  return Post.create({
    user: seller.id,
    title: `Plot ${made} at West Hill`,
    location: "West Hill, Kozhikode",
    price: "₹40 lakh",
    platform: "Instagram",
    socialUrl: `https://www.instagram.com/p/abc${made}/`,
    sellerPhone: "+91 98950 00003",
    description: "12 cents, clear title. Call 98950 12345 or 0495 2721234.",
    imageUrls: ["https://res.cloudinary.com/demo/image/upload/plotpost/posts/v.jpg"],
    createdAt: new Date(Date.now() - (100 - made) * 60000),
    ...extra,
  });
};

describe("public seller profile", () => {
  test("anyone can open it; it never shows email or phone", async () => {
    const seller = await newUser("Ravi Kumar");
    await User.updateOne(
      { _id: seller.id },
      { phone: "9895000001", bio: "Plots in Kozhikode. WhatsApp 98950 00001", agency: "Ravi Realty", location: "Kozhikode" }
    );
    const fan = await newUser("Fan");
    await request(app).post(`/api/users/${seller.id}/follow`).set(auth(fan));
    await makePost(seller);
    await makePost(seller, { status: "sold" });
    await makePost(seller, { status: "rented" });
    await makePost(seller, { removedAt: new Date(), removedReason: "Fake" });

    const guest = await get(`/api/users/${seller.id}`);
    expect(guest.status).toBe(200);
    expect(guest.body.user).toMatchObject({
      name: "Ravi Kumar",
      agency: "Ravi Realty",
      location: "Kozhikode",
      bio: `Plots in Kozhikode. WhatsApp ${HIDDEN}`,
      stats: { listings: 1, soldOrRented: 2, followers: 1, following: 0 },
      isFollowing: false,
      isYou: false,
      blockedByMe: false,
    });
    expect(guest.body.user.memberSince).toBeTruthy();
    expect(guest.body.user).not.toHaveProperty("email");
    expect(guest.body.user).not.toHaveProperty("phone");
    expect(JSON.stringify(guest.body)).not.toMatch(/pp\d+@example\.com|9895000001/);

    const asFan = await get(`/api/users/${seller.id}`, fan);
    expect(asFan.body.user).toMatchObject({ isFollowing: true, bio: "Plots in Kozhikode. WhatsApp 98950 00001" });
    expect((await get(`/api/users/${seller.id}`, seller)).body.user.isYou).toBe(true);
  });

  test("bad, deleted and banned accounts aren't shown", async () => {
    const seller = await newUser("Gone");
    expect((await get("/api/users/not-an-id")).status).toBe(400);
    expect((await get(`/api/users/${new mongoose.Types.ObjectId()}`)).status).toBe(404);
    await User.updateOne({ _id: seller.id }, { bannedAt: new Date(), banReason: "Scam" });
    expect((await get(`/api/users/${seller.id}`)).status).toBe(404);
    expect((await get(`/api/users/${seller.id}/posts`)).status).toBe(404);
  });

  test("the other /users routes still work", async () => {
    const me = await newUser("Me");
    expect((await get("/api/users/profile")).status).toBe(401);
    expect((await get("/api/users/profile", me)).body.user.email).toMatch(/@example\.com$/);
    expect((await get("/api/users/saved", me)).status).toBe(200);
    expect((await get("/api/users/blocked", me)).status).toBe(200);
    expect((await get("/api/users/suggested-sellers")).status).toBe(200);
  });

  test("Live and Sold / rented tabs, newest first, 20 at a time", async () => {
    const seller = await newUser("Ravi");
    for (let i = 0; i < 21; i += 1) await makePost(seller);
    const sold = await makePost(seller, { status: "sold" });
    const rented = await makePost(seller, { status: "rented" });
    await makePost(seller, { removedAt: new Date() });

    const first = await get(`/api/users/${seller.id}/posts`);
    expect(first.body).toMatchObject({ tab: "live", page: 1, total: 21, hasMore: true });
    expect(first.body.posts).toHaveLength(20);
    const times = first.body.posts.map((p) => new Date(p.createdAt).getTime());
    expect([...times].sort((a, b) => b - a)).toEqual(times);
    expect(first.body.posts[0].user).toMatchObject({ name: "Ravi" });

    const second = await get(`/api/users/${seller.id}/posts?page=2`);
    expect(second.body.posts).toHaveLength(1);
    expect(second.body.hasMore).toBe(false);

    const closed = await get(`/api/users/${seller.id}/posts?tab=sold`);
    expect(closed.body.tab).toBe("sold");
    expect(closed.body.posts.map((p) => String(p._id)).sort()).toEqual([String(sold._id), String(rented._id)].sort());
  });

  test("a banned seller's posts and posts of people you blocked don't show", async () => {
    const seller = await newUser("Ravi");
    const viewer = await newUser("Viewer");
    await makePost(seller);
    await makePost(seller, { sellerBanned: true });
    expect((await get(`/api/users/${seller.id}/posts`, viewer)).body.total).toBe(1);

    await request(app).post(`/api/users/${seller.id}/block`).set(auth(viewer));
    expect((await get(`/api/users/${seller.id}`, viewer)).body.user.blockedByMe).toBe(true);
    const posts = await get(`/api/users/${seller.id}/posts`, viewer);
    expect(posts.body).toMatchObject({ blockedByMe: true, total: 0, posts: [] });
    // Others still see them.
    expect((await get(`/api/users/${seller.id}/posts`)).body.total).toBe(1);
  });
});

describe("phone numbers are hidden from people who aren't logged in", () => {
  test("feed, details, saved-by-ids and profile listings", async () => {
    const seller = await newUser("Ravi");
    const buyer = await newUser("Buyer");
    const post = await makePost(seller, { title: "Villa, call 98950 12345", sellerName: "Ravi 98950 00009" });
    const noPhone = await makePost(seller, { sellerPhone: "" });

    const guestLists = [
      (await get("/api/posts")).body.posts,
      (await get(`/api/posts/by-ids?ids=${post._id},${noPhone._id}`)).body.posts,
      (await get(`/api/users/${seller.id}/posts`)).body.posts,
      [(await get(`/api/posts/${post._id}`)).body.post],
    ];
    for (const list of guestLists) {
      const item = list.find((p) => String(p._id) === String(post._id));
      expect(item).toMatchObject({
        sellerPhone: "",
        hasPhone: true,
        phoneHidden: true,
        title: `Villa, call ${HIDDEN}`,
        sellerName: `Ravi ${HIDDEN}`,
        description: `12 cents, clear title. Call ${HIDDEN} or ${HIDDEN}.`,
      });
      const other = list.find((p) => String(p._id) === String(noPhone._id));
      if (other) expect(other.hasPhone).toBe(false);
    }

    const details = (await get(`/api/posts/${post._id}`, buyer)).body.post;
    expect(details).toMatchObject({
      sellerPhone: "+91 98950 00003",
      hasPhone: true,
      title: "Villa, call 98950 12345",
      description: "12 cents, clear title. Call 98950 12345 or 0495 2721234.",
    });
    expect(details).not.toHaveProperty("phoneHidden");
    const feed = (await get("/api/posts", buyer)).body.posts.find((p) => String(p._id) === String(post._id));
    expect(feed.sellerPhone).toBe("+91 98950 00003");
  });

  test("comments", async () => {
    const seller = await newUser("Ravi");
    const buyer = await newUser("Buyer");
    const post = await makePost(seller);
    const added = await request(app)
      .post(`/api/posts/${post._id}/comment`)
      .set(auth(buyer))
      .send({ text: "Interested, my number is 98950 22222" });
    expect(added.status).toBe(201);

    const guest = await get(`/api/posts/${post._id}/comments`);
    expect(guest.body.comments[0].text).toBe(`Interested, my number is ${HIDDEN}`);
    const member = await get(`/api/posts/${post._id}/comments`, seller);
    expect(member.body.comments[0].text).toBe("Interested, my number is 98950 22222");
  });
});

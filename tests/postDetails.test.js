// Screen 4 tests: Property Details (latest post, seller card, views, contact taps).
// Uses TEST_MONGODB_URI if set, otherwise a temporary MongoDB. Never your real database.
process.env.NODE_ENV = "test";
process.env.JWT_SECRET = "test-secret-that-is-long-enough-for-signing-tokens";

const request = require("supertest");
const mongoose = require("mongoose");
const app = require("../server");
const User = require("../models/User");
const Post = require("../models/Post");
const Follow = require("../models/Follow");
const PostView = require("../models/PostView");

let memoryServer;

beforeAll(async () => {
  let uri = process.env.TEST_MONGODB_URI;
  if (!uri) {
    const { MongoMemoryServer } = require("mongodb-memory-server-core");
    memoryServer = await MongoMemoryServer.create();
    uri = memoryServer.getUri();
  }
  const url = new URL(uri);
  url.pathname = "/plotpost_test_screen4";
  await mongoose.connect(url.toString());
  await mongoose.connection.db.dropDatabase();
  await Promise.all([User.createIndexes(), Post.createIndexes(), Follow.createIndexes(), PostView.createIndexes()]);
});

afterEach(async () => {
  await Promise.all([User.deleteMany({}), Post.deleteMany({}), Follow.deleteMany({}), PostView.deleteMany({})]);
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
    .send({ name, email: `d${counter}@example.com`, password: "Password123" });
  return { id: String(res.body.user.id), token: res.body.token, name };
};
const auth = (user) => ({ Authorization: `Bearer ${user.token}` });

const makePost = (seller, extra = {}) =>
  Post.create({
    user: seller.id,
    title: "3 BHK villa at West Hill",
    location: "West Hill, Kozhikode",
    price: "₹95 lakh",
    platform: "Instagram",
    socialUrl: "https://www.instagram.com/p/abc/",
    sellerPhone: "+91 98950 00003",
    imageUrls: ["https://res.cloudinary.com/demo/image/upload/plotpost/posts/v.jpg"],
    ...extra,
  });

const details = (post, user) => {
  const req = request(app).get(`/api/posts/${post._id}`);
  return user ? req.set(auth(user)) : req;
};
const view = (post, user) => {
  const req = request(app).post(`/api/posts/${post._id}/view`);
  return user ? req.set(auth(user)) : req;
};
const tap = (post, action, user) => {
  const req = request(app).post(`/api/posts/${post._id}/contact`).send({ action });
  return user ? req.set(auth(user)) : req;
};

// ------------------------------------------------------------ details
describe("post details", () => {
  test("returns the latest copy of the post (after the seller edits it)", async () => {
    const seller = await newUser("Calicut Homes");
    const post = await makePost(seller);
    await request(app).put(`/api/posts/${post._id}`).set(auth(seller)).send({ price: "₹90 lakh" });

    const res = await details(post);
    expect(res.status).toBe(200);
    expect(res.body.post).toMatchObject({ title: "3 BHK villa at West Hill", price: "₹90 lakh", views: 0, likesCount: 0, isLiked: false });
    expect(res.body.post.likes).toBeUndefined();
    expect(res.body.post.comments).toBeUndefined();
  });

  test("includes the seller card: name, photo, listings, followers, member since; never email", async () => {
    const seller = await newUser("Calicut Homes");
    await User.updateOne({ _id: seller.id }, { $set: { profileImage: "https://res.cloudinary.com/demo/image/upload/a.jpg" } });
    const post = await makePost(seller);
    await makePost(seller, { title: "Second listing" });
    const fan = await newUser();
    await request(app).post(`/api/users/${seller.id}/follow`).set(auth(fan));

    const res = await details(post);
    expect(res.body.seller).toMatchObject({
      id: seller.id,
      name: "Calicut Homes",
      profileImage: "https://res.cloudinary.com/demo/image/upload/a.jpg",
      postsCount: 2,
      followersCount: 1,
      isFollowing: false,
      isYou: false,
    });
    expect(res.body.seller.memberSince).toBeDefined();
    expect(JSON.stringify(res.body)).not.toContain("@example.com");
  });

  test("shows whether you follow the seller, and marks your own post", async () => {
    const seller = await newUser();
    const fan = await newUser();
    const post = await makePost(seller);
    await request(app).post(`/api/users/${seller.id}/follow`).set(auth(fan));

    expect((await details(post, fan)).body.seller).toMatchObject({ isFollowing: true, isYou: false });
    expect((await details(post, seller)).body.seller).toMatchObject({ isFollowing: false, isYou: true });
  });

  test("a deleted post answers 404 with a clear message; a bad ID answers 400", async () => {
    const seller = await newUser();
    const post = await makePost(seller);
    await request(app).delete(`/api/posts/${post._id}`).set(auth(seller));
    const gone = await details(post);
    expect(gone.status).toBe(404);
    expect(gone.body.message).toMatch(/no longer available/);
    expect((await request(app).get("/api/posts/not-an-id")).status).toBe(400);
  });

  test("guests and broken logins can open details", async () => {
    const seller = await newUser();
    const post = await makePost(seller);
    expect((await details(post)).status).toBe(200);
    const broken = await request(app).get(`/api/posts/${post._id}`).set("Authorization", "Bearer broken");
    expect(broken.status).toBe(200);
  });

  test("/api/posts/my still reaches My Listings, not the details route", async () => {
    const seller = await newUser();
    await makePost(seller);
    const res = await request(app).get("/api/posts/my").set(auth(seller));
    expect(res.status).toBe(200);
    expect(res.body.posts).toHaveLength(1);
  });
});

// -------------------------------------------------------------- views
describe("views", () => {
  test("each person counts once a day; a second open the same day doesn't count", async () => {
    const seller = await newUser();
    const a = await newUser();
    const b = await newUser();
    const post = await makePost(seller);

    expect((await view(post, a)).body).toMatchObject({ counted: true, views: 1 });
    expect((await view(post, a)).body).toMatchObject({ counted: false, views: 1 });
    expect((await view(post, b)).body).toMatchObject({ counted: true, views: 2 });
    expect((await details(post)).body.post.views).toBe(2);
  });

  test("the seller's own opens don't count", async () => {
    const seller = await newUser();
    const post = await makePost(seller);
    expect((await view(post, seller)).body).toMatchObject({ counted: false, views: 0 });
  });

  test("the same person counts again on a new day", async () => {
    const seller = await newUser();
    const a = await newUser();
    const post = await makePost(seller);
    await view(post, a);
    // Pretend that first view was yesterday.
    await PostView.updateMany({}, { $set: { day: "2000-01-01" } });
    expect((await view(post, a)).body).toMatchObject({ counted: true, views: 2 });
  });

  test("guests count once per internet address, stored only as a hash", async () => {
    const seller = await newUser();
    const post = await makePost(seller);
    expect((await view(post)).body).toMatchObject({ counted: true, views: 1 });
    expect((await view(post)).body).toMatchObject({ counted: false, views: 1 });
    const row = await PostView.findOne({}).lean();
    expect(row.viewer).toMatch(/^ip:[0-9a-f]{32}$/);
    expect(row.viewer).not.toContain("127.0.0.1");
  });

  test("several opens at the same moment still count once", async () => {
    const seller = await newUser();
    const a = await newUser();
    const post = await makePost(seller);
    await Promise.all(Array.from({ length: 4 }, () => view(post, a)));
    expect((await Post.findById(post._id).lean()).views).toBe(1);
  });

  test("views show in the feed too", async () => {
    const seller = await newUser();
    const a = await newUser();
    const post = await makePost(seller);
    await view(post, a);
    expect((await request(app).get("/api/posts")).body.posts[0].views).toBe(1);
  });

  test("deleted and bad posts are refused", async () => {
    const seller = await newUser();
    const post = await makePost(seller);
    await request(app).delete(`/api/posts/${post._id}`).set(auth(seller));
    expect((await view(post)).status).toBe(404);
    expect((await request(app).post("/api/posts/nope/view")).status).toBe(400);
  });
});

// ------------------------------------------------------- contact taps
describe("Call and Open-link taps", () => {
  test("counted once per person per day, separately for call and link", async () => {
    const seller = await newUser();
    const a = await newUser();
    const post = await makePost(seller);

    expect((await tap(post, "call", a)).body.counted).toBe(true);
    expect((await tap(post, "call", a)).body.counted).toBe(false);
    expect((await tap(post, "link", a)).body.counted).toBe(true);
    await tap(post, "call"); // a guest

    const stored = await Post.findById(post._id).lean();
    expect(stored.stats).toMatchObject({ calls: 2, linkOpens: 1 });
  });

  test("the seller's own taps don't count", async () => {
    const seller = await newUser();
    const post = await makePost(seller);
    expect((await tap(post, "call", seller)).body.counted).toBe(false);
    expect((await Post.findById(post._id).lean()).stats.calls).toBe(0);
  });

  test("only the seller sees the tap counts (details and feed)", async () => {
    const seller = await newUser();
    const buyer = await newUser();
    const post = await makePost(seller);
    await tap(post, "call", buyer);

    expect((await details(post, seller)).body.post.stats).toEqual({ calls: 1, linkOpens: 0, shares: 0 });
    expect((await details(post, buyer)).body.post.stats).toBeUndefined();
    expect((await details(post)).body.post.stats).toBeUndefined();

    const sellerFeed = await request(app).get("/api/posts").set(auth(seller));
    expect(sellerFeed.body.posts[0].stats).toEqual({ calls: 1, linkOpens: 0, shares: 0 });
    const buyerFeed = await request(app).get("/api/posts").set(auth(buyer));
    expect(buyerFeed.body.posts[0].stats).toBeUndefined();
  });

  test("unknown actions and bad posts are refused", async () => {
    const seller = await newUser();
    const post = await makePost(seller);
    expect((await tap(post, "email")).status).toBe(400);
    expect((await tap(post, "__proto__")).status).toBe(400);
    expect((await request(app).post("/api/posts/nope/contact").send({ action: "call" })).status).toBe(400);
  });
});

// ---------------------------------------------------------- clean-up
describe("deleting a post", () => {
  test("also removes its view records", async () => {
    const seller = await newUser();
    const a = await newUser();
    const post = await makePost(seller);
    await view(post, a);
    await tap(post, "call", a);
    expect(await PostView.countDocuments({ post: post._id })).toBe(2);
    await request(app).delete(`/api/posts/${post._id}`).set(auth(seller));
    expect(await PostView.countDocuments({ post: post._id })).toBe(0);
  });
});

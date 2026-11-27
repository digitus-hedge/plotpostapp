// Screen 2 tests: Browse (home feed), likes, Following tab.
// Uses TEST_MONGODB_URI if set, otherwise a temporary MongoDB. Never your real database.
process.env.NODE_ENV = "test";
process.env.JWT_SECRET = "test-secret-that-is-long-enough-for-signing-tokens";

const request = require("supertest");
const mongoose = require("mongoose");
const app = require("../server");
const User = require("../models/User");
const Post = require("../models/Post");
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
  url.pathname = "/plotpost_test_screen2";
  await mongoose.connect(url.toString());
  await mongoose.connection.db.dropDatabase();
  // Rebuild indexes after emptying the database. (init() only runs once, and
  // its first run may have happened before the drop, so it isn't enough.)
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
// Signs up through the API and returns { id, token, name }.
const newUser = async (name = "Seller") => {
  counter += 1;
  const res = await request(app)
    .post("/api/auth/register")
    .send({ name, email: `u${counter}@example.com`, password: "Password123" });
  return { id: String(res.body.user.id), token: res.body.token, name };
};

const auth = (user) => ({ Authorization: `Bearer ${user.token}` });

// Creates posts one after another, so the newest is the last one created.
const makePosts = async (user, count, fields = {}) => {
  const posts = [];
  for (let i = 1; i <= count; i += 1) {
    posts.push(
      await Post.create({
        user: user.id,
        title: `${fields.titlePrefix || "Post"} ${i}`,
        location: fields.location || "Chevayur, Kozhikode, Kerala",
        platform: fields.platform || "Instagram",
      })
    );
  }
  return posts;
};

const feed = (query = "", user) => {
  const req = request(app).get(`/api/posts${query}`);
  return user ? req.set(auth(user)) : req;
};

// ------------------------------------------------------------------ feed
describe("home feed", () => {
  test("only real posts, newest first, 10 at a time with hasMore", async () => {
    const seller = await newUser();
    await makePosts(seller, 25);

    const p1 = await feed("?page=1");
    expect(p1.status).toBe(200);
    expect(p1.body.posts).toHaveLength(10);
    expect(p1.body.posts[0].title).toBe("Post 25");
    expect(p1.body).toMatchObject({ total: 25, page: 1, totalPages: 3, hasMore: true });

    const p3 = await feed("?page=3");
    expect(p3.body.posts.map((p) => p.title)).toEqual(["Post 5", "Post 4", "Post 3", "Post 2", "Post 1"]);
    expect(p3.body.hasMore).toBe(false);

    // No post is shown twice or skipped across pages.
    const p2 = await feed("?page=2");
    const titles = [...p1.body.posts, ...p2.body.posts, ...p3.body.posts].map((p) => p.title);
    expect(new Set(titles).size).toBe(25);
  });

  test("each post has counts and seller name/photo, but no like/comment lists or seller email", async () => {
    const seller = await newUser("Prime Plots");
    const fan = await newUser("Fan");
    const [post] = await makePosts(seller, 1);
    await Post.updateOne({ _id: post._id }, { $set: { likes: [fan.id], comments: [{ user: fan.id, text: "Nice" }] } });

    const res = await feed();
    const item = res.body.posts[0];
    expect(item).toMatchObject({ title: "Post 1", likesCount: 1, commentsCount: 1, isLiked: false });
    expect(item.user).toMatchObject({ _id: seller.id, name: "Prime Plots" });
    expect(item.user.email).toBeUndefined();
    expect(item.likes).toBeUndefined();
    expect(item.comments).toBeUndefined();
  });

  test("platform tabs filter on the server; All shows everything", async () => {
    const seller = await newUser();
    await makePosts(seller, 2, { platform: "Instagram" });
    await makePosts(seller, 3, { platform: "YouTube" });

    expect((await feed("?platform=YouTube")).body.total).toBe(3);
    expect((await feed("?platform=Instagram")).body.total).toBe(2);
    expect((await feed("?platform=All")).body.total).toBe(5);
    expect((await feed("?platform=Facebook")).body.posts).toEqual([]);
  });

  test("location chips match part of the location, any letter case", async () => {
    const seller = await newUser();
    await makePosts(seller, 2, { location: "Chevayur, Kozhikode, Kerala" });
    await makePosts(seller, 1, { location: "West Hill, Kozhikode" });

    expect((await feed("?locality=chevayur")).body.total).toBe(2);
    expect((await feed("?locality=West%20Hill")).body.total).toBe(1);
    expect((await feed("?locality=kozhikode")).body.total).toBe(3);
    expect((await feed("?locality=Nadakkavu")).body.total).toBe(0);
  });

  test("special characters in the location search don't break it", async () => {
    const seller = await newUser();
    await makePosts(seller, 1);
    for (const text of [".*", "(", "[a-", "\\", "$where"]) {
      const res = await feed(`?locality=${encodeURIComponent(text)}`);
      expect(res.status).toBe(200);
      expect(res.body.total).toBe(0);
    }
  });

  test("filters combine with paging", async () => {
    const seller = await newUser();
    await makePosts(seller, 12, { platform: "YouTube", location: "Nadakkavu, Kozhikode" });
    await makePosts(seller, 5, { platform: "Instagram", location: "Nadakkavu, Kozhikode" });
    const res = await feed("?platform=YouTube&locality=nadakkavu&page=2");
    expect(res.body).toMatchObject({ total: 12, hasMore: false });
    expect(res.body.posts).toHaveLength(2);
  });

  test("guests can browse; a broken or expired login doesn't break the feed", async () => {
    const seller = await newUser();
    await makePosts(seller, 1);
    expect((await feed()).status).toBe(200);
    const broken = await request(app).get("/api/posts").set("Authorization", "Bearer not-a-real-token");
    expect(broken.status).toBe(200);
    expect(broken.body.posts[0].isLiked).toBe(false);
  });
});

// ----------------------------------------------------------------- likes
describe("likes", () => {
  test("tap toggles; the feed then shows the right count and isLiked for you only", async () => {
    const seller = await newUser();
    const me = await newUser("Me");
    const [post] = await makePosts(seller, 1);

    const like = await request(app).post(`/api/posts/${post._id}/like`).set(auth(me));
    expect(like.body).toMatchObject({ success: true, isLiked: true, likesCount: 1 });

    expect((await feed("", me)).body.posts[0]).toMatchObject({ likesCount: 1, isLiked: true });
    expect((await feed("", seller)).body.posts[0]).toMatchObject({ likesCount: 1, isLiked: false });
    expect((await feed()).body.posts[0]).toMatchObject({ likesCount: 1, isLiked: false });

    const unlike = await request(app).post(`/api/posts/${post._id}/like`).set(auth(me));
    expect(unlike.body).toMatchObject({ isLiked: false, likesCount: 0 });
  });

  test("double-tap (like: true) never unlikes and never counts twice", async () => {
    const seller = await newUser();
    const me = await newUser();
    const [post] = await makePosts(seller, 1);
    for (let i = 0; i < 3; i += 1) {
      const res = await request(app).post(`/api/posts/${post._id}/like`).set(auth(me)).send({ like: true });
      expect(res.body).toMatchObject({ isLiked: true, likesCount: 1 });
    }
    const off = await request(app).post(`/api/posts/${post._id}/like`).set(auth(me)).send({ like: false });
    expect(off.body).toMatchObject({ isLiked: false, likesCount: 0 });
  });

  test("many fast taps at once still count as one like", async () => {
    const seller = await newUser();
    const me = await newUser();
    const [post] = await makePosts(seller, 1);
    await Promise.all(
      Array.from({ length: 5 }, () => request(app).post(`/api/posts/${post._id}/like`).set(auth(me)).send({ like: true }))
    );
    const stored = await Post.findById(post._id).lean();
    expect(stored.likes.map(String)).toEqual([me.id]);
  });

  test("likes from different people add up", async () => {
    const seller = await newUser();
    const [post] = await makePosts(seller, 1);
    for (let i = 0; i < 3; i += 1) {
      const fan = await newUser();
      await request(app).post(`/api/posts/${post._id}/like`).set(auth(fan));
    }
    expect((await feed()).body.posts[0].likesCount).toBe(3);
  });

  test("guests must log in; bad and unknown posts are refused", async () => {
    const me = await newUser();
    const seller = await newUser();
    const [post] = await makePosts(seller, 1);
    expect((await request(app).post(`/api/posts/${post._id}/like`)).status).toBe(401);
    expect((await request(app).post("/api/posts/not-an-id/like").set(auth(me))).status).toBe(400);
    expect((await request(app).post("/api/posts/64b7f0f0f0f0f0f0f0f0f0f0/like").set(auth(me))).status).toBe(404);
  });
});

// ------------------------------------------------------------- following
describe("following sellers", () => {
  test("follow and unfollow, with follower counts", async () => {
    const me = await newUser();
    const seller = await newUser("Calicut Homes");

    const follow = await request(app).post(`/api/users/${seller.id}/follow`).set(auth(me));
    expect(follow.body).toMatchObject({ success: true, isFollowing: true, followersCount: 1 });

    const unfollow = await request(app).delete(`/api/users/${seller.id}/follow`).set(auth(me));
    expect(unfollow.body).toMatchObject({ success: true, isFollowing: false, followersCount: 0 });
  });

  test("following twice (even at the same moment) stores it once", async () => {
    const me = await newUser();
    const seller = await newUser();
    await request(app).post(`/api/users/${seller.id}/follow`).set(auth(me));
    await Promise.all([
      request(app).post(`/api/users/${seller.id}/follow`).set(auth(me)),
      request(app).post(`/api/users/${seller.id}/follow`).set(auth(me)),
    ]);
    expect(await Follow.countDocuments({ follower: me.id, following: seller.id })).toBe(1);
  });

  test("refuses following yourself, unknown users, bad IDs and guests", async () => {
    const me = await newUser();
    expect((await request(app).post(`/api/users/${me.id}/follow`).set(auth(me))).status).toBe(400);
    expect((await request(app).post("/api/users/64b7f0f0f0f0f0f0f0f0f0f0/follow").set(auth(me))).status).toBe(404);
    expect((await request(app).post("/api/users/nope/follow").set(auth(me))).status).toBe(400);
    expect((await request(app).post(`/api/users/${me.id}/follow`)).status).toBe(401);
  });

  test("the following list shows who you follow, with their post counts", async () => {
    const me = await newUser();
    const a = await newUser("Ravi Kumar");
    const b = await newUser("Green Acre");
    await makePosts(a, 3);
    await request(app).post(`/api/users/${a.id}/follow`).set(auth(me));
    await request(app).post(`/api/users/${b.id}/follow`).set(auth(me));

    const res = await request(app).get("/api/users/following").set(auth(me));
    expect(res.status).toBe(200);
    expect(res.body.count).toBe(2);
    const byName = Object.fromEntries(res.body.following.map((s) => [s.name, s]));
    expect(byName["Ravi Kumar"]).toMatchObject({ postsCount: 3, isFollowing: true });
    expect(byName["Green Acre"]).toMatchObject({ postsCount: 0, isFollowing: true });
  });

  test("suggested sellers: most posts first, not you, marks who you follow; guests can see it", async () => {
    const me = await newUser("Me");
    const big = await newUser("Big Seller");
    const small = await newUser("Small Seller");
    await makePosts(me, 9);
    await makePosts(big, 5);
    await makePosts(small, 2);
    await request(app).post(`/api/users/${small.id}/follow`).set(auth(me));

    const mine = await request(app).get("/api/users/suggested-sellers").set(auth(me));
    expect(mine.body.sellers.map((s) => s.name)).toEqual(["Big Seller", "Small Seller"]);
    expect(mine.body.sellers.map((s) => s.isFollowing)).toEqual([false, true]);
    expect(mine.body.sellers[0].postsCount).toBe(5);

    const guest = await request(app).get("/api/users/suggested-sellers");
    expect(guest.status).toBe(200);
    expect(guest.body.sellers.map((s) => s.name)).toEqual(["Me", "Big Seller", "Small Seller"]);
    expect(guest.body.sellers.every((s) => s.isFollowing === false)).toBe(true);
  });

  test("Following feed: posts from sellers you follow plus your own, nobody else's", async () => {
    const me = await newUser();
    const followed = await newUser();
    const stranger = await newUser();
    await makePosts(me, 1, { titlePrefix: "Mine" });
    await makePosts(followed, 2, { titlePrefix: "Followed" });
    await makePosts(stranger, 3, { titlePrefix: "Stranger" });
    await request(app).post(`/api/users/${followed.id}/follow`).set(auth(me));

    const res = await feed("?feed=following", me);
    expect(res.status).toBe(200);
    const titles = res.body.posts.map((p) => p.title).sort();
    expect(titles).toEqual(["Followed 1", "Followed 2", "Mine 1"]);

    expect((await feed("?feed=following")).status).toBe(401);
  });
});

// -------------------------------------------------- nothing else broke
describe("other screens are unaffected", () => {
  test("creating a post and My Listings still work", async () => {
    const me = await newUser();
    const created = await request(app)
      .post("/api/posts")
      .set(auth(me))
      .send({ title: "New plot", location: "Kozhikode", imageUrls: ["https://res.cloudinary.com/demo/image/upload/plotpost/posts/a.jpg"] });
    expect(created.status).toBe(201);
    const mine = await request(app).get("/api/posts/my").set(auth(me));
    expect(mine.body.posts).toHaveLength(1);
    expect((await feed()).body.posts[0].title).toBe("New plot");
  });

  test("profile and saved routes still answer", async () => {
    const me = await newUser();
    expect((await request(app).get("/api/users/profile").set(auth(me))).status).toBe(200);
    expect((await request(app).get("/api/users/saved").set(auth(me))).status).toBe(200);
  });
});

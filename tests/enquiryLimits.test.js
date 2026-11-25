// Screen 9 tests: how many enquiries can be sent in an hour.
// Uses TEST_MONGODB_URI if set, otherwise a temporary MongoDB. Never your
// real database.
process.env.NODE_ENV = "test";
process.env.JWT_SECRET = "test-secret-that-is-long-enough-for-signing-tokens";
// Check the enquiry limits (the login limit stays off).
process.env.RATE_LIMIT_SOCIAL_ENABLED = "true";

const request = require("supertest");
const mongoose = require("mongoose");
const app = require("../server");
const User = require("../models/User");
const Post = require("../models/Post");
const Enquiry = require("../models/Enquiry");

let memoryServer;

beforeAll(async () => {
  let uri = process.env.TEST_MONGODB_URI;
  if (!uri) {
    const { MongoMemoryServer } = require("mongodb-memory-server-core");
    memoryServer = await MongoMemoryServer.create();
    uri = memoryServer.getUri();
  }
  const url = new URL(uri);
  url.pathname = "/plotpost_test_screen9_limits";
  await mongoose.connect(url.toString());
  await mongoose.connection.db.dropDatabase();
  await Promise.all([User.createIndexes(), Post.createIndexes(), Enquiry.createIndexes()]);
});

afterAll(async () => {
  await mongoose.connection.db.dropDatabase();
  await mongoose.disconnect();
  if (memoryServer) await memoryServer.stop();
});

let counter = 0;
const newUser = async (name = "Person") => {
  counter += 1;
  const res = await request(app)
    .post("/api/auth/register")
    .send({ name, email: `l${counter}@example.com`, password: "Password123" });
  return { id: String(res.body.user.id), token: res.body.token };
};

const interest = (post, i) => ({
  postId: String(post._id),
  name: `Buyer ${i}`,
  phone: `98470000${String(i).padStart(2, "0")}`,
  message: "Please share more details.",
});

test("guests: 5 an hour per connection; accounts: 10 an hour each", async () => {
  const seller = await newUser("Seller");
  const posts = await Promise.all(
    Array.from({ length: 12 }, (_, i) =>
      Post.create({ user: seller.id, title: `Post ${i}`, location: "Kozhikode", imageUrls: ["https://x/y.jpg"] })
    )
  );

  for (let i = 0; i < 5; i += 1) {
    expect((await request(app).post("/api/enquiries").send(interest(posts[i], i))).status).toBe(201);
  }
  const guestBlocked = await request(app).post("/api/enquiries").send(interest(posts[5], 5));
  expect(guestBlocked.status).toBe(429);
  expect(guestBlocked.body.message).toMatch(/a lot of enquiries/);

  // A logged-in buyer has their own allowance.
  const buyer = await newUser("Buyer");
  const asBuyer = (i) =>
    request(app).post("/api/enquiries").set("Authorization", `Bearer ${buyer.token}`).send(interest(posts[i], i));
  for (let i = 0; i < 10; i += 1) {
    expect((await asBuyer(i)).status).toBe(201);
  }
  expect((await asBuyer(10)).status).toBe(429);
});

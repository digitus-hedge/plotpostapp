// Screen 9 tests: Show Interest and Buyer Inquiries (enquiries to the seller).
// Rate limits are checked separately in enquiryLimits.test.js.
// Uses TEST_MONGODB_URI if set, otherwise a temporary MongoDB. Never your
// real database.
process.env.NODE_ENV = "test";
process.env.JWT_SECRET = "test-secret-that-is-long-enough-for-signing-tokens";

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
  url.pathname = "/plotpost_test_screen9";
  await mongoose.connect(url.toString());
  await mongoose.connection.db.dropDatabase();
  await Promise.all([User.createIndexes(), Post.createIndexes(), Enquiry.createIndexes()]);
});

afterEach(async () => {
  await Promise.all([User.deleteMany({}), Post.deleteMany({}), Enquiry.deleteMany({})]);
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
    .send({ name, email: `e${counter}@example.com`, password: "Password123" });
  return { id: String(res.body.user.id), token: res.body.token, name };
};
const auth = (user) => ({ Authorization: `Bearer ${user.token}` });

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

const interest = (post, extra = {}) => ({
  postId: String(post._id),
  name: "Meera Nair",
  phone: "+91 98950 54321",
  email: "meera@example.com",
  message: "Is car parking covered? I'd like to visit.",
  contactMethod: "WhatsApp",
  wantsVisit: true,
  ...extra,
});
const send = (body, user) => {
  const req = request(app).post("/api/enquiries").send(body);
  return user ? req.set(auth(user)) : req;
};
const received = (user, query = "") => request(app).get(`/api/enquiries/received${query}`).set(auth(user));

// ------------------------------------------------------------ sending
describe("Show Interest", () => {
  test("a guest's interest reaches the seller; title and seller come from the post", async () => {
    const seller = await newUser("Ravi Seller");
    const post = await makePost(seller, { sellerName: "Calicut Homes" });

    const res = await send(interest(post, { postTitle: "FAKE TITLE", seller: "FAKE SELLER" }));
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({ success: true, updated: false, message: "Interest sent to Calicut Homes." });
    expect(res.body.enquiry).toMatchObject({ postTitle: "Villa in Nadakkavu", seller: "Calicut Homes", status: "Pending" });

    const stored = await Enquiry.findOne({}).lean();
    expect(String(stored.sellerUser)).toBe(seller.id);
    expect(stored.user).toBeNull();

    const inbox = await received(seller);
    expect(inbox.status).toBe(200);
    expect(inbox.body).toMatchObject({ total: 1, unread: 1, count: 1, hasMore: false });
    expect(inbox.body.enquiries[0]).toMatchObject({
      name: "Meera Nair",
      phone: "+91 98950 54321",
      email: "meera@example.com",
      message: "Is car parking covered? I'd like to visit.",
      contactMethod: "WhatsApp",
      wantsVisit: true,
      isUnread: true,
      post: { title: "Villa in Nadakkavu", price: "₹1.2 crore", image: PHOTO, status: "active" },
    });
    // Only what the list needs about the post.
    expect(inbox.body.enquiries[0].post.likes).toBeUndefined();
  });

  test("the seller's account name is used when the post has no seller name", async () => {
    const seller = await newUser("Ravi Seller");
    const post = await makePost(seller);
    expect((await send(interest(post))).body.enquiry.seller).toBe("Ravi Seller");
  });

  test("the same person again updates their enquiry instead of making a copy", async () => {
    const seller = await newUser("Seller");
    const buyer = await newUser("Buyer");
    const post = await makePost(seller);
    const other = await makePost(seller, { title: "Another one" });

    await send(interest(post, { message: "First message here." }), buyer);
    const lead = await Enquiry.findOne({}).lean();
    await request(app).patch(`/api/enquiries/${lead._id}`).set(auth(seller)).send({ read: true, status: "Closed" });
    await send(interest(other, { message: "About the other post." }), buyer);

    const again = await send(interest(post, { message: "Second message, still keen." }), buyer);
    expect(again.status).toBe(200);
    expect(again.body.updated).toBe(true);
    expect(await Enquiry.countDocuments({ post: post._id })).toBe(1);

    const inbox = await received(seller);
    // Back on top, unread and pending again.
    expect(inbox.body.enquiries[0]).toMatchObject({ message: "Second message, still keen.", isUnread: true, status: "Pending" });
    expect(inbox.body.total).toBe(2);
  });

  test("guests are matched by phone number", async () => {
    const seller = await newUser("Seller");
    const post = await makePost(seller);
    await send(interest(post));
    expect((await send(interest(post, { message: "Same phone, new message." }))).status).toBe(200);
    expect((await send(interest(post, { phone: "9847012345", name: "Someone else" }))).status).toBe(201);
    expect(await Enquiry.countDocuments()).toBe(2);
  });

  test("bad details are refused with a clear reason", async () => {
    const seller = await newUser("Seller");
    const post = await makePost(seller);
    const reason = async (body) => {
      const res = await send(body);
      expect(res.status).toBe(400);
      return res.body.message;
    };

    expect(await reason(interest(post, { postId: "nope" }))).toMatch(/choose a property/);
    expect(await reason(interest(post, { name: "  " }))).toMatch(/enter your name/);
    expect(await reason(interest(post, { phone: "12345" }))).toMatch(/valid phone/);
    expect(await reason(interest(post, { phone: "98950abcde12" }))).toMatch(/valid phone/);
    expect(await reason(interest(post, { email: "not-an-email" }))).toMatch(/valid email/);
    expect(await reason(interest(post, { message: "Hi" }))).toMatch(/at least 10/);
    expect(await reason(interest(post, { message: "x".repeat(1001) }))).toMatch(/too long/);
    expect(await reason(interest(post, { contactMethod: "Pigeon" }))).toMatch(/Please choose/);
    expect(await reason(interest(post, { contactMethod: "Email", email: "" }))).toMatch(/add your email/);
    expect(await Enquiry.countDocuments()).toBe(0);
  });

  test("your own post, sold or rented posts and missing posts are refused", async () => {
    const seller = await newUser("Seller");
    const post = await makePost(seller);
    const sold = await makePost(seller, { status: "sold" });
    const rented = await makePost(seller, { status: "rented" });

    const own = await send(interest(post), seller);
    expect(own.status).toBe(400);
    expect(own.body.message).toMatch(/your own post/);
    expect((await send(interest(sold))).body.message).toBe("This property is no longer available.");
    expect((await send(interest(rented))).status).toBe(400);
    expect((await send(interest({ _id: new mongoose.Types.ObjectId() }))).status).toBe(404);
    expect(await Enquiry.countDocuments()).toBe(0);
  });

  test("a broken login is treated as a guest, not refused", async () => {
    const seller = await newUser("Seller");
    const post = await makePost(seller);
    const res = await request(app).post("/api/enquiries").set("Authorization", "Bearer broken").send(interest(post));
    expect(res.status).toBe(201);
  });
});

// ---------------------------------------------------- Buyer Inquiries
describe("Buyer Inquiries", () => {
  test("only enquiries on your posts, newest first, with filters and paging", async () => {
    const seller = await newUser("Seller");
    const otherSeller = await newUser("Other seller");
    const mine = await makePost(seller);
    const theirs = await makePost(otherSeller);

    await send(interest(mine, { phone: "9000000001", contactMethod: "Phone call" }));
    await send(interest(mine, { phone: "9000000002", contactMethod: "WhatsApp" }));
    await send(interest(mine, { phone: "9000000003", contactMethod: "Email" }));
    await send(interest(theirs, { phone: "9000000004" }));

    const all = await received(seller);
    expect(all.body.enquiries.map((e) => e.phone)).toEqual(["9000000003", "9000000002", "9000000001"]);
    expect(all.body).toMatchObject({ total: 3, unread: 3 });

    expect((await received(seller, "?method=WhatsApp")).body.enquiries.map((e) => e.phone)).toEqual(["9000000002"]);

    const first = all.body.enquiries[0];
    await request(app).patch(`/api/enquiries/${first._id}`).set(auth(seller)).send({ read: true });
    const unread = await received(seller, "?unread=true");
    expect(unread.body).toMatchObject({ count: 2, total: 3, unread: 2 });

    const page1 = await received(seller, "?limit=2");
    expect(page1.body.enquiries).toHaveLength(2);
    expect(page1.body.hasMore).toBe(true);
    expect((await received(seller, "?limit=2&page=2")).body.hasMore).toBe(false);

    expect((await received(otherSeller)).body.total).toBe(1);
    expect((await request(app).get("/api/enquiries/received")).status).toBe(401);
  });

  test("older enquiries (from before they were linked to the seller) still show", async () => {
    const seller = await newUser("Seller");
    const post = await makePost(seller);
    // Saved the old way: no seller account, no read date, no lastMessageAt.
    await Enquiry.collection.insertOne({
      post: post._id,
      postTitle: "Villa in Nadakkavu",
      seller: "Seller",
      name: "Old Buyer",
      phone: "9847000000",
      message: "Sent before the update.",
      contactMethod: "Phone call",
      status: "Pending",
      createdAt: new Date("2026-01-01"),
      updatedAt: new Date("2026-01-01"),
    });

    const inbox = await received(seller);
    expect(inbox.body).toMatchObject({ total: 1, unread: 1 });
    expect(inbox.body.enquiries[0]).toMatchObject({ name: "Old Buyer", isUnread: true });

    // The seller can update it too.
    const id = inbox.body.enquiries[0]._id;
    expect((await request(app).patch(`/api/enquiries/${id}`).set(auth(seller)).send({ status: "Contacted" })).status).toBe(200);
  });

  test("an enquiry stays after its post is deleted, with the title it was about", async () => {
    const seller = await newUser("Seller");
    const post = await makePost(seller);
    await send(interest(post));
    await request(app).delete(`/api/posts/${post._id}`).set(auth(seller));

    const lead = (await received(seller)).body.enquiries[0];
    expect(lead.post).toBeNull();
    expect(lead.postTitle).toBe("Villa in Nadakkavu");
  });
});

// ------------------------------------------------- read and status
describe("marking read and changing status", () => {
  test("only the seller can; read, unread and status work", async () => {
    const seller = await newUser("Seller");
    const buyer = await newUser("Buyer");
    const stranger = await newUser("Stranger");
    const post = await makePost(seller);
    const { enquiry } = (await send(interest(post), buyer)).body;
    const patch = (user, body) => request(app).patch(`/api/enquiries/${enquiry._id}`).set(auth(user)).send(body);

    expect((await patch(buyer, { status: "Closed" })).status).toBe(403);
    expect((await patch(stranger, { read: true })).status).toBe(403);

    expect((await patch(seller, { read: true })).body.enquiry.isUnread).toBe(false);
    expect((await received(seller)).body.unread).toBe(0);
    expect((await patch(seller, { status: "Contacted" })).body.enquiry).toMatchObject({ status: "Contacted", isUnread: false });
    expect((await patch(seller, { read: false })).body.enquiry.isUnread).toBe(true);

    expect((await patch(seller, { status: "Sold" })).status).toBe(400);
    expect((await patch(seller, {})).body.message).toMatch(/Nothing to change/);
    expect((await request(app).patch("/api/enquiries/bad").set(auth(seller)).send({ read: true })).status).toBe(400);
    expect((await request(app).patch(`/api/enquiries/${new mongoose.Types.ObjectId()}`).set(auth(seller)).send({ read: true })).status).toBe(404);
  });
});

// --------------------------------------------- the buyer's own list
describe("enquiries you sent", () => {
  test("listed newest first with a short post summary; you can delete your own", async () => {
    const seller = await newUser("Seller");
    const buyer = await newUser("Buyer");
    const stranger = await newUser("Stranger");
    const a = await makePost(seller, { title: "First" });
    const b = await makePost(seller, { title: "Second" });
    await send(interest(a), buyer);
    await send(interest(b), buyer);

    const mine = await request(app).get("/api/enquiries/my").set(auth(buyer));
    expect(mine.body.count).toBe(2);
    expect(mine.body.enquiries.map((e) => e.post.title)).toEqual(["Second", "First"]);
    expect(mine.body.enquiries[0].post.comments).toBeUndefined();

    const id = mine.body.enquiries[0]._id;
    expect((await request(app).delete(`/api/enquiries/${id}`).set(auth(stranger))).status).toBe(403);
    expect((await request(app).delete(`/api/enquiries/${id}`).set(auth(buyer))).status).toBe(200);
    expect((await request(app).delete("/api/enquiries/bad").set(auth(buyer))).status).toBe(400);
    expect((await request(app).get("/api/enquiries/my").set(auth(buyer))).body.count).toBe(1);
  });
});

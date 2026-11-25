// Screen 11 tests: Messages and Chat (between logged-in people), blocking.
// Uses TEST_MONGODB_URI if set, otherwise a temporary MongoDB. Never your
// real database.
process.env.NODE_ENV = "test";
process.env.JWT_SECRET = "test-secret-that-is-long-enough-for-signing-tokens";
// Check the message limit (the login limit stays off).
process.env.RATE_LIMIT_SOCIAL_ENABLED = "true";

const request = require("supertest");
const mongoose = require("mongoose");
const app = require("../server");
const User = require("../models/User");
const Post = require("../models/Post");
const Enquiry = require("../models/Enquiry");
const Conversation = require("../models/Conversation");
const Message = require("../models/Message");

let memoryServer;

beforeAll(async () => {
  let uri = process.env.TEST_MONGODB_URI;
  if (!uri) {
    const { MongoMemoryServer } = require("mongodb-memory-server-core");
    memoryServer = await MongoMemoryServer.create();
    uri = memoryServer.getUri();
  }
  const url = new URL(uri);
  url.pathname = "/plotpost_test_screen11";
  await mongoose.connect(url.toString());
  await mongoose.connection.db.dropDatabase();
  await Promise.all([User, Post, Enquiry, Conversation, Message].map((Model) => Model.createIndexes()));
});

afterEach(async () => {
  await Promise.all([User, Post, Enquiry, Conversation, Message].map((Model) => Model.deleteMany({})));
});

afterAll(async () => {
  await mongoose.connection.db.dropDatabase();
  await mongoose.disconnect();
  if (memoryServer) await memoryServer.stop();
});

let counter = 0;
const newUser = async (name = "Person") => {
  counter += 1;
  const email = `m${counter}@example.com`;
  const res = await request(app).post("/api/auth/register").send({ name, email, password: "Password123" });
  if (!res.body.user) throw new Error(`register failed: ${res.status} ${JSON.stringify(res.body)}`);
  return { id: String(res.body.user.id), token: res.body.token, name, email };
};
const auth = (user) => ({ Authorization: `Bearer ${user.token}` });

const PHOTO = "https://res.cloudinary.com/test-cloud/image/upload/v1/plotpost/posts/a.jpg";
const makePost = (seller, extra = {}) =>
  Post.create({ user: seller.id, title: "Villa in Nadakkavu", price: "₹1.2 crore", location: "Nadakkavu", platform: "PlotPost", imageUrls: [PHOTO], ...extra });

const start = (me, other, postId) =>
  request(app).post("/api/chats").set(auth(me)).send({ userId: other.id ?? other, ...(postId ? { postId: String(postId) } : {}) });
const send = (me, chatId, text, postId) =>
  request(app).post(`/api/chats/${chatId}/messages`).set(auth(me)).send({ text, ...(postId ? { postId: String(postId) } : {}) });
const list = (me) => request(app).get("/api/chats").set(auth(me));
const messages = (me, chatId, query = "") => request(app).get(`/api/chats/${chatId}/messages${query}`).set(auth(me));

// -------------------------------------------------------------- start
describe("starting a chat", () => {
  test("one chat per pair, whoever starts it; about a post", async () => {
    const buyer = await newUser("Buyer");
    const seller = await newUser("Seller");
    const post = await makePost(seller);

    const first = await start(buyer, seller, post._id);
    expect(first.status).toBe(201);
    expect(first.body.chat).toMatchObject({
      other: { name: "Seller" },
      post: { title: "Villa in Nadakkavu", image: PHOTO },
      lastMessage: null,
      unread: 0,
    });
    expect(first.body.chat.other.email).toBeUndefined();

    const again = await start(buyer, seller);
    const fromSeller = await start(seller, buyer);
    expect(again.status).toBe(200);
    expect(again.body.chat._id).toBe(first.body.chat._id);
    expect(fromSeller.body.chat._id).toBe(first.body.chat._id);
    expect(await Conversation.countDocuments()).toBe(1);

    // An empty chat isn't listed until someone writes.
    expect((await list(buyer)).body.chats).toEqual([]);
  });

  test("not with yourself, unknown people, missing posts, or without login", async () => {
    const me = await newUser();
    expect((await start(me, me)).body.message).toMatch(/message yourself/);
    expect((await start(me, new mongoose.Types.ObjectId().toString())).status).toBe(404);
    expect((await start(me, "nope")).status).toBe(400);
    const other = await newUser();
    expect((await start(me, other, new mongoose.Types.ObjectId())).status).toBe(404);
    expect((await request(app).post("/api/chats").send({ userId: other.id })).status).toBe(401);
  });

  test("20 new chats a day; reopening an existing chat doesn't count", async () => {
    const me = await newUser();
    const people = await Promise.all(Array.from({ length: 21 }, (_, i) => newUser(`P${i}`)));
    for (let i = 0; i < 20; i += 1) {
      expect((await start(me, people[i])).status).toBe(201);
    }
    const blocked = await start(me, people[20]);
    expect(blocked.status).toBe(429);
    expect(blocked.body.message).toMatch(/new chats today/);
    expect((await start(me, people[0])).status).toBe(200);
  });
});

// -------------------------------------------------- sending and reading
describe("sending and reading", () => {
  test("messages, unread counts, the badge and Seen", async () => {
    const buyer = await newUser("Buyer");
    const seller = await newUser("Seller");
    const post = await makePost(seller);
    const chatId = (await start(buyer, seller, post._id)).body.chat._id;

    const sent = await send(buyer, chatId, "  Is it still available?  ", post._id);
    expect(sent.status).toBe(201);
    expect(sent.body.message).toMatchObject({ text: "Is it still available?", fromMe: true, post: { title: "Villa in Nadakkavu" } });
    await send(buyer, chatId, "And is the price negotiable?");

    // The seller has 2 unread; the buyer none.
    const sellerList = await list(seller);
    expect(sellerList.body.unread).toBe(2);
    expect(sellerList.body.chats[0]).toMatchObject({
      other: { name: "Buyer" },
      unread: 2,
      lastMessage: { text: "And is the price negotiable?", fromMe: false },
    });
    expect((await list(buyer)).body.chats[0].unread).toBe(0);
    expect((await request(app).get("/api/chats/unread").set(auth(seller))).body).toMatchObject({ unread: 2, chats: 1 });

    // Not seen yet.
    const before = await messages(buyer, chatId);
    expect(before.body.otherReadAt).toBeNull();
    expect(before.body).toMatchObject({ canMessage: true, blockedByMe: false, hasMore: false });

    // The seller opens it.
    const sellerView = await messages(seller, chatId);
    expect(sellerView.body.messages.map((m) => [m.text, m.fromMe])).toEqual([
      ["Is it still available?", false],
      ["And is the price negotiable?", false],
    ]);
    await request(app).post(`/api/chats/${chatId}/read`).set(auth(seller));
    expect((await request(app).get("/api/chats/unread").set(auth(seller))).body.unread).toBe(0);

    const after = await messages(buyer, chatId);
    expect(new Date(after.body.otherReadAt) >= new Date(after.body.messages[1].sentAt)).toBe(true);

    // The seller replies; it's now on top for both and unread for the buyer.
    await send(seller, chatId, "Yes, slightly.");
    const buyerList = await list(buyer);
    expect(buyerList.body.chats[0]).toMatchObject({ unread: 1, lastMessage: { text: "Yes, slightly.", fromMe: false } });
  });

  test("30 at a time, older ones by scrolling up, new ones since the last seen", async () => {
    const buyer = await newUser("Buyer");
    const seller = await newUser("Seller");
    const chatId = (await start(buyer, seller)).body.chat._id;
    // 45 messages straight into the database (the send limit is 30 a minute).
    const base = Date.now() - 60 * 60 * 1000;
    const docs = Array.from({ length: 45 }, (_, i) => ({
      // One second apart, so the IDs (which start with the time) are in order.
      _id: mongoose.Types.ObjectId.createFromTime(Math.floor((base + i * 1000) / 1000)),
      conversation: chatId,
      sender: i % 2 ? seller.id : buyer.id,
      text: `Message ${i}`,
      createdAt: new Date(base + i * 1000),
      updatedAt: new Date(base + i * 1000),
    }));
    await Message.insertMany(docs);
    await Conversation.updateOne({ _id: chatId }, { $set: { "lastMessage.sentAt": new Date(), "lastMessage.text": "Message 44" } });

    const latest = await messages(buyer, chatId);
    expect(latest.body.messages).toHaveLength(30);
    expect(latest.body.messages[0].text).toBe("Message 15");
    expect(latest.body.messages[29].text).toBe("Message 44");
    expect(latest.body.hasMore).toBe(true);

    const older = await messages(buyer, chatId, `?before=${latest.body.messages[0]._id}`);
    expect(older.body.messages.map((m) => m.text)).toEqual(Array.from({ length: 15 }, (_, i) => `Message ${i}`));
    expect(older.body.hasMore).toBe(false);

    const lastId = latest.body.messages[29]._id;
    expect((await messages(buyer, chatId, `?after=${lastId}`)).body.messages).toEqual([]);
    await send(seller, chatId, "Brand new");
    expect((await messages(buyer, chatId, `?after=${lastId}`)).body.messages.map((m) => m.text)).toEqual(["Brand new"]);
  });

  test("empty and over-long messages, strangers and bad IDs are refused", async () => {
    const a = await newUser("Anu");
    const b = await newUser("Biju");
    const stranger = await newUser("Stranger");
    const chatId = (await start(a, b)).body.chat._id;

    expect((await send(a, chatId, "   ")).body.message).toMatch(/write a message/);
    expect((await send(a, chatId, "x".repeat(2001))).body.message).toMatch(/2,000 characters/);
    expect((await send(a, chatId, "x".repeat(2000))).status).toBe(201);
    expect((await send(a, chatId, "Hi", new mongoose.Types.ObjectId())).status).toBe(404);

    // Someone not in the chat can't see or touch it.
    expect((await messages(stranger, chatId)).status).toBe(404);
    expect((await send(stranger, chatId, "Hi")).status).toBe(404);
    expect((await request(app).post(`/api/chats/${chatId}/read`).set(auth(stranger))).status).toBe(404);
    expect((await request(app).delete(`/api/chats/${chatId}`).set(auth(stranger))).status).toBe(404);
    expect((await messages(a, "nope")).status).toBe(400);
  });

  test("30 messages a minute per account", async () => {
    const a = await newUser("Chatty");
    const b = await newUser("Biju");
    const chatId = (await start(a, b)).body.chat._id;
    for (let i = 0; i < 30; i += 1) {
      expect((await send(a, chatId, `Message ${i}`)).status).toBe(201);
    }
    const blocked = await send(a, chatId, "One more");
    expect(blocked.status).toBe(429);
    expect(blocked.body.message).toMatch(/very fast/);
    // The other person isn't affected.
    expect((await send(b, chatId, "Still fine")).status).toBe(201);
  });
});

// ------------------------------------------------------- delete for me
describe("deleting a chat for yourself", () => {
  test("leaves your list and history; the other person keeps it; a new message brings it back", async () => {
    const a = await newUser("Anu");
    const b = await newUser("Biju");
    const chatId = (await start(a, b)).body.chat._id;
    await send(a, chatId, "Old message one");
    await send(b, chatId, "Old message two");

    expect((await request(app).delete(`/api/chats/${chatId}`).set(auth(a))).status).toBe(200);
    expect((await list(a)).body.chats).toEqual([]);
    expect((await messages(a, chatId)).body.messages).toEqual([]);
    expect((await messages(b, chatId)).body.messages).toHaveLength(2);

    await new Promise((resolve) => setTimeout(resolve, 5));
    await send(b, chatId, "Are you there?");
    const back = await list(a);
    expect(back.body.chats).toHaveLength(1);
    expect(back.body.chats[0].unread).toBe(1);
    expect((await messages(a, chatId)).body.messages.map((m) => m.text)).toEqual(["Are you there?"]);
  });
});

// ------------------------------------------------------------ blocking
describe("blocking", () => {
  test("blocked people can't message you, and you can't message them until you unblock", async () => {
    const me = await newUser("Me");
    const pest = await newUser("Pest");
    const chatId = (await start(pest, me)).body.chat._id;
    await send(pest, chatId, "Hello");

    expect((await request(app).post(`/api/users/${pest.id}/block`).set(auth(me))).body).toMatchObject({ blocked: true });

    const theirs = await send(pest, chatId, "Hello again");
    expect(theirs.status).toBe(403);
    expect(theirs.body.message).toBe("You can't message this person.");
    const mine = await send(me, chatId, "Stop");
    expect(mine.body.message).toMatch(/Unblock them/);

    expect((await messages(pest, chatId)).body).toMatchObject({ canMessage: false, blockedByMe: false });
    expect((await messages(me, chatId)).body).toMatchObject({ canMessage: false, blockedByMe: true });
    expect((await list(me)).body.chats[0].blockedByMe).toBe(true);

    // A blocked person can't start a fresh chat either.
    await Conversation.deleteMany({});
    expect((await start(pest, me)).status).toBe(403);

    await request(app).delete(`/api/users/${pest.id}/block`).set(auth(me));
    const reopened = (await start(pest, me)).body.chat._id;
    expect((await send(pest, reopened, "Sorry")).status).toBe(201);

    expect((await request(app).post(`/api/users/${me.id}/block`).set(auth(me))).status).toBe(400);
    expect((await request(app).post(`/api/users/${new mongoose.Types.ObjectId()}/block`).set(auth(me))).status).toBe(404);
  });
});

// ------------------------------------------------------ other screens
describe("links with other screens", () => {
  test("Buyer Inquiries says whether the buyer has an account (so the seller can chat)", async () => {
    const seller = await newUser("Seller");
    const buyer = await newUser("Buyer");
    const post = await makePost(seller);
    const body = { postId: String(post._id), name: "Buyer", phone: "9847000000", message: "Please share details." };
    await request(app).post("/api/enquiries").set(auth(buyer)).send(body);
    await request(app).post("/api/enquiries").send({ ...body, name: "Guest", phone: "9847111111" });

    const leads = (await request(app).get("/api/enquiries/received").set(auth(seller))).body.enquiries;
    const byName = Object.fromEntries(leads.map((lead) => [lead.name, lead.buyerUserId]));
    expect(byName).toEqual({ Buyer: buyer.id, Guest: null });
  });

  test("deleting an account deletes its chats and messages, and others' blocks of it", async () => {
    const leaving = await newUser("Leaving");
    const staying = await newUser("Staying");
    const third = await newUser("Third");
    const chatId = (await start(leaving, staying)).body.chat._id;
    await send(leaving, chatId, "Bye");
    const otherChat = (await start(staying, third)).body.chat._id;
    await send(staying, otherChat, "Still here");
    await request(app).post(`/api/users/${leaving.id}/block`).set(auth(third));

    expect((await request(app).delete("/api/users/me").set(auth(leaving)).send({ password: "Password123" })).status).toBe(200);
    expect(await Conversation.countDocuments({ _id: chatId })).toBe(0);
    expect(await Message.countDocuments({ conversation: chatId })).toBe(0);
    expect(await Message.countDocuments({ conversation: otherChat })).toBe(1);
    expect((await User.findById(third.id).lean()).blockedUsers).toEqual([]);
    expect((await list(staying)).body.chats.map((c) => c.other.name)).toEqual(["Third"]);
  });
});

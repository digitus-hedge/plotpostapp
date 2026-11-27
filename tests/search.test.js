// Screen 6 tests: search and the Filter screen, done on the server.
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
const { parsePrice, parseBedrooms } = require("../utils/priceParser");
const { backfillPostNumbers } = require("../scripts/backfillPostNumbers");

let memoryServer;

beforeAll(async () => {
  let uri = process.env.TEST_MONGODB_URI;
  if (!uri) {
    const { MongoMemoryServer } = require("mongodb-memory-server-core");
    memoryServer = await MongoMemoryServer.create();
    uri = memoryServer.getUri();
  }
  const url = new URL(uri);
  url.pathname = "/plotpost_test_screen6";
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
const newUser = async (name = "Seller") => {
  counter += 1;
  const res = await request(app)
    .post("/api/auth/register")
    .send({ name, email: `s${counter}@example.com`, password: "Password123" });
  return { id: String(res.body.user.id), token: res.body.token };
};
const auth = (user) => ({ Authorization: `Bearer ${user.token}` });

const PHOTO = "https://res.cloudinary.com/test-cloud/image/upload/v1/plotpost/posts/a.jpg";

const makePost = (seller, extra = {}) =>
  Post.create({
    user: seller.id,
    title: "Plot near Mavoor Road",
    location: "Mavoor Road, Kozhikode",
    type: "Plot",
    deal: "For sale",
    platform: "PlotPost",
    imageUrls: [PHOTO],
    ...extra,
  });

const feed = (query = "", user) => {
  const req = request(app).get(`/api/posts${query}`);
  return user ? req.set(auth(user)) : req;
};
const titles = (res) => res.body.posts.map((post) => post.title).sort();

// ------------------------------------------------------- price numbers
describe("price and bedroom numbers", () => {
  test("common price formats become rupees", () => {
    expect(parsePrice("₹1.45 crore")).toBe(14500000);
    expect(parsePrice("1.2 Cr onwards")).toBe(12000000);
    expect(parsePrice("₹38 lakh")).toBe(3800000);
    expect(parsePrice("45 lakhs negotiable")).toBe(4500000);
    expect(parsePrice("38L")).toBe(3800000);
    expect(parsePrice("85 lac")).toBe(8500000);
    expect(parsePrice("₹50,00,000")).toBe(5000000);
    expect(parsePrice("₹18,000 / month")).toBe(18000);
    expect(parsePrice("18k per month")).toBe(18000);
    expect(parsePrice("40-50 lakh")).toBe(4000000);
    expect(parsePrice("2 BHK for 35 lakh")).toBe(3500000);
  });

  test("unclear prices give no number instead of a guess", () => {
    expect(parsePrice("Price on request")).toBeNull();
    expect(parsePrice("₹38")).toBeNull();
    expect(parsePrice("")).toBeNull();
    expect(parsePrice("0")).toBeNull();
    expect(parsePrice(undefined)).toBeNull();
    expect(parseBedrooms("3 BHK")).toBe(3);
    expect(parseBedrooms("4+")).toBe(4);
    expect(parseBedrooms("")).toBeNull();
    expect(parseBedrooms("Studio")).toBeNull();
  });

  test("set when a post is created, and kept up to date when it's edited", async () => {
    const me = await newUser();
    const created = await request(app).post("/api/posts").set(auth(me)).send({
      title: "Villa in Nadakkavu",
      location: "Nadakkavu, Kozhikode",
      type: "Villa",
      price: "₹1.2 crore",
      bedrooms: "4",
      imageUrls: [PHOTO],
    });
    expect(created.status).toBe(201);
    const id = created.body.post._id;
    expect(await Post.findById(id).lean()).toMatchObject({ priceValue: 12000000, bedroomsCount: 4 });

    await request(app).put(`/api/posts/${id}`).set(auth(me)).send({ price: "95 lakh", bedrooms: "3 BHK" });
    expect(await Post.findById(id).lean()).toMatchObject({ priceValue: 9500000, bedroomsCount: 3 });

    await request(app).put(`/api/posts/${id}`).set(auth(me)).send({ price: "Price on request" });
    expect((await Post.findById(id).lean()).priceValue).toBeNull();
  });
});

// --------------------------------------------------------------- search
describe("search", () => {
  test("every word must match, in any field, in any case", async () => {
    const me = await newUser();
    await makePost(me, { title: "Luxury villa", type: "Villa", location: "Nadakkavu, Kozhikode" });
    await makePost(me, { title: "Budget villa", type: "Villa", location: "Chevayur, Kozhikode" });
    await makePost(me, { title: "Flat with sea view", type: "Flat", location: "Beach Road", description: "Near NADAKKAVU junction" });

    expect(titles(await feed("?q=villa"))).toEqual(["Budget villa", "Luxury villa"]);
    expect(titles(await feed("?q=VILLA%20nadakkavu"))).toEqual(["Luxury villa"]);
    // Found through the description.
    expect(titles(await feed("?q=nadakkavu"))).toEqual(["Flat with sea view", "Luxury villa"]);
    expect((await feed("?q=villa%20beach")).body.total).toBe(0);
    // "rent" matches the deal "For rent".
    await makePost(me, { title: "House to let", type: "House", deal: "For rent" });
    expect(titles(await feed("?q=rent"))).toEqual(["House to let"]);
    // "plot" doesn't match every post just because the platform is "PlotPost".
    expect((await feed("?q=plot")).body.total).toBe(0);
  });

  test("finds posts by the seller name on the post or the seller's account name", async () => {
    const ramesh = await newUser("Ramesh Kumar");
    const agency = await newUser("Someone Else");
    await makePost(ramesh, { title: "Plot by Ramesh" });
    await makePost(agency, { title: "Agency plot", sellerName: "Malabar Homes" });

    expect(titles(await feed("?q=ramesh"))).toEqual(["Plot by Ramesh"]);
    expect(titles(await feed("?q=malabar"))).toEqual(["Agency plot"]);
  });

  test("symbols are searched as text, and very long searches are refused", async () => {
    const me = await newUser();
    await makePost(me, { title: "Plot (10 cents) + road" });

    expect(titles(await feed(`?q=${encodeURIComponent("(10 cents)")}`))).toEqual(["Plot (10 cents) + road"]);
    expect((await feed(`?q=${encodeURIComponent(".*")}`)).body.total).toBe(0);

    const tooLong = await feed(`?q=${"a".repeat(81)}`);
    expect(tooLong.status).toBe(400);
    expect(tooLong.body.message).toMatch(/too long/);
  });
});

// -------------------------------------------------------------- filters
describe("Filter screen", () => {
  test("property types: one or several; unknown types are refused", async () => {
    const me = await newUser();
    await makePost(me, { title: "A villa", type: "Villa" });
    await makePost(me, { title: "A house", type: "House" });
    await makePost(me, { title: "A plot", type: "Plot" });

    expect(titles(await feed("?types=Villa"))).toEqual(["A villa"]);
    expect(titles(await feed("?types=Villa,House"))).toEqual(["A house", "A villa"]);
    expect(titles(await feed("?types=Villa&types=Plot"))).toEqual(["A plot", "A villa"]);

    const bad = await feed("?types=Castle");
    expect(bad.status).toBe(400);
    expect(bad.body.message).toMatch(/property type/);
  });

  test("For sale / For rent; Any shows both", async () => {
    const me = await newUser();
    await makePost(me, { title: "To buy", deal: "For sale" });
    await makePost(me, { title: "To rent", deal: "For rent" });

    expect(titles(await feed("?deal=For%20sale"))).toEqual(["To buy"]);
    expect(titles(await feed("?deal=For%20rent"))).toEqual(["To rent"]);
    expect((await feed("?deal=Any")).body.total).toBe(2);
    expect((await feed("?deal=Lease")).status).toBe(400);
  });

  test("price range: sale prices, monthly rents, and posts with no clear price", async () => {
    const me = await newUser();
    await makePost(me, { title: "38 lakh plot", price: "₹38 lakh" });
    await makePost(me, { title: "1.45 crore villa", price: "₹1.45 crore", type: "Villa" });
    await makePost(me, { title: "On request", price: "Price on request" });
    await makePost(me, { title: "Cheap rent", deal: "For rent", price: "₹12,000 / month" });
    await makePost(me, { title: "Dear rent", deal: "For rent", price: "₹45,000 / month" });

    // ₹20 lakh to ₹1 crore, for sale
    expect(titles(await feed("?deal=For%20sale&minPrice=2000000&maxPrice=10000000"))).toEqual(["38 lakh plot"]);
    // ₹1 crore and up (no upper limit)
    expect(titles(await feed("?deal=For%20sale&minPrice=10000000"))).toEqual(["1.45 crore villa"]);
    // up to ₹50 lakh (no lower limit): the "on request" post is left out
    expect(titles(await feed("?deal=For%20sale&maxPrice=5000000"))).toEqual(["38 lakh plot"]);
    // rents up to ₹20,000 a month
    expect(titles(await feed("?deal=For%20rent&maxPrice=20000"))).toEqual(["Cheap rent"]);
    // with no price set, every post shows, including "on request"
    expect((await feed("?deal=For%20sale")).body.total).toBe(3);
  });

  test("bad prices are refused with a clear reason", async () => {
    const minAboveMax = await feed("?minPrice=5000000&maxPrice=100");
    expect(minAboveMax.status).toBe(400);
    expect(minAboveMax.body.message).toMatch(/minimum price/);

    for (const query of ["?minPrice=abc", "?maxPrice=-5", "?minPrice=1.5"]) {
      const res = await feed(query);
      expect(res.status).toBe(400);
      expect(res.body.message).toMatch(/whole number of rupees/);
    }
  });

  test("video tours only", async () => {
    const me = await newUser();
    await makePost(me, { title: "Reel", video: true, platform: "Instagram", socialUrl: "https://instagram.com/reel/1" });
    await makePost(me, { title: "Photos" });

    expect(titles(await feed("?video=true"))).toEqual(["Reel"]);
    expect((await feed("?video=false")).body.total).toBe(2);
  });

  test("minimum bedrooms; posts without a bedroom count are left out only while it's set", async () => {
    const me = await newUser();
    await makePost(me, { title: "2 bed", type: "Flat", bedrooms: "2" });
    await makePost(me, { title: "3 bed", type: "House", bedrooms: "3 BHK" });
    await makePost(me, { title: "5 bed", type: "Villa", bedrooms: "5" });
    await makePost(me, { title: "Plot", type: "Plot", bedrooms: "" });

    expect(titles(await feed("?minBedrooms=3"))).toEqual(["3 bed", "5 bed"]);
    expect(titles(await feed("?minBedrooms=1"))).toEqual(["2 bed", "3 bed", "5 bed"]);
    expect((await feed("?minBedrooms=0")).body.total).toBe(4);
    expect((await feed("?minBedrooms=99")).status).toBe(400);
  });

  test("everything together, with paging, the real total, and sold posts still hidden", async () => {
    const me = await newUser();
    for (let i = 0; i < 12; i += 1) {
      await makePost(me, { title: `Villa ${i}`, type: "Villa", price: `${60 + i} lakh`, bedrooms: "4", location: "West Hill, Kozhikode" });
    }
    await makePost(me, { title: "Villa too dear", type: "Villa", price: "3 crore", bedrooms: "4", location: "West Hill" });
    await makePost(me, { title: "Villa elsewhere", type: "Villa", price: "70 lakh", bedrooms: "4", location: "Chevayur" });
    await makePost(me, { title: "Flat in West Hill", type: "Flat", price: "70 lakh", bedrooms: "4", location: "West Hill" });
    const sold = await makePost(me, { title: "Sold villa", type: "Villa", price: "65 lakh", bedrooms: "4", location: "West Hill" });
    await request(app).patch(`/api/posts/${sold._id}/status`).set(auth(me)).send({ status: "sold" });

    const query = "?q=villa&locality=West%20Hill&types=Villa&deal=For%20sale&minPrice=5000000&maxPrice=10000000&minBedrooms=3&limit=5";
    const page1 = await feed(`${query}&page=1`);
    const page3 = await feed(`${query}&page=3`);

    expect(page1.status).toBe(200);
    expect(page1.body).toMatchObject({ total: 12, hasMore: true, totalPages: 3 });
    expect(page1.body.posts).toHaveLength(5);
    expect(page3.body.posts).toHaveLength(2);
    expect(page3.body.hasMore).toBe(false);
  });

  test("size range in square feet; posts without a clear size are left out only while it's set", async () => {
    const me = await newUser();
    await makePost(me, { title: "5 cent plot", area: "5 cents" });
    await makePost(me, { title: "12 cent plot", area: "12 cents" });
    await makePost(me, { title: "Half acre", area: "50 cents" });
    await makePost(me, { title: "Flat", type: "Flat", area: "1450 sq ft" });
    await makePost(me, { title: "No size", area: "" });

    // 10 to 20 cents (4356 to 8712 sq ft)
    expect(titles(await feed("?minArea=4356&maxArea=8712"))).toEqual(["12 cent plot"]);
    // at least 10 cents
    expect(titles(await feed("?minArea=4356"))).toEqual(["12 cent plot", "Half acre"]);
    // up to 1500 sq ft: the 5 cent plot is 2178 sq ft, so only the flat
    expect(titles(await feed("?maxArea=1500"))).toEqual(["Flat"]);
    // exactly on the edges counts
    expect(titles(await feed("?minArea=2178&maxArea=2178"))).toEqual(["5 cent plot"]);
    // with no size set, every post shows
    expect((await feed("")).body.total).toBe(5);

    const minAboveMax = await feed("?minArea=9000&maxArea=10");
    expect(minAboveMax.status).toBe(400);
    expect(minAboveMax.body.message).toMatch(/minimum size/);
    expect((await feed("?minArea=10%20cents")).status).toBe(400);
  });

  test("editing the size text updates the size number", async () => {
    const me = await newUser();
    const post = await makePost(me, { title: "Plot", area: "5 cents", sellerPhone: "9895000000" });
    expect(titles(await feed("?minArea=4356"))).toEqual([]);

    const edit = await request(app)
      .put(`/api/posts/${post._id}`)
      .set(auth(me))
      .send({ area: "11 cents" });
    expect(edit.status).toBe(200);
    expect((await Post.findById(post._id).lean()).areaValue).toBe(4792);
    expect(titles(await feed("?minArea=4356"))).toEqual(["Plot"]);
  });

  test("search and filters also work on the Following tab", async () => {
    const seller = await newUser();
    const stranger = await newUser();
    const fan = await newUser();
    await request(app).post(`/api/users/${seller.id}/follow`).set(auth(fan));
    await makePost(seller, { title: "Followed villa", type: "Villa" });
    await makePost(seller, { title: "Followed plot", type: "Plot" });
    await makePost(stranger, { title: "Stranger villa", type: "Villa" });

    expect(titles(await feed("?feed=following&types=Villa", fan))).toEqual(["Followed villa"]);
    expect(titles(await feed("?feed=following&q=plot", fan))).toEqual(["Followed plot"]);
  });
});

// ------------------------------------------------------ one-off script
describe("backfill script for existing posts", () => {
  // Posts saved before Screen 6 have no numbers: insert them the raw way.
  const insertOldPost = (seller, fields) =>
    Post.collection.insertOne({
      user: new mongoose.Types.ObjectId(seller.id),
      title: "Old post",
      location: "Kozhikode",
      type: "Villa",
      deal: "For sale",
      platform: "PlotPost",
      imageUrls: [PHOTO],
      likes: [],
      comments: [],
      createdAt: new Date("2026-01-01"),
      updatedAt: new Date("2026-01-02"),
      ...fields,
    });

  test("report only by default; --apply fills in just the three numbers", async () => {
    const me = await newUser();
    const lines = [];
    const log = (line) => lines.push(line);
    const { insertedId: a } = await insertOldPost(me, { title: "Old villa", price: "₹75 lakh", bedrooms: "4", area: "15 cents" });
    const { insertedId: b } = await insertOldPost(me, { title: "Old on request", price: "Price on request", bedrooms: "", area: "big" });
    await makePost(me, { title: "New post", price: "₹40 lakh" }); // already has its numbers

    // Old posts are invisible to a price filter until the script runs.
    expect((await feed("?minPrice=1")).body.total).toBe(1);

    const before = await Post.collection.findOne({ _id: a });
    const report = await backfillPostNumbers({ log });
    expect(report).toMatchObject({ checked: 3, toUpdate: 2, updated: 0, noPrice: 1, noSize: 2 });
    expect(report.unclearPrices).toEqual(["Price on request"]);
    expect(report.unclearSizes).toEqual(["big"]);
    expect(lines.join("\n")).toMatch(/Nothing was changed/);
    expect(await Post.collection.findOne({ _id: a })).toEqual(before);

    const applied = await backfillPostNumbers({ apply: true, log });
    expect(applied).toMatchObject({ toUpdate: 2, updated: 2 });

    const after = await Post.collection.findOne({ _id: a });
    expect(after).toEqual({ ...before, priceValue: 7500000, bedroomsCount: 4, areaValue: 6534 });
    expect(await Post.collection.findOne({ _id: b })).toMatchObject({
      priceValue: null,
      bedroomsCount: null,
      areaValue: null,
    });
    expect(titles(await feed("?minPrice=5000000"))).toEqual(["Old villa"]);
    expect(titles(await feed("?minArea=4356"))).toEqual(["Old villa"]);

    // Running it again changes nothing.
    expect(await backfillPostNumbers({ apply: true, log })).toMatchObject({ toUpdate: 0, updated: 0 });
  });
});

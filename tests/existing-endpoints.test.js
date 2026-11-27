// A quick end-to-end check of the main things the app does, against the
// current API (sign-up returns "token"; photos are Cloudinary links).
const request = require("supertest");
const app = require("../app");
const db = require("./helpers/db");
const { registerUser, bearer } = require("./helpers/auth");

beforeAll(() => db.connect("existing"));
afterEach(() => db.clear());
afterAll(() => db.close());

const samplePost = {
  title: "10 cent plot near Chevayur",
  type: "Plot",
  deal: "For sale",
  price: "₹38 lakh",
  location: "Chevayur, Kozhikode, Kerala",
  description: "Level plot with road access",
  socialUrl: "https://www.youtube.com/watch?v=abc",
  sellerPhone: "+91 98950 00002",
  area: "10 cents",
  platform: "YouTube",
  imageUrls: ["https://res.cloudinary.com/test-cloud/image/upload/v1/plotpost/posts/a.jpg"],
};

test("create, list, edit and delete a post", async () => {
  const { accessToken } = await registerUser({ name: "Prime Plots" });

  const created = await request(app).post("/api/posts").set(bearer(accessToken)).send(samplePost);
  expect(created.status).toBe(201);
  expect(created.body.post).toMatchObject({ title: samplePost.title, price: "₹38 lakh", platform: "YouTube" });
  const id = created.body.post._id;

  const list = await request(app).get("/api/posts");
  expect(list.status).toBe(200);
  expect(list.body).toMatchObject({ success: true, total: 1, page: 1 });

  const mine = await request(app).get("/api/posts/my").set(bearer(accessToken));
  expect(mine.body.posts).toHaveLength(1);

  const edited = await request(app).put(`/api/posts/${id}`).set(bearer(accessToken)).send({ price: "₹36 lakh" });
  expect(edited.status).toBe(200);
  expect(edited.body.post.price).toBe("₹36 lakh");

  expect((await request(app).delete(`/api/posts/${id}`).set(bearer(accessToken))).status).toBe(200);
});

test("other users can't edit or delete your post", async () => {
  const owner = await registerUser();
  const stranger = await registerUser();
  const created = await request(app).post("/api/posts").set(bearer(owner.accessToken)).send(samplePost);
  const id = created.body.post._id;
  expect((await request(app).put(`/api/posts/${id}`).set(bearer(stranger.accessToken)).send({ price: "1" })).status).toBe(403);
  expect((await request(app).delete(`/api/posts/${id}`).set(bearer(stranger.accessToken))).status).toBe(403);
});

test("save and unsave a post", async () => {
  const { accessToken } = await registerUser();
  const created = await request(app).post("/api/posts").set(bearer(accessToken)).send(samplePost);
  const id = created.body.post._id;

  const saved = await request(app).post(`/api/users/saved/${id}`).set(bearer(accessToken)).send({ saved: true });
  expect(saved.body.isSaved).toBe(true);
  const list = await request(app).get("/api/users/saved").set(bearer(accessToken));
  expect(list.body.savedPosts).toHaveLength(1);
  const unsaved = await request(app).post(`/api/users/saved/${id}`).set(bearer(accessToken)).send({ saved: false });
  expect(unsaved.body.isSaved).toBe(false);
});

test("guests and logged-in users can send interest", async () => {
  const seller = await registerUser();
  const buyer = await registerUser();
  const created = await request(app).post("/api/posts").set(bearer(seller.accessToken)).send(samplePost);
  const enquiry = {
    postId: created.body.post._id,
    name: "Meera",
    phone: "9895000009",
    message: "Is it still available?",
    contactMethod: "Phone call",
  };

  expect((await request(app).post("/api/enquiries").send(enquiry)).status).toBe(201);
  expect((await request(app).post("/api/enquiries").set(bearer(buyer.accessToken)).send(enquiry)).status).toBe(201);
  const mine = await request(app).get("/api/enquiries/my").set(bearer(buyer.accessToken));
  expect(mine.body.count).toBe(1);
});

test("like and comment", async () => {
  const { accessToken } = await registerUser();
  const created = await request(app).post("/api/posts").set(bearer(accessToken)).send(samplePost);
  const id = created.body.post._id;
  const like = await request(app).post(`/api/posts/${id}/like`).set(bearer(accessToken));
  expect(like.body).toMatchObject({ isLiked: true, likesCount: 1 });
  const comment = await request(app).post(`/api/posts/${id}/comment`).set(bearer(accessToken)).send({ text: "Still available?" });
  expect(comment.status).toBe(201);
  expect(comment.body.commentsCount).toBe(1);
});

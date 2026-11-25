const request = require("supertest");
const app = require("../app");
const db = require("./helpers/db");
const { errorHandler } = require("../middleware/errorHandler");
const { adminOnly } = require("../middleware/authMiddleware");

beforeAll(() => db.connect("security"));
afterAll(() => db.close());

describe("Stage 0: app basics", () => {
  test("root and health respond", async () => {
    const root = await request(app).get("/");
    expect(root.status).toBe(200);
    expect(root.body.success).toBe(true);

    const health = await request(app).get("/api/health");
    expect(health.status).toBe(200);
    expect(health.body.database).toBe("connected");
  });

  test("unknown routes return JSON 404", async () => {
    const res = await request(app).get("/api/does-not-exist");
    expect(res.status).toBe(404);
    expect(res.body.success).toBe(false);
  });

  test("broken JSON returns 400, not a crash", async () => {
    const res = await request(app)
      .post("/api/auth/login")
      .set("Content-Type", "application/json")
      .send('{"email": "a@b.com", ');
    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/not valid JSON/);
  });
});

describe("Stage 0: security headers and CORS", () => {
  test("Helmet headers are set and Express is not advertised", async () => {
    const res = await request(app).get("/");
    expect(res.headers["x-content-type-options"]).toBe("nosniff");
    expect(res.headers["x-powered-by"]).toBeUndefined();
  });

  test("listed browser origin is allowed", async () => {
    const res = await request(app).get("/").set("Origin", "https://plotpost.web.app");
    expect(res.headers["access-control-allow-origin"]).toBe("https://plotpost.web.app");
  });

  test("unlisted browser origin gets no CORS permission", async () => {
    const res = await request(app).get("/").set("Origin", "https://evil.example.com");
    expect(res.headers["access-control-allow-origin"]).toBeUndefined();
  });

  test("mobile app requests (no Origin header) work", async () => {
    const res = await request(app).get("/api/health");
    expect(res.status).toBe(200);
  });
});

describe("Stage 0: request limits and injection", () => {
  test("oversized bodies are rejected outside the posts routes", async () => {
    const res = await request(app)
      .post("/api/auth/login")
      .send({ email: "a@b.com", password: "x".repeat(300 * 1024) });
    expect(res.status).toBe(413);
  });

  test("editing a post still accepts large bodies (older posts keep base64 photos)", async () => {
    const res = await request(app)
      .put("/api/posts/64b7f0f0f0f0f0f0f0f0f0f0")
      .send({ title: "x", location: "y", imageUrls: ["x".repeat(1024 * 1024)] });
    // Parsed fine, then stopped by login check, not by the size limit.
    expect(res.status).toBe(401);
    // New posts only send photo links, so they get the small limit.
    const create = await request(app).post("/api/posts").send({ title: "x", imageUrls: ["x".repeat(1024 * 1024)] });
    expect(create.status).toBe(413);
  });

  test("MongoDB operator injection in login is blocked", async () => {
    const res = await request(app)
      .post("/api/auth/login")
      .send({ email: { $ne: null }, password: { $ne: null } });
    expect(res.status).toBe(400);
    expect(res.body.success).toBe(false);
    expect(res.body.token).toBeUndefined();
  });

  test("rate limiter returns 429 after too many auth attempts", async () => {
    let limitedApp;
    jest.isolateModules(() => {
      process.env.RATE_LIMIT_ENABLED = "true";
      process.env.RATE_LIMIT_AUTH_MAX = "3";
      limitedApp = require("../app");
    });
    process.env.RATE_LIMIT_ENABLED = "false";
    delete process.env.RATE_LIMIT_AUTH_MAX;

    const statuses = [];
    for (let i = 0; i < 4; i += 1) {
      // Invalid emails fail validation instantly, after the limiter has counted them.
      const res = await request(limitedApp).post("/api/auth/login").send({ email: "bad", password: "x" });
      statuses.push(res.status);
    }
    expect(statuses).toEqual([400, 400, 400, 429]);
  });
});

describe("Stage 0: error handler", () => {
  const fakeRes = () => {
    const res = {};
    res.status = jest.fn(() => res);
    res.json = jest.fn(() => res);
    return res;
  };

  test("unexpected errors never leak internal details", () => {
    const res = fakeRes();
    errorHandler(new Error("connection string mongodb+srv://admin:secret@cluster"), { method: "GET", originalUrl: "/x" }, res, () => {});
    expect(res.status).toHaveBeenCalledWith(500);
    const body = res.json.mock.calls[0][0];
    expect(JSON.stringify(body)).not.toMatch(/secret|mongodb/);
  });

  test("duplicate key errors become 409", () => {
    const res = fakeRes();
    errorHandler({ code: 11000, keyPattern: { email: 1 } }, { method: "POST", originalUrl: "/x" }, res, () => {});
    expect(res.status).toHaveBeenCalledWith(409);
  });
});

describe("Stage 1: admin-only guard", () => {
  test("normal users are refused, admins pass", () => {
    const res = { status: jest.fn(() => res), json: jest.fn(() => res) };
    const next = jest.fn();

    adminOnly({ user: { role: "user" } }, res, next);
    expect(res.status).toHaveBeenCalledWith(403);
    expect(next).not.toHaveBeenCalled();

    adminOnly({ user: { role: "admin" } }, res, next);
    expect(next).toHaveBeenCalled();
  });
});

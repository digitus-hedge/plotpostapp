// Phase 4 Step 1: request protection. None of these need a database.
const express = require("express");
const request = require("supertest");
const app = require("../server");
const { clean } = require("../middleware/sanitize");
const { looksLikePhoto, oneImage } = require("../middleware/uploadMiddleware");

const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 0x10, 0x4a, 0x46, 0x49, 0x46, 0, 1, 1, 0]);
const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0x0d, 0x49, 0x48]);
const WEBP = Buffer.concat([Buffer.from("RIFF"), Buffer.from([0x24, 0, 0, 0]), Buffer.from("WEBPVP8 ")]);
const HEIC = Buffer.concat([Buffer.from([0, 0, 0, 0x18]), Buffer.from("ftypheic"), Buffer.alloc(8)]);

describe("security headers and CORS (the real server)", () => {
  test("helmet headers are set and Express isn't advertised", async () => {
    const res = await request(app).get("/");
    expect(res.headers["x-content-type-options"]).toBe("nosniff");
    expect(res.headers["strict-transport-security"]).toMatch(/max-age=/);
    expect(res.headers["x-frame-options"]).toBe("SAMEORIGIN");
    expect(res.headers["x-powered-by"]).toBeUndefined();
  });

  test("the admin panel keeps its own stricter page rules", async () => {
    const res = await request(app).get("/admin/");
    expect(res.headers["x-frame-options"]).toBe("DENY");
    expect(res.headers["content-security-policy"]).toMatch(/frame-ancestors 'none'/);
  });

  test("listed sites may call the API from a browser; others get no permission; apps always work", async () => {
    const listed = await request(app).get("/").set("Origin", "https://plotpost.web.app");
    expect(listed.headers["access-control-allow-origin"]).toBe("https://plotpost.web.app");
    const other = await request(app).get("/").set("Origin", "https://evil.example.com");
    expect(other.headers["access-control-allow-origin"]).toBeUndefined();
    const phone = await request(app).get("/");
    expect(phone.status).toBe(200);
  });
});

describe("request size", () => {
  test("bodies over 200 KB are refused, except when editing a post", async () => {
    const big = { title: "x", imageUrls: ["x".repeat(1024 * 1024)] };
    expect((await request(app).post("/api/auth/login").send({ email: "a@b.com", password: "x".repeat(300 * 1024) })).status).toBe(413);
    const create = await request(app).post("/api/posts").send(big);
    expect(create.status).toBe(413);
    expect(create.body.message).toBe("The request is too large.");
    // Editing: parsed fine, then stopped by the login check.
    expect((await request(app).put("/api/posts/64b7f0f0f0f0f0f0f0f0f0f0").send(big)).status).toBe(401);
  });
});

describe("MongoDB operator injection", () => {
  test("keys starting with $ or containing a dot are removed at any depth", () => {
    const body = { email: { $ne: null }, ok: "yes", "a.b": 1, deep: [{ $where: "sleep(1000)", keep: 2 }] };
    expect(clean(body)).toEqual({ email: {}, ok: "yes", deep: [{ keep: 2 }] });
  });

  test("login with operators is refused", async () => {
    const res = await request(app).post("/api/auth/login").send({ email: { $ne: null }, password: { $ne: null } });
    expect(res.status).toBe(400);
    expect(res.body.token).toBeUndefined();
  });
});

describe("photo uploads are checked by their content", () => {
  test("real JPG, PNG, WEBP and HEIC pass; renamed files don't", () => {
    for (const photo of [JPEG, PNG, WEBP, HEIC]) expect(looksLikePhoto(photo)).toBe(true);
    expect(looksLikePhoto(Buffer.from("<?php echo 'hi'; ?> pretending"))).toBe(false);
    expect(looksLikePhoto(Buffer.from("%PDF-1.7 not a photo at all"))).toBe(false);
    expect(looksLikePhoto(Buffer.from([0xff, 0xd8]))).toBe(false);
    expect(looksLikePhoto(undefined)).toBe(false);
  });

  const mini = () => {
    const small = express();
    small.post("/upload", oneImage, (req, res) => res.json({ success: true, bytes: req.file.size }));
    return small;
  };

  test("a text file sent as image/jpeg is refused", async () => {
    const res = await request(mini())
      .post("/upload")
      .attach("image", Buffer.from("not really a photo, just text....."), { filename: "x.jpg", contentType: "image/jpeg" });
    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/isn't a photo/);
  });

  test("a real photo goes through; two files at once don't", async () => {
    const ok = await request(mini()).post("/upload").attach("image", JPEG, { filename: "a.jpg", contentType: "image/jpeg" });
    expect(ok.status).toBe(200);
    const two = await request(mini())
      .post("/upload")
      .attach("image", JPEG, { filename: "a.jpg", contentType: "image/jpeg" })
      .attach("image", JPEG, { filename: "b.jpg", contentType: "image/jpeg" });
    expect(two.status).toBe(400);
    expect(two.body.message).toBe("Send one photo at a time.");
  });

  test("other file types are refused by what the phone says too", async () => {
    const res = await request(mini()).post("/upload").attach("image", Buffer.from("%PDF-1.7"), { filename: "a.pdf", contentType: "application/pdf" });
    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/JPG, PNG, WEBP and HEIC/);
  });
});

describe("rate limits", () => {
  // Loads the limiters with limits switched on and small numbers.
  const limiters = (env) => {
    let loaded;
    jest.isolateModules(() => {
      const before = { ...process.env };
      Object.assign(process.env, { RATE_LIMIT_ENABLED: "true", ...env });
      loaded = require("../middleware/rateLimiter");
      process.env = before;
    });
    return loaded;
  };
  const miniApp = (middleware, status = 200, user = null) => {
    const small = express();
    small.use(express.json());
    small.use((req, res, next) => {
      if (user) req.user = { _id: user };
      next();
    });
    small.post("/x", middleware, (req, res) => res.status(status).json({ success: status < 400 }));
    return small;
  };

  test("codes by email: per address, whatever the network", async () => {
    const { emailCodeLimiter } = limiters({ RATE_LIMIT_EMAIL_CODE_MAX: "2" });
    const small = miniApp(emailCodeLimiter);
    const send = (email) => request(small).post("/x").send({ email });
    expect((await send("asha@example.com")).status).toBe(200);
    expect((await send("ASHA@example.com ")).status).toBe(200);
    const third = await send("asha@example.com");
    expect(third.status).toBe(429);
    expect(third.body.message).toMatch(/Too many codes/);
    expect((await send("biju@example.com")).status).toBe(200);
  });

  test("wrong passwords per account; successful logins don't count", async () => {
    const { loginFailLimiter } = limiters({ RATE_LIMIT_LOGIN_FAIL_MAX: "2" });
    const wrong = miniApp(loginFailLimiter, 401);
    for (let i = 0; i < 2; i += 1) expect((await request(wrong).post("/x").send({ email: "a@b.com" })).status).toBe(401);
    const blocked = await request(wrong).post("/x").send({ email: "a@b.com" });
    expect(blocked.status).toBe(429);
    expect(blocked.body.message).toMatch(/Too many wrong passwords/);

    const { loginFailLimiter: fresh } = limiters({ RATE_LIMIT_LOGIN_FAIL_MAX: "2" });
    const right = miniApp(fresh, 200);
    for (let i = 0; i < 5; i += 1) expect((await request(right).post("/x").send({ email: "a@b.com" })).status).toBe(200);
  });

  test("uploads, new posts and likes/follows are limited per account", async () => {
    const { uploadLimiter, newPostLimiter, actionLimiter } = limiters({
      RATE_LIMIT_UPLOAD_MAX: "1",
      RATE_LIMIT_POST_MAX: "1",
      RATE_LIMIT_ACTION_MAX: "1",
    });
    for (const [limiter, text] of [
      [uploadLimiter, /uploaded a lot of photos/],
      [newPostLimiter, /posted a lot of listings/],
      [actionLimiter, /very fast/],
    ]) {
      const asha = miniApp(limiter, 200, "asha");
      expect((await request(asha).post("/x")).status).toBe(200);
      const second = await request(asha).post("/x");
      expect(second.status).toBe(429);
      expect(second.body.message).toMatch(text);
      // Someone else isn't affected.
      expect((await request(miniApp(limiter, 200, "biju")).post("/x")).status).toBe(200);
    }
  });
});

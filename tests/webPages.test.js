// Phase 5 Step 1: the public pages (privacy, terms, delete account) and the
// website deletion API's checks that run before the database. No database
// needed.
const fs = require("fs");
const path = require("path");
const request = require("supertest");
const app = require("../server");
const emailService = require("../services/emailService");

afterEach(() => jest.restoreAllMocks());

const PAGES = ["/privacy", "/terms", "/delete-account"];

describe("public pages", () => {
  test.each(PAGES)("%s is a web page with strict page rules", async (url) => {
    const res = await request(app).get(url);
    expect(res.status).toBe(200);
    expect(res.headers["content-type"]).toMatch(/text\/html/);
    expect(res.headers["x-frame-options"]).toBe("DENY");
    expect(res.headers["content-security-policy"]).toMatch(/script-src 'self'/);
    expect(res.headers["content-security-policy"]).toMatch(/frame-ancestors 'none'/);
    expect(res.text).toMatch(/<html lang="en">/);
    // The same page also answers with .html and a trailing slash.
    expect((await request(app).get(`${url}.html`)).status).toBe(200);
    expect((await request(app).get(`${url}/`)).status).toBe(200);
  });

  test("the style sheet and the delete page's script load; nothing else in the folder is listed", async () => {
    const css = await request(app).get("/site/site.css");
    expect(css.status).toBe(200);
    expect(css.headers["content-type"]).toMatch(/text\/css/);
    const js = await request(app).get("/site/delete-account.js");
    expect(js.status).toBe(200);
    expect(js.headers["content-type"]).toMatch(/javascript/);
    expect((await request(app).get("/site/")).status).toBe(404);
    expect((await request(app).get("/site/../server.js")).status).toBe(404);
  });

  test("pages only use files from this server, and every link goes somewhere real", async () => {
    for (const url of PAGES) {
      const html = (await request(app).get(url)).text;
      // No inline scripts or styles (the page rules would block them).
      expect(html).not.toMatch(/<script>(?!<\/script>)/);
      expect(html).not.toMatch(/\sstyle="/);
      expect(html).not.toMatch(/\son[a-z]+="/);
      const local = [...html.matchAll(/(?:href|src)="(\/[^"#]*)"/g)].map((m) => m[1]);
      for (const link of new Set(local)) {
        expect([link, (await request(app).get(link)).status]).toEqual([link, 200]);
      }
    }
  });

  test("the privacy policy covers deletion, keeping data and contact", async () => {
    const html = (await request(app).get("/privacy")).text;
    expect(html).toMatch(/href="\/delete-account"/);
    expect(html).toMatch(/12 months/);
    expect(html).toMatch(/90 days/);
    expect(html).toMatch(/62356 49489/);
    expect(html).not.toMatch(/January 2025/);
  });

  test("the delete page loads its script and explains what is deleted and kept", async () => {
    const html = (await request(app).get("/delete-account")).text;
    expect(html).toMatch(/<script src="\/site\/delete-account.js" defer><\/script>/);
    expect(html).toMatch(/What gets deleted/);
    expect(html).toMatch(/What we keep for a while/);
    const script = fs.readFileSync(path.join(__dirname, "..", "public", "site", "delete-account.js"), "utf8");
    expect(script).toMatch(/\/api\/auth\/delete-account\/request-code/);
    expect(script).toMatch(/\/api\/auth\/delete-account\/confirm/);
  });
});

describe("website deletion API (before the database)", () => {
  test("with no email service it says how to reach support instead", async () => {
    jest.spyOn(emailService, "canSend").mockReturnValue(false);
    const res = await request(app).post("/api/auth/delete-account/request-code").send({ email: "asha@example.com" });
    expect(res.status).toBe(503);
    expect(res.body.noEmail).toBe(true);
    expect(res.body.message).toMatch(/WhatsApp/);
  });

  test("checks the email and the code's shape", async () => {
    const bad = await request(app).post("/api/auth/delete-account/request-code").send({ email: "not-an-email" });
    expect(bad.status).toBe(400);
    const short = await request(app).post("/api/auth/delete-account/confirm").send({ email: "a@example.com", code: "12" });
    expect(short.status).toBe(400);
    expect(short.body.message).toMatch(/6-digit code/);
    const injection = await request(app)
      .post("/api/auth/delete-account/confirm")
      .send({ email: { $ne: null }, code: "123456" });
    expect(injection.status).toBe(400);
  });
});

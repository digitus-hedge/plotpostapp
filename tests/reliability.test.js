// Phase 5 Step 2: backups, error alert emails and the start-up report.
// No database needed (the backup tests use a small pretend database).
const fs = require("fs");
const os = require("os");
const path = require("path");
const mongoose = require("mongoose");
const {
  backupDatabase,
  restoreDatabase,
  pruneOldBackups,
  backupFolderName,
  hidePassword,
} = require("../utils/dbBackup");
const { createAlerter, formatEmail } = require("../services/errorAlerts");
const { startupReport, describeMongoUri } = require("../config/startupReport");

const { EJSON } = mongoose.mongo.BSON;

// Just enough of a MongoDB database for the backup code.
const fakeDb = (data = {}, name = "plotpost") => {
  const store = Object.fromEntries(Object.entries(data).map(([key, docs]) => [key, docs.map((d) => ({ ...d }))]));
  return {
    databaseName: name,
    store,
    listCollections: () => ({
      toArray: async () => [...Object.keys(store), "system.views"].map((n) => ({ name: n })),
    }),
    collection: (n) => ({
      find: () => ({
        async *[Symbol.asyncIterator]() {
          for (const doc of store[n] || []) yield doc;
        },
      }),
      estimatedDocumentCount: async () => (store[n] || []).length,
      deleteMany: async () => {
        store[n] = [];
      },
      insertMany: async (docs) => {
        (store[n] ||= []).push(...docs);
      },
    }),
  };
};

const tempDir = () => fs.mkdtempSync(path.join(os.tmpdir(), "plotpost-backup-"));
const same = (a, b) => expect(EJSON.stringify(a, { relaxed: false })).toBe(EJSON.stringify(b, { relaxed: false }));

describe("backups", () => {
  const userId = new mongoose.Types.ObjectId();
  const source = () =>
    fakeDb({
      users: [{ _id: userId, name: "Asha", createdAt: new Date("2026-11-01T10:00:00Z"), savedPosts: [] }],
      posts: Array.from({ length: 1201 }, (_, i) => ({
        _id: new mongoose.Types.ObjectId(),
        user: userId,
        title: `Plot ${i}`,
        priceValue: 3800000 + i,
        expiresAt: new Date(Date.UTC(2027, 0, 1, 0, 0, i % 60)),
      })),
      reports: [],
    });

  test("a backup and a restore give back exactly the same documents (ids, dates and numbers)", async () => {
    const root = tempDir();
    const db = source();
    const { folder, manifest } = await backupDatabase(db, root, { now: new Date(2026, 10, 24, 2, 30) });
    expect(path.basename(folder)).toBe("2026-11-24_0230");
    expect(manifest.collections).toEqual({ posts: 1201, reports: 0, users: 1 });
    expect(fs.existsSync(path.join(folder, "system.views.ndjson.gz"))).toBe(false);

    const target = fakeDb({}, "plotpost_restore");
    const { restored } = await restoreDatabase(target, folder, { batchSize: 500 });
    expect(restored).toEqual({ posts: 1201, reports: 0, users: 1 });
    same(target.store.users, db.store.users);
    same(target.store.posts, db.store.posts);
    expect(target.store.users[0]._id.equals(userId)).toBe(true);
    expect(target.store.users[0].createdAt).toEqual(new Date("2026-11-01T10:00:00Z"));
  });

  test("restoring refuses to touch collections that have data, unless --replace", async () => {
    const root = tempDir();
    const { folder } = await backupDatabase(source(), root);
    const target = fakeDb({ users: [{ _id: new mongoose.Types.ObjectId(), name: "Someone else" }] });
    await expect(restoreDatabase(target, folder)).rejects.toThrow(/already has data in: users/);
    // Nothing was written, not even to the empty collections.
    expect(target.store.posts).toBeUndefined();
    expect(target.store.users).toHaveLength(1);

    await restoreDatabase(target, folder, { replace: true });
    expect(target.store.users.map((u) => u.name)).toEqual(["Asha"]);
    expect(target.store.posts).toHaveLength(1201);
  });

  test("a folder that isn't a backup is refused", async () => {
    await expect(restoreDatabase(fakeDb(), tempDir())).rejects.toThrow(/isn't a PlotPost backup/);
  });

  test("two backups in the same minute don't overwrite each other", async () => {
    const root = tempDir();
    const now = new Date(2026, 10, 24, 2, 30);
    const first = await backupDatabase(source(), root, { now });
    const second = await backupDatabase(source(), root, { now });
    expect(path.basename(second.folder)).toBe("2026-11-24_0230-2");
    expect(first.folder).not.toBe(second.folder);
  });

  test("backups older than 30 days are deleted; other folders are never touched", async () => {
    const root = tempDir();
    const now = new Date(2026, 10, 24, 12, 0);
    const make = (name, withManifest = true) => {
      fs.mkdirSync(path.join(root, name));
      if (withManifest) fs.writeFileSync(path.join(root, name, "backup.json"), "{}");
    };
    make(backupFolderName(new Date(2026, 9, 20, 2, 30))); // 35 days old
    make(`${backupFolderName(new Date(2026, 9, 20, 2, 30))}-2`); // same, second copy
    make(backupFolderName(new Date(2026, 10, 1, 2, 30))); // 23 days old
    make(backupFolderName(new Date(2026, 8, 1, 2, 30)), false); // old, but no backup.json
    make("my important files");
    const removed = pruneOldBackups(root, { now });
    expect(removed.sort()).toEqual(["2026-10-20_0230", "2026-10-20_0230-2"]);
    expect(fs.readdirSync(root).sort()).toEqual(["2026-09-01_0230", "2026-11-01_0230", "my important files"]);
  });

  test("passwords are hidden when the address is printed", () => {
    expect(hidePassword("mongodb+srv://plotpost:S3cr3t!@cluster0.ab.mongodb.net/plotpost?x=1")).toBe(
      "mongodb+srv://plotpost:•••@cluster0.ab.mongodb.net/plotpost?x=1"
    );
  });
});

describe("error alert emails", () => {
  const setup = () => {
    let clock = 1_000_000;
    const sent = [];
    const timers = [];
    const alerter = createAlerter({
      send: async (message) => sent.push(message),
      canSend: () => true,
      to: () => ["me@example.com"],
      now: () => clock,
      windowMs: 15 * 60 * 1000,
      setTimer: (fn, ms) => timers.push({ fn, ms }),
    });
    return { alerter, sent, timers, tick: (ms) => (clock += ms) };
  };

  test("the first problem is emailed straight away; more within 15 minutes come together in one email", async () => {
    const { alerter, sent, timers, tick } = setup();
    alerter.report(new Error("Database timed out\n    at stack line"), { where: "GET /api/posts" });
    await Promise.resolve();
    expect(sent).toHaveLength(1);
    expect(sent[0].to).toEqual(["me@example.com"]);
    expect(sent[0].subject).toBe("PlotPost server problem: GET /api/posts");
    expect(sent[0].text).toMatch(/GET \/api\/posts: Database timed out/);
    expect(sent[0].text).not.toMatch(/stack line/);

    tick(60 * 1000);
    alerter.report(new Error("one"), { where: "POST /api/posts" });
    alerter.report(new Error("two"), { where: "POST /api/posts" });
    expect(sent).toHaveLength(1);
    expect(timers).toHaveLength(1); // one email waiting, not one per problem
    expect(timers[0].ms).toBe(14 * 60 * 1000);

    tick(14 * 60 * 1000);
    await timers[0].fn();
    expect(sent).toHaveLength(2);
    expect(sent[1].subject).toBe("PlotPost server: 2 problems");
  });

  test("a crash is emailed at once, even inside the 15 minutes", async () => {
    const { alerter, sent } = setup();
    alerter.report(new Error("first"), { where: "GET /x" });
    await Promise.resolve();
    expect(await alerter.reportNow(new Error("boom"), { where: "crash" })).not.toBe(false);
    expect(sent).toHaveLength(2);
    expect(sent[1].text).toMatch(/crash: boom/);
  });

  test("with nobody to email (or no email service) nothing is sent", () => {
    const sent = [];
    const alerter = createAlerter({ send: async (m) => sent.push(m), canSend: () => false });
    expect(alerter.report(new Error("x"))).toBe(false);
    expect(sent).toHaveLength(0);
  });

  test("long lists stop at 20 lines and point to the logs", () => {
    const items = Array.from({ length: 20 }, (_, i) => ({ at: new Date(0), where: "GET /x", message: `e${i}` }));
    const { text } = formatEmail(items, 35);
    expect(text).toMatch(/…and 15 more/);
  });
});

describe("start-up report", () => {
  test("reads the database name and host, never the password", () => {
    expect(describeMongoUri("mongodb+srv://u:secret@cluster0.ab.mongodb.net/plotpost?retryWrites=true")).toEqual({
      host: "cluster0.ab.mongodb.net",
      database: "plotpost",
    });
    expect(describeMongoUri("mongodb+srv://u:p@cluster0.ab.mongodb.net/?retryWrites=true").database).toBe("");
    const { lines } = startupReport({ MONGODB_URI: "mongodb+srv://u:secret@cluster0.ab.mongodb.net/plotpost" });
    expect(lines.join("\n")).not.toMatch(/secret/);
    expect(lines.join("\n")).toMatch(/Database: plotpost on cluster0.ab.mongodb.net/);
  });

  test("warns about a missing database name, and about Railway without NODE_ENV=production", () => {
    const { warnings } = startupReport({
      MONGODB_URI: "mongodb+srv://u:p@cluster0.ab.mongodb.net/?retryWrites=true",
      RAILWAY_ENVIRONMENT_NAME: "production",
    });
    expect(warnings.join("\n")).toMatch(/no database name/);
    expect(warnings.join("\n")).toMatch(/NODE_ENV=production/);
  });
});

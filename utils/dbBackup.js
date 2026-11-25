// Backing up and restoring the PlotPost database without installing any
// MongoDB tools. Used by scripts/backupDb.js and scripts/restoreDb.js.
//
// A backup is a folder named after the time it was made, e.g.
//   backups/2026-11-24_0230/
//     backup.json             what's inside (database, collections, counts)
//     users.ndjson.gz         one document per line, in MongoDB's "extended
//     posts.ndjson.gz         JSON", so ids and dates come back exactly
//     ...
// Indexes aren't copied: the server builds them itself when it starts.
const fs = require("fs");
const path = require("path");
const zlib = require("zlib");
const readline = require("readline");
const { pipeline } = require("stream/promises");
const { Readable } = require("stream");
const mongoose = require("mongoose");

const { EJSON } = mongoose.mongo.BSON;
const FORMAT = 1;
const KEEP_DAYS = 30; // the privacy policy promises backups are kept 30 days at most
const FOLDER_PATTERN = /^(\d{4})-(\d{2})-(\d{2})_(\d{2})(\d{2})$/;

const pad = (n) => String(n).padStart(2, "0");

// "2026-11-24_0230" in the computer's local time.
const backupFolderName = (date = new Date()) =>
  `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}_${pad(date.getHours())}${pad(date.getMinutes())}`;

const folderDate = (name) => {
  const match = FOLDER_PATTERN.exec(name);
  if (!match) return null;
  const [, y, m, d, hh, mm] = match.map(Number);
  return new Date(y, m - 1, d, hh, mm);
};

const userCollections = async (db) =>
  (await db.listCollections({}, { nameOnly: true }).toArray())
    .map((c) => c.name)
    .filter((name) => !name.startsWith("system."))
    .sort();

// Writes every collection of `db` into a new folder under `root`.
// Only reads from the database.
const backupDatabase = async (db, root, { now = new Date() } = {}) => {
  let folder = path.join(root, backupFolderName(now));
  // Two backups in the same minute: add a number rather than overwrite.
  for (let n = 2; fs.existsSync(folder); n += 1) folder = path.join(root, `${backupFolderName(now)}-${n}`);
  fs.mkdirSync(folder, { recursive: true });

  const counts = {};
  for (const name of await userCollections(db)) {
    let count = 0;
    const cursor = db.collection(name).find({}, { batchSize: 500 });
    const lines = Readable.from(
      (async function* toLines() {
        for await (const doc of cursor) {
          count += 1;
          yield `${EJSON.stringify(doc, { relaxed: false })}\n`;
        }
      })()
    );
    await pipeline(lines, zlib.createGzip(), fs.createWriteStream(path.join(folder, `${name}.ndjson.gz`)));
    counts[name] = count;
  }

  const manifest = { format: FORMAT, createdAt: now.toISOString(), database: db.databaseName, collections: counts };
  fs.writeFileSync(path.join(folder, "backup.json"), `${JSON.stringify(manifest, null, 2)}\n`);
  return { folder, manifest };
};

const readManifest = (folder) => {
  const file = path.join(folder, "backup.json");
  if (!fs.existsSync(file)) throw new Error(`${folder} isn't a PlotPost backup (no backup.json).`);
  const manifest = JSON.parse(fs.readFileSync(file, "utf8"));
  if (manifest.format !== FORMAT) throw new Error(`Unknown backup format ${manifest.format}.`);
  for (const name of Object.keys(manifest.collections)) {
    if (!fs.existsSync(path.join(folder, `${name}.ndjson.gz`))) throw new Error(`${name}.ndjson.gz is missing.`);
  }
  return manifest;
};

const readDocs = async function* readDocs(file) {
  const lines = readline.createInterface({
    input: fs.createReadStream(file).pipe(zlib.createGunzip()),
    crlfDelay: Infinity,
  });
  for await (const line of lines) {
    if (line.trim()) yield EJSON.parse(line, { relaxed: false });
  }
};

// Copies a backup folder into `db`. Refuses if any of those collections
// already has documents, unless replace is true (then they're emptied first).
// Checks everything before changing anything.
const restoreDatabase = async (db, folder, { replace = false, batchSize = 500 } = {}) => {
  const manifest = readManifest(folder);
  const names = Object.keys(manifest.collections);

  if (!replace) {
    const busy = [];
    for (const name of names) {
      if ((await db.collection(name).estimatedDocumentCount()) > 0) busy.push(name);
    }
    if (busy.length) {
      throw new Error(
        `The database "${db.databaseName}" already has data in: ${busy.join(", ")}. Restore into an empty database, or use --replace to delete that data first.`
      );
    }
  }

  const restored = {};
  for (const name of names) {
    const collection = db.collection(name);
    if (replace) await collection.deleteMany({});
    let batch = [];
    let count = 0;
    for await (const doc of readDocs(path.join(folder, `${name}.ndjson.gz`))) {
      batch.push(doc);
      if (batch.length >= batchSize) {
        await collection.insertMany(batch, { ordered: true });
        count += batch.length;
        batch = [];
      }
    }
    if (batch.length) {
      await collection.insertMany(batch, { ordered: true });
      count += batch.length;
    }
    restored[name] = count;
  }
  return { manifest, restored };
};

// Deletes backup folders older than KEEP_DAYS. Only touches folders whose
// name is a backup time and that contain backup.json.
const pruneOldBackups = (root, { now = new Date(), keepDays = KEEP_DAYS } = {}) => {
  if (!fs.existsSync(root)) return [];
  const cutoff = now.getTime() - keepDays * 24 * 60 * 60 * 1000;
  const removed = [];
  for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const name = entry.name.replace(/-\d+$/, "");
    const made = folderDate(name);
    const folder = path.join(root, entry.name);
    if (!made || made.getTime() >= cutoff) continue;
    if (!fs.existsSync(path.join(folder, "backup.json"))) continue;
    fs.rmSync(folder, { recursive: true, force: true });
    removed.push(entry.name);
  }
  return removed;
};

// "mongodb+srv://user:secret@host/db" -> "mongodb+srv://user:•••@host/db"
const hidePassword = (uri) => String(uri || "").replace(/(\/\/[^:/@]+:)[^@]*@/, "$1•••@");

module.exports = {
  backupDatabase,
  restoreDatabase,
  pruneOldBackups,
  readManifest,
  backupFolderName,
  folderDate,
  hidePassword,
  KEEP_DAYS,
};

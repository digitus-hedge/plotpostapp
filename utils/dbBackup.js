// Backing up and restoring PlotPost's MySQL database with plain Node (no
// mysqldump needed, so it works on shared hosting too). Used by
// scripts/backupDb.js and scripts/restoreDb.js.
//
// A backup is a folder named after the time it was made, e.g.
//   backups/2026-11-24_0230/
//     backup.json          what's inside (database, tables, row counts)
//     users.ndjson.gz      one row per line as JSON; dates and binary data
//     posts.ndjson.gz      are tagged so they come back exactly
//     ...
// Only the rows are saved. Restoring needs the tables to exist; the restore
// script creates any missing ones from PlotPost's models first.
const fs = require("fs");
const path = require("path");
const zlib = require("zlib");
const readline = require("readline");
const { pipeline } = require("stream/promises");
const { Readable } = require("stream");

const FORMAT = 2; // 1 was the old MongoDB format
const KEEP_DAYS = 30; // the privacy policy promises backups are kept 30 days at most
const PAGE = 500;
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

const quoteName = (name) => `\`${String(name).replace(/`/g, "``")}\``;

// One row as a JSON line. Dates and binary data are tagged so they come
// back as the same type.
const encodeRow = (row) =>
  JSON.stringify(row, function replacer(key, value) {
    const raw = this[key];
    if (raw instanceof Date) return { $date: raw.toISOString() };
    if (Buffer.isBuffer(raw)) return { $base64: raw.toString("base64") };
    return value;
  });

// Back from a JSON line. JSON columns become text again, ready to insert.
const decodeRow = (line) => {
  const row = JSON.parse(line);
  for (const [key, value] of Object.entries(row)) {
    if (value && typeof value === "object") {
      if (typeof value.$date === "string" && Object.keys(value).length === 1) row[key] = new Date(value.$date);
      else if (typeof value.$base64 === "string" && Object.keys(value).length === 1) row[key] = Buffer.from(value.$base64, "base64");
      else row[key] = JSON.stringify(value);
    }
  }
  return row;
};

const listTables = async (sequelize) => {
  const [rows] = await sequelize.query("SHOW FULL TABLES WHERE Table_type = 'BASE TABLE'");
  return rows.map((row) => Object.values(row)[0]).sort();
};

const hasIdColumn = async (sequelize, table) => {
  const columns = await sequelize.getQueryInterface().describeTable(table);
  return Boolean(columns.id);
};

// Reads every row of one table, a page at a time (by id when there is one).
async function* tableRows(sequelize, table) {
  const name = quoteName(table);
  if (await hasIdColumn(sequelize, table)) {
    for (let lastId = null; ; ) {
      const [rows] = await sequelize.query(
        `SELECT * FROM ${name}${lastId === null ? "" : " WHERE `id` > ?"} ORDER BY \`id\` LIMIT ${PAGE}`,
        { replacements: lastId === null ? [] : [lastId] }
      );
      yield* rows;
      if (rows.length < PAGE) return;
      lastId = rows[rows.length - 1].id;
    }
  }
  const [rows] = await sequelize.query(`SELECT * FROM ${name}`);
  yield* rows;
}

// Writes every table of the connected database into a new folder under `root`.
// Only reads from the database.
const backupDatabase = async (sequelize, root, { now = new Date() } = {}) => {
  let folder = path.join(root, backupFolderName(now));
  // Two backups in the same minute: add a number rather than overwrite.
  for (let n = 2; fs.existsSync(folder); n += 1) folder = path.join(root, `${backupFolderName(now)}-${n}`);
  fs.mkdirSync(folder, { recursive: true });

  const tables = {};
  for (const table of await listTables(sequelize)) {
    let count = 0;
    const lines = Readable.from(
      (async function* toLines() {
        for await (const row of tableRows(sequelize, table)) {
          count += 1;
          yield `${encodeRow(row)}\n`;
        }
      })()
    );
    await pipeline(lines, zlib.createGzip(), fs.createWriteStream(path.join(folder, `${table}.ndjson.gz`)));
    tables[table] = count;
  }

  const manifest = {
    format: FORMAT,
    engine: "mysql",
    createdAt: now.toISOString(),
    database: sequelize.getDatabaseName(),
    tables,
  };
  fs.writeFileSync(path.join(folder, "backup.json"), `${JSON.stringify(manifest, null, 2)}\n`);
  return { folder, manifest };
};

const readManifest = (folder) => {
  const file = path.join(folder, "backup.json");
  if (!fs.existsSync(file)) throw new Error(`${folder} isn't a PlotPost backup (no backup.json).`);
  const manifest = JSON.parse(fs.readFileSync(file, "utf8"));
  if (manifest.format === 1) {
    throw new Error("This is an old MongoDB backup. It can't be restored into MySQL.");
  }
  if (manifest.format !== FORMAT) throw new Error(`Unknown backup format ${manifest.format}.`);
  for (const name of Object.keys(manifest.tables)) {
    if (!fs.existsSync(path.join(folder, `${name}.ndjson.gz`))) throw new Error(`${name}.ndjson.gz is missing.`);
  }
  return manifest;
};

async function* readRows(file) {
  const lines = readline.createInterface({
    input: fs.createReadStream(file).pipe(zlib.createGunzip()),
    crlfDelay: Infinity,
  });
  for await (const line of lines) {
    if (line.trim()) yield decodeRow(line);
  }
}

const rowCount = async (sequelize, table) => {
  const [[row]] = await sequelize.query(`SELECT COUNT(*) AS n FROM ${quoteName(table)}`);
  return Number(row.n) || 0;
};

// Copies a backup folder into the connected database. The tables must
// exist. Refuses if any of them already has rows, unless replace is true
// (then they're emptied first). Checks everything before changing anything,
// and does it all in one transaction: if anything fails, nothing changes.
const restoreDatabase = async (sequelize, folder, { replace = false, batchSize = 500 } = {}) => {
  const manifest = readManifest(folder);
  const names = Object.keys(manifest.tables);
  const existing = new Set(await listTables(sequelize));

  const missing = names.filter((name) => !existing.has(name));
  if (missing.length) throw new Error(`The database has no table for: ${missing.join(", ")}.`);

  if (!replace) {
    const busy = [];
    for (const name of names) if ((await rowCount(sequelize, name)) > 0) busy.push(name);
    if (busy.length) {
      throw new Error(
        `The database "${sequelize.getDatabaseName()}" already has rows in: ${busy.join(", ")}. Restore into an empty database, or use --replace to delete those rows first.`
      );
    }
  }

  const qi = sequelize.getQueryInterface();
  const restored = {};
  await sequelize.transaction(async (transaction) => {
    // Rows go in table by table, so links between tables are checked only at the end.
    await sequelize.query("SET FOREIGN_KEY_CHECKS = 0", { transaction });
    try {
      for (const name of names) {
        if (replace) await sequelize.query(`DELETE FROM ${quoteName(name)}`, { transaction });
        let batch = [];
        let count = 0;
        for await (const row of readRows(path.join(folder, `${name}.ndjson.gz`))) {
          batch.push(row);
          if (batch.length >= batchSize) {
            await qi.bulkInsert(name, batch, { transaction });
            count += batch.length;
            batch = [];
          }
        }
        if (batch.length) {
          await qi.bulkInsert(name, batch, { transaction });
          count += batch.length;
        }
        restored[name] = count;
      }
    } finally {
      await sequelize.query("SET FOREIGN_KEY_CHECKS = 1", { transaction });
    }
  });
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

module.exports = {
  backupDatabase,
  restoreDatabase,
  pruneOldBackups,
  readManifest,
  backupFolderName,
  folderDate,
  encodeRow,
  decodeRow,
  KEEP_DAYS,
};

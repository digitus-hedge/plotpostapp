// Backs up the PlotPost database into backups/<date_time>/ (one compressed
// file per collection), then deletes backups older than 30 days, because the
// privacy policy says backups are kept for 30 days at most.
//
//   npm run backup                                uses BACKUP_MONGODB_URI, or else MONGODB_URI, from .env
//   npm run backup -- --uri "mongodb+srv://..."   a different database
//   npm run backup -- --out "D:\PlotPost backups" a different folder
//
// Only reads from the database. Best with a read-only Atlas user (see
// DEPLOY_GUIDE.md). The backups hold people's personal data: keep the folder
// private, and never upload it or put it in Git (backups/ is in .gitignore).
require("dotenv").config({ quiet: true });
const dns = require("dns");
const path = require("path");
const mongoose = require("mongoose");
const { backupDatabase, pruneOldBackups, hidePassword, KEEP_DAYS } = require("../utils/dbBackup");
const { describeMongoUri } = require("../config/startupReport");

const argValue = (args, name) => {
  const at = args.indexOf(name);
  return at >= 0 ? args[at + 1] : undefined;
};

const run = async () => {
  const args = process.argv.slice(2);
  const uri = argValue(args, "--uri") || process.env.BACKUP_MONGODB_URI || process.env.MONGODB_URI;
  const root = path.resolve(argValue(args, "--out") || path.join(__dirname, "..", "backups"));
  if (!uri) {
    console.error("No database address: set BACKUP_MONGODB_URI (or MONGODB_URI) in .env, or pass --uri.");
    process.exit(1);
  }
  const { database } = describeMongoUri(uri);
  if (!database) {
    console.error("The database address has no database name (…mongodb.net/plotpost?…). Add it and try again.");
    process.exit(1);
  }

  // Same Windows DNS fix as server.js (mongodb+srv lookups).
  try {
    dns.setServers(["1.1.1.1", "8.8.8.8"]);
  } catch (error) {
    // ignore
  }

  console.log(`Backing up ${hidePassword(uri)}`);
  const client = new mongoose.mongo.MongoClient(uri, { serverSelectionTimeoutMS: 10000 });
  try {
    await client.connect();
    const started = Date.now();
    const { folder, manifest } = await backupDatabase(client.db(), root);
    const total = Object.values(manifest.collections).reduce((a, b) => a + b, 0);
    console.log(
      `Done in ${((Date.now() - started) / 1000).toFixed(1)} s: ${total} documents from ${Object.keys(manifest.collections).length} collections.`
    );
    for (const [name, count] of Object.entries(manifest.collections)) console.log(`  ${name}: ${count}`);
    console.log(`Saved in ${folder}`);
  } finally {
    await client.close();
  }

  const removed = pruneOldBackups(root);
  if (removed.length) console.log(`Deleted ${removed.length} backup(s) older than ${KEEP_DAYS} days: ${removed.join(", ")}`);
};

run().catch((error) => {
  console.error(`Backup failed: ${error.message}`);
  process.exit(1);
});

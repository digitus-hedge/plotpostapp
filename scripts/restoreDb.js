// Puts a backup made by `npm run backup` back into a database.
//
//   npm run restore -- backups/2026-11-24_0230 --uri "mongodb+srv://.../plotpost_restore?..."
//
// Safety:
//   - The target database must be given with --uri every time (it's never
//     taken from .env), so you can't restore into the wrong one by accident.
//   - It refuses if those collections already have data. Add --replace to
//     delete what's in them first (only for a real emergency).
//   - Before changing anything it shows what it will do and asks you to type
//     the database name. (Or pass --confirm <database name>.)
//
// Tip: restore into a NEW database name first (e.g. plotpost_restore),
// check it, and only then point MONGODB_URI at it.
require("dotenv").config({ quiet: true });
const dns = require("dns");
const path = require("path");
const readline = require("readline/promises");
const mongoose = require("mongoose");
const { restoreDatabase, readManifest, hidePassword } = require("../utils/dbBackup");
const { describeMongoUri } = require("../config/startupReport");

const argValue = (args, name) => {
  const at = args.indexOf(name);
  return at >= 0 ? args[at + 1] : undefined;
};

const run = async () => {
  const args = process.argv.slice(2);
  const valueFlags = new Set(["--uri", "--confirm"]);
  const folderArg = args.find((arg, i) => !arg.startsWith("--") && !valueFlags.has(args[i - 1]));
  const uri = argValue(args, "--uri");
  const replace = args.includes("--replace");
  if (!folderArg || !uri) {
    console.error('Usage: npm run restore -- <backup folder> --uri "mongodb+srv://…/<database>?…" [--replace]');
    process.exit(1);
  }
  const folder = path.resolve(folderArg);
  const { database, host } = describeMongoUri(uri);
  if (!database) {
    console.error("The --uri address has no database name (…mongodb.net/plotpost_restore?…).");
    process.exit(1);
  }

  const manifest = readManifest(folder);
  const total = Object.values(manifest.collections).reduce((a, b) => a + b, 0);
  console.log(`Backup:  ${folder}`);
  console.log(`         made ${manifest.createdAt} from database "${manifest.database}", ${total} documents`);
  console.log(`Target:  database "${database}" on ${host}  (${hidePassword(uri)})`);
  console.log(
    replace
      ? "Mode:    --replace: those collections are EMPTIED first, then filled from the backup."
      : "Mode:    only into empty collections (stops if any have data)."
  );

  let typed = argValue(args, "--confirm");
  if (typed === undefined) {
    const prompt = readline.createInterface({ input: process.stdin, output: process.stdout });
    typed = await prompt.question(`Type the database name (${database}) to continue: `);
    prompt.close();
  }
  if (String(typed).trim() !== database) {
    console.log("Stopped. Nothing was changed.");
    process.exit(1);
  }

  try {
    dns.setServers(["1.1.1.1", "8.8.8.8"]);
  } catch (error) {
    // ignore
  }

  const client = new mongoose.mongo.MongoClient(uri, { serverSelectionTimeoutMS: 10000 });
  try {
    await client.connect();
    const { restored } = await restoreDatabase(client.db(), folder, { replace });
    for (const [name, count] of Object.entries(restored)) console.log(`  ${name}: ${count}`);
    console.log("Restore finished. Start the server once so it rebuilds the indexes.");
  } finally {
    await client.close();
  }
};

run().catch((error) => {
  console.error(`Restore failed: ${error.message}`);
  process.exit(1);
});

// Puts a backup made by `npm run backup` back into a MySQL database.
//
//   npm run restore -- backups/2026-11-24_0230 --database plotpost_restore
//
// It uses the MySQL server, user and password from .env (MYSQL_HOST,
// MYSQL_USER, MYSQL_PASSWORD), but the database name must be given with
// --database every time (it's never taken from .env), so you can't restore
// into the wrong one by accident.
//
// Safety:
//   - Create the target database first (on Hostinger: hPanel → Databases;
//     the MySQL user needs access to it). Missing tables are created.
//   - It refuses if those tables already have rows. Add --replace to delete
//     what's in them first (only for a real emergency).
//   - Before changing anything it shows what it will do and asks you to type
//     the database name. (Or pass --confirm <database name>.)
//   - Everything happens in one transaction: if it fails, nothing changes.
//
// Tip: restore into a NEW database first (e.g. plotpost_restore), check it,
// and only then point MYSQL_DATABASE at it.
const path = require("path");
const readline = require("readline/promises");

const argValue = (args, name) => {
  const at = args.indexOf(name);
  return at >= 0 ? args[at + 1] : undefined;
};

const args = process.argv.slice(2);
const valueFlags = new Set(["--database", "--confirm"]);
const folderArg = args.find((arg, i) => !arg.startsWith("--") && !valueFlags.has(args[i - 1]));
const database = argValue(args, "--database");
const replace = args.includes("--replace");

if (!folderArg || !database) {
  console.error("Usage: npm run restore -- <backup folder> --database <database name> [--replace]");
  process.exit(1);
}
// Must be set before the database settings are read.
process.env.MYSQL_DATABASE = database;

const db = require("./scriptDb");
const { restoreDatabase, readManifest } = require("../utils/dbBackup");

const run = async () => {
  const folder = path.resolve(folderArg);
  const manifest = readManifest(folder);
  const total = Object.values(manifest.tables).reduce((a, b) => a + b, 0);
  console.log(`Backup:  ${folder}`);
  console.log(`         made ${manifest.createdAt} from database "${manifest.database}", ${total} rows`);
  console.log(`Target:  ${db.describe()}`);
  console.log(
    replace
      ? "Mode:    --replace: those tables are EMPTIED first, then filled from the backup."
      : "Mode:    only into empty tables (stops if any have rows)."
  );

  let typed = argValue(args, "--confirm");
  if (typed === undefined) {
    const prompt = readline.createInterface({ input: process.stdin, output: process.stdout });
    typed = await prompt.question(`Type the database name (${database}) to continue: `);
    prompt.close();
  }
  if (String(typed).trim() !== database) {
    console.log("Stopped. Nothing was changed.");
    process.exitCode = 1;
    return;
  }

  const sequelize = await db.open();
  // Create any missing tables from PlotPost's models (existing ones are left as they are).
  require("../models");
  await sequelize.sync();
  const { restored } = await restoreDatabase(sequelize, folder, { replace });
  for (const [name, count] of Object.entries(restored)) console.log(`  ${name}: ${count}`);
  console.log("Restore finished.");
};

run()
  .catch((error) => {
    console.error(`Restore failed: ${error.message}`);
    process.exitCode = 1;
  })
  .finally(() => db.close());

// Backs up the PlotPost MySQL database into backups/<date_time>/ (one
// compressed file per table), then deletes backups older than 30 days,
// because the privacy policy says backups are kept for 30 days at most.
//
//   npm run backup                                 the database in .env (MYSQL_*)
//   npm run backup -- --database plotpost_copy     a different database on the same server
//   npm run backup -- --out "D:\PlotPost backups"  a different folder
//
// Only reads from the database. The backups hold people's personal data:
// keep the folder private, and never upload it or put it in Git (backups/ is
// in .gitignore).
const path = require("path");

const argValue = (args, name) => {
  const at = args.indexOf(name);
  return at >= 0 ? args[at + 1] : undefined;
};

const args = process.argv.slice(2);
// Must be set before the database settings are read.
if (argValue(args, "--database")) process.env.MYSQL_DATABASE = argValue(args, "--database");

const db = require("./scriptDb");
const { backupDatabase, pruneOldBackups, KEEP_DAYS } = require("../utils/dbBackup");

const run = async () => {
  const root = path.resolve(argValue(args, "--out") || path.join(__dirname, "..", "backups"));

  console.log(`Backing up ${db.describe()}`);
  const sequelize = await db.open();
  const started = Date.now();
  const { folder, manifest } = await backupDatabase(sequelize, root);
  const total = Object.values(manifest.tables).reduce((a, b) => a + b, 0);
  console.log(
    `Done in ${((Date.now() - started) / 1000).toFixed(1)} s: ${total} rows from ${Object.keys(manifest.tables).length} tables.`
  );
  for (const [name, count] of Object.entries(manifest.tables)) console.log(`  ${name}: ${count}`);
  console.log(`Saved in ${folder}`);

  const removed = pruneOldBackups(root);
  if (removed.length) console.log(`Deleted ${removed.length} backup(s) older than ${KEEP_DAYS} days: ${removed.join(", ")}`);
};

run()
  .catch((error) => {
    console.error(`Backup failed: ${error.message}`);
    process.exitCode = 1;
  })
  .finally(() => db.close());

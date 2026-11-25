// Lists (and, with --apply, deletes) Cloudinary photos that no post or
// profile uses any more, e.g. photos uploaded for a post that was never
// published. Only PlotPost's own folders: plotpost/posts and plotpost/avatars.
//
//   node scripts/cleanupPhotos.js                     report only (changes nothing)
//   node scripts/cleanupPhotos.js --apply             delete what the report lists
//   node scripts/cleanupPhotos.js --days 7            only photos older than 7 days (default 2)
//   node scripts/cleanupPhotos.js --folder posts      only post photos (or: avatars)
//
// Uses MONGODB_URI and the CLOUDINARY_* settings from .env. Photos of removed
// posts are kept (they can be restored). Deleted photos can't be brought back.
require("dotenv").config();
const dns = require("dns");
const mongoose = require("mongoose");

const run = async () => {
  const args = process.argv.slice(2);
  const apply = args.includes("--apply");
  const force = args.includes("--force");
  const valueOf = (name) => {
    const index = args.indexOf(name);
    return index >= 0 ? args[index + 1] : undefined;
  };
  const days = Number(valueOf("--days") ?? 2);
  if (!Number.isFinite(days) || days < 1) {
    console.error("--days must be 1 or more.");
    process.exit(1);
  }
  const folderArg = valueOf("--folder") || "all";

  const { config } = require("../config/env");
  if (!process.env.MONGODB_URI) {
    console.error("MONGODB_URI is not set in .env");
    process.exit(1);
  }
  if (!config.cloudinary.configured) {
    console.error("Cloudinary is not set up in .env (CLOUDINARY_CLOUD_NAME, CLOUDINARY_API_KEY, CLOUDINARY_API_SECRET).");
    process.exit(1);
  }

  const cloudinary = require("../config/cloudinary");
  const Post = require("../models/Post");
  const User = require("../models/User");
  const { cloudinaryPublicId } = require("../controllers/postController");
  const { FOLDERS, listFolder, usedPhotoIds, findUnused, deletePhotos } = require("../services/photoCleanup");

  const folders = folderArg === "all" ? Object.keys(FOLDERS) : [folderArg];
  if (folders.some((name) => !FOLDERS[name])) {
    console.error('--folder must be "posts", "avatars" or left out for both.');
    process.exit(1);
  }

  // Same Windows DNS fix as server.js (mongodb+srv lookups).
  try {
    dns.setServers(["1.1.1.1", "8.8.8.8"]);
  } catch (error) {
    // ignore
  }
  await mongoose.connect(process.env.MONGODB_URI, { serverSelectionTimeoutMS: 10000 });

  console.log(`Database: ${mongoose.connection.name}. Cloudinary: ${config.cloudinary.cloudName}.`);
  const used = await usedPhotoIds({ Post, User, publicIdOf: cloudinaryPublicId });
  console.log(`Photos the database uses: ${used.size}`);

  let photos = [];
  for (const name of folders) {
    const list = await listFolder(cloudinary, FOLDERS[name]);
    console.log(`In ${FOLDERS[name]}: ${list.length}`);
    photos = photos.concat(list);
  }

  const unused = findUnused({ photos, used, olderThanDays: days });
  const megabytes = (unused.reduce((sum, photo) => sum + photo.bytes, 0) / 1024 / 1024).toFixed(1);
  console.log(`\nNot used by any post or profile, older than ${days} day(s): ${unused.length} (${megabytes} MB)`);
  for (const photo of unused.slice(0, 50)) console.log(`  ${photo.publicId}  (uploaded ${photo.createdAt})`);
  if (unused.length > 50) console.log(`  ... and ${unused.length - 50} more`);

  if (!apply) {
    console.log(unused.length ? "\nNothing was deleted. Run again with --apply to delete these." : "\nNothing to clean up.");
    return;
  }
  // Safety: the database has no photos but Cloudinary does. Probably the
  // wrong database in .env (deleting would wipe every photo).
  if (!used.size && photos.length && !force) {
    console.error("\nStopped: the database uses no photos at all, but Cloudinary has some.");
    console.error("Check MONGODB_URI points to the real database. (--force deletes anyway.)");
    process.exitCode = 1;
    return;
  }
  if (!unused.length) {
    console.log("\nNothing to delete.");
    return;
  }
  const { deleted, failed } = await deletePhotos(
    cloudinary,
    unused.map((photo) => photo.publicId)
  );
  console.log(`\nDeleted: ${deleted}. Failed: ${failed}.`);
  if (failed) process.exitCode = 1;
};

run()
  .catch((error) => {
    console.error("Clean-up failed:", error.message || error);
    process.exitCode = 1;
  })
  .finally(() => mongoose.disconnect());

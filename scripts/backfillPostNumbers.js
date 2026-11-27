// One-off: fills in the price, bedroom and size numbers (priceValue,
// bedroomsCount, areaValue) on older posts, so the price, bedrooms and size
// filters include them. Run it again after an update that adds a number.
//
// It only sets those three fields. Nothing else in any post is changed, and
// nothing is deleted. New and edited posts get the numbers automatically.
//
//   node scripts/backfillPostNumbers.js           report only, changes nothing
//   node scripts/backfillPostNumbers.js --apply   write the numbers
//
// Back up your database before using --apply.

const mongoose = require("mongoose");
const Post = require("../models/Post");
const { parsePrice, parseBedrooms, parseArea } = require("../utils/priceParser");

const BATCH_SIZE = 500;

// Works on the current mongoose connection. Returns a summary.
const backfillPostNumbers = async ({ apply = false, log = console.log } = {}) => {
  const summary = {
    checked: 0,
    toUpdate: 0,
    updated: 0,
    noPrice: 0,
    unclearPrices: [],
    noSize: 0,
    unclearSizes: [],
  };
  let batch = [];

  const flush = async () => {
    if (apply && batch.length) {
      // The raw collection, so updatedAt (shown as the post's date) stays as it was.
      const result = await Post.collection.bulkWrite(batch, { ordered: false });
      summary.updated += result.modifiedCount;
    }
    batch = [];
  };

  const cursor = Post.find({})
    .select("price bedrooms area priceValue bedroomsCount areaValue")
    .lean()
    .cursor();

  for await (const post of cursor) {
    summary.checked += 1;
    const priceValue = parsePrice(post.price);
    const bedroomsCount = parseBedrooms(post.bedrooms);
    const areaValue = parseArea(post.area);

    if (priceValue === null) {
      summary.noPrice += 1;
      if (post.price && summary.unclearPrices.length < 20) summary.unclearPrices.push(post.price);
    }

    if (areaValue === null) {
      summary.noSize += 1;
      if (post.area && summary.unclearSizes.length < 20) summary.unclearSizes.push(post.area);
    }

    if (
      post.priceValue === priceValue &&
      post.bedroomsCount === bedroomsCount &&
      post.areaValue === areaValue
    ) {
      continue;
    }

    summary.toUpdate += 1;
    batch.push({
      updateOne: {
        filter: { _id: post._id },
        update: { $set: { priceValue, bedroomsCount, areaValue } },
      },
    });
    if (batch.length >= BATCH_SIZE) await flush();
  }
  await flush();

  log(`Posts checked: ${summary.checked}`);
  log(`Posts that need the numbers: ${summary.toUpdate}`);
  log(`Posts with no clear price (left out of price filters): ${summary.noPrice}`);
  if (summary.unclearPrices.length) {
    log(`Some of those prices: ${summary.unclearPrices.map((p) => JSON.stringify(p)).join(", ")}`);
  }
  log(`Posts with no clear size (left out of size filters): ${summary.noSize}`);
  if (summary.unclearSizes.length) {
    log(`Some of those sizes: ${summary.unclearSizes.map((a) => JSON.stringify(a)).join(", ")}`);
  }
  log(
    apply
      ? `Done. Posts updated: ${summary.updated}`
      : "Nothing was changed. Back up your database, then run again with --apply."
  );
  return summary;
};

// Run from the command line with the backend's .env.
if (require.main === module) {
  require("dotenv").config();
  const apply = process.argv.includes("--apply");

  (async () => {
    if (!process.env.MONGODB_URI) {
      console.error("MONGODB_URI is not set in .env");
      process.exit(1);
    }
    await mongoose.connect(process.env.MONGODB_URI);
    console.log(apply ? "Writing the numbers..." : "Report only (no changes)...");
    await backfillPostNumbers({ apply });
    await mongoose.disconnect();
  })().catch(async (error) => {
    console.error("Backfill failed:", error.message);
    await mongoose.disconnect().catch(() => {});
    process.exit(1);
  });
}

module.exports = { backfillPostNumbers };

// One-off: fills in the price, bedroom and size numbers (priceValue,
// bedroomsCount, areaValue) on older posts, so the price, bedrooms and size
// filters include them. Run it again after an update that adds a number.
//
// It only sets those three fields. Nothing else in any post is changed (not
// even the post's date), and nothing is deleted. New and edited posts get the
// numbers automatically.
//
//   node scripts/backfillPostNumbers.js           report only, changes nothing
//   node scripts/backfillPostNumbers.js --apply   write the numbers
//
// Back up your database before using --apply (npm run backup).

const { Op } = require("sequelize");
const { Post } = require("../models");
const { parsePrice, parseBedrooms, parseArea } = require("../utils/priceParser");

const BATCH_SIZE = 500;

// The database may hand numbers back as strings; null stays null.
const same = (stored, wanted) =>
  (stored === null || stored === undefined) === (wanted === null || wanted === undefined) &&
  (wanted === null || wanted === undefined || Number(stored) === wanted);

// Works on the open database connection. Returns a summary.
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

  for (let lastId = 0; ; ) {
    const posts = await Post.findAll({
      attributes: ["id", "price", "bedrooms", "area", "priceValue", "bedroomsCount", "areaValue"],
      where: { id: { [Op.gt]: lastId } },
      order: [["id", "ASC"]],
      limit: BATCH_SIZE,
      raw: true,
    });

    for (const post of posts) {
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
        same(post.priceValue, priceValue) &&
        same(post.bedroomsCount, bedroomsCount) &&
        same(post.areaValue, areaValue)
      ) {
        continue;
      }

      summary.toUpdate += 1;
      if (apply) {
        // silent: keeps updatedAt (shown as the post's date) as it was.
        const [count] = await Post.update(
          { priceValue, bedroomsCount, areaValue },
          { where: { id: post.id }, silent: true, hooks: false }
        );
        summary.updated += count;
      }
    }

    if (posts.length < BATCH_SIZE) break;
    lastId = posts[posts.length - 1].id;
  }

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
  const db = require("./scriptDb");
  const apply = process.argv.includes("--apply");

  (async () => {
    await db.open();
    console.log(`Database: ${db.describe()}`);
    console.log(apply ? "Writing the numbers..." : "Report only (no changes)...");
    await backfillPostNumbers({ apply });
  })()
    .catch((error) => {
      console.error("Backfill failed:", error.message);
      process.exitCode = 1;
    })
    .finally(() => db.close());
}

module.exports = { backfillPostNumbers };

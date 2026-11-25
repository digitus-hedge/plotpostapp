// Listing expiry notices. Listings leave the feed by themselves when their
// expiresAt passes (the feed checks the date), so this check only tells the
// seller:
//   - 3 days before: "Your listing expires in 3 days. Renew it..."
//   - when it has expired: "Your listing has expired. Renew it..."
// Each is sent once per 90 days (Renew clears them). Runs every hour inside
// the server; nothing to set up. Set EXPIRY_CHECKS=false to turn it off.
const Post = require("../models/Post");
const notifications = require("./notificationService");
const { runRetentionCleanup } = require("./retentionService");

const DAY_MS = 24 * 60 * 60 * 1000;
const REMINDER_DAYS = 3;
const BATCH = 200; // per kind per run; the next run picks up the rest

// Only listings that are still the seller's to renew: active (not sold or
// rented), not removed by PlotPost, seller not banned.
const RENEWABLE = { status: { $nin: ["sold", "rented"] }, removedAt: null, sellerBanned: { $ne: true } };

// Marks one notice as sent, unless another run already did. True = ours to send.
const claim = async (postId, field, now) => {
  const result = await Post.updateOne(
    { _id: postId, [field]: null },
    { $set: { [field]: now } },
    { timestamps: false }
  );
  return result.modifiedCount === 1;
};

const runExpiryChecks = async (now = new Date()) => {
  const soon = new Date(now.getTime() + REMINDER_DAYS * DAY_MS);
  const fields = "_id user title expiresAt";

  const [expiring, expired] = await Promise.all([
    Post.find({ ...RENEWABLE, expiresAt: { $gt: now, $lte: soon }, expiryReminderAt: null })
      .select(fields)
      .limit(BATCH)
      .lean(),
    Post.find({ ...RENEWABLE, expiresAt: { $lte: now }, expiredNoticeAt: null })
      .select(fields)
      .limit(BATCH)
      .lean(),
  ]);

  let reminders = 0;
  for (const post of expiring) {
    if (!(await claim(post._id, "expiryReminderAt", now))) continue;
    const daysLeft = Math.max(1, Math.ceil((new Date(post.expiresAt) - now) / DAY_MS));
    await notifications.listingExpiry({ post, daysLeft });
    reminders += 1;
  }

  let expiredNotices = 0;
  for (const post of expired) {
    if (!(await claim(post._id, "expiredNoticeAt", now))) continue;
    // A listing that expired without a reminder (server was off) counts as reminded too.
    await Post.updateOne({ _id: post._id, expiryReminderAt: null }, { $set: { expiryReminderAt: now } }, { timestamps: false });
    await notifications.listingExpiry({ post, daysLeft: 0 });
    expiredNotices += 1;
  }

  return { reminders, expired: expiredNotices };
};

let timer = null;

// Called once after the database connects (server.js). First run after a
// minute, then every hour.
const startExpiryChecks = ({ everyMinutes = 60, firstAfterMs = 60 * 1000 } = {}) => {
  if (timer || process.env.EXPIRY_CHECKS === "false" || process.env.NODE_ENV === "test") return;
  const run = async () => {
    try {
      const result = await runExpiryChecks();
      if (result.reminders || result.expired) {
        console.log(`Listing expiry: ${result.reminders} reminder(s), ${result.expired} expired notice(s) sent.`);
      }
    } catch (error) {
      console.error("Listing expiry check failed:", error.message);
      require("./errorAlerts").report(error, { where: "listing expiry check" });
    }
    // Old closed reports and admin log rows (12 months; see the privacy policy).
    try {
      const removed = await runRetentionCleanup();
      if (removed.reports || removed.adminActions) {
        console.log(`Retention: ${removed.reports} old report(s), ${removed.adminActions} old admin log row(s) deleted.`);
      }
    } catch (error) {
      console.error("Retention cleanup failed:", error.message);
      require("./errorAlerts").report(error, { where: "12-month clean-up" });
    }
  };
  setTimeout(run, firstAfterMs).unref();
  timer = setInterval(run, everyMinutes * 60 * 1000);
  timer.unref();
};

module.exports = { runExpiryChecks, startExpiryChecks, REMINDER_DAYS };

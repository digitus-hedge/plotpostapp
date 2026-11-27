const { Op } = require("sequelize");
const { Post } = require("../models");
const notifications = require("./notificationService");
const { runRetentionCleanup } = require("./retentionService");

const DAY_MS = 24 * 60 * 60 * 1000;
const REMINDER_DAYS = 3;

const runExpiryChecks = async (now = new Date()) => {
  const soon = new Date(now.getTime() + REMINDER_DAYS * DAY_MS);

  const RENEWABLE = {
    status: { [Op.notIn]: ["sold", "rented"] },
    removedAt: null,
    sellerBanned: false,
  };

  const expiring = await Post.findAll({
    where: {
      ...RENEWABLE,
      expiresAt: { [Op.gt]: now, [Op.lte]: soon },
      expiryReminderAt: null,
    },
    limit: 200,
  });

  const expired = await Post.findAll({
    where: {
      ...RENEWABLE,
      expiresAt: { [Op.lte]: now },
      expiredNoticeAt: null,
    },
    limit: 200,
  });

  let reminders = 0;
  for (const post of expiring) {
    post.expiryReminderAt = now;
    await post.save();
    const daysLeft = Math.max(1, Math.ceil((new Date(post.expiresAt) - now) / DAY_MS));
    await notifications.listingExpiry({ post, daysLeft });
    reminders += 1;
  }

  let expiredNotices = 0;
  for (const post of expired) {
    post.expiredNoticeAt = now;
    if (!post.expiryReminderAt) post.expiryReminderAt = now;
    await post.save();
    await notifications.listingExpiry({ post, daysLeft: 0 });
    expiredNotices += 1;
  }

  return { reminders, expired: expiredNotices };
};

let timer = null;

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
    }
    try {
      const removed = await runRetentionCleanup();
      if (removed.reports || removed.adminActions) {
        console.log(`Retention: ${removed.reports} old report(s), ${removed.adminActions} old admin log row(s) deleted.`);
      }
    } catch (error) {
      console.error("Retention cleanup failed:", error.message);
    }
  };
  setTimeout(run, firstAfterMs).unref();
  timer = setInterval(run, everyMinutes * 60 * 1000);
  timer.unref();
};

module.exports = { runExpiryChecks, startExpiryChecks, REMINDER_DAYS };

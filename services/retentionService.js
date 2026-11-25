// How long PlotPost keeps safety records (matches the privacy policy):
//   - reports: 12 months after an admin closes them (open reports stay
//     until someone acts on them)
//   - the admin log (/admin → Log): 12 months after each action
// Runs with the hourly listing-expiry check (services/expiryService.js).
const Report = require("../models/Report");
const AdminAction = require("../models/AdminAction");

const RETENTION_MONTHS = 12;

const cutoffFrom = (now) => {
  const cutoff = new Date(now);
  cutoff.setMonth(cutoff.getMonth() - RETENTION_MONTHS);
  return cutoff;
};

const runRetentionCleanup = async (now = new Date()) => {
  const cutoff = cutoffFrom(now);
  const [reports, actions] = await Promise.all([
    Report.deleteMany({ status: "done", resolvedAt: { $ne: null, $lt: cutoff } }),
    AdminAction.deleteMany({ createdAt: { $lt: cutoff } }),
  ]);
  return { reports: reports.deletedCount || 0, adminActions: actions.deletedCount || 0 };
};

module.exports = { runRetentionCleanup, RETENTION_MONTHS };

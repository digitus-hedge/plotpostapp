// Lists reported posts, so you can review them.
//
//   node scripts/listReports.js                 open reports, most-reported post first
//   node scripts/listReports.js --all           also the ones marked done
//   node scripts/listReports.js --done <postId> mark every report on that post done
//   node scripts/listReports.js --done-report <reportId>  mark one comment/account report done
//
// Only --done changes anything (it sets status "done" on those reports).
// Posts are never hidden or deleted by this script.

const mongoose = require("mongoose");
const Report = require("../models/Report");
require("../models/Post");
require("../models/User");

// Works on the current mongoose connection. Returns the groups it printed.
const POST_REPORTS = { kind: { $in: ["post", null] } };

const listReports = async ({ all = false, log = console.log } = {}) => {
  const reports = await Report.find(all ? POST_REPORTS : { ...POST_REPORTS, status: "open" })
    .sort({ createdAt: -1 })
    .populate({ path: "post", select: "title location price user", populate: { path: "user", select: "name email phone" } })
    .populate("reporter", "name email")
    .lean();

  // One group per post.
  const groups = new Map();
  for (const report of reports) {
    const key = String(report.post?._id ?? "deleted");
    if (!groups.has(key)) groups.set(key, { post: report.post, postId: report.post?._id, reports: [] });
    groups.get(key).reports.push(report);
  }
  const sorted = [...groups.values()].sort((a, b) => b.reports.length - a.reports.length);

  await listPersonReports({ all, log });

  if (!sorted.length) {
    log(all ? "No post reports yet." : "No open post reports.");
    return sorted;
  }

  for (const { post, postId, reports: list } of sorted) {
    log("");
    log(post ? `POST ${postId}  "${post.title}"` : "POST (deleted since)");
    if (post) {
      log(`  ${post.location || "No location"} · ${post.price || "No price"}`);
      const seller = post.user;
      log(`  Seller: ${seller ? `${seller.name} <${seller.email}>${seller.phone ? ` ${seller.phone}` : ""}` : "(account deleted)"}`);
    }
    log(`  ${list.length} ${list.length === 1 ? "report" : "reports"}:`);
    for (const report of list) {
      const who = report.reporter ? `${report.reporter.name} <${report.reporter.email}>` : "(account deleted)";
      const when = new Date(report.updatedAt || report.createdAt).toISOString().slice(0, 16).replace("T", " ");
      log(`  - [${report.status}] ${report.reason} · by ${who} · ${when} UTC`);
      if (report.details) log(`      "${report.details}"`);
    }
  }
  log("");
  log(`${reports.length} ${reports.length === 1 ? "report" : "reports"} on ${sorted.length} ${sorted.length === 1 ? "post" : "posts"}.`);
  if (!all) log("Mark one done with: node scripts/listReports.js --done <postId>");
  return sorted;
};

// Reports about comments and accounts, newest first (printed before the posts).
const listPersonReports = async ({ all = false, log = console.log } = {}) => {
  const filter = { kind: { $in: ["comment", "user"] }, ...(all ? {} : { status: "open" }) };
  const reports = await Report.find(filter)
    .sort({ updatedAt: -1 })
    .populate("reportedUser", "name email phone")
    .populate("reporter", "name email")
    .populate("post", "title")
    .lean();
  if (!reports.length) return reports;
  log("");
  log(`COMMENTS AND ACCOUNTS (${reports.length})`);
  for (const report of reports) {
    const about = report.reportedUser
      ? `${report.reportedUser.name} <${report.reportedUser.email}>`
      : "(account deleted)";
    const who = report.reporter ? `${report.reporter.name} <${report.reporter.email}>` : "(account deleted)";
    const when = new Date(report.updatedAt || report.createdAt).toISOString().slice(0, 16).replace("T", " ");
    log(`- REPORT ${report._id} [${report.status}] ${report.kind === "comment" ? "Comment" : "Account"} by ${about}`);
    if (report.kind === "comment") {
      log(`    On "${report.post?.title ?? "(post deleted)"}": "${report.commentText}"`);
    }
    log(`    ${report.reason} · reported by ${who} · ${when} UTC`);
    if (report.details) log(`    "${report.details}"`);
  }
  return reports;
};

// Marks one comment or account report done. Returns how many changed (0 or 1).
const markReportDone = async (reportId, { log = console.log } = {}) => {
  if (!mongoose.Types.ObjectId.isValid(reportId)) {
    log("Please give a report ID, e.g. --done-report 665f1c2e9b1d4a0012345678");
    return 0;
  }
  const result = await Report.updateOne({ _id: reportId, status: "open" }, { $set: { status: "done" } });
  log(result.modifiedCount ? "Marked 1 report done." : "No open report with that ID.");
  return result.modifiedCount;
};

// Marks every report on one post done. Returns how many changed.
const markDone = async (postId, { log = console.log } = {}) => {
  if (!mongoose.Types.ObjectId.isValid(postId)) {
    log("Please give a post ID, e.g. --done 665f1c2e9b1d4a0012345678");
    return 0;
  }
  const result = await Report.updateMany(
    { ...POST_REPORTS, post: postId, status: "open" },
    { $set: { status: "done" } }
  );
  log(`Marked ${result.modifiedCount} ${result.modifiedCount === 1 ? "report" : "reports"} done.`);
  return result.modifiedCount;
};

// Run from the command line with the backend's .env.
if (require.main === module) {
  require("dotenv").config();
  const args = process.argv.slice(2);
  const doneIndex = args.indexOf("--done");
  const doneReportIndex = args.indexOf("--done-report");

  (async () => {
    if (!process.env.MONGODB_URI) {
      console.error("MONGODB_URI is not set in .env");
      process.exit(1);
    }
    await mongoose.connect(process.env.MONGODB_URI);
    if (doneReportIndex !== -1) {
      await markReportDone(args[doneReportIndex + 1]);
    } else if (doneIndex !== -1) {
      await markDone(args[doneIndex + 1]);
    } else {
      await listReports({ all: args.includes("--all") });
    }
    await mongoose.disconnect();
  })().catch(async (error) => {
    console.error("Failed:", error.message);
    await mongoose.disconnect().catch(() => {});
    process.exit(1);
  });
}

module.exports = { listReports, listPersonReports, markDone, markReportDone };

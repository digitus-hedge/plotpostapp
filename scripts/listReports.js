// Lists reported posts, comments and accounts, so you can review them.
// (The admin panel at /admin does the same with buttons; this is for the
// command line.)
//
//   node scripts/listReports.js                 open reports, most-reported post first
//   node scripts/listReports.js --all           also the ones marked done
//   node scripts/listReports.js --done <postId> mark every report on that post done
//   node scripts/listReports.js --done-report <reportId>  mark one comment/account report done
//
// Only --done and --done-report change anything (they set status "done" on
// those reports). Posts are never hidden or deleted by this script.

const { Op } = require("sequelize");
const { Report, Post, User } = require("../models");

const POST_REPORTS = { [Op.or]: [{ kind: "post" }, { kind: null }] };
const PERSON = ["id", "name", "email", "phone"];

const stamp = (date) => new Date(date).toISOString().slice(0, 16).replace("T", " ");
const whoIs = (user) => (user ? `${user.name} <${user.email}>` : "(account deleted)");
const isId = (value) => /^\d+$/.test(String(value ?? ""));

// Reports about posts, one group per post, most-reported first.
// Returns the groups it printed.
const listReports = async ({ all = false, log = console.log } = {}) => {
  const reports = await Report.findAll({
    where: all ? POST_REPORTS : { ...POST_REPORTS, status: "open" },
    order: [["createdAt", "DESC"]],
    include: [
      {
        model: Post,
        as: "postItem",
        attributes: ["id", "title", "location", "price", "userId"],
        include: [{ model: User, as: "user", attributes: PERSON }],
      },
      { model: User, as: "reporterUser", attributes: PERSON },
    ],
  });

  const groups = new Map();
  for (const report of reports) {
    const post = report.postItem;
    const key = post ? String(post.id) : `deleted-${report.post ?? "?"}`;
    if (!groups.has(key)) groups.set(key, { post, postId: post?.id ?? report.post, reports: [] });
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
    log(post ? `POST ${postId}  "${post.title}"` : `POST ${postId ?? ""} (deleted since)`);
    if (post) {
      log(`  ${post.location || "No location"} · ${post.price || "No price"}`);
      const seller = post.user;
      log(`  Seller: ${seller ? `${whoIs(seller)}${seller.phone ? ` ${seller.phone}` : ""}` : "(account deleted)"}`);
    }
    log(`  ${list.length} ${list.length === 1 ? "report" : "reports"}:`);
    for (const report of list) {
      log(`  - [${report.status}] ${report.reason} · by ${whoIs(report.reporterUser)} · ${stamp(report.updatedAt || report.createdAt)} UTC`);
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
  const reports = await Report.findAll({
    where: { kind: { [Op.in]: ["comment", "user"] }, ...(all ? {} : { status: "open" }) },
    order: [["updatedAt", "DESC"]],
    include: [
      { model: User, as: "targetUser", attributes: PERSON },
      { model: User, as: "reporterUser", attributes: PERSON },
      { model: Post, as: "postItem", attributes: ["id", "title"] },
    ],
  });
  if (!reports.length) return reports;
  log("");
  log(`COMMENTS AND ACCOUNTS (${reports.length})`);
  for (const report of reports) {
    log(`- REPORT ${report.id} [${report.status}] ${report.kind === "comment" ? "Comment" : "Account"} by ${whoIs(report.targetUser)}`);
    if (report.kind === "comment") {
      log(`    On "${report.postItem?.title ?? "(post deleted)"}": "${report.commentText}"`);
    }
    log(`    ${report.reason} · reported by ${whoIs(report.reporterUser)} · ${stamp(report.updatedAt || report.createdAt)} UTC`);
    if (report.details) log(`    "${report.details}"`);
  }
  return reports;
};

const closed = () => ({ status: "done", resolvedAt: new Date(), resolution: "dismissed" });

// Marks one comment or account report done. Returns how many changed (0 or 1).
const markReportDone = async (reportId, { log = console.log } = {}) => {
  if (!isId(reportId)) {
    log("Please give a report ID (a number), e.g. --done-report 42");
    return 0;
  }
  const [count] = await Report.update(closed(), { where: { id: Number(reportId), status: "open" } });
  log(count ? "Marked 1 report done." : "No open report with that ID.");
  return count;
};

// Marks every report on one post done. Returns how many changed.
const markDone = async (postId, { log = console.log } = {}) => {
  if (!isId(postId)) {
    log("Please give a post ID (a number), e.g. --done 17");
    return 0;
  }
  const [count] = await Report.update(closed(), {
    where: { ...POST_REPORTS, post: Number(postId), status: "open" },
  });
  log(`Marked ${count} ${count === 1 ? "report" : "reports"} done.`);
  return count;
};

// Run from the command line with the backend's .env.
if (require.main === module) {
  const db = require("./scriptDb");
  const args = process.argv.slice(2);
  const doneIndex = args.indexOf("--done");
  const doneReportIndex = args.indexOf("--done-report");

  (async () => {
    await db.open();
    if (doneReportIndex !== -1) {
      await markReportDone(args[doneReportIndex + 1]);
    } else if (doneIndex !== -1) {
      await markDone(args[doneIndex + 1]);
    } else {
      await listReports({ all: args.includes("--all") });
    }
  })()
    .catch((error) => {
      console.error("Failed:", error.message);
      process.exitCode = 1;
    })
    .finally(() => db.close());
}

module.exports = { listReports, listPersonReports, markDone, markReportDone };

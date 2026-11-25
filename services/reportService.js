const Report = require("../models/Report");
const Post = require("../models/Post");
const User = require("../models/User");
const emailService = require("./emailService");

// Emails the admins (and REPORT_ALERT_EMAILS, comma separated) about a new
// report. Never fails the report itself.
const alertAdmins = async (kind, target, reason, details) => {
  try {
    const admins = await User.find({ role: "admin", bannedAt: null }).select("email").lean();
    const extra = String(process.env.REPORT_ALERT_EMAILS || "")
      .split(",")
      .map((email) => email.trim())
      .filter(Boolean);
    const to = [...new Set([...admins.map((admin) => admin.email), ...extra])].filter(Boolean);
    if (!to.length) return;
    const post = target.post ? await Post.findById(target.post).select("title").lean() : null;
    emailService.sendReportAlert(to, {
      kind,
      reason,
      details,
      about: post?.title || "",
      commentText: target.commentText || "",
    });
  } catch (error) {
    console.error("Report alert error:", error?.message || error);
  }
};

// Saves one person's report about one item (a post, a comment or an account),
// or updates their earlier report about the same item and opens it again.
//
//   kind     "post" | "comment" | "user"
//   target   { post, comment, reportedUser, commentText }
//   report   { reporter, reason, details }
//
// Returns { updated } (true when it replaced an earlier report).
const saveReport = async (kind, target, { reporter, reason, details = "" }) => {
  const key = Report.keyFor(kind, { reporter, ...target });
  const set = {
    reason,
    details,
    status: "open",
    reportedUser: target.reportedUser ?? null,
    // Reporting again opens it again.
    resolvedAt: null,
    resolvedBy: null,
    resolution: "",
  };
  if (target.commentText !== undefined) set.commentText = String(target.commentText).slice(0, 1000);
  const update = { $set: set };

  const existed = Boolean(await Report.exists(key));
  try {
    await Report.updateOne(key, update, { upsert: true });
  } catch (error) {
    // Two taps at once: the other one created it, so just update it.
    if (error?.code !== 11000) throw error;
    const result = await Report.updateOne(key, update);
    if (!result.matchedCount) throw error;
  }
  // New reports (not updates of an earlier one) are emailed to the admins.
  if (!existed) await alertAdmins(kind, target, reason, details);
  return { updated: existed };
};

module.exports = { saveReport };

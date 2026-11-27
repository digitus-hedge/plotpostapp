const { Report, Post, User } = require("../models");
const emailService = require("./emailService");

const alertAdmins = async (kind, target, reason, details) => {
  try {
    const admins = await User.findAll({ where: { role: "admin", bannedAt: null }, attributes: ["email"] });
    const extra = String(process.env.REPORT_ALERT_EMAILS || "")
      .split(",")
      .map((email) => email.trim())
      .filter(Boolean);
    const to = [...new Set([...admins.map((admin) => admin.email), ...extra])].filter(Boolean);
    if (!to.length) return;
    const post = target.post ? await Post.findByPk(target.post) : null;
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

const saveReport = async (kind, target, { reporter, reason, details = "" }) => {
  let report = await Report.findOne({
    where: {
      kind,
      reporter,
      post: target.post || null,
      comment: target.comment || null,
      reportedUser: target.reportedUser || null,
    },
  });

  const existed = Boolean(report);

  if (report) {
    await report.update({
      reason,
      details,
      status: "open",
      commentText: target.commentText || "",
      resolvedAt: null,
      resolvedBy: null,
      resolution: "",
    });
  } else {
    report = await Report.create({
      kind,
      reporter,
      post: target.post || null,
      comment: target.comment || null,
      reportedUser: target.reportedUser || null,
      commentText: target.commentText || "",
      reason,
      details,
      status: "open",
    });
  }

  if (!existed) await alertAdmins(kind, target, reason, details);
  return { updated: existed };
};

module.exports = { saveReport };

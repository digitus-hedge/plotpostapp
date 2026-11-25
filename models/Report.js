const mongoose = require("mongoose");

// The reasons on the Report Post sheet, word for word.
const REPORT_REASONS = [
  "Fake or misleading listing",
  "Spam, scam, or fraud",
  "Incorrect price or location",
  "Property already sold or rented",
  "Inappropriate content",
  "Other reason",
];

// Reasons for reporting a comment or a person (Report sheets in comments and
// chats, and on the seller card).
const PERSON_REPORT_REASONS = [
  "Spam or scam",
  "Harassment or bullying",
  "Hate speech or offensive language",
  "Sexual or inappropriate content",
  "Pretending to be someone else",
  "Other reason",
];

const REPORT_KINDS = ["post", "comment", "user"];

// What was reported:
//   kind "post"     post = the listing
//   kind "comment"  post = the listing, comment = the comment's id
//   kind "user"     reportedUser = the person
// reportedUser is also filled for posts and comments (who wrote it), so the
// admin panel can see everything reported about one person.
//
// One report per person per item. Reporting the same thing again updates the
// reason and details and opens it again.
const reportSchema = new mongoose.Schema(
  {
    kind: { type: String, enum: REPORT_KINDS, default: "post" },
    post: { type: mongoose.Schema.Types.ObjectId, ref: "Post", default: null },
    comment: { type: mongoose.Schema.Types.ObjectId, default: null },
    reportedUser: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
    // A copy of the comment's text when it was reported (it may be edited or
    // deleted later).
    commentText: { type: String, default: "" },
    reporter: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
    reason: {
      type: String,
      enum: [...new Set([...REPORT_REASONS, ...PERSON_REPORT_REASONS])],
      required: true,
    },
    details: { type: String, trim: true, maxlength: 500, default: "" },
    // "done" once you've looked at it.
    status: { type: String, enum: ["open", "done"], default: "open" },
    // Set when an admin closes it in the admin panel.
    resolvedAt: { type: Date, default: null },
    resolvedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
    // dismissed | removed_post | removed_comment | banned_user
    resolution: { type: String, default: "" },
  },
  { timestamps: true }
);

reportSchema.index(
  { reporter: 1, kind: 1, post: 1, comment: 1, reportedUser: 1 },
  { unique: true, name: "one_report_per_item" }
);
reportSchema.index({ status: 1, createdAt: -1 });
// The admin queue (open reports, oldest first) and the 12-month clean-up.
reportSchema.index({ status: 1, updatedAt: 1 });
reportSchema.index({ status: 1, resolvedAt: 1 });
reportSchema.index({ reportedUser: 1, status: 1 });

// The filter that finds "this person's report about this item".
reportSchema.statics.keyFor = (kind, { reporter, post = null, comment = null, reportedUser = null }) => {
  if (kind === "post") return { reporter, kind, post };
  if (kind === "comment") return { reporter, kind, post, comment };
  return { reporter, kind, reportedUser };
};

// Reports made before comments and people could be reported: give them their
// kind, and drop the old "one report per post per person" index, which would
// stop someone reporting a comment on a post they also reported. Runs once
// at server start; safe to run again.
reportSchema.statics.upgradeOldReports = async function upgradeOldReports() {
  await this.updateMany({ kind: { $exists: false } }, { $set: { kind: "post" } });
  try {
    await this.collection.dropIndex("post_1_reporter_1");
  } catch (error) {
    const missing = error?.codeName === "IndexNotFound" || error?.code === 27 || error?.codeName === "NamespaceNotFound" || error?.code === 26;
    if (!missing) throw error;
  }
};

module.exports = mongoose.model("Report", reportSchema);
module.exports.REPORT_REASONS = REPORT_REASONS;
module.exports.PERSON_REPORT_REASONS = PERSON_REPORT_REASONS;
module.exports.REPORT_KINDS = REPORT_KINDS;

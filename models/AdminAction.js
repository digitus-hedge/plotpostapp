const mongoose = require("mongoose");

// The audit log: every action taken in the admin panel, who did it, when and
// why. Never edited; deleted 12 months after the action
// (services/retentionService.js, as the privacy policy says).
const ADMIN_ACTIONS = [
  "remove_post",
  "restore_post",
  "remove_comment",
  "ban_user",
  "unban_user",
  "dismiss_reports",
];

const { ObjectId } = mongoose.Schema.Types;

const adminActionSchema = new mongoose.Schema(
  {
    admin: { type: ObjectId, ref: "User", required: true },
    // A copy of the admin's name, in case their account is deleted later.
    adminName: { type: String, default: "" },
    action: { type: String, enum: ADMIN_ACTIONS, required: true },
    post: { type: ObjectId, ref: "Post", default: null },
    comment: { type: ObjectId, default: null },
    user: { type: ObjectId, ref: "User", default: null },
    // What it was about, readable even after the post or account is gone,
    // e.g. 'Listing "Villa in Nadakkavu" by Ravi' or a comment's text.
    summary: { type: String, default: "" },
    reason: { type: String, trim: true, maxlength: 500, default: "" },
    // How many open reports this closed.
    reportsClosed: { type: Number, default: 0 },
  },
  { timestamps: true }
);

adminActionSchema.index({ createdAt: -1 });
adminActionSchema.index({ user: 1, createdAt: -1 });

module.exports = mongoose.model("AdminAction", adminActionSchema);
module.exports.ADMIN_ACTIONS = ADMIN_ACTIONS;

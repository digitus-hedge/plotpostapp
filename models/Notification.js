const mongoose = require("mongoose");

// One row in someone's Notifications list. Similar events are grouped into
// one row: all likes on a post ("Anu and 3 others liked…"), all comments on
// a post. Each follower and each buyer inquiry has its own row. groupKey
// says which row an event belongs to, e.g. "like:<postId>",
// "comment:<postId>", "follow:<userId>", "enquiry:<enquiryId>".
// Chat messages are not listed here (Messages has its own list); they only
// send a phone alert.
// "moderation": PlotPost removed your listing or comment (with the reason).
// "listing": your listing expires in 3 days, or has expired (renew it).
const NOTIFICATION_TYPES = ["enquiry", "comment", "like", "follow", "moderation", "listing"];

const { ObjectId } = mongoose.Schema.Types;

const notificationSchema = new mongoose.Schema(
  {
    recipient: { type: ObjectId, ref: "User", required: true },
    type: { type: String, enum: NOTIFICATION_TYPES, required: true },
    groupKey: { type: String, required: true },
    // Newest first; up to 3 people, shown by name and photo.
    actors: [{ type: ObjectId, ref: "User" }],
    // How many different people are in the group.
    count: { type: Number, default: 1 },
    post: { type: ObjectId, ref: "Post", default: null },
    enquiry: { type: ObjectId, ref: "Enquiry", default: null },
    // Inquiries: the name the buyer typed (guests have no account).
    actorName: { type: String, default: "" },
    // Short text: the latest comment, or the inquiry message.
    preview: { type: String, default: "" },
    commentId: { type: ObjectId, default: null },
    // When something last happened in this group. The list is newest first,
    // and anything after your last visit counts as new.
    lastAt: { type: Date, default: Date.now },
  },
  { timestamps: true }
);

notificationSchema.index({ recipient: 1, groupKey: 1 }, { unique: true });
notificationSchema.index({ recipient: 1, lastAt: -1 });
notificationSchema.index({ post: 1 });

// Old notifications are deleted 90 days after the last activity. (Some test
// databases can't do this, so tests can switch it off.)
if (process.env.DB_TTL_INDEXES !== "false") {
  notificationSchema.index({ lastAt: 1 }, { expireAfterSeconds: 90 * 24 * 60 * 60 });
}

const Notification = mongoose.model("Notification", notificationSchema);
Notification.NOTIFICATION_TYPES = NOTIFICATION_TYPES;

module.exports = Notification;

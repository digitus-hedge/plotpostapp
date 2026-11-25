const mongoose = require("mongoose");

const enquirySchema = new mongoose.Schema(
  {
    // The buyer's account (empty for guests).
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
    },
    // The seller's account: the post's owner, set by the server. Older
    // enquiries don't have it; they're matched through their post.
    sellerUser: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
    },
    post: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Post",
    },
    postTitle: {
      type: String,
      required: true,
      trim: true,
    },
    seller: {
      type: String,
      default: "",
      trim: true,
    },
    name: {
      type: String,
      required: true,
      trim: true,
    },
    phone: {
      type: String,
      required: true,
      trim: true,
    },
    email: {
      type: String,
      default: "",
      trim: true,
    },
    message: {
      type: String,
      default: "",
    },
    contactMethod: {
      type: String,
      enum: ["Phone call", "WhatsApp", "Email"],
      default: "Phone call",
    },
    wantsVisit: {
      type: Boolean,
      default: false,
    },
    status: {
      type: String,
      enum: ["Pending", "Contacted", "Closed"],
      default: "Pending",
    },
    // When the seller first opened it (empty = unread).
    readAt: {
      type: Date,
      default: null,
    },
    // When the buyer last sent it (a repeat from the same person updates the
    // same enquiry). Buyer Inquiries are sorted by this.
    lastMessageAt: {
      type: Date,
      default: Date.now,
    },
  },
  {
    timestamps: true,
  }
);

enquirySchema.index({ sellerUser: 1, lastMessageAt: -1 });
enquirySchema.index({ post: 1, user: 1 });
enquirySchema.index({ user: 1, lastMessageAt: -1 });

module.exports = mongoose.model("Enquiry", enquirySchema);
module.exports.CONTACT_METHODS = ["Phone call", "WhatsApp", "Email"];
module.exports.ENQUIRY_STATUSES = ["Pending", "Contacted", "Closed"];

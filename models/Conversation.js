const mongoose = require("mongoose");

// One chat between two people (like WhatsApp: one per pair, whatever post it's
// about). Per-person values are kept under each person's user ID:
//   unread.<userId>   how many messages they haven't read
//   readAt.<userId>   when they last read the chat (for "Seen")
//   hiddenAt.<userId> when they deleted the chat for themselves; they only see
//                     messages after this, and it comes back with a new message
const conversationSchema = new mongoose.Schema(
  {
    participants: [{ type: mongoose.Schema.Types.ObjectId, ref: "User", required: true }],
    // "<smaller id>:<larger id>", so each pair has exactly one chat.
    pairKey: { type: String, required: true, unique: true },
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
    // The property the chat is (most recently) about.
    post: { type: mongoose.Schema.Types.ObjectId, ref: "Post", default: null },
    lastMessage: {
      text: { type: String, default: "" },
      sender: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
      sentAt: { type: Date, default: null },
    },
    lastMessageAt: { type: Date, default: Date.now },
    unread: { type: mongoose.Schema.Types.Mixed, default: {} },
    readAt: { type: mongoose.Schema.Types.Mixed, default: {} },
    hiddenAt: { type: mongoose.Schema.Types.Mixed, default: {} },
  },
  { timestamps: true, minimize: false }
);

conversationSchema.index({ participants: 1, lastMessageAt: -1 });
conversationSchema.index({ createdBy: 1, createdAt: -1 });

conversationSchema.statics.pairKeyFor = (a, b) => [String(a), String(b)].sort().join(":");

module.exports = mongoose.model("Conversation", conversationSchema);

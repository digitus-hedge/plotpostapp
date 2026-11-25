const mongoose = require("mongoose");

// One chat message. `post` is set when the message is about a property (the
// app shows it as a small post card).
const messageSchema = new mongoose.Schema(
  {
    conversation: { type: mongoose.Schema.Types.ObjectId, ref: "Conversation", required: true },
    sender: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
    text: { type: String, required: true, trim: true, maxlength: 2000 },
    post: { type: mongoose.Schema.Types.ObjectId, ref: "Post", default: null },
  },
  { timestamps: true }
);

// Paging goes by _id (newer messages have larger IDs).
messageSchema.index({ conversation: 1, _id: -1 });

module.exports = mongoose.model("Message", messageSchema);

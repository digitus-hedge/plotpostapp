const mongoose = require("mongoose");

// Remembers that someone opened a post (or tapped Call / Open link) on a
// given day, so repeat opens on the same day aren't counted again.
// viewer is "user:<account id>" for logged-in people, or "ip:<hash>" for
// guests (the internet address is stored only as a one-way hash).
const postViewSchema = new mongoose.Schema(
  {
    post: { type: mongoose.Schema.Types.ObjectId, ref: "Post", required: true },
    viewer: { type: String, required: true },
    kind: { type: String, enum: ["view", "call", "link", "share"], required: true },
    // Calendar day in India time, e.g. "2026-11-21".
    day: { type: String, required: true },
  },
  { timestamps: true }
);

// One row per person, post, kind and day: a second open the same day is refused.
postViewSchema.index({ post: 1, viewer: 1, kind: 1, day: 1 }, { unique: true });

// Rows are only needed for the day they're about; MongoDB deletes them after
// two days. (Some test databases can't do this, so tests can switch it off.)
if (process.env.DB_TTL_INDEXES !== "false") {
  postViewSchema.index({ createdAt: 1 }, { expireAfterSeconds: 2 * 24 * 60 * 60 });
}

module.exports = mongoose.model("PostView", postViewSchema);

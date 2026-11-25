const mongoose = require("mongoose");

// One row per "A follows B". The unique index makes it impossible to follow
// the same seller twice, even with two quick taps.
const followSchema = new mongoose.Schema(
  {
    follower: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    following: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
  },
  { timestamps: true }
);

followSchema.index({ follower: 1, following: 1 }, { unique: true });
// Counting a seller's followers.
followSchema.index({ following: 1 });

module.exports = mongoose.model("Follow", followSchema);

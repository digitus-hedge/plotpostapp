const mongoose = require("mongoose");
const { config } = require("../config/env");

// One row per logged-in device. The app holds the raw token; only its
// SHA-256 hash is stored, so a database leak can't be used to log in.
const refreshTokenSchema = new mongoose.Schema(
  {
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },
    tokenHash: { type: String, required: true, unique: true },
    expiresAt: { type: Date, required: true },
    revokedAt: { type: Date, default: null },
    // Set when this token was exchanged for a new one (rotation).
    replacedByHash: { type: String, default: null },
    userAgent: { type: String, default: "" },
    ip: { type: String, default: "" },
  },
  { timestamps: true }
);

// MongoDB deletes expired rows automatically. Lookups also check expiresAt,
// so security does not depend on this cleanup running on time.
if (config.dbTtlIndexes) {
  refreshTokenSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });
}

module.exports = mongoose.model("RefreshToken", refreshTokenSchema);

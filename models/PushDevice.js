const mongoose = require("mongoose");

// A phone that gets PlotPost alerts for an account. The token comes from
// Firebase on the phone; the server only ever sends it to Firebase and never
// shows it to anyone. One phone belongs to one account at a time: logging in
// with another account on the same phone moves it.
const PUSH_PLATFORMS = ["android", "ios", "web"];

const pushDeviceSchema = new mongoose.Schema(
  {
    token: { type: String, required: true },
    user: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
    platform: { type: String, enum: PUSH_PLATFORMS, default: "android" },
    // Updated each time the app opens while logged in.
    lastSeenAt: { type: Date, default: Date.now },
  },
  { timestamps: true }
);

pushDeviceSchema.index({ token: 1 }, { unique: true });
pushDeviceSchema.index({ user: 1, lastSeenAt: -1 });

// Firebase stops accepting tokens from apps not opened for about 270 days,
// so those rows are deleted then. (Tests can switch this off.)
if (process.env.DB_TTL_INDEXES !== "false") {
  pushDeviceSchema.index({ lastSeenAt: 1 }, { expireAfterSeconds: 270 * 24 * 60 * 60 });
}

const PushDevice = mongoose.model("PushDevice", pushDeviceSchema);
PushDevice.PUSH_PLATFORMS = PUSH_PLATFORMS;

module.exports = PushDevice;

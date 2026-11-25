const mongoose = require("mongoose");

const userSchema = new mongoose.Schema(
  {
    name: {
      type: String,
      required: [true, "Name is required"],
      trim: true,
    },
    email: {
      type: String,
      required: [true, "Email is required"],
      unique: true,
      lowercase: true,
      trim: true,
    },
    // Accounts created with "Continue with Google" have no password until
    // they set one with Forgot Password.
    password: {
      type: String,
      required: [
        function passwordRequired() {
          return !this.googleId;
        },
        "Password is required",
      ],
      minlength: 6,
    },
    // Google account ID, set when the user signs in with Google.
    googleId: {
      type: String,
    },
    // Forgot Password: a hash of the emailed 6-digit code (never the code
    // itself). Not returned by queries unless asked for.
    passwordReset: {
      type: new mongoose.Schema(
        {
          codeHash: { type: String, required: true },
          expiresAt: { type: Date, required: true },
          attempts: { type: Number, default: 0 },
          sentAt: { type: Date, default: Date.now },
        },
        { _id: false }
      ),
      select: false,
    },
    // Email verification: the same kind of code, sent at sign-up and on
    // "Send a new code". Not returned by queries unless asked for.
    emailVerification: {
      type: new mongoose.Schema(
        {
          codeHash: { type: String, required: true },
          expiresAt: { type: Date, required: true },
          attempts: { type: Number, default: 0 },
          sentAt: { type: Date, default: Date.now },
        },
        { _id: false }
      ),
      select: false,
    },
    // Deleting the account from the website (/delete-account): the same kind
    // of code, emailed to prove the request comes from the account's owner.
    accountDeletion: {
      type: new mongoose.Schema(
        {
          codeHash: { type: String, required: true },
          expiresAt: { type: Date, required: true },
          attempts: { type: Number, default: 0 },
          sentAt: { type: Date, default: Date.now },
        },
        { _id: false }
      ),
      select: false,
    },
    // When the email was confirmed (code, Google, or password reset). Null:
    // not yet. Accounts made before verification existed count as verified.
    emailVerifiedAt: { type: Date, default: null },
    phone: {
      type: String,
      default: "",
      trim: true,
    },
    profileImage: {
      type: String,
      default: "",
    },
    bio: {
      type: String,
      default: "",
    },
    // Shown on your profile. "profession" is the Role field (free text, e.g.
    // "Owner" or "Real estate agent"); nothing is marked verified.
    agency: { type: String, default: "", trim: true },
    profession: { type: String, default: "", trim: true },
    location: { type: String, default: "", trim: true },
    // Account Settings. pushNotifications: phone alerts (inquiries,
    // messages, comments). emailInquiries: an email copy of each buyer inquiry.
    settings: {
      pushNotifications: { type: Boolean, default: true },
      emailInquiries: { type: Boolean, default: true },
    },
    // Logins carry this number. Changing or resetting the password, or "Log
    // out of all devices", raises it, so older logins stop working.
    tokenVersion: { type: Number, default: 0 },
    // People you blocked: neither of you can message the other, and they
    // don't appear in your notifications.
    blockedUsers: [{ type: mongoose.Schema.Types.ObjectId, ref: "User" }],
    // "admin" can use the admin panel (/admin). Set with
    // `node scripts/make-admin.js <email>`.
    role: { type: String, enum: ["user", "admin"], default: "user" },
    // Suspended by an admin: can't log in, existing logins end, their posts
    // and comments are hidden. Cleared by Unban.
    bannedAt: { type: Date, default: null },
    banReason: { type: String, trim: true, default: "" },
    bannedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
    // When the user agreed to the Terms of Use (sign-up checkbox, or the
    // "Agree and continue" screen for Google and older accounts). The app
    // asks before anything can be posted while this is empty.
    termsAcceptedAt: { type: Date, default: null },
    // Notifications screen: anything newer than this is new (the number on
    // the bell). Set when you open the screen.
    notificationsSeenAt: { type: Date, default: null },
    savedPosts: [
      {
        type: mongoose.Schema.Types.ObjectId,
        ref: "Post",
      },
    ],
  },
  {
    timestamps: true,
  }
);

// One Google account can belong to only one PlotPost account.
userSchema.index({ googleId: 1 }, { unique: true, sparse: true });
// Admin panel: the people list (newest first) and the Banned count.
userSchema.index({ createdAt: -1, _id: -1 });
userSchema.index({ bannedAt: 1 });

// Accounts made before email verification existed count as verified, so
// nobody already using the app gets locked out. Safe to run on every start;
// uses the raw collection so "last updated" times stay as they were.
userSchema.statics.upgradeOldUsers = async function upgradeOldUsers() {
  const result = await this.collection.updateMany(
    { emailVerifiedAt: { $exists: false } },
    { $set: { emailVerifiedAt: new Date() } }
  );
  return result.modifiedCount || 0;
};

module.exports = mongoose.model("User", userSchema);

const bcrypt = require("bcryptjs");
const User = require("../models/User");
const Post = require("../models/Post");
const Follow = require("../models/Follow");
const notifications = require("../services/notificationService");
const { deleteAccountData } = require("../services/accountDeletion");
const { saveReport } = require("../services/reportService");
const { maskPhoneNumbers } = require("../utils/phoneMask");
const {
  toFeedItem,
  blockedIdsOf,
  VISIBLE_POSTS,
  liveListings,
  cloudinaryPublicId,
  deleteCloudinaryPhotos,
} = require("./postController");

// Only real web links are sent as photos (older accounts may have a phone
// file path or base64 text saved, which nobody else could ever see).
const webPhoto = (url) => (typeof url === "string" && /^https?:\/\//.test(url) ? url : "");

// Your profile as the app sees it: no password, Google ID or reset codes;
// with your numbers (listings, followers, following).
const profileResponse = async (user) => {
  const [listings, followers, following] = await Promise.all([
    Post.countDocuments({ user: user._id }),
    Follow.countDocuments({ following: user._id }),
    Follow.countDocuments({ follower: user._id }),
  ]);
  return {
    _id: user._id,
    id: user._id,
    name: user.name,
    email: user.email,
    phone: user.phone || "",
    bio: user.bio || "",
    profileImage: webPhoto(user.profileImage),
    isEmailVerified: Boolean(user.emailVerifiedAt),
    agency: user.agency || "",
    profession: user.profession || "",
    location: user.location || "",
    settings: {
      pushNotifications: user.settings?.pushNotifications !== false,
      emailInquiries: user.settings?.emailInquiries !== false,
    },
    // Google-only accounts have no password (Change Password sends them to
    // Forgot Password; Delete account asks them to type DELETE).
    hasPassword: Boolean(user.password),
    termsAcceptedAt: user.termsAcceptedAt || null,
    googleLinked: Boolean(user.googleId),
    savedPosts: (user.savedPosts || []).map(String),
    createdAt: user.createdAt,
    stats: { listings, followers, following },
  };
};

// GET /api/users/profile
const getUserProfile = async (req, res) => {
  try {
    const user = await User.findById(req.user._id);

    if (!user) {
      return res.status(404).json({ success: false, message: "User not found" });
    }

    res.status(200).json({
      success: true,
      user: await profileResponse(user),
    });
  } catch (error) {
    console.error("Get profile error:", error);
    res.status(500).json({ success: false, message: "Failed to fetch profile" });
  }
};

// PUT /api/users/profile — fields checked by validators/userValidators.js;
// only the ones sent change. A new or removed photo deletes the old one from
// Cloudinary (only our own photos are ever deleted).
const updateUserProfile = async (req, res) => {
  try {
    const { name, phone, bio, agency, profession, location, profileImage, settings } = req.body;

    if (
      profileImage !== undefined &&
      profileImage !== "" &&
      !(cloudinaryPublicId(profileImage) || "").startsWith("plotpost/avatars/")
    ) {
      return res.status(400).json({
        success: false,
        message: "Please upload the photo first, then save. Update the app if this keeps happening.",
      });
    }

    const user = await User.findById(req.user._id);
    if (!user) {
      return res.status(404).json({ success: false, message: "User not found" });
    }

    const oldPhoto = user.profileImage;
    if (name !== undefined) user.name = name;
    if (phone !== undefined) user.phone = phone;
    if (bio !== undefined) user.bio = bio;
    if (agency !== undefined) user.agency = agency;
    if (profession !== undefined) user.profession = profession;
    if (location !== undefined) user.location = location;
    if (profileImage !== undefined) user.profileImage = profileImage;
    if (settings?.pushNotifications !== undefined) user.settings.pushNotifications = settings.pushNotifications;
    if (settings?.emailInquiries !== undefined) user.settings.emailInquiries = settings.emailInquiries;

    await user.save();

    if (profileImage !== undefined && oldPhoto && oldPhoto !== user.profileImage) {
      await deleteCloudinaryPhotos([oldPhoto]);
    }

    res.status(200).json({
      success: true,
      message: "Profile updated.",
      user: await profileResponse(user),
    });
  } catch (error) {
    console.error("Update profile error:", error);
    res.status(500).json({ success: false, message: "Failed to update profile" });
  }
};

// SAVED POSTS (bookmarks on the account)

const mongoose = require("mongoose");

const MAX_SAVED = 500;
const LIMIT_MESSAGE = `You can save up to ${MAX_SAVED} posts. Remove some saved posts to save more.`;

// A post ID as the app sends it (24 hex characters).
const isPostId = (value) => typeof value === "string" && /^[a-f0-9]{24}$/i.test(value);

const savedIdsOf = async (userId) => {
  const user = await User.findById(userId).select("savedPosts").lean();
  return user ? [...new Set((user.savedPosts || []).map(String))] : null;
};

// POST /api/users/saved/:postId
// Body { "saved": true } saves and { "saved": false } removes. Both are safe
// to repeat, so a double tap or a retry never undoes a save. With no body it
// toggles, as it always did.
const toggleSavedPost = async (req, res) => {
  try {
    const { postId } = req.params;

    if (!isPostId(postId)) {
      return res.status(400).json({
        success: false,
        message: "Invalid post ID",
      });
    }

    const wanted = req.body?.saved;
    if (wanted !== undefined && typeof wanted !== "boolean") {
      return res.status(400).json({
        success: false,
        message: "saved must be true or false.",
      });
    }

    const savedIds = await savedIdsOf(req.user._id);
    if (!savedIds) {
      return res.status(404).json({
        success: false,
        message: "User not found",
      });
    }

    const alreadySaved = savedIds.includes(postId);
    const isSaved = wanted ?? !alreadySaved;

    if (isSaved && !alreadySaved) {
      if (!(await Post.exists({ _id: postId }))) {
        return res.status(404).json({
          success: false,
          message: "Post not found",
        });
      }
      if (savedIds.length >= MAX_SAVED) {
        return res.status(400).json({
          success: false,
          limitReached: true,
          message: LIMIT_MESSAGE,
        });
      }
      await User.updateOne({ _id: req.user._id }, { $addToSet: { savedPosts: postId } });
    } else if (!isSaved && alreadySaved) {
      // Works even if the post has since been deleted.
      await User.updateOne(
        { _id: req.user._id },
        { $pull: { savedPosts: new mongoose.Types.ObjectId(postId) } }
      );
    }

    const savedPosts = await savedIdsOf(req.user._id);

    return res.status(200).json({
      success: true,
      isSaved,
      message: isSaved
        ? "Post saved to bookmarks"
        : "Post removed from bookmarks",
      savedPosts,
      savedCount: savedPosts.length,
    });
  } catch (error) {
    console.error("Toggle saved post error:", error);

    return res.status(500).json({
      success: false,
      message: "Failed to toggle saved post",
    });
  }
};


// GET /api/users/saved — your saved posts, newest saved first, in the same
// format as the feed (counts instead of like/comment lists, no emails).
// Sold and rented posts stay (the app labels them); deleted ones drop out.
const getSavedPosts = async (req, res) => {
  try {
    const savedIds = await savedIdsOf(req.user._id);

    if (!savedIds) {
      return res.status(404).json({ success: false, message: "User not found" });
    }

    // New saves are added at the end, so newest first = reversed. Posts from
    // people you blocked are left out (they come back if you unblock).
    const ids = [...savedIds].reverse();
    const blocked = blockedIdsOf(req.user);
    const found = ids.length
      ? await Post.find({
          _id: { $in: ids },
          ...VISIBLE_POSTS,
          ...(blocked.length ? { user: { $nin: blocked } } : {}),
        })
          .populate("user", "name profileImage")
          .lean()
      : [];
    const byId = new Map(found.map((post) => [String(post._id), post]));
    const posts = ids.map((id) => byId.get(id)).filter(Boolean);

    res.status(200).json({
      success: true,
      count: posts.length,
      postIds: posts.map((post) => String(post._id)),
      savedPosts: posts.map((post) => toFeedItem(post, req.user._id)),
    });
  } catch (error) {
    console.error("Get saved posts error:", error);
    res.status(500).json({ success: false, message: "Failed to fetch saved posts" });
  }
};


// POST /api/users/saved/import — body { "postIds": [...] }.
// Moves saves kept on a phone (from before logging in, or before saves were
// on the account) onto the account. Posts that no longer exist, ones already
// saved and anything past the 500 limit are skipped. Safe to repeat.
const importSavedPosts = async (req, res) => {
  try {
    const { postIds } = req.body ?? {};

    if (
      !Array.isArray(postIds) ||
      postIds.length > MAX_SAVED ||
      postIds.some((id) => typeof id !== "string")
    ) {
      return res.status(400).json({
        success: false,
        message: `postIds must be a list of up to ${MAX_SAVED} post IDs.`,
      });
    }

    const savedIds = await savedIdsOf(req.user._id);
    if (!savedIds) {
      return res.status(404).json({ success: false, message: "User not found" });
    }

    const alreadySaved = new Set(savedIds);
    const candidates = [...new Set(postIds.map((id) => id.trim()))].filter(
      (id) => isPostId(id) && !alreadySaved.has(id)
    );
    const existing = candidates.length
      ? await Post.find({ _id: { $in: candidates } }).select("_id").lean()
      : [];
    const existingIds = new Set(existing.map((post) => String(post._id)));
    const available = candidates.filter((id) => existingIds.has(id));
    const toAdd = available.slice(0, Math.max(0, MAX_SAVED - savedIds.length));

    if (toAdd.length) {
      await User.updateOne({ _id: req.user._id }, { $addToSet: { savedPosts: { $each: toAdd } } });
    }

    res.status(200).json({
      success: true,
      added: toAdd.length,
      savedCount: savedIds.length + toAdd.length,
      limitReached: toAdd.length < available.length,
      message:
        toAdd.length < available.length
          ? LIMIT_MESSAGE
          : `${toAdd.length} saved ${toAdd.length === 1 ? "post" : "posts"} added to your account.`,
    });
  } catch (error) {
    console.error("Import saved posts error:", error);
    res.status(500).json({ success: false, message: "Failed to add saved posts" });
  }
};

// POST /api/users/:id/block and DELETE /api/users/:id/block
// Blocked people can't message you or start a chat with you, and you can't
// message them until you unblock them.
const setBlocked = (blocked) => async (req, res) => {
  try {
    const { id } = req.params;
    if (!/^[a-f0-9]{24}$/i.test(id)) {
      return res.status(400).json({ success: false, message: "Invalid user ID." });
    }
    if (id === String(req.user._id)) {
      return res.status(400).json({ success: false, message: "You can't block yourself." });
    }
    if (blocked && !(await User.exists({ _id: id }))) {
      return res.status(404).json({ success: false, message: "User not found" });
    }
    await User.updateOne(
      { _id: req.user._id },
      blocked
        ? { $addToSet: { blockedUsers: new mongoose.Types.ObjectId(id) } }
        : { $pull: { blockedUsers: new mongoose.Types.ObjectId(id) } }
    );
    // Blocked people disappear from your notifications.
    await notifications.blockChanged(req.user._id, id, blocked);
    res.status(200).json({
      success: true,
      blocked,
      message: blocked
        ? "Blocked. You won't see their posts, comments or messages."
        : "Unblocked.",
    });
  } catch (error) {
    console.error("Block user error:", error);
    res.status(500).json({ success: false, message: "Could not update blocking." });
  }
};
const blockUser = setBlocked(true);
const unblockUser = setBlocked(false);

// POST /api/users/accept-terms — "Agree and continue" on the Terms of Use
// screen (Google sign-ups and accounts from before the checkbox). Keeps the
// first date if it was already accepted.
const acceptTerms = async (req, res) => {
  try {
    const now = new Date();
    await User.updateOne(
      { _id: req.user._id, termsAcceptedAt: null },
      { $set: { termsAcceptedAt: now } },
      { timestamps: false }
    );
    const user = await User.findById(req.user._id).select("termsAcceptedAt").lean();
    res.status(200).json({ success: true, termsAcceptedAt: user?.termsAcceptedAt || now });
  } catch (error) {
    console.error("Accept terms error:", error);
    res.status(500).json({ success: false, message: "Could not save. Please try again." });
  }
};

// GET /api/users/blocked — the people you blocked (Settings → Blocked people),
// most recently blocked first.
const getBlockedUsers = async (req, res) => {
  try {
    const me = await User.findById(req.user._id).select("blockedUsers").lean();
    const ids = [...(me?.blockedUsers || [])].reverse();
    const found = ids.length
      ? await User.find({ _id: { $in: ids } }).select("name profileImage").lean()
      : [];
    const byId = new Map(found.map((user) => [String(user._id), user]));
    const users = ids
      .map((id) => byId.get(String(id)))
      .filter(Boolean)
      .map((user) => ({ _id: user._id, name: user.name, profileImage: webPhoto(user.profileImage) }));
    res.status(200).json({ success: true, count: users.length, users });
  } catch (error) {
    console.error("Blocked users error:", error);
    res.status(500).json({ success: false, message: "Could not load blocked people." });
  }
};

// POST /api/users/:id/report — body { reason, details }. One report per
// person reported; reporting again updates it. You can't report yourself.
const reportUser = async (req, res) => {
  try {
    const { id } = req.params;
    if (!/^[a-f0-9]{24}$/i.test(id)) {
      return res.status(400).json({ success: false, message: "Invalid user ID." });
    }
    if (id === String(req.user._id)) {
      return res.status(400).json({ success: false, message: "You can't report yourself." });
    }
    if (!(await User.exists({ _id: id }))) {
      return res.status(404).json({ success: false, message: "User not found" });
    }
    const { updated } = await saveReport(
      "user",
      { reportedUser: new mongoose.Types.ObjectId(id) },
      { reporter: req.user._id, reason: req.body.reason, details: req.body.details }
    );
    res.status(updated ? 200 : 201).json({
      success: true,
      updated,
      message: updated
        ? "Your report has been updated. We'll review this account."
        : "Report submitted. We'll review this account.",
    });
  } catch (error) {
    console.error("Report user error:", error);
    res.status(500).json({ success: false, message: "Failed to send the report." });
  }
};

// DELETE /api/users/me — deletes your account and what belongs to it.
// Password accounts send { password }; Google-only accounts send
// { confirm: "DELETE" }. Removed: your posts (with their photos, view
// records, leads and other people's saves of them), your comments and likes
// on other posts, your follows both ways, enquiries you sent, your profile
// photo, your chats and their messages, your notifications and phone
// alerts, and the account (services/accountDeletion.js). Reports you made stay,
// shown as "account deleted", until they're deleted 12 months after closing.
// Each step can safely run again if something fails half-way.
const deleteAccount = async (req, res) => {
  try {
    const user = await User.findById(req.user._id);
    if (!user) {
      return res.status(404).json({ success: false, message: "User not found" });
    }

    const { password, confirm } = req.body;
    if (user.password) {
      if (!password) {
        return res.status(400).json({ success: false, message: "Please enter your password to delete your account." });
      }
      if (!(await bcrypt.compare(password, user.password))) {
        return res.status(400).json({ success: false, message: "Your password is incorrect." });
      }
    } else if (confirm !== "DELETE") {
      return res.status(400).json({ success: false, message: "Please type DELETE to confirm." });
    }

    // Everything goes, the same way as the website's Delete account page.
    await deleteAccountData(user);

    res.status(200).json({ success: true, message: "Your account has been deleted." });
  } catch (error) {
    console.error("Delete account error:", error);
    res.status(500).json({ success: false, message: "Could not delete your account. Please try again." });
  }
};

// ------------------------------------------------------------ public profile

// The seller's public page: anyone can open it, logged in or not.
// Live = what the feed shows; Sold / rented = their closed listings.
// Removed listings, expired listings and banned sellers never show.
const CLOSED_LISTINGS = { ...VISIBLE_POSTS, status: { $in: ["sold", "rented"] } };
const PROFILE_PAGE_SIZE = 20;

// Finds the person, or answers 400/404. Banned and deleted accounts aren't shown.
const publicPersonOf = async (req, res) => {
  const { id } = req.params;
  if (!mongoose.Types.ObjectId.isValid(id)) {
    res.status(400).json({ success: false, message: "Invalid user ID." });
    return null;
  }
  const person = await User.findById(id)
    .select("name profileImage bio agency profession location createdAt bannedAt")
    .lean();
  if (!person || person.bannedAt) {
    res.status(404).json({ success: false, message: "This account isn't available." });
    return null;
  }
  return person;
};

const blockedByViewer = (req, personId) => blockedIdsOf(req.user).some((id) => String(id) === String(personId));

// GET /api/users/:id — a seller's public profile. Never includes their
// email or phone. Guests don't see phone numbers written in the name or bio.
const getPublicProfile = async (req, res) => {
  const person = await publicPersonOf(req, res);
  if (!person) return;
  const isYou = Boolean(req.user) && String(req.user._id) === String(person._id);
  const [listings, soldOrRented, followers, following, follows] = await Promise.all([
    Post.countDocuments({ user: person._id, ...liveListings() }),
    Post.countDocuments({ user: person._id, ...CLOSED_LISTINGS }),
    Follow.countDocuments({ following: person._id }),
    Follow.countDocuments({ follower: person._id }),
    req.user && !isYou ? Follow.exists({ follower: req.user._id, following: person._id }) : null,
  ]);
  const guest = !req.user;
  const shown = (text) => (guest ? maskPhoneNumbers(text || "") : text || "");

  res.status(200).json({
    success: true,
    user: {
      _id: person._id,
      id: person._id,
      name: shown(person.name),
      profileImage: webPhoto(person.profileImage),
      bio: shown(person.bio),
      agency: person.agency || "",
      profession: person.profession || "",
      location: person.location || "",
      memberSince: person.createdAt,
      stats: { listings, soldOrRented, followers, following },
      isFollowing: Boolean(follows),
      isYou,
      blockedByMe: blockedByViewer(req, person._id),
    },
  });
};

// GET /api/users/:id/posts?tab=live|sold&page=1 — the seller's listings,
// newest first, 20 at a time, in the same format as the feed. People you
// blocked: no listings (the app shows Unblock instead).
const getPublicPosts = async (req, res) => {
  const person = await publicPersonOf(req, res);
  if (!person) return;
  const tab = req.query.tab === "sold" ? "sold" : "live";
  const page = Math.min(Math.max(parseInt(req.query.page, 10) || 1, 1), 500);

  if (blockedByViewer(req, person._id)) {
    return res.status(200).json({ success: true, tab, page, total: 0, hasMore: false, blockedByMe: true, posts: [] });
  }

  const filter = { user: person._id, ...(tab === "sold" ? CLOSED_LISTINGS : liveListings()) };
  const [posts, total] = await Promise.all([
    Post.find(filter)
      .populate("user", "name profileImage")
      .sort({ createdAt: -1, _id: -1 })
      .skip((page - 1) * PROFILE_PAGE_SIZE)
      .limit(PROFILE_PAGE_SIZE)
      .lean(),
    Post.countDocuments(filter),
  ]);
  res.status(200).json({
    success: true,
    tab,
    page,
    total,
    hasMore: (page - 1) * PROFILE_PAGE_SIZE + posts.length < total,
    blockedByMe: false,
    posts: posts.map((post) => toFeedItem(post, req.user?._id)),
  });
};

module.exports = {
  getPublicProfile,
  getPublicPosts,
  blockUser,
  unblockUser,
  deleteAccount,
  getUserProfile,
  updateUserProfile,
  toggleSavedPost,
  getSavedPosts,
  importSavedPosts,
  getBlockedUsers,
  reportUser,
  acceptTerms,
};

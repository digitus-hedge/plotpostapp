const bcrypt = require("bcryptjs");
const { Op } = require("sequelize");
const { User, Post, Follow } = require("../models");
const notifications = require("../services/notificationService");
const { deleteAccountData } = require("../services/accountDeletion");
const { saveReport } = require("../services/reportService");
const { maskPhoneNumbers } = require("../utils/phoneMask");
const {
  toFeedItem,
  blockedIdsOf,
  cloudinaryPublicId,
  deleteCloudinaryPhotos,
} = require("./postController");

const webPhoto = (url) => (typeof url === "string" && /^https?:\/\//.test(url) ? url : "");

const profileResponse = async (user) => {
  const [listings, followers, following] = await Promise.all([
    Post.count({ where: { userId: user.id } }),
    Follow.count({ where: { following: user.id } }),
    Follow.count({ where: { follower: user.id } }),
  ]);
  return {
    _id: user.id,
    id: user.id,
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
    hasPassword: Boolean(user.password),
    termsAcceptedAt: user.termsAcceptedAt || null,
    googleLinked: Boolean(user.googleId),
    savedPosts: (user.savedPosts || []).map(String),
    createdAt: user.createdAt,
    stats: { listings, followers, following },
  };
};

const getUserProfile = async (req, res) => {
  try {
    const user = await User.findByPk(req.user.id);
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

    const user = await User.findByPk(req.user.id);
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

    const userSettings = { ...(user.settings || { pushNotifications: true, emailInquiries: true }) };
    if (settings?.pushNotifications !== undefined) userSettings.pushNotifications = settings.pushNotifications;
    if (settings?.emailInquiries !== undefined) userSettings.emailInquiries = settings.emailInquiries;
    user.settings = userSettings;

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

// After POST /api/users/profile/photo has put the photo in Cloudinary: make
// it the profile photo, delete the old one, and send back the updated user
// (the app replaces its saved copy with it).
const saveUploadedProfilePhoto = async (req, result) => {
  const user = await User.findByPk(req.user.id);
  if (!user) {
    await deleteCloudinaryPhotos([result.secure_url]);
    return {};
  }
  const oldPhoto = user.profileImage;
  user.profileImage = result.secure_url;
  await user.save();
  if (oldPhoto && oldPhoto !== user.profileImage) {
    await deleteCloudinaryPhotos([oldPhoto]);
  }
  return { message: "Profile photo updated.", user: await profileResponse(user) };
};

// DELETE /api/users/profile/photo
const removeProfilePhoto = async (req, res) => {
  try {
    const user = await User.findByPk(req.user.id);
    if (!user) {
      return res.status(404).json({ success: false, message: "User not found" });
    }
    const oldPhoto = user.profileImage;
    user.profileImage = "";
    await user.save();
    if (oldPhoto) await deleteCloudinaryPhotos([oldPhoto]);
    res.status(200).json({ success: true, message: "Profile photo removed.", user: await profileResponse(user) });
  } catch (error) {
    console.error("Remove profile photo error:", error);
    res.status(500).json({ success: false, message: "Could not remove the photo." });
  }
};

const MAX_SAVED = 500;
const LIMIT_MESSAGE = `You can save up to ${MAX_SAVED} posts. Remove some saved posts to save more.`;

const savedIdsOf = async (userId) => {
  const user = await User.findByPk(userId);
  return user ? [...new Set((user.savedPosts || []).map(String))] : null;
};

const toggleSavedPost = async (req, res) => {
  try {
    const { postId } = req.params;
    const wanted = req.body?.saved;

    const savedIds = await savedIdsOf(req.user.id);
    if (!savedIds) {
      return res.status(404).json({ success: false, message: "User not found" });
    }

    const alreadySaved = savedIds.includes(String(postId));
    const isSaved = wanted ?? !alreadySaved;

    const user = await User.findByPk(req.user.id);

    if (isSaved && !alreadySaved) {
      const postExists = await Post.findByPk(postId);
      if (!postExists) {
        return res.status(404).json({ success: false, message: "Post not found" });
      }
      if (savedIds.length >= MAX_SAVED) {
        return res.status(400).json({
          success: false,
          limitReached: true,
          message: LIMIT_MESSAGE,
        });
      }
      user.savedPosts = [...savedIds, String(postId)];
      await user.save();
    } else if (!isSaved && alreadySaved) {
      user.savedPosts = savedIds.filter((id) => id !== String(postId));
      await user.save();
    }

    const updatedSavedPosts = (user.savedPosts || []).map(String);

    return res.status(200).json({
      success: true,
      isSaved,
      message: isSaved
        ? "Post saved to bookmarks"
        : "Post removed from bookmarks",
      savedPosts: updatedSavedPosts,
      savedCount: updatedSavedPosts.length,
    });
  } catch (error) {
    console.error("Toggle saved post error:", error);
    return res.status(500).json({ success: false, message: "Failed to toggle saved post" });
  }
};

const getSavedPosts = async (req, res) => {
  try {
    const savedIds = await savedIdsOf(req.user.id);
    if (!savedIds) {
      return res.status(404).json({ success: false, message: "User not found" });
    }

    const ids = [...savedIds].map((id) => parseInt(id, 10)).filter(Boolean).reverse();
    const found = ids.length
      ? await Post.findAll({
          where: { id: { [Op.in]: ids }, removedAt: null, sellerBanned: false },
          include: [{ model: User, as: "user", attributes: ["id", "name", "profileImage"] }],
        })
      : [];

    const byId = new Map(found.map((post) => [String(post.id), post]));
    const posts = ids.map((id) => byId.get(String(id))).filter(Boolean);

    res.status(200).json({
      success: true,
      count: posts.length,
      postIds: posts.map((post) => String(post.id)),
      savedPosts: posts.map((post) => toFeedItem(post, req.user.id)),
    });
  } catch (error) {
    console.error("Get saved posts error:", error);
    res.status(500).json({ success: false, message: "Failed to fetch saved posts" });
  }
};

const importSavedPosts = async (req, res) => {
  try {
    const { postIds } = req.body ?? {};
    if (!Array.isArray(postIds)) {
      return res.status(400).json({ success: false, message: "postIds must be an array." });
    }

    const user = await User.findByPk(req.user.id);
    if (!user) return res.status(404).json({ success: false, message: "User not found" });

    const currentSaved = new Set((user.savedPosts || []).map(String));
    const toAdd = postIds.map(String).filter((id) => !currentSaved.has(id));

    user.savedPosts = [...currentSaved, ...toAdd];
    await user.save();

    res.status(200).json({
      success: true,
      added: toAdd.length,
      savedCount: user.savedPosts.length,
      message: `${toAdd.length} saved posts imported.`,
    });
  } catch (error) {
    console.error("Import saved posts error:", error);
    res.status(500).json({ success: false, message: "Failed to import saved posts" });
  }
};

const setBlocked = (blocked) => async (req, res) => {
  try {
    const { id } = req.params;
    if (String(id) === String(req.user.id)) {
      return res.status(400).json({ success: false, message: "You can't block yourself." });
    }
    const targetUser = await User.findByPk(id);
    if (blocked && !targetUser) {
      return res.status(404).json({ success: false, message: "User not found" });
    }
    const user = await User.findByPk(req.user.id);
    const current = new Set((user.blockedUsers || []).map(String));
    if (blocked) {
      current.add(String(id));
    } else {
      current.delete(String(id));
    }
    user.blockedUsers = [...current];
    await user.save();

    await notifications.blockChanged(req.user.id, id, blocked);
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

const acceptTerms = async (req, res) => {
  try {
    const now = new Date();
    const user = await User.findByPk(req.user.id);
    if (!user.termsAcceptedAt) {
      user.termsAcceptedAt = now;
      await user.save();
    }
    res.status(200).json({ success: true, termsAcceptedAt: user.termsAcceptedAt || now });
  } catch (error) {
    console.error("Accept terms error:", error);
    res.status(500).json({ success: false, message: "Could not save. Please try again." });
  }
};

const getBlockedUsers = async (req, res) => {
  try {
    const me = await User.findByPk(req.user.id);
    const ids = [...(me?.blockedUsers || [])].map((id) => parseInt(id, 10)).filter(Boolean).reverse();
    const found = ids.length
      ? await User.findAll({ where: { id: { [Op.in]: ids } }, attributes: ["id", "name", "profileImage"] })
      : [];
    const byId = new Map(found.map((user) => [String(user.id), user]));
    const users = ids
      .map((id) => byId.get(String(id)))
      .filter(Boolean)
      .map((user) => ({ _id: user.id, name: user.name, profileImage: webPhoto(user.profileImage) }));
    res.status(200).json({ success: true, count: users.length, users });
  } catch (error) {
    console.error("Blocked users error:", error);
    res.status(500).json({ success: false, message: "Could not load blocked people." });
  }
};

const reportUser = async (req, res) => {
  try {
    const { id } = req.params;
    if (String(id) === String(req.user.id)) {
      return res.status(400).json({ success: false, message: "You can't report yourself." });
    }
    const targetUser = await User.findByPk(id);
    if (!targetUser) {
      return res.status(404).json({ success: false, message: "User not found" });
    }
    const { updated } = await saveReport(
      "user",
      { reportedUser: targetUser.id },
      { reporter: req.user.id, reason: req.body.reason, details: req.body.details }
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

const deleteAccount = async (req, res) => {
  try {
    const user = await User.findByPk(req.user.id);
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

    await deleteAccountData(user);

    res.status(200).json({ success: true, message: "Your account has been deleted." });
  } catch (error) {
    console.error("Delete account error:", error);
    res.status(500).json({ success: false, message: "Could not delete your account. Please try again." });
  }
};

const publicPersonOf = async (req, res) => {
  const { id } = req.params;
  const person = await User.findByPk(id, {
    attributes: ["id", "name", "profileImage", "bio", "agency", "profession", "location", "createdAt", "bannedAt"],
  });
  if (!person || person.bannedAt) {
    res.status(404).json({ success: false, message: "This account isn't available." });
    return null;
  }
  return person;
};

const blockedByViewer = (req, personId) => blockedIdsOf(req.user).some((id) => String(id) === String(personId));

const getPublicProfile = async (req, res) => {
  const person = await publicPersonOf(req, res);
  if (!person) return;
  const isYou = Boolean(req.user) && String(req.user.id) === String(person.id);
  const [listings, soldOrRented, followers, following, follows] = await Promise.all([
    Post.count({ where: { userId: person.id, status: "active", removedAt: null, sellerBanned: false } }),
    Post.count({ where: { userId: person.id, status: { [Op.in]: ["sold", "rented"] }, removedAt: null, sellerBanned: false } }),
    Follow.count({ where: { following: person.id } }),
    Follow.count({ where: { follower: person.id } }),
    req.user && !isYou ? Follow.findOne({ where: { follower: req.user.id, following: person.id } }) : null,
  ]);
  const guest = !req.user;
  const shown = (text) => (guest ? maskPhoneNumbers(text || "") : text || "");

  res.status(200).json({
    success: true,
    user: {
      _id: person.id,
      id: person.id,
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
      blockedByMe: blockedByViewer(req, person.id),
    },
  });
};

const getPublicPosts = async (req, res) => {
  const person = await publicPersonOf(req, res);
  if (!person) return;
  const tab = req.query.tab === "sold" ? "sold" : "live";
  const page = Math.min(Math.max(parseInt(req.query.page, 10) || 1, 1), 500);

  if (blockedByViewer(req, person.id)) {
    return res.status(200).json({ success: true, tab, page, total: 0, hasMore: false, blockedByMe: true, posts: [] });
  }

  const where = {
    userId: person.id,
    removedAt: null,
    sellerBanned: false,
    status: tab === "sold" ? { [Op.in]: ["sold", "rented"] } : "active",
  };

  const { rows: posts, count: total } = await Post.findAndCountAll({
    where,
    include: [{ model: User, as: "user", attributes: ["id", "name", "profileImage"] }],
    order: [["createdAt", "DESC"]],
    limit: 20,
    offset: (page - 1) * 20,
  });

  res.status(200).json({
    success: true,
    tab,
    page,
    total,
    hasMore: (page - 1) * 20 + posts.length < total,
    blockedByMe: false,
    posts: posts.map((post) => toFeedItem(post, req.user?.id)),
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
  saveUploadedProfilePhoto,
  removeProfilePhoto,
  toggleSavedPost,
  getSavedPosts,
  importSavedPosts,
  getBlockedUsers,
  reportUser,
  acceptTerms,
};

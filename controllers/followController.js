const mongoose = require("mongoose");
const Follow = require("../models/Follow");
const Post = require("../models/Post");
const User = require("../models/User");
const notifications = require("../services/notificationService");

const isValidId = (id) => mongoose.Types.ObjectId.isValid(id);

const followersCount = (userId) => Follow.countDocuments({ following: userId });

// Seller details the app shows in the Following tab.
const sellerSummary = (user, postsCount, isFollowing) => ({
  id: user._id,
  _id: user._id,
  name: user.name,
  profileImage: user.profileImage || "",
  postsCount,
  isFollowing,
});

// POST /api/users/:id/follow — follow a seller (doing it twice is harmless).
const followUser = async (req, res) => {
  const { id } = req.params;
  if (!isValidId(id)) {
    return res.status(400).json({ success: false, message: "Invalid user ID." });
  }
  if (String(id) === String(req.user._id)) {
    return res.status(400).json({ success: false, message: "You can't follow yourself." });
  }
  if (!(await User.exists({ _id: id }))) {
    return res.status(404).json({ success: false, message: "User not found." });
  }

  try {
    await Follow.create({ follower: req.user._id, following: id });
    // A new follower (not a repeat tap): "started following you".
    await notifications.followed(req.user._id, id);
  } catch (error) {
    // Already following: the unique index refused a second row. That's fine.
    if (error?.code !== 11000) throw error;
  }

  res.status(200).json({
    success: true,
    isFollowing: true,
    followersCount: await followersCount(id),
    message: "Following",
  });
};

// DELETE /api/users/:id/follow — unfollow a seller.
const unfollowUser = async (req, res) => {
  const { id } = req.params;
  if (!isValidId(id)) {
    return res.status(400).json({ success: false, message: "Invalid user ID." });
  }
  await Follow.deleteOne({ follower: req.user._id, following: id });
  await notifications.unfollowed(req.user._id, id);
  res.status(200).json({
    success: true,
    isFollowing: false,
    followersCount: await followersCount(id),
    message: "Unfollowed",
  });
};

// Number of posts per seller, for the given seller IDs (or the top sellers).
const postCounts = async (match, limit) => {
  // Only listings everyone can see (not removed, seller not banned).
  const pipeline = [
    { $match: { ...match, removedAt: null, sellerBanned: { $ne: true } } },
    { $group: { _id: "$user", postsCount: { $sum: 1 } } },
    { $sort: { postsCount: -1, _id: 1 } },
  ];
  if (limit) pipeline.push({ $limit: limit });
  return Post.aggregate(pipeline);
};

// GET /api/users/following — the sellers you follow.
const getFollowing = async (req, res) => {
  const follows = await Follow.find({ follower: req.user._id }).sort({ createdAt: -1 }).lean();
  // People you blocked are left out.
  const blocked = new Set((req.user.blockedUsers || []).map(String));
  const ids = follows.map((f) => f.following).filter((id) => !blocked.has(String(id)));
  const [users, counts] = await Promise.all([
    // Banned accounts are left out.
    User.find({ _id: { $in: ids }, bannedAt: null }).select("name profileImage").lean(),
    postCounts({ user: { $in: ids } }),
  ]);
  const usersById = new Map(users.map((u) => [String(u._id), u]));
  const countsById = new Map(counts.map((c) => [String(c._id), c.postsCount]));

  const following = ids
    .map((id) => usersById.get(String(id)))
    .filter(Boolean)
    .map((u) => sellerSummary(u, countsById.get(String(u._id)) || 0, true));

  res.status(200).json({ success: true, count: following.length, following });
};

// GET /api/users/suggested-sellers?limit=10 — sellers with the most posts.
// Guests can see it; for logged-in users it marks who they already follow
// and leaves themselves out.
const getSuggestedSellers = async (req, res) => {
  const limit = Math.min(30, Math.max(1, parseInt(req.query.limit, 10) || 10));
  // Not yourself, and not people you blocked.
  const match = req.user
    ? { user: { $nin: [req.user._id, ...(req.user.blockedUsers || [])] } }
    : {};
  const top = await postCounts(match, limit);
  const ids = top.map((t) => t._id);

  const [users, myFollows] = await Promise.all([
    User.find({ _id: { $in: ids } }).select("name profileImage").lean(),
    req.user
      ? Follow.find({ follower: req.user._id, following: { $in: ids } }).select("following").lean()
      : [],
  ]);
  const usersById = new Map(users.map((u) => [String(u._id), u]));
  const followed = new Set(myFollows.map((f) => String(f.following)));

  const sellers = top
    .map((t) => {
      const user = usersById.get(String(t._id));
      return user ? sellerSummary(user, t.postsCount, followed.has(String(t._id))) : null;
    })
    .filter(Boolean);

  res.status(200).json({ success: true, count: sellers.length, sellers });
};

module.exports = { followUser, unfollowUser, getFollowing, getSuggestedSellers };

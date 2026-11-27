const { Op, fn, col, UniqueConstraintError } = require("sequelize");
const { Follow, Post, User } = require("../models");
const notifications = require("../services/notificationService");

// User IDs are positive whole numbers in MySQL.
const isValidId = (id) => /^\d+$/.test(String(id)) && Number(id) > 0;

const followersCount = (userId) => Follow.count({ where: { following: userId } });

// Seller details the app shows in the Following tab.
const sellerSummary = (user, postsCount, isFollowing) => ({
  id: user.id,
  _id: user.id,
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
  const targetId = Number(id);
  if (targetId === Number(req.user.id)) {
    return res.status(400).json({ success: false, message: "You can't follow yourself." });
  }
  if (!(await User.count({ where: { id: targetId } }))) {
    return res.status(404).json({ success: false, message: "User not found." });
  }

  try {
    await Follow.create({ follower: req.user.id, following: targetId });
    // A new follower (not a repeat tap): "started following you".
    await notifications.followed(req.user.id, targetId);
  } catch (error) {
    // Already following: the unique index refused a second row. That's fine.
    if (!(error instanceof UniqueConstraintError)) throw error;
  }

  res.status(200).json({
    success: true,
    isFollowing: true,
    followersCount: await followersCount(targetId),
    message: "Following",
  });
};

// DELETE /api/users/:id/follow — unfollow a seller.
const unfollowUser = async (req, res) => {
  const { id } = req.params;
  if (!isValidId(id)) {
    return res.status(400).json({ success: false, message: "Invalid user ID." });
  }
  const targetId = Number(id);
  await Follow.destroy({ where: { follower: req.user.id, following: targetId } });
  await notifications.unfollowed(req.user.id, targetId);
  res.status(200).json({
    success: true,
    isFollowing: false,
    followersCount: await followersCount(targetId),
    message: "Unfollowed",
  });
};

// Number of posts per seller: [{ userId, postsCount }], most posts first.
// Only listings everyone can see (not removed, seller not banned).
const postCounts = async (userWhere, limit) => {
  const rows = await Post.findAll({
    attributes: ["userId", [fn("COUNT", col("id")), "postsCount"]],
    where: { ...(userWhere ? { userId: userWhere } : {}), removedAt: null, sellerBanned: false },
    group: ["userId"],
    order: [
      [fn("COUNT", col("id")), "DESC"],
      ["userId", "ASC"],
    ],
    ...(limit ? { limit } : {}),
    raw: true,
  });
  return rows.map((row) => ({ userId: row.userId, postsCount: Number(row.postsCount) || 0 }));
};

const blockedIdsOf = (user) => (Array.isArray(user?.blockedUsers) ? user.blockedUsers : []);

// GET /api/users/following — the sellers you follow.
const getFollowing = async (req, res) => {
  const follows = await Follow.findAll({
    where: { follower: req.user.id },
    order: [["createdAt", "DESC"]],
    attributes: ["following"],
    raw: true,
  });
  // People you blocked are left out.
  const blocked = new Set(blockedIdsOf(req.user).map(String));
  const ids = follows.map((f) => f.following).filter((id) => !blocked.has(String(id)));

  const [users, counts] = ids.length
    ? await Promise.all([
        // Banned accounts are left out.
        User.findAll({
          where: { id: { [Op.in]: ids }, bannedAt: null },
          attributes: ["id", "name", "profileImage"],
          raw: true,
        }),
        postCounts({ [Op.in]: ids }),
      ])
    : [[], []];
  const usersById = new Map(users.map((u) => [String(u.id), u]));
  const countsById = new Map(counts.map((c) => [String(c.userId), c.postsCount]));

  const following = ids
    .map((id) => usersById.get(String(id)))
    .filter(Boolean)
    .map((u) => sellerSummary(u, countsById.get(String(u.id)) || 0, true));

  res.status(200).json({ success: true, count: following.length, following });
};

// GET /api/users/suggested-sellers?limit=10 — sellers with the most posts.
// Guests can see it; for logged-in users it marks who they already follow
// and leaves themselves out.
const getSuggestedSellers = async (req, res) => {
  const limit = Math.min(30, Math.max(1, parseInt(req.query.limit, 10) || 10));
  // Not yourself, and not people you blocked.
  const userWhere = req.user ? { [Op.notIn]: [req.user.id, ...blockedIdsOf(req.user)] } : null;
  const top = await postCounts(userWhere, limit);
  const ids = top.map((t) => t.userId);

  const [users, myFollows] = ids.length
    ? await Promise.all([
        User.findAll({ where: { id: { [Op.in]: ids } }, attributes: ["id", "name", "profileImage"], raw: true }),
        req.user
          ? Follow.findAll({
              where: { follower: req.user.id, following: { [Op.in]: ids } },
              attributes: ["following"],
              raw: true,
            })
          : [],
      ])
    : [[], []];
  const usersById = new Map(users.map((u) => [String(u.id), u]));
  const followed = new Set(myFollows.map((f) => String(f.following)));

  const sellers = top
    .map((t) => {
      const user = usersById.get(String(t.userId));
      return user ? sellerSummary(user, t.postsCount, followed.has(String(t.userId))) : null;
    })
    .filter(Boolean);

  res.status(200).json({ success: true, count: sellers.length, sellers });
};

module.exports = { followUser, unfollowUser, getFollowing, getSuggestedSellers };

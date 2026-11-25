const Notification = require("../models/Notification");
const Follow = require("../models/Follow");
const User = require("../models/User");
const push = require("../services/pushService");

const PAGE_SIZE = 20;

const webPhoto = (url) => (typeof url === "string" && /^https?:\/\//.test(url) ? url : "");

const postSummaryOf = (post) => {
  if (!post || !post._id) return null;
  const photo = [...(post.imageUrls || []), post.imageUrl || ""].find(Boolean) || "";
  return {
    _id: post._id,
    title: post.title || "",
    image: webPhoto(photo),
    status: post.status || "active",
  };
};

const newerThan = (seenAt) => (seenAt ? { lastAt: { $gt: seenAt } } : {});

const unreadOf = (userId, seenAt) =>
  Notification.countDocuments({ recipient: userId, ...newerThan(seenAt) });

// One row as the app shows it. Rows whose post or person is gone are left out.
const toItem = (row, seenAt, followingBack) => {
  const actors = (row.actors || [])
    .filter((actor) => actor && actor._id)
    .map((actor) => ({ _id: actor._id, name: actor.name, profileImage: webPhoto(actor.profileImage) }));
  const post = postSummaryOf(row.post);
  if ((row.type === "like" || row.type === "comment") && (!post || !actors.length)) return null;
  if (row.type === "follow" && !actors.length) return null;
  // "listing" rows (expires soon / expired) need their listing.
  if (row.type === "listing" && !post) return null;
  // "moderation" rows (PlotPost removed your listing / comment) have no
  // people: actorName is "PlotPost" and preview is the reason.

  return {
    _id: row._id,
    type: row.type,
    actors,
    count: Math.max(row.count || 1, actors.length),
    actorName: row.actorName || "",
    post,
    enquiryId: row.enquiry || null,
    preview: row.preview || "",
    commentId: row.commentId || null,
    isFollowing: row.type === "follow" ? followingBack.has(String(actors[0]._id)) : false,
    at: row.lastAt,
    isNew: !seenAt || row.lastAt > seenAt,
  };
};

// GET /api/notifications?page=1 — newest first, 20 a page. Also returns the
// number of new ones and serverTime (send it back to /seen).
const listNotifications = async (req, res) => {
  const me = req.user._id;
  const seenAt = req.user.notificationsSeenAt || null;
  const page = Math.min(Math.max(parseInt(req.query.page, 10) || 1, 1), 500);
  const serverTime = new Date();

  const rows = await Notification.find({ recipient: me })
    .sort({ lastAt: -1, _id: -1 })
    .skip((page - 1) * PAGE_SIZE)
    .limit(PAGE_SIZE + 1)
    .populate("actors", "name profileImage")
    .populate("post", "title imageUrls imageUrl status")
    .lean();
  const hasMore = rows.length > PAGE_SIZE;
  const pageRows = rows.slice(0, PAGE_SIZE);

  // "Follow back" buttons: which of these followers you already follow.
  const followerIds = pageRows
    .filter((row) => row.type === "follow")
    .flatMap((row) => (row.actors || []).filter(Boolean).map((actor) => actor._id));
  const followingBack = new Set(
    followerIds.length
      ? (await Follow.find({ follower: me, following: { $in: followerIds } }).select("following").lean()).map(
          (follow) => String(follow.following)
        )
      : []
  );

  res.status(200).json({
    success: true,
    notifications: pageRows.map((row) => toItem(row, seenAt, followingBack)).filter(Boolean),
    unread: await unreadOf(me, seenAt),
    page,
    hasMore,
    serverTime: serverTime.toISOString(),
  });
};

// GET /api/notifications/unread — the number on the bell.
const unreadCount = async (req, res) => {
  res.status(200).json({
    success: true,
    count: await unreadOf(req.user._id, req.user.notificationsSeenAt || null),
  });
};

// POST /api/notifications/seen { upTo } — you've opened the list: the bell
// goes back to zero. Only ever moves forward, never past now.
const markSeen = async (req, res) => {
  const now = new Date();
  let upTo = req.body.upTo ? new Date(req.body.upTo) : now;
  if (upTo > now) upTo = now;

  let seenAt = req.user.notificationsSeenAt || null;
  if (!seenAt || upTo > seenAt) {
    await User.updateOne({ _id: req.user._id }, { $set: { notificationsSeenAt: upTo } }, { timestamps: false });
    seenAt = upTo;
  }
  res.status(200).json({ success: true, unread: await unreadOf(req.user._id, seenAt) });
};

// POST /api/notifications/devices { token, platform } — this phone gets
// alerts for your account. alertsReady says whether the server is set up
// to send them (Firebase key present).
const registerDevice = async (req, res) => {
  await push.registerDevice(req.user._id, req.body.token, req.body.platform);
  res.status(200).json({ success: true, alertsReady: push.canSend() });
};

// DELETE /api/notifications/devices { token } — this phone logged out.
const removeDevice = async (req, res) => {
  await push.removeDevice(req.user._id, req.body.token);
  res.status(200).json({ success: true });
};

module.exports = { listNotifications, unreadCount, markSeen, registerDevice, removeDevice };

const { Op } = require("sequelize");
const { Notification, Follow, User, Post } = require("../models");
const push = require("../services/pushService");

const PAGE_SIZE = 20;

const webPhoto = (url) => (typeof url === "string" && /^https?:\/\//.test(url) ? url : "");

const postSummaryOf = (post) => {
  if (!post || !post.id) return null;
  const photo = [...(post.imageUrls || []), post.imageUrl || ""].find(Boolean) || "";
  return {
    _id: post.id,
    title: post.title || "",
    image: webPhoto(photo),
    status: post.status || "active",
  };
};

const newerThan = (seenAt) => (seenAt ? { lastAt: { [Op.gt]: seenAt } } : {});

const unreadOf = (userId, seenAt) =>
  Notification.count({ where: { recipient: userId, ...newerThan(seenAt) } });

// actors is stored as a JSON list of user IDs (older rows may hold objects).
const actorIdsOf = (row) =>
  (Array.isArray(row.actors) ? row.actors : [])
    .map((actor) => (actor && typeof actor === "object" ? actor.id ?? actor._id : actor))
    .filter((id) => id !== null && id !== undefined && id !== "");

// One row as the app shows it. Rows whose post or person is gone are left out.
const toItem = (row, usersById, seenAt, followingBack) => {
  const actors = actorIdsOf(row)
    .map((id) => usersById.get(String(id)))
    .filter(Boolean)
    .map((actor) => ({ _id: actor.id, name: actor.name, profileImage: webPhoto(actor.profileImage) }));
  const post = postSummaryOf(row.postItem);
  if ((row.type === "like" || row.type === "comment") && (!post || !actors.length)) return null;
  if (row.type === "follow" && !actors.length) return null;
  // "listing" rows (expires soon / expired) need their listing.
  if (row.type === "listing" && !post) return null;
  // "moderation" rows (PlotPost removed your listing / comment) have no
  // people: actorName is "PlotPost" and preview is the reason.

  return {
    _id: row.id,
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
  const me = req.user.id;
  const seenAt = req.user.notificationsSeenAt || null;
  const page = Math.min(Math.max(parseInt(req.query.page, 10) || 1, 1), 500);
  const serverTime = new Date();

  const rows = await Notification.findAll({
    where: { recipient: me },
    order: [
      ["lastAt", "DESC"],
      ["id", "DESC"],
    ],
    offset: (page - 1) * PAGE_SIZE,
    limit: PAGE_SIZE + 1,
    include: [
      {
        model: Post,
        as: "postItem",
        attributes: ["id", "title", "imageUrls", "imageUrl", "status"],
        required: false,
      },
    ],
  });
  const hasMore = rows.length > PAGE_SIZE;
  const pageRows = rows.slice(0, PAGE_SIZE);

  // Everyone named in these rows, loaded in one query.
  const actorIds = [...new Set(pageRows.flatMap(actorIdsOf).map(Number).filter(Number.isFinite))];
  const actorUsers = actorIds.length
    ? await User.findAll({
        where: { id: { [Op.in]: actorIds } },
        attributes: ["id", "name", "profileImage"],
        raw: true,
      })
    : [];
  const usersById = new Map(actorUsers.map((u) => [String(u.id), u]));

  // "Follow back" buttons: which of these followers you already follow.
  const followerIds = [
    ...new Set(
      pageRows
        .filter((row) => row.type === "follow")
        .flatMap(actorIdsOf)
        .map(Number)
        .filter(Number.isFinite)
    ),
  ];
  const followingBack = new Set(
    followerIds.length
      ? (
          await Follow.findAll({
            where: { follower: me, following: { [Op.in]: followerIds } },
            attributes: ["following"],
            raw: true,
          })
        ).map((follow) => String(follow.following))
      : []
  );

  res.status(200).json({
    success: true,
    notifications: pageRows.map((row) => toItem(row, usersById, seenAt, followingBack)).filter(Boolean),
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
    count: await unreadOf(req.user.id, req.user.notificationsSeenAt || null),
  });
};

// POST /api/notifications/seen { upTo } — you've opened the list: the bell
// goes back to zero. Only ever moves forward, never past now.
const markSeen = async (req, res) => {
  const now = new Date();
  let upTo = req.body.upTo ? new Date(req.body.upTo) : now;
  if (Number.isNaN(upTo.getTime()) || upTo > now) upTo = now;

  let seenAt = req.user.notificationsSeenAt || null;
  if (!seenAt || upTo > seenAt) {
    // silent: don't touch updatedAt, the profile didn't change.
    await User.update({ notificationsSeenAt: upTo }, { where: { id: req.user.id }, silent: true });
    seenAt = upTo;
  }
  res.status(200).json({ success: true, unread: await unreadOf(req.user.id, seenAt) });
};

// POST /api/notifications/devices { token, platform } — this phone gets
// alerts for your account. alertsReady says whether the server is set up
// to send them (Firebase key present).
const registerDevice = async (req, res) => {
  await push.registerDevice(req.user.id, req.body.token, req.body.platform);
  res.status(200).json({ success: true, alertsReady: push.canSend() });
};

// DELETE /api/notifications/devices { token } — this phone logged out.
const removeDevice = async (req, res) => {
  await push.removeDevice(req.user.id, req.body.token);
  res.status(200).json({ success: true });
};

module.exports = { listNotifications, unreadCount, markSeen, registerDevice, removeDevice };

const { Op, fn, col } = require("sequelize");
const { Post, User, Report, AdminAction } = require("../models");
const notifications = require("../services/notificationService");
const push = require("../services/pushService");

const DAY_MS = 24 * 60 * 60 * 1000;
const PAGE_SIZE = 30;

const webPhoto = (url) => (typeof url === "string" && /^https?:\/\//.test(url) ? url : "");
const pageOf = (req) => Math.min(Math.max(parseInt(req.query.page, 10) || 1, 1), 1000);
const quote = (text, max = 80) => {
  const value = String(text ?? "").replace(/\s+/g, " ").trim();
  return value.length > max ? `${value.slice(0, max - 1)}…` : value;
};

const log = (req, fields) =>
  AdminAction.create({ admin: req.user.id, adminName: req.user.name || "", ...fields });

const closeReports = async (req, filter, resolution) => {
  const [affectedCount] = await Report.update(
    { status: "done", resolvedAt: new Date(), resolvedBy: req.user.id, resolution },
    { where: { ...filter, status: "open" } }
  );
  return affectedCount || 0;
};

const postSummary = (post) => {
  if (!post) return null;
  const photo = [...(post.imageUrls || []), post.imageUrl || ""].find(Boolean) || "";
  return {
    _id: post.id,
    id: post.id,
    title: post.title || "",
    location: post.location || "",
    price: post.price || "",
    status: post.status || "active",
    image: webPhoto(photo),
    removed: Boolean(post.removedAt),
    removedReason: post.removedReason || "",
    sellerBanned: post.sellerBanned === true,
    platform: post.platform || "",
    type: post.type || "",
    deal: post.deal || "",
    views: post.views || 0,
    socialUrl: /^https?:\/\//.test(post.socialUrl || "") ? post.socialUrl : "",
    createdAt: post.createdAt || null,
    expiresAt: post.expiresAt || null,
    expired: Post.isExpired(post),
  };
};

const personSummary = (user) =>
  user && user.id
    ? {
        _id: user.id,
        id: user.id,
        name: user.name || "",
        email: user.email || "",
        phone: user.phone || "",
        role: user.role || "user",
        banned: Boolean(user.bannedAt),
      }
    : null;

const livePosts = () => ({
  removedAt: null,
  sellerBanned: false,
  status: { [Op.notIn]: ["sold", "rented"] },
  expiresAt: { [Op.gt]: new Date() },
});

const getSummary = async (req, res) => {
  const now = Date.now();
  const dayAgo = new Date(now - DAY_MS);
  const weekAgo = new Date(now - 7 * DAY_MS);

  const [
    openReports,
    overdueReports,
    users,
    bannedUsers,
    posts,
    removedPosts,
    activePosts,
    newThisWeek,
  ] = await Promise.all([
    Report.count({ where: { status: "open" } }),
    Report.count({ where: { status: "open", updatedAt: { [Op.lt]: dayAgo } } }),
    User.count(),
    User.count({ where: { bannedAt: { [Op.ne]: null } } }),
    Post.count(),
    Post.count({ where: { removedAt: { [Op.ne]: null } } }),
    Post.count({ where: livePosts() }),
    Post.count({ where: { createdAt: { [Op.gte]: weekAgo } } }),
  ]);

  res.status(200).json({
    success: true,
    admin: { _id: req.user.id, id: req.user.id, name: req.user.name, email: req.user.email },
    summary: {
      openReports,
      overdueReports,
      oldestOpenHours: 0,
      users,
      bannedUsers,
      posts,
      removedPosts,
      activePosts,
      newThisWeek,
      newToday: 0,
      newPostsPerDay: [],
      byPlatform: [],
      sellersWhoPosted: 0,
      views: 0,
      contactTaps: 0,
      shares: 0,
    },
  });
};

const getReports = async (req, res) => {
  const status = req.query.status === "done" ? "done" : "open";
  const where = { status };
  if (["post", "comment", "user"].includes(req.query.kind)) where.kind = req.query.kind;

  const reports = await Report.findAll({
    where,
    order: [["updatedAt", status === "open" ? "ASC" : "DESC"]],
    limit: 500,
  });

  const [openCount, doneCount] = await Promise.all([
    Report.count({ where: { status: "open" } }),
    Report.count({ where: { status: "done" } }),
  ]);

  res.status(200).json({
    success: true,
    status,
    count: reports.length,
    counts: { open: openCount, done: doneCount },
    groups: reports.map((r) => ({
      key: `report:${r.id}`,
      kind: r.kind,
      post: null,
      comment: null,
      person: null,
      reports: [
        {
          _id: r.id,
          reason: r.reason,
          details: r.details || "",
          reporter: null,
          at: r.updatedAt,
          resolution: r.resolution || "",
          resolvedAt: r.resolvedAt || null,
          resolvedBy: "",
        },
      ],
      openedAt: r.createdAt,
      lastAt: r.updatedAt,
      count: 1,
      ageHours: 0,
      overdue: false,
    })),
  });
};

const dismissReports = async (req, res) => {
  const { kind, post, comment, user, reason } = req.body;
  let filter = {};
  if (kind === "post" && post) filter = { kind: "post", post };
  else if (kind === "comment" && comment) filter = { kind: "comment", comment };
  else if (kind === "user" && user) filter = { kind: "user", reportedUser: user };
  else return res.status(400).json({ success: false, message: "Say which post, comment or account." });

  const reportsClosed = await closeReports(req, filter, "dismissed");
  await log(req, {
    action: "dismiss_reports",
    post: kind === "post" ? post : null,
    comment: kind === "comment" ? comment : null,
    user: kind === "user" ? user : null,
    summary: `Reports dismissed on ${kind}`,
    reason: reason || "",
    reportsClosed,
  });
  res.status(200).json({ success: true, reportsClosed, message: `Closed ${reportsClosed} report(s).` });
};

const removePost = async (req, res) => {
  const post = await Post.findByPk(req.params.id);
  if (!post) return res.status(404).json({ success: false, message: "This post no longer exists." });

  const { reason } = req.body;
  post.removedAt = new Date();
  post.removedReason = reason;
  post.removedBy = req.user.id;
  await post.save();

  const reportsClosed = await closeReports(req, { kind: "post", post: post.id }, "removed_post");
  await notifications.removedByAdmin({ userId: post.userId, post, reason });
  await log(req, {
    action: "remove_post",
    post: post.id,
    user: post.userId,
    summary: `Listing "${quote(post.title)}"`,
    reason,
    reportsClosed,
  });
  res.status(200).json({
    success: true,
    reportsClosed,
    message: "Listing removed.",
  });
};

const restorePost = async (req, res) => {
  const post = await Post.findByPk(req.params.id);
  if (!post) return res.status(404).json({ success: false, message: "This post no longer exists." });

  post.removedAt = null;
  post.removedReason = "";
  post.removedBy = null;
  await post.save();

  await notifications.restoredByAdmin({ userId: post.userId, postId: post.id });
  await log(req, {
    action: "restore_post",
    post: post.id,
    user: post.userId,
    summary: `Listing "${quote(post.title)}"`,
    reason: req.body?.reason || "",
  });
  res.status(200).json({ success: true, message: "Listing restored." });
};

const removeComment = async (req, res) => {
  const { id, commentId } = req.params;
  const post = await Post.findByPk(id);
  if (!post) return res.status(404).json({ success: false, message: "Post not found." });

  const comments = post.comments || [];
  post.comments = comments.filter((c) => String(c.id || c._id) !== String(commentId));
  await post.save();

  const reportsClosed = await closeReports(req, { kind: "comment", comment: commentId }, "removed_comment");
  await log(req, {
    action: "remove_comment",
    post: post.id,
    comment: commentId,
    summary: `Comment removed on post ${post.id}`,
    reason: req.body?.reason || "",
    reportsClosed,
  });
  res.status(200).json({ success: true, reportsClosed, message: "Comment removed." });
};

const getPosts = async (req, res) => {
  const page = pageOf(req);
  const offset = (page - 1) * PAGE_SIZE;

  const { rows: posts, count: total } = await Post.findAndCountAll({
    include: [{ model: User, as: "user", attributes: ["id", "name", "email", "role", "bannedAt"] }],
    order: [["createdAt", "DESC"]],
    limit: PAGE_SIZE,
    offset,
  });

  res.status(200).json({
    success: true,
    page,
    total,
    hasMore: offset + posts.length < total,
    counts: { all: total },
    posts: posts.map((post) => ({
      ...postSummary(post),
      createdAt: post.createdAt,
      seller: personSummary(post.user),
      openReports: 0,
    })),
  });
};

// One post in full, for the admin panel's post view: every photo, the
// video, the text, the details, the seller and the comments.
const getPost = async (req, res) => {
  const post = await Post.findByPk(req.params.id, {
    include: [{ model: User, as: "user", attributes: ["id", "name", "email", "phone", "role", "bannedAt"] }],
  });
  if (!post) return res.status(404).json({ success: false, message: "Post not found." });

  const images = [...(post.imageUrls || []), post.imageUrl || ""].map(webPhoto).filter(Boolean);
  const comments = (post.comments || []).map((c) => ({
    _id: String(c.id || c._id || ""),
    name: c.user?.name || "Someone",
    userId: c.user?.id ?? null,
    text: String(c.text ?? ""),
    at: c.createdAt || null,
  }));
  const stats = post.stats || {};

  res.status(200).json({
    success: true,
    post: {
      ...postSummary(post),
      images: [...new Set(images)],
      videoUrl: webPhoto(post.videoUrl),
      videoPoster: webPhoto(post.videoPoster),
      caption: post.caption || "",
      description: post.description || "",
      area: post.area || "",
      bedrooms: post.bedrooms || "",
      bathrooms: post.bathrooms || "",
      sellerName: post.sellerName || "",
      sellerPhone: post.sellerPhone || "",
      likes: Array.isArray(post.likes) ? post.likes.length : 0,
      calls: Number(stats.calls) || 0,
      linkOpens: Number(stats.linkOpens) || 0,
      shares: Number(stats.shares) || 0,
      updatedAt: post.updatedAt,
      seller: personSummary(post.user),
      comments,
    },
  });
};

const getUsers = async (req, res) => {
  const page = pageOf(req);
  const offset = (page - 1) * PAGE_SIZE;

  const { rows: users, count: total } = await User.findAndCountAll({
    order: [["createdAt", "DESC"]],
    limit: PAGE_SIZE,
    offset,
  });

  // How many posts each person on this page has made (all of them, removed included).
  const postCounts = new Map();
  if (users.length) {
    const rows = await Post.findAll({
      attributes: ["userId", [fn("COUNT", col("id")), "count"]],
      where: { userId: users.map((user) => user.id) },
      group: ["userId"],
      raw: true,
    });
    for (const row of rows) postCounts.set(String(row.userId), Number(row.count) || 0);
  }

  res.status(200).json({
    success: true,
    page,
    total,
    hasMore: offset + users.length < total,
    counts: { all: total },
    users: users.map((user) => ({
      ...personSummary(user),
      bannedAt: user.bannedAt,
      banReason: user.banReason || "",
      createdAt: user.createdAt,
      posts: postCounts.get(String(user.id)) || 0,
      openReports: 0,
    })),
  });
};

const POSTS_PER_PERSON = 100;

const getUser = async (req, res) => {
  const user = await User.findByPk(req.params.id);
  if (!user) return res.status(404).json({ success: false, message: "User not found" });

  const [posts, postsTotal] = await Promise.all([
    Post.findAll({ where: { userId: user.id }, order: [["createdAt", "DESC"]], limit: POSTS_PER_PERSON }),
    Post.count({ where: { userId: user.id } }),
  ]);
  const reports = await Report.findAll({ where: { reportedUser: user.id }, limit: 50 });
  const actions = await AdminAction.findAll({ where: { user: user.id }, limit: 50 });

  res.status(200).json({
    success: true,
    user: {
      ...personSummary(user),
      bannedAt: user.bannedAt,
      banReason: user.banReason || "",
      createdAt: user.createdAt,
      agency: user.agency || "",
      profession: user.profession || "",
      location: user.location || "",
      bio: user.bio || "",
    },
    posts: posts.map((post) => ({ ...postSummary(post), createdAt: post.createdAt })),
    postsTotal,
    reports: reports.map((r) => ({
      _id: r.id,
      kind: r.kind,
      reason: r.reason,
      details: r.details || "",
      status: r.status,
      at: r.updatedAt,
      reporter: null,
      postTitle: "",
      commentText: "",
    })),
    actions: actions.map((a) => ({
      _id: a.id,
      action: a.action,
      adminName: a.adminName || "",
      summary: a.summary || "",
      reason: a.reason || "",
      reportsClosed: a.reportsClosed || 0,
      at: a.createdAt,
    })),
  });
};

const banUser = async (req, res) => {
  const { id } = req.params;
  if (String(id) === String(req.user.id)) return res.status(400).json({ success: false, message: "You can't ban yourself." });
  const user = await User.findByPk(id);
  if (!user) return res.status(404).json({ success: false, message: "User not found" });
  if (user.role === "admin") {
    return res.status(400).json({ success: false, message: "Admins can't be banned here." });
  }

  const { reason } = req.body;
  user.bannedAt = new Date();
  user.banReason = reason;
  user.bannedBy = req.user.id;
  user.tokenVersion = (user.tokenVersion || 0) + 1;
  await user.save();

  await Post.update({ sellerBanned: true }, { where: { userId: user.id } });
  await push.removeAllDevices(user.id);
  const reportsClosed = await closeReports(req, { reportedUser: user.id }, "banned_user");

  await log(req, {
    action: "ban_user",
    user: user.id,
    summary: `Account ${user.name}`,
    reason,
    reportsClosed,
  });
  res.status(200).json({
    success: true,
    reportsClosed,
    message: `${user.name} is banned.`,
  });
};

const unbanUser = async (req, res) => {
  const { id } = req.params;
  const user = await User.findByPk(id);
  if (!user) return res.status(404).json({ success: false, message: "User not found" });

  user.bannedAt = null;
  user.banReason = "";
  user.bannedBy = null;
  await user.save();

  await Post.update({ sellerBanned: false }, { where: { userId: user.id } });
  await log(req, {
    action: "unban_user",
    user: user.id,
    summary: `Account ${user.name}`,
    reason: req.body?.reason || "",
  });
  res.status(200).json({ success: true, message: `${user.name} is unbanned.` });
};

const getAudit = async (req, res) => {
  const page = pageOf(req);
  const { rows: actions, count: total } = await AdminAction.findAndCountAll({
    order: [["createdAt", "DESC"]],
    limit: 50,
    offset: (page - 1) * 50,
  });

  res.status(200).json({
    success: true,
    page,
    total,
    hasMore: page * 50 < total,
    admins: [],
    actions: actions.map((a) => ({
      _id: a.id,
      action: a.action,
      adminName: a.adminName || "",
      summary: a.summary || "",
      reason: a.reason || "",
      reportsClosed: a.reportsClosed || 0,
      post: a.post || null,
      user: a.user || null,
      at: a.createdAt,
    })),
  });
};

module.exports = {
  getSummary,
  getReports,
  dismissReports,
  removePost,
  restorePost,
  removeComment,
  getPosts,
  getPost,
  getUsers,
  getUser,
  banUser,
  unbanUser,
  getAudit,
};

// The admin panel's API (/api/admin/...). Every route needs an admin login
// (routes/adminRoutes.js). Every action is written to the audit log.
const mongoose = require("mongoose");
const Post = require("../models/Post");
const User = require("../models/User");
const Report = require("../models/Report");
const AdminAction = require("../models/AdminAction");
const notifications = require("../services/notificationService");
const push = require("../services/pushService");

const DAY_MS = 24 * 60 * 60 * 1000;
const PAGE_SIZE = 30;

const isId = (value) => typeof value === "string" && /^[a-f0-9]{24}$/i.test(value);
const oid = (value) => new mongoose.Types.ObjectId(String(value));
const webPhoto = (url) => (typeof url === "string" && /^https?:\/\//.test(url) ? url : "");
const escapeRegex = (text) => String(text).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const pageOf = (req) => Math.min(Math.max(parseInt(req.query.page, 10) || 1, 1), 1000);
const quote = (text, max = 80) => {
  const value = String(text ?? "").replace(/\s+/g, " ").trim();
  return value.length > max ? `${value.slice(0, max - 1)}…` : value;
};

const log = (req, fields) =>
  AdminAction.create({ admin: req.user._id, adminName: req.user.name || "", ...fields });

// Marks the matching open reports done. Returns how many.
const closeReports = async (req, filter, resolution) => {
  const result = await Report.updateMany(
    { ...filter, status: "open" },
    { $set: { status: "done", resolvedAt: new Date(), resolvedBy: req.user._id, resolution } }
  );
  return result.modifiedCount || 0;
};

const postSummary = (post) => {
  if (!post || !post._id) return null;
  const photo = [...(post.imageUrls || []), post.imageUrl || ""].find(Boolean) || "";
  return {
    _id: post._id,
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
  user && user._id
    ? {
        _id: user._id,
        name: user.name || "",
        email: user.email || "",
        phone: user.phone || "",
        role: user.role || "user",
        banned: Boolean(user.bannedAt),
      }
    : null;

// ------------------------------------------------------------------ summary

// Days in India time ("2026-11-23"), for the new-posts chart.
const IST_MS = 330 * 60 * 1000;
const istDay = (date) => new Date(new Date(date).getTime() + IST_MS).toISOString().slice(0, 10);
// Live = what the feed shows (not removed, seller not banned, not sold or
// rented, not expired). A function because "now" moves.
const livePosts = () => ({
  removedAt: null,
  sellerBanned: { $ne: true },
  status: { $nin: ["sold", "rented"] },
  ...Post.notExpired(),
});

// GET /api/admin/summary — the Dashboard numbers.
const getSummary = async (req, res) => {
  const now = Date.now();
  const dayAgo = new Date(now - DAY_MS);
  const weekAgo = new Date(now - 7 * DAY_MS);
  // The chart: today and the 13 days before it, in India time.
  const days = Array.from({ length: 14 }, (_, i) => istDay(now - (13 - i) * DAY_MS));
  const chartStart = new Date(Date.parse(`${days[0]}T00:00:00+05:30`));

  const [
    openReports,
    overdueReports,
    oldest,
    users,
    bannedUsers,
    posts,
    removedPosts,
    activePosts,
    newThisWeek,
    recent,
    platforms,
    sellers,
    totals,
  ] = await Promise.all([
    Report.countDocuments({ status: "open" }),
    Report.countDocuments({ status: "open", updatedAt: { $lt: dayAgo } }),
    Report.findOne({ status: "open" }).sort({ updatedAt: 1 }).select("updatedAt").lean(),
    User.countDocuments(),
    User.countDocuments({ bannedAt: { $ne: null } }),
    Post.countDocuments(),
    Post.countDocuments({ removedAt: { $ne: null } }),
    Post.countDocuments(livePosts()),
    Post.countDocuments({ createdAt: { $gte: weekAgo } }),
    Post.find({ createdAt: { $gte: chartStart } }).select("createdAt").lean(),
    Post.aggregate([{ $match: livePosts() }, { $group: { _id: "$platform", n: { $sum: 1 } } }]),
    Post.distinct("user", livePosts()),
    Post.aggregate([
      {
        $group: {
          _id: null,
          views: { $sum: "$views" },
          calls: { $sum: "$stats.calls" },
          linkOpens: { $sum: "$stats.linkOpens" },
          shares: { $sum: "$stats.shares" },
        },
      },
    ]),
  ]);

  const perDay = new Map(days.map((day) => [day, 0]));
  for (const post of recent) {
    const day = istDay(post.createdAt);
    if (perDay.has(day)) perDay.set(day, perDay.get(day) + 1);
  }
  const sums = totals[0] || {};

  res.status(200).json({
    success: true,
    admin: { _id: req.user._id, name: req.user.name, email: req.user.email },
    summary: {
      openReports,
      overdueReports,
      oldestOpenHours: oldest ? Math.floor((now - new Date(oldest.updatedAt)) / 3600000) : null,
      users,
      bannedUsers,
      posts,
      removedPosts,
      activePosts,
      newThisWeek,
      newToday: perDay.get(days[days.length - 1]) || 0,
      newPostsPerDay: days.map((day) => ({ day, count: perDay.get(day) })),
      byPlatform: platforms
        .map((p) => ({ platform: p._id || "Other", count: p.n }))
        .sort((a, b) => b.count - a.count),
      sellersWhoPosted: sellers.length,
      views: sums.views || 0,
      contactTaps: (sums.calls || 0) + (sums.linkOpens || 0),
      shares: sums.shares || 0,
    },
  });
};

// ------------------------------------------------------------------ reports

// GET /api/admin/reports?status=open|done&kind=post|comment|user
// Reports grouped by what was reported. Open ones: the oldest first, with
// how long they've been waiting; over 24 hours = overdue.
const getReports = async (req, res) => {
  const status = req.query.status === "done" ? "done" : "open";
  const filter = { status };
  if (Report.REPORT_KINDS.includes(req.query.kind)) filter.kind = req.query.kind;

  const reports = await Report.find(filter)
    .sort({ updatedAt: status === "open" ? 1 : -1 })
    .limit(500)
    .populate("reporter", "name email")
    .populate("resolvedBy", "name")
    .populate("reportedUser", "name email phone role bannedAt")
    .populate({
      path: "post",
      select:
        "title location price status imageUrls imageUrl removedAt removedReason sellerBanned user platform type deal views socialUrl createdAt expiresAt",
      populate: { path: "user", select: "name email phone role bannedAt" },
    })
    .lean();

  const groups = new Map();
  for (const report of reports) {
    const kind = report.kind || "post";
    const key =
      kind === "user"
        ? `user:${report.reportedUser?._id ?? report.reportedUser}`
        : kind === "comment"
          ? `comment:${report.comment}`
          : `post:${report.post?._id ?? report.post}`;
    if (!groups.has(key)) {
      groups.set(key, {
        key,
        kind,
        post: postSummary(report.post),
        postId: report.post?._id ?? report.post ?? null,
        comment: kind === "comment" ? { _id: report.comment, text: report.commentText || "" } : null,
        person: personSummary(report.reportedUser) || personSummary(report.post?.user),
        reports: [],
        openedAt: report.updatedAt,
        lastAt: report.updatedAt,
      });
    }
    const group = groups.get(key);
    group.reports.push({
      _id: report._id,
      reason: report.reason,
      details: report.details || "",
      reporter: personSummary(report.reporter),
      at: report.updatedAt,
      resolution: report.resolution || "",
      resolvedAt: report.resolvedAt || null,
      resolvedBy: report.resolvedBy?.name || "",
    });
    if (report.updatedAt < group.openedAt) group.openedAt = report.updatedAt;
    if (report.updatedAt > group.lastAt) group.lastAt = report.updatedAt;
  }

  const now = Date.now();
  const list = [...groups.values()].map((group) => {
    const ageHours = Math.floor((now - new Date(group.openedAt)) / 3600000);
    return { ...group, count: group.reports.length, ageHours, overdue: status === "open" && ageHours >= 24 };
  });
  if (status === "open") {
    list.sort((a, b) => Number(b.overdue) - Number(a.overdue) || new Date(a.openedAt) - new Date(b.openedAt));
  }
  const [openCount, doneCount] = await Promise.all([
    Report.countDocuments({ status: "open" }),
    Report.countDocuments({ status: "done" }),
  ]);
  res.status(200).json({
    success: true,
    status,
    count: list.length,
    counts: { open: openCount, done: doneCount },
    groups: list,
  });
};

// POST /api/admin/reports/dismiss { kind, post | comment | user, reason }
// Nothing wrong: close the open reports about that item.
const dismissReports = async (req, res) => {
  const { kind, post, comment, user, reason } = req.body;
  let filter;
  let summary;
  if (kind === "post" && isId(post)) {
    filter = { kind: "post", post: oid(post) };
    const found = await Post.findById(post).select("title").lean();
    summary = `Reports on listing "${quote(found?.title || "deleted")}"`;
  } else if (kind === "comment" && isId(comment)) {
    filter = { kind: "comment", comment: oid(comment) };
    const one = await Report.findOne(filter).select("commentText").lean();
    summary = `Reports on comment "${quote(one?.commentText || "")}"`;
  } else if (kind === "user" && isId(user)) {
    filter = { kind: "user", reportedUser: oid(user) };
    const found = await User.findById(user).select("name email").lean();
    summary = `Reports on account ${found ? `${found.name} <${found.email}>` : "(deleted)"}`;
  } else {
    return res.status(400).json({ success: false, message: "Say which post, comment or account." });
  }
  const reportsClosed = await closeReports(req, filter, "dismissed");
  await log(req, {
    action: "dismiss_reports",
    post: kind === "post" ? oid(post) : null,
    comment: kind === "comment" ? oid(comment) : null,
    user: kind === "user" ? oid(user) : null,
    summary,
    reason: reason || "",
    reportsClosed,
  });
  res.status(200).json({ success: true, reportsClosed, message: `Closed ${reportsClosed} report(s). Nothing was removed.` });
};

// ------------------------------------------------------------------ listings

// POST /api/admin/posts/:id/remove { reason } — hidden from everyone but the
// seller, who is told why. Its open reports are closed.
const removePost = async (req, res) => {
  if (!isId(req.params.id)) return res.status(400).json({ success: false, message: "Invalid post ID." });
  const post = await Post.findById(req.params.id).populate("user", "name email").lean();
  if (!post) return res.status(404).json({ success: false, message: "This post no longer exists." });

  const { reason } = req.body;
  await Post.updateOne(
    { _id: post._id },
    { $set: { removedAt: new Date(), removedReason: reason, removedBy: req.user._id } },
    { timestamps: false }
  );
  const reportsClosed = await closeReports(req, { kind: "post", post: post._id }, "removed_post");
  await notifications.removedByAdmin({ userId: post.user?._id, post, reason });
  await log(req, {
    action: "remove_post",
    post: post._id,
    user: post.user?._id ?? null,
    summary: `Listing "${quote(post.title)}" by ${post.user?.name || "(deleted account)"}`,
    reason,
    reportsClosed,
  });
  res.status(200).json({
    success: true,
    reportsClosed,
    message: "Listing removed. The seller sees it as removed, with your reason.",
  });
};

// POST /api/admin/posts/:id/restore — puts a removed listing back.
const restorePost = async (req, res) => {
  if (!isId(req.params.id)) return res.status(400).json({ success: false, message: "Invalid post ID." });
  const post = await Post.findById(req.params.id).populate("user", "name").lean();
  if (!post) return res.status(404).json({ success: false, message: "This post no longer exists." });
  if (!post.removedAt) return res.status(400).json({ success: false, message: "This listing isn't removed." });

  await Post.updateOne(
    { _id: post._id },
    { $set: { removedAt: null, removedReason: "", removedBy: null } },
    { timestamps: false }
  );
  await notifications.restoredByAdmin({ userId: post.user?._id, postId: post._id });
  await log(req, {
    action: "restore_post",
    post: post._id,
    user: post.user?._id ?? null,
    summary: `Listing "${quote(post.title)}" by ${post.user?.name || "(deleted account)"}`,
    reason: req.body?.reason || "",
  });
  res.status(200).json({ success: true, message: "Listing restored." });
};

// POST /api/admin/posts/:id/comments/:commentId/remove { reason }
const removeComment = async (req, res) => {
  const { id, commentId } = req.params;
  if (!isId(id) || !isId(commentId)) {
    return res.status(400).json({ success: false, message: "Invalid post or comment ID." });
  }
  const { reason } = req.body;
  const post = await Post.collection.findOne({ _id: oid(id) }, { projection: { title: 1, comments: 1 } });
  const comment = (post?.comments || []).find((item) => String(item._id) === commentId);

  if (comment) {
    await Post.collection.updateOne({ _id: post._id }, { $pullAll: { comments: [comment] } });
    await notifications.commentRemoved(post._id);
    await notifications.removedByAdmin({ userId: comment.user, post, commentId: comment._id, reason });
  }
  const reportsClosed = await closeReports(req, { kind: "comment", comment: oid(commentId) }, "removed_comment");
  const author = comment?.user ? await User.findById(comment.user).select("name").lean() : null;
  await log(req, {
    action: "remove_comment",
    post: post?._id ?? null,
    comment: oid(commentId),
    user: comment?.user ?? null,
    summary: comment
      ? `Comment by ${author?.name || "(deleted account)"} on "${quote(post.title)}": "${quote(comment.text, 120)}"`
      : "Comment (already deleted)",
    reason,
    reportsClosed,
  });
  res.status(200).json({
    success: true,
    reportsClosed,
    message: comment ? "Comment removed. The author was told why." : "This comment was already deleted; its reports are closed.",
  });
};

// GET /api/admin/posts?q=&filter=all|removed&page= — search listings.
const getPosts = async (req, res) => {
  const page = pageOf(req);
  // Search and platform apply to every tab; the tab picks the status.
  const base = {};
  const q = String(req.query.q || "").trim().slice(0, 80);
  if (q) {
    const pattern = { $regex: escapeRegex(q), $options: "i" };
    const sellers = await User.find({ $or: [{ name: pattern }, { email: pattern }] }).select("_id").limit(200).lean();
    base.$or = [{ title: pattern }, { location: pattern }, { user: { $in: sellers.map((s) => s._id) } }];
    if (isId(q)) base.$or.push({ _id: oid(q) });
  }
  if (typeof req.query.platform === "string" && req.query.platform && req.query.platform !== "all") {
    base.platform = req.query.platform.slice(0, 20);
  }
  const TABS = {
    all: {},
    live: livePosts(),
    expired: { removedAt: null, status: { $nin: ["sold", "rented"] }, expiresAt: { $lte: new Date() } },
    removed: { removedAt: { $ne: null } },
    sold: { status: { $in: ["sold", "rented"] } },
    banned: { sellerBanned: true },
  };
  const tab = TABS[req.query.filter] ? req.query.filter : "all";
  const filter = { ...base, ...TABS[tab] };
  const countEntries = await Promise.all(
    Object.entries(TABS).map(async ([name, extra]) => [name, await Post.countDocuments({ ...base, ...extra })])
  );
  const [posts, total] = await Promise.all([
    Post.find(filter)
      .sort({ createdAt: -1, _id: -1 })
      .skip((page - 1) * PAGE_SIZE)
      .limit(PAGE_SIZE)
      .select("title location price status imageUrls imageUrl removedAt removedReason sellerBanned user createdAt platform type deal views socialUrl expiresAt")
      .populate("user", "name email phone role bannedAt")
      .lean(),
    Post.countDocuments(filter),
  ]);
  const openCounts = posts.length
    ? await Report.aggregate([
        { $match: { status: "open", kind: "post", post: { $in: posts.map((p) => p._id) } } },
        { $group: { _id: "$post", n: { $sum: 1 } } },
      ])
    : [];
  const openById = new Map(openCounts.map((c) => [String(c._id), c.n]));
  res.status(200).json({
    success: true,
    page,
    total,
    hasMore: page * PAGE_SIZE < total,
    counts: Object.fromEntries(countEntries),
    posts: posts.map((post) => ({
      ...postSummary(post),
      createdAt: post.createdAt,
      seller: personSummary(post.user),
      openReports: openById.get(String(post._id)) || 0,
    })),
  });
};

// ------------------------------------------------------------------ people

// GET /api/admin/users?q=&filter=all|banned|admins&page=
const getUsers = async (req, res) => {
  const page = pageOf(req);
  const base = {};
  const q = String(req.query.q || "").trim().slice(0, 80);
  if (q) {
    const pattern = { $regex: escapeRegex(q), $options: "i" };
    base.$or = [{ name: pattern }, { email: pattern }, { phone: pattern }];
    if (isId(q)) base.$or.push({ _id: oid(q) });
  }
  const TABS = {
    all: {},
    active: { bannedAt: null },
    banned: { bannedAt: { $ne: null } },
    admins: { role: "admin" },
  };
  const tab = TABS[req.query.filter] ? req.query.filter : "all";
  const filter = { ...base, ...TABS[tab] };
  const countEntries = await Promise.all(
    Object.entries(TABS).map(async ([name, extra]) => [name, await User.countDocuments({ ...base, ...extra })])
  );
  const [users, total] = await Promise.all([
    User.find(filter)
      .sort({ createdAt: -1, _id: -1 })
      .skip((page - 1) * PAGE_SIZE)
      .limit(PAGE_SIZE)
      .select("name email phone role bannedAt banReason createdAt")
      .lean(),
    User.countDocuments(filter),
  ]);
  const ids = users.map((u) => u._id);
  const [postCounts, reportCounts] = ids.length
    ? await Promise.all([
        Post.aggregate([{ $match: { user: { $in: ids } } }, { $group: { _id: "$user", n: { $sum: 1 } } }]),
        Report.aggregate([
          { $match: { status: "open", reportedUser: { $in: ids } } },
          { $group: { _id: "$reportedUser", n: { $sum: 1 } } },
        ]),
      ])
    : [[], []];
  const posts = new Map(postCounts.map((c) => [String(c._id), c.n]));
  const reportsAgainst = new Map(reportCounts.map((c) => [String(c._id), c.n]));
  res.status(200).json({
    success: true,
    page,
    total,
    hasMore: page * PAGE_SIZE < total,
    counts: Object.fromEntries(countEntries),
    users: users.map((user) => ({
      ...personSummary(user),
      bannedAt: user.bannedAt,
      banReason: user.banReason || "",
      createdAt: user.createdAt,
      posts: posts.get(String(user._id)) || 0,
      openReports: reportsAgainst.get(String(user._id)) || 0,
    })),
  });
};

// GET /api/admin/users/:id — one account: details, listings, reports about
// them and what admins did.
const getUser = async (req, res) => {
  if (!isId(req.params.id)) return res.status(400).json({ success: false, message: "Invalid user ID." });
  const user = await User.findById(req.params.id)
    .select("name email phone role bannedAt banReason bannedBy createdAt agency profession location bio")
    .lean();
  if (!user) return res.status(404).json({ success: false, message: "User not found" });
  const [posts, reports, actions] = await Promise.all([
    Post.find({ user: user._id })
      .sort({ createdAt: -1 })
      .limit(100)
      .select("title location price status imageUrls imageUrl removedAt removedReason sellerBanned createdAt platform type deal views socialUrl expiresAt")
      .lean(),
    Report.find({ reportedUser: user._id })
      .sort({ updatedAt: -1 })
      .limit(50)
      .populate("reporter", "name email")
      .populate("post", "title")
      .lean(),
    AdminAction.find({ user: user._id }).sort({ createdAt: -1 }).limit(50).lean(),
  ]);
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
    reports: reports.map((report) => ({
      _id: report._id,
      kind: report.kind || "post",
      reason: report.reason,
      details: report.details || "",
      status: report.status,
      at: report.updatedAt,
      reporter: personSummary(report.reporter),
      postTitle: report.post?.title || "",
      commentText: report.commentText || "",
    })),
    actions: actions.map(toActionItem),
  });
};

// POST /api/admin/users/:id/ban { reason } — logs them out everywhere, refuses
// new logins, hides their listings and comments. Closes reports about them.
const banUser = async (req, res) => {
  const { id } = req.params;
  if (!isId(id)) return res.status(400).json({ success: false, message: "Invalid user ID." });
  if (id === String(req.user._id)) return res.status(400).json({ success: false, message: "You can't ban yourself." });
  const user = await User.findById(id).select("name email role bannedAt").lean();
  if (!user) return res.status(404).json({ success: false, message: "User not found" });
  if (user.role === "admin") {
    return res.status(400).json({ success: false, message: "Admins can't be banned here. Remove their admin role first." });
  }

  const { reason } = req.body;
  await User.updateOne(
    { _id: user._id },
    {
      $set: { bannedAt: new Date(), banReason: reason, bannedBy: req.user._id },
      // Ends every login they have.
      $inc: { tokenVersion: 1 },
    }
  );
  await Post.updateMany({ user: user._id }, { $set: { sellerBanned: true } }, { timestamps: false });
  await push.removeAllDevices(user._id);
  const reportsClosed = await closeReports(req, { reportedUser: user._id }, "banned_user");
  await log(req, {
    action: "ban_user",
    user: user._id,
    summary: `Account ${user.name} <${user.email}>`,
    reason,
    reportsClosed,
  });
  res.status(200).json({
    success: true,
    reportsClosed,
    message: `${user.name} is banned. Their logins ended and their listings and comments are hidden.`,
  });
};

// POST /api/admin/users/:id/unban
const unbanUser = async (req, res) => {
  const { id } = req.params;
  if (!isId(id)) return res.status(400).json({ success: false, message: "Invalid user ID." });
  const user = await User.findById(id).select("name email bannedAt").lean();
  if (!user) return res.status(404).json({ success: false, message: "User not found" });
  if (!user.bannedAt) return res.status(400).json({ success: false, message: "This account isn't banned." });

  await User.updateOne({ _id: user._id }, { $set: { bannedAt: null, banReason: "", bannedBy: null } });
  await Post.updateMany({ user: user._id }, { $set: { sellerBanned: false } }, { timestamps: false });
  await log(req, {
    action: "unban_user",
    user: user._id,
    summary: `Account ${user.name} <${user.email}>`,
    reason: req.body?.reason || "",
  });
  res.status(200).json({ success: true, message: `${user.name} is unbanned. They can log in again.` });
};

// ------------------------------------------------------------------ audit log

const toActionItem = (action) => ({
  _id: action._id,
  action: action.action,
  adminName: action.adminName || "",
  summary: action.summary || "",
  reason: action.reason || "",
  reportsClosed: action.reportsClosed || 0,
  post: action.post || null,
  user: action.user || null,
  at: action.createdAt,
});

// GET /api/admin/audit?page= — newest first, 50 a page.
const getAudit = async (req, res) => {
  const page = pageOf(req);
  const size = 50;
  const filter = {};
  const q = String(req.query.q || "").trim().slice(0, 80);
  if (q) {
    const pattern = { $regex: escapeRegex(q), $options: "i" };
    filter.$or = [{ summary: pattern }, { reason: pattern }, { adminName: pattern }];
  }
  if (typeof req.query.who === "string" && req.query.who && req.query.who !== "all") {
    filter.adminName = req.query.who.slice(0, 80);
  }
  const [actions, total, admins] = await Promise.all([
    AdminAction.find(filter).sort({ createdAt: -1, _id: -1 }).skip((page - 1) * size).limit(size).lean(),
    AdminAction.countDocuments(filter),
    AdminAction.distinct("adminName"),
  ]);
  res.status(200).json({
    success: true,
    page,
    total,
    hasMore: page * size < total,
    admins: admins.filter(Boolean).sort(),
    actions: actions.map(toActionItem),
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
  getUsers,
  getUser,
  banUser,
  unbanUser,
  getAudit,
};

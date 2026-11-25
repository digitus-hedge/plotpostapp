const crypto = require("crypto");
const mongoose = require("mongoose");
const Post = require("../models/Post");
const Follow = require("../models/Follow");
const PostView = require("../models/PostView");
const User = require("../models/User");
const Report = require("../models/Report");
const cloudinary = require("../config/cloudinary");
const notifications = require("../services/notificationService");
const { saveReport } = require("../services/reportService");
const { feedFiltersSchema } = require("../validators/postValidators");
const { maskPhoneNumbers } = require("../utils/phoneMask");

const getPostFields = (body) => ({
  title: body.title,
  type: body.type,
  deal: body.deal,
  price: body.price,
  location: body.location,
  description: body.description,
  socialUrl: body.socialUrl,
  sellerPhone: body.sellerPhone,
  area: body.area,
  bedrooms: body.bedrooms,
  bathrooms: body.bathrooms,
  platform: body.platform,
  sellerName: body.sellerName,
  video: body.video,
});

// Works out the Cloudinary ID of one of OUR photos from its link, e.g.
// https://res.cloudinary.com/<cloud>/image/upload/v123/plotpost/posts/abc.jpg
// -> plotpost/posts/abc. Anything else (YouTube thumbnails, old base64
// photos, other people's Cloudinary accounts) returns null and is never deleted.
const cloudinaryPublicId = (url) => {
  const cloud = process.env.CLOUDINARY_CLOUD_NAME;
  if (!cloud || typeof url !== "string") return null;
  const prefix = `https://res.cloudinary.com/${cloud}/image/upload/`;
  if (!url.startsWith(prefix)) return null;
  const parts = url.slice(prefix.length).split("/");
  while (parts.length && (/^v\d+$/.test(parts[0]) || parts[0].includes(","))) parts.shift();
  const id = parts.join("/").replace(/\.[a-z0-9]+$/i, "");
  return id.startsWith("plotpost/") ? id : null;
};

// Deletes photos from Cloudinary. Failures are only logged: a leftover file
// must never stop someone from deleting or editing their post.
const deleteCloudinaryPhotos = async (urls) => {
  const ids = [...new Set(urls.map(cloudinaryPublicId).filter(Boolean))];
  await Promise.all(
    ids.map((id) =>
      cloudinary.uploader.destroy(id).catch((error) => {
        if (process.env.NODE_ENV !== "test") console.warn("Cloudinary delete failed:", id, error.message);
      })
    )
  );
};

// Photo rules. New photos must be web links (uploaded to Cloudinary first
// with POST /api/upload); base64 text is no longer accepted. When editing,
// photos the post already had (including older base64 ones) may stay.
const isWebLink = (url) => typeof url === "string" && /^https?:\/\/\S+$/i.test(url) && url.length <= 1000;

const checkPhotos = (imageUrls, { platform, existing = [] }) => {
  const kept = new Set(existing);
  if (imageUrls.some((url) => !isWebLink(url) && !kept.has(url))) {
    return "Photos must be uploaded first. Please update the app and try again.";
  }
  if (platform === "PlotPost" && imageUrls.length === 0) {
    return "Please add at least one photo.";
  }
  return null;
};

// CREATE POST
const createPost = async (req, res) => {
  try {
    // Fields are already checked by validators/postValidators.js.
    const { title, description, imageUrls } = req.body;
    const validationMessage = checkPhotos(imageUrls, { platform: req.body.platform });
    if (validationMessage) {
      return res.status(400).json({
        success: false,
        message: validationMessage,
      });
    }

    const post = await Post.create({
      user: req.user._id,
      caption: description || title,
      ...getPostFields(req.body),
      imageUrls,
    });

    const populatedPost = await Post.findById(post._id)
      .populate("user", "name email profileImage");

    res.status(201).json({
      success: true,
      message: "Post created successfully",
      post: populatedPost,
    });

  } catch (error) {
    console.error("Create post error:", error);
    res.status(500).json({
      success: false,
      message: "Failed to create post",
    });
  }
};

// UPDATE POST

const updatePost = async (req, res) => {
  try {
    const post = await Post.findById(req.params.id);

    if (!post) {
      return res.status(404).json({
        success: false,
        message: "Post not found.",
      });
    }

    if (post.user.toString() !== req.user._id.toString()) {
      return res.status(403).json({
        success: false,
        message: "You cannot edit this post.",
      });
    }

const updates = Object.fromEntries(
  Object.entries(getPostFields(req.body)).filter(
    ([key, value]) => value !== undefined
  )
);
    // Check the photos the post will end up with.
    const imageUrls = req.body.imageUrls ?? post.imageUrls;
    const validationMessage = checkPhotos(imageUrls, {
      platform: updates.platform ?? post.platform,
      existing: post.imageUrls,
    });

    if (validationMessage) {
      return res.status(400).json({
        success: false,
        message: validationMessage,
      });
    }

    const previousPhotos = [...(post.imageUrls || [])];
    Object.assign(post, updates);

    // Update images only when imageUrls is explicitly provided.
    if (req.body.imageUrls !== undefined) {
      post.imageUrls = imageUrls;
    }

    // Keep caption synchronized when description is changed.
    if (req.body.description !== undefined) {
      post.caption = req.body.description;
    }

    await post.save();

    // Photos removed in this edit are deleted from Cloudinary.
    const removedPhotos = previousPhotos.filter((url) => !post.imageUrls.includes(url));
    await deleteCloudinaryPhotos(removedPhotos);

    const populatedPost = await Post.findById(post._id)
      .populate("user", "name email profileImage");

    return res.status(200).json({
      success: true,
      message: "Post updated successfully.",
      post: populatedPost,
    });
  } catch (error) {
    console.error("Update post error:", error);

    return res.status(500).json({
      success: false,
      message: "Failed to update post.",
    });
  }
};



// Posts everyone can see: not removed by an admin, seller not banned.
// (Older posts have neither field: visible.)
const VISIBLE_POSTS = { removedAt: null, sellerBanned: { $ne: true } };
const isHiddenPost = (post) => Boolean(post?.removedAt) || post?.sellerBanned === true;

// Listings the feed shows: visible, not sold or rented, not expired.
// (Older posts with no status count as active.)
const liveListings = () => ({ ...VISIBLE_POSTS, status: { $nin: ["sold", "rented"] }, ...Post.notExpired() });

// The people the viewer blocked (their posts and comments are hidden from
// the viewer). Empty for guests.
const blockedIdsOf = (user) => (user?.blockedUsers || []).map((id) => new mongoose.Types.ObjectId(String(id)));

// Escapes text so it can be used inside a regular expression safely.
const escapeRegex = (text) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

// Search box: the post fields one word is looked for in (any case).
// Not the platform: "plot" would match every "PlotPost" post (the platform
// tabs cover that anyway).
const SEARCH_FIELDS = ["title", "caption", "description", "location", "type", "deal", "sellerName"];
const MAX_SEARCH_WORDS = 6;

// One search word: found in any of the fields above, or in the account name
// of the seller who posted it.
const searchConditionFor = async (word) => {
  const pattern = { $regex: escapeRegex(word), $options: "i" };
  const sellers = await User.find({ name: pattern }).select("_id").limit(200).lean();
  return {
    $or: [
      ...SEARCH_FIELDS.map((field) => ({ [field]: pattern })),
      ...(sellers.length ? [{ user: { $in: sellers.map((seller) => seller._id) } }] : []),
    ],
  };
};

// What the app gets for each post in a list: the post fields, the seller's
// name and photo, like/comment counts and whether *you* liked it. The full
// likes and comments arrays stay on the server.
// Tap counts (calls, link opens) are included only when the viewer is the seller.
// People who aren't logged in don't get the seller's phone (hasPhone tells
// the app there is one, so it can say "Log in to see the number"), and phone
// numbers written in the post text are hidden too.
const forGuests = (item) => ({
  ...item,
  sellerPhone: "",
  phoneHidden: true,
  title: maskPhoneNumbers(item.title),
  caption: maskPhoneNumbers(item.caption),
  description: maskPhoneNumbers(item.description),
  sellerName: maskPhoneNumbers(item.sellerName),
  ...(item.user && typeof item.user === "object" && item.user.name
    ? { user: { ...item.user, name: maskPhoneNumbers(item.user.name) } }
    : {}),
});

const toFeedItem = (post, viewerId) => {
  const {
    likes = [],
    comments = [],
    stats,
    removedBy,
    sellerBanned,
    expiryReminderAt,
    expiredNoticeAt,
    ...fields
  } = post;
  const ownerId = post.user?._id ?? post.user;
  const isOwner = Boolean(viewerId) && String(ownerId) === String(viewerId);
  const item = {
    ...fields,
    hasPhone: Boolean(String(post.sellerPhone || "").trim()),
    // Active but past its 90 days: out of the feed until the seller renews.
    isExpired: Post.isExpired(post),
    views: post.views || 0,
    likesCount: likes.length,
    commentsCount: comments.length,
    isLiked: Boolean(viewerId) && likes.some((id) => String(id) === String(viewerId)),
    ...(isOwner
      ? {
          stats: {
            calls: stats?.calls || 0,
            linkOpens: stats?.linkOpens || 0,
            shares: stats?.shares || 0,
          },
        }
      : {}),
  };
  return viewerId ? item : forGuests(item);
};

// "user:<id>" for logged-in people, "ip:<hash>" for guests. The internet
// address is never stored as-is, only as a keyed one-way hash.
const viewerKey = (req) => {
  if (req.user) return `user:${req.user._id}`;
  const hash = crypto
    .createHmac("sha256", process.env.JWT_SECRET || "plotpost")
    .update(String(req.ip || ""))
    .digest("hex")
    .slice(0, 32);
  return `ip:${hash}`;
};

// Today's date in India time ("2026-11-21"): "once a day" resets at midnight IST.
const todayInIndia = () => new Date(Date.now() + 330 * 60 * 1000).toISOString().slice(0, 10);

// Records one view/call/link tap per person per post per day. Returns true
// when it was counted (the first time today), false for a repeat.
const countOncePerDay = async (req, postId, kind) => {
  try {
    await PostView.create({ post: postId, viewer: viewerKey(req), kind, day: todayInIndia() });
    return true;
  } catch (error) {
    if (error?.code === 11000) return false; // already counted today
    throw error;
  }
};

const isOwnPost = (req, post) => Boolean(req.user) && String(post.user) === String(req.user._id);

// GET /api/posts/:id — the latest copy of one post, for the details page.
// Guests allowed. Includes the seller's public details and, for logged-in
// users, whether they follow the seller.
const getPostById = async (req, res) => {
  try {
    if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
      return res.status(400).json({ success: false, message: "Invalid post ID." });
    }
    const post = await Post.findById(req.params.id).populate("user", "name profileImage createdAt").lean();
    if (!post || !post.user) {
      return res.status(404).json({ success: false, message: "This post is no longer available." });
    }

    const sellerId = post.user._id;
    const isYou = Boolean(req.user) && String(req.user._id) === String(sellerId);
    // Removed listings and banned sellers' listings: only the seller (and
    // admins) can still open them.
    if (isHiddenPost(post) && !isYou && req.user?.role !== "admin") {
      return res.status(404).json({
        success: false,
        message: post.removedAt
          ? "This listing was removed by PlotPost."
          : "This post is no longer available.",
      });
    }
    const [postsCount, followersCount, follows] = await Promise.all([
      Post.countDocuments({ user: sellerId }),
      Follow.countDocuments({ following: sellerId }),
      req.user && !isYou ? Follow.exists({ follower: req.user._id, following: sellerId }) : null,
    ]);

    res.status(200).json({
      success: true,
      post: toFeedItem(post, req.user?._id),
      seller: {
        id: sellerId,
        _id: sellerId,
        name: post.user.name,
        profileImage: post.user.profileImage || "",
        postsCount,
        followersCount,
        memberSince: post.user.createdAt,
        isFollowing: Boolean(follows),
        isYou,
        // The seller card shows Unblock instead of Block.
        blockedByMe: blockedIdsOf(req.user).some((id) => String(id) === String(sellerId)),
      },
    });
  } catch (error) {
    console.error("Get post error:", error);
    res.status(500).json({ success: false, message: "Failed to load the post." });
  }
};

// POST /api/posts/:id/view — the details page was opened. Counted once per
// person per day; the seller's own opens don't count.
const recordView = async (req, res) => {
  try {
    if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
      return res.status(400).json({ success: false, message: "Invalid post ID." });
    }
    const post = await Post.findById(req.params.id).select("user views").lean();
    if (!post) {
      return res.status(404).json({ success: false, message: "This post is no longer available." });
    }

    let counted = false;
    if (!isOwnPost(req, post)) {
      counted = await countOncePerDay(req, post._id, "view");
      if (counted) await Post.updateOne({ _id: post._id }, { $inc: { views: 1 } });
    }
    const latest = await Post.findById(post._id).select("views").lean();
    res.status(200).json({ success: true, counted, views: latest?.views || 0 });
  } catch (error) {
    console.error("Record view error:", error);
    res.status(500).json({ success: false, message: "Failed to record the view." });
  }
};

// POST /api/posts/:id/contact  body: { "action": "call" | "link" }
// A tap on Call or Open on Instagram/YouTube. Counted once per person per
// day; the seller's own taps don't count. Only the seller sees these numbers.
const CONTACT_FIELDS = { call: "stats.calls", link: "stats.linkOpens", share: "stats.shares" };

const recordContact = async (req, res) => {
  try {
    if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
      return res.status(400).json({ success: false, message: "Invalid post ID." });
    }
    const action = req.body?.action;
    if (!Object.prototype.hasOwnProperty.call(CONTACT_FIELDS, action)) {
      return res.status(400).json({ success: false, message: 'action must be "call", "link" or "share".' });
    }
    const post = await Post.findById(req.params.id).select("user").lean();
    if (!post) {
      return res.status(404).json({ success: false, message: "This post is no longer available." });
    }

    let counted = false;
    if (!isOwnPost(req, post)) {
      counted = await countOncePerDay(req, post._id, action);
      if (counted) await Post.updateOne({ _id: post._id }, { $inc: { [CONTACT_FIELDS[action]]: 1 } });
    }
    res.status(200).json({ success: true, counted });
  } catch (error) {
    console.error("Record contact error:", error);
    res.status(500).json({ success: false, message: "Failed to record the tap." });
  }
};

// GET ALL POSTS WITH PAGINATION (home feed)
// Query: page, limit (max 50), platform (Instagram | Facebook | YouTube),
// locality (part of the location, any letter case), feed=following,
// plus the Filter screen values in feedFiltersSchema (minArea/maxArea are
// square feet).
const getPosts = async (req, res) => {
  // Search and Filter screen values. Bad values get a 400 with the reason
  // (thrown here, outside the try, so the error handler answers).
  const filters = feedFiltersSchema.parse(req.query);

  try {
    const page = Math.max(1, parseInt(req.query.page, 10) || 1);
    const limit = Math.min(50, Math.max(1, parseInt(req.query.limit, 10) || 10));
    const skip = (page - 1) * limit;

    // Sold, rented and expired properties leave the feed.
    const filter = liveListings();

    const platform = typeof req.query.platform === "string" ? req.query.platform.trim() : "";
    if (platform && platform !== "All") filter.platform = platform;

    const locality = typeof req.query.locality === "string" ? req.query.locality.trim() : "";
    if (locality) filter.location = { $regex: escapeRegex(locality.slice(0, 80)), $options: "i" };

    if (filters.types?.length) filter.type = { $in: filters.types };
    if (filters.deal && filters.deal !== "Any") filter.deal = filters.deal;
    if (filters.video === "true") filter.video = true;
    if (filters.minBedrooms) filter.bedroomsCount = { $gte: filters.minBedrooms };

    // Price range in rupees (per month for rentals). Posts without a clear
    // price ("Price on request") are left out only while a price is set.
    if (filters.minPrice !== undefined || filters.maxPrice !== undefined) {
      filter.priceValue = { $type: "number" };
      if (filters.minPrice !== undefined) filter.priceValue.$gte = filters.minPrice;
      if (filters.maxPrice !== undefined) filter.priceValue.$lte = filters.maxPrice;
    }

    // Size range in square feet. Posts without a clear size are left out
    // only while a size is set.
    if (filters.minArea !== undefined || filters.maxArea !== undefined) {
      filter.areaValue = { $type: "number" };
      if (filters.minArea !== undefined) filter.areaValue.$gte = filters.minArea;
      if (filters.maxArea !== undefined) filter.areaValue.$lte = filters.maxArea;
    }

    // Search: every word must appear somewhere in the post or the seller's
    // account name, so "villa nadakkavu" finds villas in Nadakkavu.
    const words = (filters.q || "").split(/\s+/).filter(Boolean).slice(0, MAX_SEARCH_WORDS);
    if (words.length) {
      filter.$and = await Promise.all(words.map(searchConditionFor));
    }

    // Following tab: posts from sellers you follow, plus your own.
    if (req.query.feed === "following") {
      if (!req.user) {
        return res.status(401).json({
          success: false,
          message: "Please log in to see posts from sellers you follow.",
        });
      }
      const follows = await Follow.find({ follower: req.user._id }).select("following").lean();
      filter.user = { $in: [req.user._id, ...follows.map((f) => f.following)] };
    }

    // Posts from people you blocked are hidden.
    const blocked = blockedIdsOf(req.user);
    if (blocked.length) {
      const hidden = new Set(blocked.map(String));
      if (filter.user?.$in) {
        filter.user.$in = filter.user.$in.filter((id) => !hidden.has(String(id)));
      } else {
        filter.user = { $nin: blocked };
      }
    }

    const [posts, total] = await Promise.all([
      Post.find(filter)
        .populate("user", "name profileImage")
        .sort({ createdAt: -1, _id: -1 })
        .skip(skip)
        .limit(limit)
        .lean(),
      Post.countDocuments(filter)
    ]);

    res.status(200).json({
      success: true,
      count: total,
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit),
      hasMore: skip + posts.length < total,
      posts: posts.map((post) => toFeedItem(post, req.user?._id))
    });

  } catch (error) {
    console.error("Get posts error:", error);

    res.status(500).json({
      success: false,
      message: "Failed to fetch posts"
    });
  }
};


// GET /api/posts/by-ids?ids=a,b,c — posts in the order asked, for a guest's
// Saved tab (their saves are kept on the phone). Includes sold and rented
// posts (the app labels them). Deleted posts and bad IDs are left out.
const MAX_IDS = 100;
const getPostsByIds = async (req, res) => {
  const raw = req.query.ids;
  const ids = (Array.isArray(raw) ? raw : [raw ?? ""])
    .flatMap((value) => String(value).split(","))
    .map((value) => value.trim())
    .filter(Boolean);

  if (ids.length > MAX_IDS) {
    return res.status(400).json({
      success: false,
      message: `Please ask for up to ${MAX_IDS} posts at a time.`,
    });
  }

  const validIds = [...new Set(ids)].filter((id) => mongoose.Types.ObjectId.isValid(id));
  const blocked = blockedIdsOf(req.user);
  const found = validIds.length
    ? await Post.find({
        _id: { $in: validIds },
        ...VISIBLE_POSTS,
        ...(blocked.length ? { user: { $nin: blocked } } : {}),
      })
        .populate("user", "name profileImage")
        .lean()
    : [];
  const byId = new Map(found.map((post) => [String(post._id), post]));
  const posts = validIds.map((id) => byId.get(id)).filter(Boolean);

  res.status(200).json({
    success: true,
    count: posts.length,
    posts: posts.map((post) => toFeedItem(post, req.user?._id)),
  });
};

// GET MY POSTS
const getMyPosts = async (req, res) => {
  try {
    // All your posts (active, sold and rented), newest first, with views,
    // likes, comments and your Call / link-open counts.
    const posts = await Post.find({ user: req.user._id })
      .populate("user", "name profileImage")
      .sort({ createdAt: -1, _id: -1 })
      .lean();

    res.status(200).json({
      success: true,
      count: posts.length,
      posts: posts.map((post) => toFeedItem(post, req.user._id)),
    });
  } catch (error) {
    console.error("Get my posts error:", error);
    res.status(500).json({
      success: false,
      message: "Failed to fetch your posts",
    });
  }
};

// DELETE POST
const deletePost = async (req, res) => {
  try {
    const post = await Post.findById(req.params.id);
    if (!post) {
      return res.status(404).json({ success: false, message: "Post not found." });
    }
    if (post.user.toString() !== req.user._id.toString()) {
      return res.status(403).json({ success: false, message: "Not authorized to delete this post." });
    }

    await post.deleteOne();
    // Clean up everything that pointed at it: view records, other people's
    // saved lists, and its photos on Cloudinary.
    await PostView.deleteMany({ post: post._id });
    await User.updateMany({ savedPosts: post._id }, { $pull: { savedPosts: post._id } });
    await notifications.postDeleted(post._id);
    await deleteCloudinaryPhotos(post.imageUrls || []);

    res.status(200).json({
      success: true,
      message: "Post deleted successfully",
    });
  } catch (error) {
    console.error("Delete post error:", error);
    res.status(500).json({
      success: false,
      message: "Failed to delete post",
    });
  }
};

// TOGGLE LIKE POST
// Toggles your like. Send { "like": true } or { "like": false } to set it
// directly instead (double-tap only ever likes). Uses $addToSet / $pull so a
// post can never be liked twice by the same person, even with fast taps.
const likePost = async (req, res) => {
  try {
    if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
      return res.status(400).json({ success: false, message: "Invalid post ID." });
    }

    const current = await Post.findById(req.params.id).select("likes removedAt sellerBanned").lean();
    if (!current || isHiddenPost(current)) {
      return res.status(404).json({ success: false, message: "Post not found." });
    }

    const alreadyLiked = (current.likes || []).some((id) => String(id) === String(req.user._id));
    const isLiked = typeof req.body?.like === "boolean" ? req.body.like : !alreadyLiked;

    await Post.updateOne(
      { _id: req.params.id },
      isLiked ? { $addToSet: { likes: req.user._id } } : { $pull: { likes: req.user._id } }
    );
    const post = await Post.findById(req.params.id).select("likes").lean();
    if (!post) {
      return res.status(404).json({ success: false, message: "Post not found." });
    }
    // The seller's "liked your post" notification (only a new like counts).
    await notifications.likeChanged(post._id, req.user._id, isLiked && !alreadyLiked);

    res.status(200).json({
      success: true,
      isLiked,
      likesCount: post.likes.length,
      message: isLiked ? "Post liked" : "Post unliked",
    });
  } catch (error) {
    console.error("Like post error:", error);
    res.status(500).json({
      success: false,
      message: "Failed to toggle like",
    });
  }
};

// PATCH /api/posts/:id/status  body: { "status": "active" | "sold" | "rented" }
// Only the seller can change it.
const POST_STATUSES = ["active", "sold", "rented"];

const updatePostStatus = async (req, res) => {
  try {
    if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
      return res.status(400).json({ success: false, message: "Invalid post ID." });
    }
    const status = req.body?.status;
    if (!POST_STATUSES.includes(status)) {
      return res.status(400).json({ success: false, message: 'status must be "active", "sold" or "rented".' });
    }
    const post = await Post.findById(req.params.id).select("user status expiresAt").lean();
    if (!post) {
      return res.status(404).json({ success: false, message: "Post not found." });
    }
    if (String(post.user) !== String(req.user._id)) {
      return res.status(403).json({ success: false, message: "You cannot change this post." });
    }
    const wasActive = !["sold", "rented"].includes(post.status);
    const update = { status };
    // Back on the market (from sold / rented), or active but expired: a new
    // 90 days starts.
    const restart = status === "active" && (!wasActive || Post.isExpired(post));
    if (restart) Object.assign(update, { expiresAt: Post.expiryFromNow(), expiryReminderAt: null, expiredNoticeAt: null });
    await Post.updateOne({ _id: post._id }, { $set: update });
    // "Expires soon" / "expired" notices no longer apply.
    if (status !== "active" || restart) await notifications.listingRenewed({ userId: req.user._id, postId: post._id });

    const labels = {
      active: restart ? `Marked as active. It shows for ${Post.LISTING_DAYS} days.` : "Marked as active.",
      sold: "Marked as sold.",
      rented: "Marked as rented.",
    };
    res.status(200).json({
      success: true,
      status,
      expiresAt: update.expiresAt || post.expiresAt || null,
      message: labels[status],
    });
  } catch (error) {
    console.error("Update status error:", error);
    res.status(500).json({ success: false, message: "Failed to update the status." });
  }
};

// POST /api/posts/:id/renew — the seller shows an active listing for
// another 90 days (from today). Sold, rented and removed posts can't be renewed.
const renewPost = async (req, res) => {
  if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
    return res.status(400).json({ success: false, message: "Invalid post ID." });
  }
  const post = await Post.findById(req.params.id).select("user status removedAt").lean();
  if (!post) {
    return res.status(404).json({ success: false, message: "Post not found." });
  }
  if (String(post.user) !== String(req.user._id)) {
    return res.status(403).json({ success: false, message: "You cannot change this post." });
  }
  if (post.removedAt) {
    return res.status(400).json({ success: false, message: "This listing was removed by PlotPost and can't be renewed." });
  }
  if (["sold", "rented"].includes(post.status)) {
    return res.status(400).json({
      success: false,
      message: `This listing is marked as ${post.status}. Mark it as active to show it again.`,
    });
  }
  const expiresAt = Post.expiryFromNow();
  await Post.updateOne(
    { _id: post._id },
    { $set: { expiresAt, expiryReminderAt: null, expiredNoticeAt: null } },
    { timestamps: false }
  );
  await notifications.listingRenewed({ userId: req.user._id, postId: post._id });
  res.status(200).json({
    success: true,
    expiresAt,
    message: `Renewed. It shows for another ${Post.LISTING_DAYS} days.`,
  });
};

// ------------------------------------------------------------ Comments

const isObjectId = (value) => typeof value === "string" && /^[a-f0-9]{24}$/i.test(value);

// One comment as the app shows it: author name and photo (no email), a
// "Seller" label for the post's seller, and whether you may delete it
// (your own comments, or any comment on your post).
const toCommentItem = (comment, postOwnerId, viewerId) => {
  const author = comment.user && comment.user._id ? comment.user : null;
  const authorId = author ? author._id : comment.user;
  return {
    _id: comment._id,
    // Guests don't see phone numbers written in comments either.
    text: viewerId ? comment.text : maskPhoneNumbers(comment.text),
    createdAt: comment.createdAt,
    user: {
      _id: authorId ?? null,
      name: author?.name || "PlotPost user",
      profileImage: author?.profileImage || "",
    },
    isSeller: authorId != null && String(authorId) === String(postOwnerId),
    canDelete:
      Boolean(viewerId) &&
      (String(authorId) === String(viewerId) || String(postOwnerId) === String(viewerId)),
  };
};

const commentCountOf = async (postId) => {
  const post = await Post.findById(postId).select("comments._id").lean();
  return post?.comments?.length ?? 0;
};

// GET /api/posts/:id/comments?page=1&limit=20 — newest first. Guests allowed.
const getComments = async (req, res) => {
  try {
    if (!isObjectId(req.params.id)) {
      return res.status(400).json({ success: false, message: "Invalid post ID." });
    }
    const page = Math.max(1, parseInt(req.query.page, 10) || 1);
    const limit = Math.min(50, Math.max(1, parseInt(req.query.limit, 10) || 20));
    const skip = (page - 1) * limit;

    const post = await Post.findById(req.params.id)
      .select("user comments")
      .populate("comments.user", "name profileImage bannedAt")
      .lean();
    if (!post) {
      return res.status(404).json({ success: false, message: "This post is no longer available." });
    }

    // New comments are added at the end, so newest first = reversed.
    // Comments from people you blocked are hidden.
    const hidden = new Set(blockedIdsOf(req.user).map(String));
    const all = [...(post.comments || [])]
      .reverse()
      .filter((comment) => !hidden.has(String(comment.user?._id ?? comment.user)))
      // Comments by banned accounts are hidden from everyone.
      .filter((comment) => !comment.user?.bannedAt);
    const comments = all.slice(skip, skip + limit);

    res.status(200).json({
      success: true,
      total: all.length,
      page,
      limit,
      hasMore: skip + comments.length < all.length,
      comments: comments.map((comment) => toCommentItem(comment, post.user, req.user?._id)),
    });
  } catch (error) {
    console.error("Get comments error:", error);
    res.status(500).json({ success: false, message: "Failed to load comments." });
  }
};

// POST /api/posts/:id/comment — body { text } (1–1,000 characters, checked
// by validators/postValidators.js). Returns the new comment and the count.
const addComment = async (req, res) => {
  try {
    if (!isObjectId(req.params.id)) {
      return res.status(400).json({ success: false, message: "Invalid post ID." });
    }
    const post = await Post.findById(req.params.id).select("user removedAt sellerBanned").lean();
    if (!post || isHiddenPost(post)) {
      return res.status(404).json({ success: false, message: "This post is no longer available." });
    }

    const now = new Date();
    const comment = {
      _id: new mongoose.Types.ObjectId(),
      user: req.user._id,
      text: req.body.text,
      createdAt: now,
      updatedAt: now,
    };
    // Added in one step, so two people commenting at once both keep theirs.
    // The post's own "updated" date stays as it was.
    await Post.updateOne({ _id: post._id }, { $push: { comments: comment } }, { timestamps: false });
    // The seller's notification and phone alert.
    await notifications.commentAdded(post._id, req.user, req.body.text);

    res.status(201).json({
      success: true,
      message: "Comment added.",
      comment: toCommentItem(
        { ...comment, user: { _id: req.user._id, name: req.user.name, profileImage: req.user.profileImage } },
        post.user,
        req.user._id
      ),
      commentsCount: await commentCountOf(post._id),
    });
  } catch (error) {
    console.error("Add comment error:", error);
    res.status(500).json({
      success: false,
      message: "Failed to add comment",
    });
  }
};

// DELETE /api/posts/:id/comments/:commentId — your own comment, or any
// comment on your post.
const deleteComment = async (req, res) => {
  try {
    const { id, commentId } = req.params;
    if (!isObjectId(id) || !isObjectId(commentId)) {
      return res.status(400).json({ success: false, message: "Invalid post or comment ID." });
    }

    const post = await Post.collection.findOne(
      { _id: new mongoose.Types.ObjectId(id) },
      { projection: { user: 1, comments: 1 } }
    );
    if (!post) {
      return res.status(404).json({ success: false, message: "This post is no longer available." });
    }
    const comment = (post.comments || []).find((item) => String(item._id) === commentId);
    if (!comment) {
      return res.status(404).json({ success: false, message: "This comment has already been deleted." });
    }

    const isAuthor = String(comment.user) === String(req.user._id);
    const isSeller = String(post.user) === String(req.user._id);
    if (!isAuthor && !isSeller) {
      return res.status(403).json({ success: false, message: "You can only delete your own comments." });
    }

    // Removes exactly this stored comment in one step (works on MongoDB
    // Atlas and on the test database).
    await Post.collection.updateOne({ _id: post._id }, { $pullAll: { comments: [comment] } });
    await notifications.commentRemoved(post._id);

    res.status(200).json({
      success: true,
      message: "Comment deleted.",
      commentsCount: await commentCountOf(post._id),
    });
  } catch (error) {
    console.error("Delete comment error:", error);
    res.status(500).json({ success: false, message: "Failed to delete the comment." });
  }
};

// ------------------------------------------------------------- Reports

// POST /api/posts/:id/report — body { reason, details }. One report per
// person per post; reporting again updates it. You can't report your own post.
const reportPost = async (req, res) => {
  try {
    if (!isObjectId(req.params.id)) {
      return res.status(400).json({ success: false, message: "Invalid post ID." });
    }
    const post = await Post.findById(req.params.id).select("user").lean();
    if (!post) {
      return res.status(404).json({ success: false, message: "This post is no longer available." });
    }
    if (isOwnPost(req, post)) {
      return res.status(400).json({ success: false, message: "You can't report your own post." });
    }

    const { updated } = await saveReport(
      "post",
      { post: post._id, reportedUser: post.user },
      { reporter: req.user._id, reason: req.body.reason, details: req.body.details }
    );

    res.status(updated ? 200 : 201).json({
      success: true,
      updated,
      message: updated
        ? "Your report has been updated. We'll review this listing."
        : "Report submitted. We'll review this listing.",
    });
  } catch (error) {
    console.error("Report post error:", error);
    res.status(500).json({ success: false, message: "Failed to send the report." });
  }
};

// POST /api/posts/:id/comments/:commentId/report — body { reason, details }.
// One report per person per comment. You can't report your own comment.
const reportComment = async (req, res) => {
  try {
    const { id, commentId } = req.params;
    if (!isObjectId(id) || !isObjectId(commentId)) {
      return res.status(400).json({ success: false, message: "Invalid post or comment ID." });
    }
    const post = await Post.collection.findOne(
      { _id: new mongoose.Types.ObjectId(id) },
      { projection: { comments: 1 } }
    );
    if (!post) {
      return res.status(404).json({ success: false, message: "This post is no longer available." });
    }
    const comment = (post.comments || []).find((item) => String(item._id) === commentId);
    if (!comment) {
      return res.status(404).json({ success: false, message: "This comment has already been deleted." });
    }
    if (String(comment.user) === String(req.user._id)) {
      return res.status(400).json({ success: false, message: "You can't report your own comment." });
    }

    const { updated } = await saveReport(
      "comment",
      { post: post._id, comment: comment._id, reportedUser: comment.user ?? null, commentText: comment.text || "" },
      { reporter: req.user._id, reason: req.body.reason, details: req.body.details }
    );

    res.status(updated ? 200 : 201).json({
      success: true,
      updated,
      message: updated
        ? "Your report has been updated. We'll review this comment."
        : "Report submitted. We'll review this comment.",
    });
  } catch (error) {
    console.error("Report comment error:", error);
    res.status(500).json({ success: false, message: "Failed to send the report." });
  }
};

module.exports = {
  createPost,
  updatePost,
  getPosts,
  getPostsByIds,
  getPostById,
  recordView,
  recordContact,
  updatePostStatus,
  renewPost,
  getMyPosts,
  deletePost,
  likePost,
  getComments,
  addComment,
  deleteComment,
  reportPost,
  reportComment,
  // Shared with the Saved list and profile / delete account (userController).
  toFeedItem,
  blockedIdsOf,
  VISIBLE_POSTS,
  liveListings,
  isHiddenPost,
  cloudinaryPublicId,
  deleteCloudinaryPhotos,
};

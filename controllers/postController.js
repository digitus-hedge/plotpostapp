const crypto = require("crypto");
const { Op } = require("sequelize");
const { Post, User, Follow, PostView } = require("../models");
const cloudinary = require("../config/cloudinary");
const notifications = require("../services/notificationService");
const { saveReport } = require("../services/reportService");
const { feedFiltersSchema } = require("../validators/postValidators");
const { maskPhoneNumbers } = require("../utils/phoneMask");
const videoService = require("../services/videoService");
const linkPreview = require("../services/linkPreview");

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

const deleteCloudinaryPhotos = async (urls) => {
  const ids = [...new Set((urls || []).map(cloudinaryPublicId).filter(Boolean))];
  await Promise.all(
    ids.map((id) =>
      cloudinary.uploader.destroy(id).catch((error) => {
        if (process.env.NODE_ENV !== "test") console.warn("Cloudinary delete failed:", id, error.message);
      })
    )
  );
};

const isWebLink = (url) => typeof url === "string" && /^https?:\/\/\S+$/i.test(url) && url.length <= 1000;

const checkPhotos = (imageUrls, { platform, existing = [], hasVideo = false }) => {
  const kept = new Set(existing);
  if ((imageUrls || []).some((url) => !isWebLink(url) && !kept.has(url))) {
    return "Photos must be uploaded first. Please update the app and try again.";
  }
  if (platform === "PlotPost" && (!imageUrls || imageUrls.length === 0) && !hasVideo) {
    return "Please add at least one photo or a video.";
  }
  return null;
};

const sendError = (res, error, label, fallback) => {
  if (error?.statusCode && error.statusCode < 500) {
    return res.status(error.statusCode).json({ success: false, message: error.message });
  }
  if (error?.statusCode === 503) {
    return res.status(503).json({ success: false, message: error.message });
  }
  console.error(`${label} error:`, error);
  return res.status(500).json({ success: false, message: fallback });
};

const createPost = async (req, res) => {
  try {
    const { title, description, imageUrls, videoPublicId } = req.body;
    const validationMessage = checkPhotos(imageUrls, {
      platform: req.body.platform,
      hasVideo: Boolean(videoPublicId),
    });
    if (validationMessage) {
      return res.status(400).json({
        success: false,
        message: validationMessage,
      });
    }

    const videoFields = videoPublicId
      ? await videoService.videoFieldsFor(videoPublicId, req.user.id)
      : {};

    // A link from OLX, 99acres... with no picture: use the page's preview.
    let photos = imageUrls || [];
    if (!photos.length && !videoPublicId && linkPreview.needsPreview(req.body.socialUrl)) {
      const preview = await linkPreview.previewImageFor(req.body.socialUrl);
      if (preview) photos = [preview];
    }

    const post = await Post.create({
      userId: req.user.id,
      caption: description || title,
      ...getPostFields(req.body),
      imageUrls: photos,
      ...videoFields,
    });

    const populatedPost = await Post.findByPk(post.id, {
      include: [{ model: User, as: "user", attributes: ["id", "name", "email", "profileImage"] }],
    });

    res.status(201).json({
      success: true,
      message: "Post created successfully",
      post: populatedPost,
    });
  } catch (error) {
    return sendError(res, error, "Create post", "Failed to create post");
  }
};

const updatePost = async (req, res) => {
  try {
    const post = await Post.findByPk(req.params.id);

    if (!post) {
      return res.status(404).json({
        success: false,
        message: "Post not found.",
      });
    }

    if (String(post.userId) !== String(req.user.id)) {
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

    const previousVideo = post.videoPublicId || "";
    const wantedVideo = req.body.videoPublicId;
    const videoChanges = wantedVideo !== undefined && wantedVideo !== previousVideo;
    const willHaveVideo = wantedVideo !== undefined ? Boolean(wantedVideo) : Boolean(post.videoUrl);

    const imageUrls = req.body.imageUrls ?? post.imageUrls;
    const validationMessage = checkPhotos(imageUrls, {
      platform: updates.platform ?? post.platform,
      existing: post.imageUrls,
      hasVideo: willHaveVideo,
    });

    if (validationMessage) {
      return res.status(400).json({
        success: false,
        message: validationMessage,
      });
    }

    const videoFields = videoChanges
      ? wantedVideo
        ? await videoService.videoFieldsFor(wantedVideo, req.user.id)
        : { ...videoService.NO_VIDEO }
      : null;

    const previousPhotos = [...(post.imageUrls || [])];
    Object.assign(post, updates);
    if (videoFields) {
      Object.assign(post, videoFields);
      if (!videoFields.videoUrl && updates.video === undefined) post.video = false;
    }

    if (req.body.imageUrls !== undefined) {
      post.imageUrls = imageUrls;
    }

    // A new link (OLX, 99acres...) and no picture: use the page's preview.
    const linkChanged = updates.socialUrl !== undefined && updates.socialUrl !== (post.previous("socialUrl") || "");
    if (
      linkChanged &&
      !(post.imageUrls || []).length &&
      !post.videoUrl &&
      linkPreview.needsPreview(post.socialUrl)
    ) {
      const preview = await linkPreview.previewImageFor(post.socialUrl);
      if (preview) post.imageUrls = [preview];
    }

    if (req.body.description !== undefined) {
      post.caption = req.body.description;
    }

    await post.save();

    const removedPhotos = previousPhotos.filter((url) => !(post.imageUrls || []).includes(url));
    await deleteCloudinaryPhotos(removedPhotos);
    if (videoChanges && previousVideo) await videoService.destroyVideo(previousVideo);

    const populatedPost = await Post.findByPk(post.id, {
      include: [{ model: User, as: "user", attributes: ["id", "name", "email", "profileImage"] }],
    });

    return res.status(200).json({
      success: true,
      message: "Post updated successfully.",
      post: populatedPost,
    });
  } catch (error) {
    return sendError(res, error, "Update post", "Failed to update post.");
  }
};

const isHiddenPost = (post) => Boolean(post?.removedAt) || post?.sellerBanned === true;

const blockedIdsOf = (user) => (user?.blockedUsers || []).map((id) => String(id));

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
  const plain = typeof post.get === "function" ? post.get({ plain: true }) : post;
  const {
    likes = [],
    comments = [],
    stats,
    removedBy,
    sellerBanned,
    expiryReminderAt,
    expiredNoticeAt,
    userId,
    ...fields
  } = plain;
  const ownerId = plain.userId || (plain.user?.id ?? plain.user);
  const isOwner = Boolean(viewerId) && String(ownerId) === String(viewerId);
  const item = {
    ...fields,
    _id: plain.id,
    user: plain.user,
    hasPhone: Boolean(String(plain.sellerPhone || "").trim()),
    isExpired: Post.isExpired(plain),
    views: plain.views || 0,
    likesCount: (likes || []).length,
    commentsCount: (comments || []).length,
    isLiked: Boolean(viewerId) && (likes || []).some((id) => String(id) === String(viewerId)),
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

const viewerKey = (req) => {
  if (req.user) return `user:${req.user.id}`;
  const hash = crypto
    .createHmac("sha256", process.env.JWT_SECRET || "plotpost")
    .update(String(req.ip || ""))
    .digest("hex")
    .slice(0, 32);
  return `ip:${hash}`;
};

const todayInIndia = () => new Date(Date.now() + 330 * 60 * 1000).toISOString().slice(0, 10);

const countOncePerDay = async (req, postId, kind) => {
  try {
    await PostView.create({ postId, viewer: viewerKey(req), kind, day: todayInIndia() });
    return true;
  } catch (error) {
    return false;
  }
};

const isOwnPost = (req, post) => Boolean(req.user) && String(post.userId) === String(req.user.id);

const getPostById = async (req, res) => {
  try {
    const post = await Post.findByPk(req.params.id, {
      include: [{ model: User, as: "user", attributes: ["id", "name", "profileImage", "createdAt"] }],
    });
    if (!post || !post.user) {
      return res.status(404).json({ success: false, message: "This post is no longer available." });
    }

    const sellerId = post.user.id;
    const isYou = Boolean(req.user) && String(req.user.id) === String(sellerId);
    if (isHiddenPost(post) && !isYou && req.user?.role !== "admin") {
      return res.status(404).json({
        success: false,
        message: post.removedAt
          ? "This listing was removed by PlotPost."
          : "This post is no longer available.",
      });
    }
    const [postsCount, followersCount, follows] = await Promise.all([
      Post.count({ where: { userId: sellerId } }),
      Follow.count({ where: { following: sellerId } }),
      req.user && !isYou ? Follow.findOne({ where: { follower: req.user.id, following: sellerId } }) : null,
    ]);

    res.status(200).json({
      success: true,
      post: toFeedItem(post, req.user?.id),
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
        blockedByMe: blockedIdsOf(req.user).some((id) => String(id) === String(sellerId)),
      },
    });
  } catch (error) {
    console.error("Get post error:", error);
    res.status(500).json({ success: false, message: "Failed to load the post." });
  }
};

const recordView = async (req, res) => {
  try {
    const post = await Post.findByPk(req.params.id);
    if (!post) {
      return res.status(404).json({ success: false, message: "This post is no longer available." });
    }

    let counted = false;
    if (!isOwnPost(req, post)) {
      counted = await countOncePerDay(req, post.id, "view");
      if (counted) {
        post.views = (post.views || 0) + 1;
        await post.save();
      }
    }
    res.status(200).json({ success: true, counted, views: post.views || 0 });
  } catch (error) {
    console.error("Record view error:", error);
    res.status(500).json({ success: false, message: "Failed to record the view." });
  }
};

const recordContact = async (req, res) => {
  try {
    const action = req.body?.action;
    if (!["call", "link", "share"].includes(action)) {
      return res.status(400).json({ success: false, message: 'action must be "call", "link" or "share".' });
    }
    const post = await Post.findByPk(req.params.id);
    if (!post) {
      return res.status(404).json({ success: false, message: "This post is no longer available." });
    }

    let counted = false;
    if (!isOwnPost(req, post)) {
      counted = await countOncePerDay(req, post.id, action);
      if (counted) {
        const stats = { ...(post.stats || { calls: 0, linkOpens: 0, shares: 0 }) };
        if (action === "call") stats.calls = (stats.calls || 0) + 1;
        if (action === "link") stats.linkOpens = (stats.linkOpens || 0) + 1;
        if (action === "share") stats.shares = (stats.shares || 0) + 1;
        post.stats = stats;
        await post.save();
      }
    }
    res.status(200).json({ success: true, counted });
  } catch (error) {
    console.error("Record contact error:", error);
    res.status(500).json({ success: false, message: "Failed to record the tap." });
  }
};

const getPosts = async (req, res) => {
  const filters = feedFiltersSchema.parse(req.query);

  try {
    const page = Math.max(1, parseInt(req.query.page, 10) || 1);
    const limit = Math.min(50, Math.max(1, parseInt(req.query.limit, 10) || 10));
    const offset = (page - 1) * limit;

    const where = {
      removedAt: null,
      sellerBanned: false,
      status: { [Op.notIn]: ["sold", "rented"] },
      expiresAt: { [Op.gt]: new Date() },
    };

    const platform = typeof req.query.platform === "string" ? req.query.platform.trim() : "";
    if (platform && platform !== "All") where.platform = platform;

    const locality = typeof req.query.locality === "string" ? req.query.locality.trim() : "";
    if (locality) where.location = { [Op.like]: `%${locality}%` };

    if (filters.types?.length) where.type = { [Op.in]: filters.types };
    if (filters.deal && filters.deal !== "Any") where.deal = filters.deal;
    if (filters.video === "true") where.video = true;
    if (filters.minBedrooms) where.bedroomsCount = { [Op.gte]: filters.minBedrooms };

    if (filters.minPrice !== undefined || filters.maxPrice !== undefined) {
      where.priceValue = {};
      if (filters.minPrice !== undefined) where.priceValue[Op.gte] = filters.minPrice;
      if (filters.maxPrice !== undefined) where.priceValue[Op.lte] = filters.maxPrice;
    }

    if (filters.minArea !== undefined || filters.maxArea !== undefined) {
      where.areaValue = {};
      if (filters.minArea !== undefined) where.areaValue[Op.gte] = filters.minArea;
      if (filters.maxArea !== undefined) where.areaValue[Op.lte] = filters.maxArea;
    }

    if (req.query.feed === "following") {
      if (!req.user) {
        return res.status(401).json({
          success: false,
          message: "Please log in to see posts from sellers you follow.",
        });
      }
      const follows = await Follow.findAll({ where: { follower: req.user.id }, attributes: ["following"] });
      const followingIds = follows.map((f) => f.following);
      where.userId = { [Op.in]: [req.user.id, ...followingIds] };
    }

    const { rows: posts, count: total } = await Post.findAndCountAll({
      where,
      include: [{ model: User, as: "user", attributes: ["id", "name", "profileImage"] }],
      order: [["createdAt", "DESC"]],
      limit,
      offset,
    });

    res.status(200).json({
      success: true,
      count: total,
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit),
      hasMore: offset + posts.length < total,
      posts: posts.map((post) => toFeedItem(post, req.user?.id)),
    });
  } catch (error) {
    console.error("Get posts error:", error);
    res.status(500).json({
      success: false,
      message: "Failed to fetch posts",
    });
  }
};

const getPostsByIds = async (req, res) => {
  const raw = req.query.ids;
  const ids = (Array.isArray(raw) ? raw : [raw ?? ""])
    .flatMap((value) => String(value).split(","))
    .map((value) => value.trim())
    .filter(Boolean);

  if (ids.length > 100) {
    return res.status(400).json({
      success: false,
      message: "Please ask for up to 100 posts at a time.",
    });
  }

  const validIds = [...new Set(ids)].map((id) => parseInt(id, 10)).filter(Boolean);
  const found = validIds.length
    ? await Post.findAll({
        where: { id: { [Op.in]: validIds }, removedAt: null, sellerBanned: false },
        include: [{ model: User, as: "user", attributes: ["id", "name", "profileImage"] }],
      })
    : [];

  const byId = new Map(found.map((post) => [String(post.id), post]));
  const posts = validIds.map((id) => byId.get(String(id))).filter(Boolean);

  res.status(200).json({
    success: true,
    count: posts.length,
    posts: posts.map((post) => toFeedItem(post, req.user?.id)),
  });
};

const getMyPosts = async (req, res) => {
  try {
    const posts = await Post.findAll({
      where: { userId: req.user.id },
      include: [{ model: User, as: "user", attributes: ["id", "name", "profileImage"] }],
      order: [["createdAt", "DESC"]],
    });

    res.status(200).json({
      success: true,
      count: posts.length,
      posts: posts.map((post) => toFeedItem(post, req.user.id)),
    });
  } catch (error) {
    console.error("Get my posts error:", error);
    res.status(500).json({
      success: false,
      message: "Failed to fetch your posts",
    });
  }
};

const deletePost = async (req, res) => {
  try {
    const post = await Post.findByPk(req.params.id);
    if (!post) {
      return res.status(404).json({ success: false, message: "Post not found." });
    }
    if (String(post.userId) !== String(req.user.id)) {
      return res.status(403).json({ success: false, message: "Not authorized to delete this post." });
    }

    await post.destroy();
    await PostView.destroy({ where: { postId: post.id } });
    await notifications.postDeleted(post.id);
    await deleteCloudinaryPhotos(post.imageUrls || []);
    await videoService.destroyVideo(post.videoPublicId);

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

const likePost = async (req, res) => {
  try {
    const post = await Post.findByPk(req.params.id);
    if (!post || isHiddenPost(post)) {
      return res.status(404).json({ success: false, message: "Post not found." });
    }

    const likes = [...(post.likes || [])];
    const alreadyLiked = likes.some((id) => String(id) === String(req.user.id));
    const isLiked = typeof req.body?.like === "boolean" ? req.body.like : !alreadyLiked;

    let updatedLikes;
    if (isLiked && !alreadyLiked) {
      updatedLikes = [...likes, req.user.id];
    } else if (!isLiked && alreadyLiked) {
      updatedLikes = likes.filter((id) => String(id) !== String(req.user.id));
    } else {
      updatedLikes = likes;
    }

    post.likes = updatedLikes;
    await post.save();

    await notifications.likeChanged(post.id, req.user.id, isLiked && !alreadyLiked);

    res.status(200).json({
      success: true,
      isLiked,
      likesCount: updatedLikes.length,
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

const updatePostStatus = async (req, res) => {
  try {
    const status = req.body?.status;
    if (!["active", "sold", "rented"].includes(status)) {
      return res.status(400).json({ success: false, message: 'status must be "active", "sold" or "rented".' });
    }
    const post = await Post.findByPk(req.params.id);
    if (!post) {
      return res.status(404).json({ success: false, message: "Post not found." });
    }
    if (String(post.userId) !== String(req.user.id)) {
      return res.status(403).json({ success: false, message: "You cannot change this post." });
    }
    const wasActive = !["sold", "rented"].includes(post.status);
    post.status = status;
    const restart = status === "active" && (!wasActive || Post.isExpired(post));
    if (restart) {
      post.expiresAt = Post.expiryFromNow();
      post.expiryReminderAt = null;
      post.expiredNoticeAt = null;
    }
    await post.save();
    if (status !== "active" || restart) await notifications.listingRenewed({ userId: req.user.id, postId: post.id });

    const labels = {
      active: restart ? `Marked as active. It shows for ${Post.LISTING_DAYS} days.` : "Marked as active.",
      sold: "Marked as sold.",
      rented: "Marked as rented.",
    };
    res.status(200).json({
      success: true,
      status,
      expiresAt: post.expiresAt,
      message: labels[status],
    });
  } catch (error) {
    console.error("Update status error:", error);
    res.status(500).json({ success: false, message: "Failed to update the status." });
  }
};

const renewPost = async (req, res) => {
  const post = await Post.findByPk(req.params.id);
  if (!post) {
    return res.status(404).json({ success: false, message: "Post not found." });
  }
  if (String(post.userId) !== String(req.user.id)) {
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
  post.expiresAt = Post.expiryFromNow();
  post.expiryReminderAt = null;
  post.expiredNoticeAt = null;
  await post.save();
  await notifications.listingRenewed({ userId: req.user.id, postId: post.id });
  res.status(200).json({
    success: true,
    expiresAt: post.expiresAt,
    message: `Renewed. It shows for another ${Post.LISTING_DAYS} days.`,
  });
};

const toCommentItem = (comment, postOwnerId, viewerId) => {
  const author = comment.user && comment.user.id ? comment.user : null;
  const authorId = author ? author.id : comment.user;
  return {
    _id: comment.id || comment._id,
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

const getComments = async (req, res) => {
  try {
    const post = await Post.findByPk(req.params.id);
    if (!post) {
      return res.status(404).json({ success: false, message: "This post is no longer available." });
    }

    const comments = [...(post.comments || [])].reverse();

    res.status(200).json({
      success: true,
      total: comments.length,
      page: 1,
      limit: 50,
      hasMore: false,
      comments: comments.map((comment) => toCommentItem(comment, post.userId, req.user?.id)),
    });
  } catch (error) {
    console.error("Get comments error:", error);
    res.status(500).json({ success: false, message: "Failed to load comments." });
  }
};

const addComment = async (req, res) => {
  try {
    const post = await Post.findByPk(req.params.id);
    if (!post || isHiddenPost(post)) {
      return res.status(404).json({ success: false, message: "This post is no longer available." });
    }

    const comment = {
      id: crypto.randomUUID(),
      user: { id: req.user.id, name: req.user.name, profileImage: req.user.profileImage },
      text: req.body.text,
      createdAt: new Date(),
    };

    post.comments = [...(post.comments || []), comment];
    await post.save();
    await notifications.commentAdded(post.id, req.user, req.body.text);

    res.status(201).json({
      success: true,
      message: "Comment added.",
      comment: toCommentItem(comment, post.userId, req.user.id),
      commentsCount: post.comments.length,
    });
  } catch (error) {
    console.error("Add comment error:", error);
    res.status(500).json({
      success: false,
      message: "Failed to add comment",
    });
  }
};

const deleteComment = async (req, res) => {
  try {
    const { id, commentId } = req.params;
    const post = await Post.findByPk(id);
    if (!post) {
      return res.status(404).json({ success: false, message: "This post is no longer available." });
    }
    const comments = post.comments || [];
    const comment = comments.find((item) => String(item.id || item._id) === String(commentId));
    if (!comment) {
      return res.status(404).json({ success: false, message: "This comment has already been deleted." });
    }

    const authorId = comment.user?.id || comment.user;
    const isAuthor = String(authorId) === String(req.user.id);
    const isSeller = String(post.userId) === String(req.user.id);
    if (!isAuthor && !isSeller) {
      return res.status(403).json({ success: false, message: "You can only delete your own comments." });
    }

    post.comments = comments.filter((item) => String(item.id || item._id) !== String(commentId));
    await post.save();
    await notifications.commentRemoved(post.id);

    res.status(200).json({
      success: true,
      message: "Comment deleted.",
      commentsCount: post.comments.length,
    });
  } catch (error) {
    console.error("Delete comment error:", error);
    res.status(500).json({ success: false, message: "Failed to delete the comment." });
  }
};

const reportPost = async (req, res) => {
  try {
    const post = await Post.findByPk(req.params.id);
    if (!post) {
      return res.status(404).json({ success: false, message: "This post is no longer available." });
    }
    if (isOwnPost(req, post)) {
      return res.status(400).json({ success: false, message: "You can't report your own post." });
    }

    const { updated } = await saveReport(
      "post",
      { post: post.id, reportedUser: post.userId },
      { reporter: req.user.id, reason: req.body.reason, details: req.body.details }
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

const reportComment = async (req, res) => {
  try {
    const { id, commentId } = req.params;
    const post = await Post.findByPk(id);
    if (!post) {
      return res.status(404).json({ success: false, message: "This post is no longer available." });
    }
    const comments = post.comments || [];
    const comment = comments.find((item) => String(item.id || item._id) === String(commentId));
    if (!comment) {
      return res.status(404).json({ success: false, message: "This comment has already been deleted." });
    }

    const authorId = comment.user?.id || comment.user;
    if (String(authorId) === String(req.user.id)) {
      return res.status(400).json({ success: false, message: "You can't report your own comment." });
    }

    const { updated } = await saveReport(
      "comment",
      { post: post.id, comment: commentId, reportedUser: authorId, commentText: comment.text || "" },
      { reporter: req.user.id, reason: req.body.reason, details: req.body.details }
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
  toFeedItem,
  blockedIdsOf,
  isHiddenPost,
  cloudinaryPublicId,
  deleteCloudinaryPhotos,
};

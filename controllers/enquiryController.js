const Enquiry = require("../models/Enquiry");
const Post = require("../models/Post");
const User = require("../models/User");
const notifications = require("../services/notificationService");

const isObjectId = (value) => typeof value === "string" && /^[a-f0-9]{24}$/i.test(value);

// Fields of the post shown with an enquiry (no likes, comments or emails).
const POST_SUMMARY = "title price location imageUrls imageUrl status";

// First photo link of a post, or "" (old base64 photos aren't sent in lists).
const firstPhoto = (post) => {
  const photo = [...(post.imageUrls || []), post.imageUrl || ""].find(Boolean) || "";
  return /^https?:\/\//.test(photo) ? photo : "";
};

// One enquiry as the app shows it. `post` is null when the post was deleted
// (postTitle still says what it was about).
const toEnquiryItem = (enquiry) => {
  const post = enquiry.post && enquiry.post._id ? enquiry.post : null;
  return {
    _id: enquiry._id,
    post: post
      ? {
          _id: post._id,
          title: post.title,
          price: post.price || "",
          location: post.location || "",
          image: firstPhoto(post),
          status: post.status || "active",
        }
      : null,
    postTitle: enquiry.postTitle,
    seller: enquiry.seller || "",
    // The buyer's account, if they were logged in (the seller can chat with
    // them in the app); null for guests.
    buyerUserId: enquiry.user ? String(enquiry.user._id ?? enquiry.user) : null,
    name: enquiry.name,
    phone: enquiry.phone,
    email: enquiry.email || "",
    message: enquiry.message || "",
    contactMethod: enquiry.contactMethod || "Phone call",
    wantsVisit: Boolean(enquiry.wantsVisit),
    status: enquiry.status || "Pending",
    isUnread: !enquiry.readAt,
    sentAt: enquiry.lastMessageAt || enquiry.createdAt,
    createdAt: enquiry.createdAt,
  };
};

// Enquiries for the posts of seller `userId`: ones linked to the seller, and
// older ones (from before they were linked) through the seller's posts.
const receivedFilter = async (userId) => {
  const posts = await Post.find({ user: userId }).select("_id").lean();
  return {
    $or: [
      { sellerUser: userId },
      { sellerUser: null, post: { $in: posts.map((post) => post._id) } },
    ],
  };
};

// The seller of an enquiry may read it and change its status.
const isSellerOf = async (enquiry, userId) => {
  if (enquiry.sellerUser) return String(enquiry.sellerUser) === String(userId);
  if (!enquiry.post) return false;
  return Boolean(await Post.exists({ _id: enquiry.post, user: userId }));
};

// POST /api/enquiries (Show Interest). Guests allowed. Fields are checked by
// validators/enquiryValidators.js. The same person asking about the same post
// again updates their enquiry (new message, unread again) instead of a copy.
const createEnquiry = async (req, res) => {
  try {
    const { postId, name, phone, email, message, contactMethod, wantsVisit } = req.body;

    const post = await Post.findById(postId)
      .select("user title sellerName status removedAt sellerBanned expiresAt")
      .populate("user", "name")
      .lean();
    if (!post || !post.user || post.removedAt || post.sellerBanned) {
      return res.status(404).json({ success: false, message: "This property is no longer available." });
    }
    if (post.status === "sold" || post.status === "rented") {
      return res.status(400).json({ success: false, message: "This property is no longer available." });
    }
    // Past its 90 days and not renewed: the seller hasn't confirmed it's still available.
    if (Post.isExpired(post)) {
      return res.status(400).json({ success: false, message: "This listing has expired." });
    }
    if (req.user && String(post.user._id) === String(req.user._id)) {
      return res.status(400).json({ success: false, message: "You can't send interest on your own post." });
    }
    // Sellers who blocked this buyer don't get their inquiries. (Deliberately
    // vague, like chats: people aren't told they've been blocked.)
    if (req.user && (await User.exists({ _id: post.user._id, blockedUsers: req.user._id }))) {
      return res.status(403).json({ success: false, message: "You can't contact this seller." });
    }

    const sellerName = post.sellerName || post.user.name || "";
    const fields = {
      sellerUser: post.user._id,
      postTitle: post.title,
      seller: sellerName,
      name,
      phone,
      email,
      message,
      contactMethod,
      wantsVisit,
      status: "Pending",
      readAt: null,
      lastMessageAt: new Date(),
    };

    // Same person: same account, or (guests) the same phone number.
    const sameSender = req.user ? { user: req.user._id } : { user: null, phone };
    const existing = await Enquiry.findOne({ post: post._id, ...sameSender }).select("_id").lean();

    let enquiryId;
    if (existing) {
      await Enquiry.updateOne({ _id: existing._id }, { $set: fields });
      enquiryId = existing._id;
    } else {
      const created = await Enquiry.create({ ...fields, post: post._id, user: req.user ? req.user._id : null });
      enquiryId = created._id;
    }

    const enquiry = await Enquiry.findById(enquiryId).populate("post", POST_SUMMARY).lean();
    // The seller's notification, phone alert and (Email Inquiries) email.
    await notifications.enquiryReceived(
      { ...enquiry, post: enquiry.post?._id ?? post._id },
      post.title,
      Boolean(existing)
    );

    res.status(existing ? 200 : 201).json({
      success: true,
      updated: Boolean(existing),
      message: existing
        ? `Your enquiry to ${sellerName || "the seller"} has been updated.`
        : `Interest sent to ${sellerName || "the seller"}.`,
      enquiry: toEnquiryItem(enquiry),
    });
  } catch (error) {
    console.error("Create enquiry error:", error);
    res.status(500).json({
      success: false,
      message: "Failed to submit enquiry",
    });
  }
};

// GET /api/enquiries/received — Buyer Inquiries: enquiries on your posts,
// newest first. Query: page, limit (max 50), unread=true, method=WhatsApp.
// Also returns total and unread for all your enquiries.
const getReceivedEnquiries = async (req, res) => {
  try {
    const page = Math.max(1, parseInt(req.query.page, 10) || 1);
    const limit = Math.min(50, Math.max(1, parseInt(req.query.limit, 10) || 30));
    const skip = (page - 1) * limit;

    const ownLeads = await receivedFilter(req.user._id);
    // Inquiries from people you blocked are hidden.
    const blocked = req.user.blockedUsers || [];
    const mine = blocked.length ? { $and: [ownLeads, { user: { $nin: blocked } }] } : ownLeads;
    const extra = {};
    if (req.query.unread === "true") extra.readAt = null;
    if (Enquiry.CONTACT_METHODS.includes(req.query.method)) extra.contactMethod = req.query.method;
    const filter = Object.keys(extra).length ? { $and: [mine, extra] } : mine;

    const [enquiries, count, total, unread] = await Promise.all([
      Enquiry.find(filter)
        .sort({ lastMessageAt: -1, createdAt: -1, _id: -1 })
        .skip(skip)
        .limit(limit)
        .populate("post", POST_SUMMARY)
        .lean(),
      Enquiry.countDocuments(filter),
      Enquiry.countDocuments(mine),
      Enquiry.countDocuments({ $and: [mine, { readAt: null }] }),
    ]);

    res.status(200).json({
      success: true,
      count,
      total,
      unread,
      page,
      hasMore: skip + enquiries.length < count,
      enquiries: enquiries.map(toEnquiryItem),
    });
  } catch (error) {
    console.error("Get received enquiries error:", error);
    res.status(500).json({ success: false, message: "Failed to fetch enquiries" });
  }
};

// PATCH /api/enquiries/:id — the seller marks it read / unread or changes
// its status (Pending, Contacted, Closed).
const updateEnquiry = async (req, res) => {
  try {
    if (!isObjectId(req.params.id)) {
      return res.status(400).json({ success: false, message: "Invalid enquiry ID." });
    }
    const enquiry = await Enquiry.findById(req.params.id).select("sellerUser post readAt").lean();
    if (!enquiry) {
      return res.status(404).json({ success: false, message: "Enquiry not found" });
    }
    if (!(await isSellerOf(enquiry, req.user._id))) {
      return res.status(403).json({ success: false, message: "Only the seller can update this enquiry." });
    }

    const set = {};
    if (req.body.status !== undefined) set.status = req.body.status;
    if (req.body.read === true && !enquiry.readAt) set.readAt = new Date();
    if (req.body.read === false) set.readAt = null;
    if (Object.keys(set).length) {
      // Doesn't change lastMessageAt, so the list order stays the same.
      await Enquiry.updateOne({ _id: enquiry._id }, { $set: set });
    }

    const updated = await Enquiry.findById(enquiry._id).populate("post", POST_SUMMARY).lean();
    res.status(200).json({ success: true, message: "Enquiry updated.", enquiry: toEnquiryItem(updated) });
  } catch (error) {
    console.error("Update enquiry error:", error);
    res.status(500).json({ success: false, message: "Failed to update enquiry" });
  }
};

// GET /api/enquiries/my — enquiries you sent (as a buyer), newest first.
const getMyEnquiries = async (req, res) => {
  try {
    const enquiries = await Enquiry.find({ user: req.user._id })
      .sort({ lastMessageAt: -1, createdAt: -1 })
      .populate("post", POST_SUMMARY)
      .lean();

    res.status(200).json({
      success: true,
      count: enquiries.length,
      enquiries: enquiries.map(toEnquiryItem),
    });
  } catch (error) {
    console.error("Get enquiries error:", error);
    res.status(500).json({
      success: false,
      message: "Failed to fetch enquiries",
    });
  }
};

// DELETE /api/enquiries/:id — the buyer deletes one they sent.
const deleteEnquiry = async (req, res) => {
  try {
    if (!isObjectId(req.params.id)) {
      return res.status(400).json({ success: false, message: "Invalid enquiry ID." });
    }
    const enquiry = await Enquiry.findById(req.params.id);
    if (!enquiry) {
      return res.status(404).json({ success: false, message: "Enquiry not found" });
    }

    if (!enquiry.user || enquiry.user.toString() !== req.user._id.toString()) {
      return res.status(403).json({
        success: false,
        message: "Not authorized to delete this enquiry",
      });
    }

    await enquiry.deleteOne();
    await notifications.enquiryDeleted(enquiry._id);

    res.status(200).json({
      success: true,
      message: "Enquiry deleted successfully",
    });
  } catch (error) {
    console.error("Delete enquiry error:", error);
    res.status(500).json({
      success: false,
      message: "Failed to delete enquiry",
    });
  }
};

module.exports = {
  createEnquiry,
  getReceivedEnquiries,
  updateEnquiry,
  getMyEnquiries,
  deleteEnquiry,
};

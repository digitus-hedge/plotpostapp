const { Op } = require("sequelize");
const { Enquiry, Post, User } = require("../models");
const notifications = require("../services/notificationService");

const webPhoto = (url) => (typeof url === "string" && /^https?:\/\//.test(url) ? url : "");

const firstPhoto = (post) => {
  const photo = [...(post?.imageUrls || []), post?.imageUrl || ""].find(Boolean) || "";
  return /^https?:\/\//.test(photo) ? photo : "";
};

const toEnquiryItem = (enquiry) => {
  const post = enquiry.postItem || enquiry.post;
  return {
    _id: enquiry.id,
    id: enquiry.id,
    post: post && typeof post === "object" && post.id
      ? {
          _id: post.id,
          id: post.id,
          title: post.title,
          price: post.price || "",
          location: post.location || "",
          image: firstPhoto(post),
          status: post.status || "active",
        }
      : null,
    postTitle: enquiry.postTitle,
    seller: enquiry.seller || "",
    buyerUserId: enquiry.userId ? String(enquiry.userId) : null,
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

const createEnquiry = async (req, res) => {
  try {
    const { postId, name, phone, email, message, contactMethod, wantsVisit } = req.body;

    const post = await Post.findByPk(postId, {
      include: [{ model: User, as: "user", attributes: ["id", "name"] }],
    });

    if (!post || !post.user || post.removedAt || post.sellerBanned) {
      return res.status(404).json({ success: false, message: "This property is no longer available." });
    }
    if (post.status === "sold" || post.status === "rented") {
      return res.status(400).json({ success: false, message: "This property is no longer available." });
    }
    if (Post.isExpired(post)) {
      return res.status(400).json({ success: false, message: "This listing has expired." });
    }
    if (req.user && String(post.userId) === String(req.user.id)) {
      return res.status(400).json({ success: false, message: "You can't send interest on your own post." });
    }

    const sellerName = post.sellerName || post.user.name || "";
    const fields = {
      sellerUserId: post.userId,
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

    let enquiry;
    const existing = req.user
      ? await Enquiry.findOne({ where: { postId: post.id, userId: req.user.id } })
      : await Enquiry.findOne({ where: { postId: post.id, userId: null, phone } });

    if (existing) {
      await existing.update(fields);
      enquiry = existing;
    } else {
      enquiry = await Enquiry.create({
        ...fields,
        postId: post.id,
        userId: req.user ? req.user.id : null,
      });
    }

    await notifications.enquiryReceived(
      { ...enquiry.get({ plain: true }), post: post.id },
      post.title,
      Boolean(existing)
    );

    res.status(existing ? 200 : 201).json({
      success: true,
      updated: Boolean(existing),
      message: existing
        ? `Your enquiry to ${sellerName || "the seller"} has been updated.`
        : `Interest sent to ${sellerName || "the seller"}.`,
      enquiry: toEnquiryItem({ ...enquiry.get({ plain: true }), postItem: post }),
    });
  } catch (error) {
    console.error("Create enquiry error:", error);
    res.status(500).json({ success: false, message: "Failed to submit enquiry" });
  }
};

const getReceivedEnquiries = async (req, res) => {
  try {
    const page = Math.max(1, parseInt(req.query.page, 10) || 1);
    const limit = Math.min(50, Math.max(1, parseInt(req.query.limit, 10) || 30));
    const offset = (page - 1) * limit;

    const where = { sellerUserId: req.user.id };
    if (req.query.unread === "true") where.readAt = null;
    if (["Phone call", "WhatsApp", "Email"].includes(req.query.method)) where.contactMethod = req.query.method;

    const { rows: enquiries, count: total } = await Enquiry.findAndCountAll({
      where,
      include: [{ model: Post, as: "post", attributes: ["id", "title", "price", "location", "imageUrls", "status"] }],
      order: [["lastMessageAt", "DESC"]],
      limit,
      offset,
    });

    const unread = await Enquiry.count({ where: { sellerUserId: req.user.id, readAt: null } });

    res.status(200).json({
      success: true,
      count: total,
      total,
      unread,
      page,
      hasMore: offset + enquiries.length < total,
      enquiries: enquiries.map(toEnquiryItem),
    });
  } catch (error) {
    console.error("Get received enquiries error:", error);
    res.status(500).json({ success: false, message: "Failed to fetch enquiries" });
  }
};

const updateEnquiry = async (req, res) => {
  try {
    const enquiry = await Enquiry.findByPk(req.params.id, {
      include: [{ model: Post, as: "post" }],
    });

    if (!enquiry) {
      return res.status(404).json({ success: false, message: "Enquiry not found" });
    }

    if (String(enquiry.sellerUserId) !== String(req.user.id)) {
      return res.status(403).json({ success: false, message: "Only the seller can update this enquiry." });
    }

    if (req.body.status !== undefined) enquiry.status = req.body.status;
    if (req.body.read === true && !enquiry.readAt) enquiry.readAt = new Date();
    if (req.body.read === false) enquiry.readAt = null;

    await enquiry.save();

    res.status(200).json({ success: true, message: "Enquiry updated.", enquiry: toEnquiryItem(enquiry) });
  } catch (error) {
    console.error("Update enquiry error:", error);
    res.status(500).json({ success: false, message: "Failed to update enquiry" });
  }
};

const getMyEnquiries = async (req, res) => {
  try {
    const enquiries = await Enquiry.findAll({
      where: { userId: req.user.id },
      include: [{ model: Post, as: "post", attributes: ["id", "title", "price", "location", "imageUrls", "status"] }],
      order: [["lastMessageAt", "DESC"]],
    });

    res.status(200).json({
      success: true,
      count: enquiries.length,
      enquiries: enquiries.map(toEnquiryItem),
    });
  } catch (error) {
    console.error("Get enquiries error:", error);
    res.status(500).json({ success: false, message: "Failed to fetch enquiries" });
  }
};

const deleteEnquiry = async (req, res) => {
  try {
    const enquiry = await Enquiry.findByPk(req.params.id);
    if (!enquiry) {
      return res.status(404).json({ success: false, message: "Enquiry not found" });
    }

    if (!enquiry.userId || String(enquiry.userId) !== String(req.user.id)) {
      return res.status(403).json({ success: false, message: "Not authorized to delete this enquiry" });
    }

    await enquiry.destroy();
    await notifications.enquiryDeleted(enquiry.id);

    res.status(200).json({
      success: true,
      message: "Enquiry deleted successfully",
    });
  } catch (error) {
    console.error("Delete enquiry error:", error);
    res.status(500).json({ success: false, message: "Failed to delete enquiry" });
  }
};

module.exports = {
  createEnquiry,
  getReceivedEnquiries,
  updateEnquiry,
  getMyEnquiries,
  deleteEnquiry,
};

const express = require("express");
const router = express.Router();

const {
  createPost,
  getPosts,
  getPostsByIds,
  getPostById,
  recordView,
  recordContact,
  updatePostStatus,
  renewPost,
  getMyPosts,
  updatePost,
  deletePost,
  likePost,
  getComments,
  addComment,
  deleteComment,
  reportPost,
  reportComment,
} = require("../controllers/postController");

const { protect, optionalAuth } = require("../middleware/authMiddleware");
const validate = require("../middleware/validate");
const { noOffensiveWords } = require("../middleware/contentFilter");

// Text fields of a listing that are checked for offensive words.
const postText = noOffensiveWords({ title: "title", description: "description", sellerName: "seller name", location: "location" });
const {
  createPostSchema,
  updatePostSchema,
  commentSchema,
  reportSchema,
  personReportSchema,
} = require("../validators/postValidators");
const { commentLimiter, reportLimiter, newPostLimiter, actionLimiter } = require("../middleware/rateLimiter");
const { requireVerifiedEmail } = require("../middleware/emailVerified");

// Public routes (logged-in users also see which posts they liked)
router.get("/", optionalAuth, getPosts);

// Protected routes
router.get("/my", protect, getMyPosts);

// A guest's saved posts (kept on the phone), fetched by ID. Keep before "/:id".
router.get("/by-ids", optionalAuth, getPostsByIds);

// Property Details page (guests allowed; keep after "/my")
router.get("/:id", optionalAuth, getPostById);
router.post("/:id/view", optionalAuth, recordView);
router.post("/:id/contact", optionalAuth, recordContact);

router.post("/", protect, requireVerifiedEmail, newPostLimiter, validate(createPostSchema), postText, createPost);
router.put("/:id", protect, validate(updatePostSchema), postText, updatePost);
router.delete("/:id", protect, deletePost);
// My Listings: mark as sold / rented / active
router.patch("/:id/status", protect, updatePostStatus);
router.post("/:id/renew", protect, renewPost);
router.post("/:id/like", protect, actionLimiter, likePost);
// Comments: anyone can read; posting and deleting need login.
router.get("/:id/comments", optionalAuth, getComments);
router.post(
  "/:id/comment",
  protect,
  requireVerifiedEmail,
  commentLimiter,
  validate(commentSchema),
  noOffensiveWords({ text: "comment" }),
  addComment
);
router.delete("/:id/comments/:commentId", protect, deleteComment);
// Report a comment (one report per person per comment).
router.post(
  "/:id/comments/:commentId/report",
  protect,
  reportLimiter,
  validate(personReportSchema),
  reportComment
);
// Report a post (one report per person per post).
router.post("/:id/report", protect, reportLimiter, validate(reportSchema), reportPost);

module.exports = router;

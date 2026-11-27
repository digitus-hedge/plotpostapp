const express = require("express");
const router = express.Router();

const {
  getUserProfile,
  updateUserProfile,
  deleteAccount,
  blockUser,
  unblockUser,
  getBlockedUsers,
  reportUser,
  acceptTerms,
  toggleSavedPost,
  getSavedPosts,
  importSavedPosts,
  getPublicProfile,
  getPublicPosts,
  saveUploadedProfilePhoto,
  removeProfilePhoto,
} = require("../controllers/userController");
const {
  followUser,
  unfollowUser,
  getFollowing,
  getSuggestedSellers,
} = require("../controllers/followController");
const { avatarUpload } = require("../controllers/uploadController");
// One photo per request, checked to really be a photo.
const { oneImage } = require("../middleware/uploadMiddleware");

const { protect, optionalAuth } = require("../middleware/authMiddleware");
const validate = require("../middleware/validate");
const { noOffensiveWords } = require("../middleware/contentFilter");
const { authLimiter, reportLimiter, uploadLimiter, actionLimiter } = require("../middleware/rateLimiter");
const { personReportSchema } = require("../validators/postValidators");
const { updateProfileSchema } = require("../validators/userValidators");
const { deleteAccountSchema } = require("../validators/authValidators");

// User Profile routes
router.get("/profile", protect, getUserProfile);
router.put(
  "/profile",
  protect,
  validate(updateProfileSchema),
  noOffensiveWords({ name: "name", bio: "bio", agency: "agency", profession: "role", location: "location" }),
  updateUserProfile
);
// Uploads the photo and saves it as your profile photo in one step.
router.post("/profile/photo", protect, uploadLimiter, oneImage, avatarUpload(saveUploadedProfilePhoto));
router.delete("/profile/photo", protect, removeProfilePhoto);

// Terms of Use accepted ("Agree and continue").
router.post("/accept-terms", protect, acceptTerms);

// Delete your account (body: { password } or { confirm: "DELETE" }).
router.delete("/me", protect, authLimiter, validate(deleteAccountSchema), deleteAccount);

// Block / unblock someone. You stop seeing their posts, comments and chats,
// and neither of you can message the other. Keep "/blocked" before "/:id".
router.get("/blocked", protect, getBlockedUsers);
router.post("/:id/block", protect, blockUser);
router.delete("/:id/block", protect, unblockUser);

// Report a person (one report per person reported).
router.post("/:id/report", protect, reportLimiter, validate(personReportSchema), reportUser);

// Saved / Bookmarks routes
// Phone saves moved to the account (keep before "/saved/:postId").
router.post("/saved/import", protect, importSavedPosts);
router.post("/saved/:postId", protect, actionLimiter, toggleSavedPost);
router.get("/saved", protect, getSavedPosts);

// Following tab (Browse screen)
router.get("/following", protect, getFollowing);
router.get("/suggested-sellers", optionalAuth, getSuggestedSellers);
router.post("/:id/follow", protect, actionLimiter, followUser);
router.delete("/:id/follow", protect, actionLimiter, unfollowUser);

// Public seller profile (guests allowed). Kept last so /profile, /blocked,
// /saved, /following and /suggested-sellers above are matched first.
router.get("/:id", optionalAuth, getPublicProfile);
router.get("/:id/posts", optionalAuth, getPublicPosts);

module.exports = router;

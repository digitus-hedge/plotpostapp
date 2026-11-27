
const express = require("express");
const router = express.Router();

const { protect } = require("../middleware/authMiddleware");
const { requireVerifiedEmail } = require("../middleware/emailVerified");
const { oneImage } = require("../middleware/uploadMiddleware");
const { uploadLimiter } = require("../middleware/rateLimiter");
const { uploadImage, uploadAvatar, videoUploadTicket } = require("../controllers/uploadController");

// Property photo
router.post("/", protect, uploadLimiter, oneImage, uploadImage);

// Profile photo
router.post("/avatar", protect, uploadLimiter, oneImage, uploadAvatar);

// Permission to upload one post video straight to Cloudinary (the file
// itself never comes to this server). Same rule as posting: confirmed email.
router.post("/video/ticket", protect, requireVerifiedEmail, uploadLimiter, videoUploadTicket);

module.exports = router;

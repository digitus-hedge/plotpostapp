
const express = require("express");
const router = express.Router();

const { protect } = require("../middleware/authMiddleware");
const { oneImage } = require("../middleware/uploadMiddleware");
const { uploadLimiter } = require("../middleware/rateLimiter");
const { uploadImage, uploadAvatar } = require("../controllers/uploadController");

// Property photo
router.post("/", protect, uploadLimiter, oneImage, uploadImage);

// Profile photo
router.post("/avatar", protect, uploadLimiter, oneImage, uploadAvatar);

module.exports = router;

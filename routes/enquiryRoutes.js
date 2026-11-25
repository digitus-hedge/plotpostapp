const express = require("express");
const router = express.Router();

const {
  createEnquiry,
  getReceivedEnquiries,
  updateEnquiry,
  getMyEnquiries,
  deleteEnquiry,
} = require("../controllers/enquiryController");

const { protect, optionalAuth } = require("../middleware/authMiddleware");
const validate = require("../middleware/validate");
const { noOffensiveWords } = require("../middleware/contentFilter");
const { enquiryLimiter } = require("../middleware/rateLimiter");
const { requireVerifiedEmail } = require("../middleware/emailVerified");
const { createEnquirySchema, updateEnquirySchema } = require("../validators/enquiryValidators");

// Show Interest: guests allowed (a broken or expired login counts as a guest).
router.post(
  "/",
  optionalAuth,
  requireVerifiedEmail,
  enquiryLimiter,
  validate(createEnquirySchema),
  noOffensiveWords({ name: "name", message: "message" }),
  createEnquiry
);

// Buyer Inquiries: enquiries on your posts.
router.get("/received", protect, getReceivedEnquiries);
// Enquiries you sent.
router.get("/my", protect, getMyEnquiries);

// Seller: mark read / change status. Buyer: delete one you sent.
router.patch("/:id", protect, validate(updateEnquirySchema), updateEnquiry);
router.delete("/:id", protect, deleteEnquiry);

module.exports = router;

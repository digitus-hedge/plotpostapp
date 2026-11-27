// Admin panel API. Every route needs a logged-in account with role "admin"
// (give it with `node scripts/make-admin.js <email>`).
const express = require("express");
const router = express.Router();

const admin = require("../controllers/adminController");
const { protect, adminOnly } = require("../middleware/authMiddleware");
const validate = require("../middleware/validate");
const { reasonSchema, optionalReasonSchema, dismissSchema } = require("../validators/adminValidators");

router.use(protect, adminOnly);

router.get("/summary", admin.getSummary);

// Reports queue (oldest open first; over 24 hours = overdue).
router.get("/reports", admin.getReports);
router.post("/reports/dismiss", validate(dismissSchema), admin.dismissReports);

// Listings and comments.
router.get("/posts", admin.getPosts);
router.post("/posts/:id/remove", validate(reasonSchema), admin.removePost);
router.post("/posts/:id/restore", validate(optionalReasonSchema), admin.restorePost);
router.post("/posts/:id/comments/:commentId/remove", validate(reasonSchema), admin.removeComment);

// People.
router.get("/users", admin.getUsers);
router.get("/users/:id", admin.getUser);
router.post("/users/:id/ban", validate(reasonSchema), admin.banUser);
router.post("/users/:id/unban", validate(optionalReasonSchema), admin.unbanUser);

// Audit log.
router.get("/audit", admin.getAudit);

module.exports = router;

const express = require("express");
const router = express.Router();

const {
  listNotifications,
  unreadCount,
  markSeen,
  registerDevice,
  removeDevice,
} = require("../controllers/notificationController");
const { protect } = require("../middleware/authMiddleware");
const validate = require("../middleware/validate");
const {
  markSeenSchema,
  registerDeviceSchema,
  removeDeviceSchema,
} = require("../validators/notificationValidators");

// Notifications are for logged-in people only.
router.use(protect);

router.get("/", listNotifications);
router.get("/unread", unreadCount);
router.post("/seen", validate(markSeenSchema), markSeen);
router.post("/devices", validate(registerDeviceSchema), registerDevice);
router.delete("/devices", validate(removeDeviceSchema), removeDevice);

module.exports = router;

const express = require("express");
const router = express.Router();

const {
  startChat,
  listChats,
  unreadCount,
  getMessages,
  sendMessage,
  markRead,
  hideChat,
} = require("../controllers/chatController");
const { protect } = require("../middleware/authMiddleware");
const validate = require("../middleware/validate");
const { noOffensiveWords } = require("../middleware/contentFilter");
const { messageLimiter } = require("../middleware/rateLimiter");
const { requireVerifiedEmail } = require("../middleware/emailVerified");
const { startChatSchema, sendMessageSchema } = require("../validators/chatValidators");

// Chats are for logged-in people only.
router.use(protect);

router.post("/", requireVerifiedEmail, validate(startChatSchema), startChat);
router.get("/", listChats);
router.get("/unread", unreadCount);
router.get("/:id/messages", getMessages);
router.post(
  "/:id/messages",
  requireVerifiedEmail,
  messageLimiter,
  validate(sendMessageSchema),
  noOffensiveWords({ text: "message" }),
  sendMessage
);
router.post("/:id/read", markRead);
router.delete("/:id", hideChat);

module.exports = router;

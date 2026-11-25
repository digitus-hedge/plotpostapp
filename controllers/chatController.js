const mongoose = require("mongoose");
const Conversation = require("../models/Conversation");
const Message = require("../models/Message");
const User = require("../models/User");
const Post = require("../models/Post");
const notifications = require("../services/notificationService");

const isObjectId = (value) => typeof value === "string" && /^[a-f0-9]{24}$/i.test(value);

// New chats one person can start in 24 hours (opening an existing chat
// doesn't count).
const NEW_CHATS_PER_DAY = () => parseInt(process.env.CHAT_NEW_PER_DAY_MAX || "20", 10);
// Messages per page when scrolling back.
const PAGE_SIZE = 30;

const POST_SUMMARY = "title price location imageUrls imageUrl status";

const webPhoto = (url) => (typeof url === "string" && /^https?:\/\//.test(url) ? url : "");

const personOf = (user) =>
  user && user._id
    ? { _id: user._id, name: user.name, profileImage: webPhoto(user.profileImage) }
    : { _id: null, name: "PlotPost user", profileImage: "" };

const postSummaryOf = (post) => {
  if (!post || !post._id) return null;
  const photo = [...(post.imageUrls || []), post.imageUrl || ""].find(Boolean) || "";
  return {
    _id: post._id,
    title: post.title,
    price: post.price || "",
    location: post.location || "",
    image: webPhoto(photo),
    status: post.status || "active",
  };
};

const idOf = (value) => String(value?._id ?? value);
const otherOf = (conversation, me) => conversation.participants.find((p) => idOf(p) !== String(me));

// Blocking works both ways: if either person blocked the other, no messages.
const blockState = async (meId, otherId) => {
  const [me, other] = await Promise.all([
    User.findById(meId).select("blockedUsers").lean(),
    User.findById(otherId).select("blockedUsers").lean(),
  ]);
  const has = (list, id) => (list || []).some((item) => String(item) === String(id));
  return {
    otherExists: Boolean(other),
    blockedByMe: has(me?.blockedUsers, otherId),
    blockedMe: has(other?.blockedUsers, meId),
  };
};

// Why you can't send right now, or null.
const sendProblem = (state) => {
  if (!state.otherExists) return [404, "This person's account no longer exists."];
  if (state.blockedByMe) return [403, "You blocked this person. Unblock them to send a message."];
  // Deliberately vague: people aren't told they've been blocked.
  if (state.blockedMe) return [403, "You can't message this person."];
  return null;
};

// One chat in your list.
const chatItem = (conversation, me, blockedByMe = false) => {
  const key = String(me);
  const last = conversation.lastMessage;
  return {
    _id: conversation._id,
    other: personOf(otherOf(conversation, me)),
    post: postSummaryOf(conversation.post),
    lastMessage: last?.sentAt
      ? { text: last.text, fromMe: idOf(last.sender) === key, sentAt: last.sentAt }
      : null,
    lastMessageAt: conversation.lastMessageAt,
    unread: Number(conversation.unread?.[key] || 0),
    blockedByMe,
  };
};

const messageItem = (message, me) => ({
  _id: message._id,
  text: message.text,
  fromMe: idOf(message.sender) === String(me),
  sentAt: message.createdAt,
  post: postSummaryOf(message.post),
});

// A chat you're part of (strangers get "not found", so chat IDs reveal nothing).
const findMine = async (req, res) => {
  if (!isObjectId(req.params.id)) {
    res.status(400).json({ success: false, message: "Invalid chat ID." });
    return null;
  }
  const conversation = await Conversation.findOne({ _id: req.params.id, participants: req.user._id }).lean();
  if (!conversation) {
    res.status(404).json({ success: false, message: "Chat not found." });
    return null;
  }
  return conversation;
};

// POST /api/chats — body { userId, postId? }. Opens your chat with someone
// (there's one per pair), or starts it. With postId, the chat is about that
// property. A new chat shows in lists once a message is sent.
const startChat = async (req, res) => {
  try {
    const me = req.user._id;
    const { userId, postId } = req.body;

    if (String(userId) === String(me)) {
      return res.status(400).json({ success: false, message: "You can't message yourself." });
    }
    const state = await blockState(me, userId);
    if (!state.otherExists) {
      return res.status(404).json({ success: false, message: "This person's account no longer exists." });
    }

    let post = null;
    if (postId) {
      post = await Post.findById(postId).select("_id").lean();
      if (!post) {
        return res.status(404).json({ success: false, message: "This property is no longer available." });
      }
    }

    const pairKey = Conversation.pairKeyFor(me, userId);
    let conversation = await Conversation.findOne({ pairKey }).select("_id").lean();
    let created = false;

    if (!conversation) {
      const problem = sendProblem(state);
      if (problem) return res.status(problem[0]).json({ success: false, message: problem[1] });

      const since = new Date(Date.now() - 24 * 60 * 60 * 1000);
      if ((await Conversation.countDocuments({ createdBy: me, createdAt: { $gte: since } })) >= NEW_CHATS_PER_DAY()) {
        return res.status(429).json({
          success: false,
          message: "You've started a lot of new chats today. Please try again tomorrow.",
        });
      }
      try {
        conversation = await Conversation.create({
          participants: [me, userId],
          pairKey,
          createdBy: me,
          post: post ? post._id : null,
        });
        created = true;
      } catch (error) {
        // Both people tapped at once: use the one the other request made.
        if (error?.code !== 11000) throw error;
        conversation = await Conversation.findOne({ pairKey }).select("_id").lean();
      }
    } else if (post) {
      await Conversation.updateOne({ _id: conversation._id }, { $set: { post: post._id } }, { timestamps: false });
    }

    const full = await Conversation.findById(conversation._id)
      .populate("participants", "name profileImage")
      .populate("post", POST_SUMMARY)
      .lean();

    res.status(created ? 201 : 200).json({
      success: true,
      created,
      chat: chatItem(full, me, state.blockedByMe),
    });
  } catch (error) {
    console.error("Start chat error:", error);
    res.status(500).json({ success: false, message: "Could not open the chat." });
  }
};

// GET /api/chats — your chats with at least one message, newest first.
// Chats you deleted come back when a new message arrives. Also returns your
// total unread count.
const listChats = async (req, res) => {
  try {
    const me = req.user._id;
    const key = String(me);
    const [conversations, meDoc] = await Promise.all([
      Conversation.find({ participants: me, "lastMessage.sentAt": { $ne: null } })
        .sort({ lastMessageAt: -1, _id: -1 })
        .limit(200)
        .populate("participants", "name profileImage")
        .populate("post", POST_SUMMARY)
        .lean(),
      User.findById(me).select("blockedUsers").lean(),
    ]);
    const blocked = new Set((meDoc?.blockedUsers || []).map(String));

    // Chats you deleted stay hidden until a newer message; chats with people
    // you blocked are hidden until you unblock them.
    const visible = conversations.filter((c) => {
      if (blocked.has(idOf(otherOf(c, me)))) return false;
      const hidden = c.hiddenAt?.[key];
      return !hidden || new Date(c.lastMessageAt) > new Date(hidden);
    });
    const chats = visible.map((c) => chatItem(c, me, false));

    res.status(200).json({
      success: true,
      chats,
      unread: chats.reduce((sum, chat) => sum + chat.unread, 0),
    });
  } catch (error) {
    console.error("List chats error:", error);
    res.status(500).json({ success: false, message: "Could not load your messages." });
  }
};

// GET /api/chats/unread — for the badge on the Messages icon.
const unreadCount = async (req, res) => {
  try {
    const key = String(req.user._id);
    const blocked = new Set((req.user.blockedUsers || []).map(String));
    const conversations = await Conversation.find({ participants: req.user._id })
      .select("unread participants")
      .lean();
    // Chats with people you blocked don't count.
    const counts = conversations
      .filter((c) => !c.participants.some((p) => blocked.has(String(p))))
      .map((c) => Number(c.unread?.[key] || 0));
    res.status(200).json({
      success: true,
      unread: counts.reduce((sum, n) => sum + n, 0),
      chats: counts.filter((n) => n > 0).length,
    });
  } catch (error) {
    console.error("Unread count error:", error);
    res.status(500).json({ success: false, message: "Could not load the unread count." });
  }
};

// GET /api/chats/:id/messages — in time order.
//   (nothing)   the latest 30, with hasMore for older ones
//   ?before=ID  30 older than that message (scrolling up)
//   ?after=ID   everything newer than that message (checking for new ones)
// Also returns otherReadAt (for "Seen"), canMessage and blockedByMe.
const getMessages = async (req, res) => {
  try {
    const conversation = await findMine(req, res);
    if (!conversation) return;
    const me = req.user._id;
    const key = String(me);

    const filter = { conversation: conversation._id };
    const hidden = conversation.hiddenAt?.[key];
    if (hidden) filter.createdAt = { $gt: new Date(hidden) };

    const { before, after } = req.query;
    let messages;
    let hasMore = false;
    if (isObjectId(after)) {
      filter._id = { $gt: new mongoose.Types.ObjectId(after) };
      messages = await Message.find(filter).sort({ _id: 1 }).limit(200).populate("post", POST_SUMMARY).lean();
    } else {
      if (isObjectId(before)) filter._id = { $lt: new mongoose.Types.ObjectId(before) };
      const page = await Message.find(filter)
        .sort({ _id: -1 })
        .limit(PAGE_SIZE + 1)
        .populate("post", POST_SUMMARY)
        .lean();
      hasMore = page.length > PAGE_SIZE;
      messages = page.slice(0, PAGE_SIZE).reverse();
    }

    const otherId = idOf(conversation.participants.find((p) => String(p) !== key));
    const state = await blockState(me, otherId);

    res.status(200).json({
      success: true,
      messages: messages.map((message) => messageItem(message, me)),
      hasMore,
      otherReadAt: conversation.readAt?.[otherId] || null,
      canMessage: !sendProblem(state),
      blockedByMe: state.blockedByMe,
    });
  } catch (error) {
    console.error("Get messages error:", error);
    res.status(500).json({ success: false, message: "Could not load messages." });
  }
};

// POST /api/chats/:id/messages — body { text, postId? } (checked by
// validators/chatValidators.js).
const sendMessage = async (req, res) => {
  try {
    const conversation = await findMine(req, res);
    if (!conversation) return;
    const me = req.user._id;
    const key = String(me);
    const otherId = idOf(conversation.participants.find((p) => String(p) !== key));

    const problem = sendProblem(await blockState(me, otherId));
    if (problem) return res.status(problem[0]).json({ success: false, message: problem[1] });

    let post = null;
    if (req.body.postId) {
      post = await Post.findById(req.body.postId).select(POST_SUMMARY).lean();
      if (!post) {
        return res.status(404).json({ success: false, message: "This property is no longer available." });
      }
    }

    const message = await Message.create({
      conversation: conversation._id,
      sender: me,
      text: req.body.text,
      post: post ? post._id : null,
    });

    // Your own message counts as read by you; the other person gets +1 unread.
    await Conversation.updateOne(
      { _id: conversation._id },
      {
        $set: {
          lastMessage: { text: message.text.slice(0, 200), sender: me, sentAt: message.createdAt },
          lastMessageAt: message.createdAt,
          [`readAt.${key}`]: message.createdAt,
          [`unread.${key}`]: 0,
          ...(post ? { post: post._id } : {}),
        },
        $inc: { [`unread.${otherId}`]: 1 },
      }
    );
    // A phone alert for the other person (one per chat in their tray).
    await notifications.messageSent({
      conversationId: conversation._id,
      sender: req.user,
      recipientId: otherId,
      text: message.text,
    });

    res.status(201).json({
      success: true,
      message: messageItem({ ...message.toObject(), post }, me),
    });
  } catch (error) {
    console.error("Send message error:", error);
    res.status(500).json({ success: false, message: "Could not send your message." });
  }
};

// POST /api/chats/:id/read — you've seen everything so far.
const markRead = async (req, res) => {
  try {
    const conversation = await findMine(req, res);
    if (!conversation) return;
    const key = String(req.user._id);
    await Conversation.updateOne(
      { _id: conversation._id },
      { $set: { [`readAt.${key}`]: new Date(), [`unread.${key}`]: 0 } },
      { timestamps: false }
    );
    res.status(200).json({ success: true });
  } catch (error) {
    console.error("Mark chat read error:", error);
    res.status(500).json({ success: false, message: "Could not update the chat." });
  }
};

// DELETE /api/chats/:id — deletes the chat for you only: it leaves your list
// and its history is gone for you. The other person still has it. A new
// message brings it back (with only the new messages).
const hideChat = async (req, res) => {
  try {
    const conversation = await findMine(req, res);
    if (!conversation) return;
    const key = String(req.user._id);
    await Conversation.updateOne(
      { _id: conversation._id },
      { $set: { [`hiddenAt.${key}`]: new Date(), [`unread.${key}`]: 0 } },
      { timestamps: false }
    );
    res.status(200).json({ success: true, message: "Chat deleted." });
  } catch (error) {
    console.error("Delete chat error:", error);
    res.status(500).json({ success: false, message: "Could not delete the chat." });
  }
};

module.exports = {
  startChat,
  listChats,
  unreadCount,
  getMessages,
  sendMessage,
  markRead,
  hideChat,
};

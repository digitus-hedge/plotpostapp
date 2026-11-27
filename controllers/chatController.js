const { Op } = require("sequelize");
const { Conversation, Message, User, Post } = require("../models");
const notifications = require("../services/notificationService");

const NEW_CHATS_PER_DAY = () => parseInt(process.env.CHAT_NEW_PER_DAY_MAX || "20", 10);
const PAGE_SIZE = 30;

const webPhoto = (url) => (typeof url === "string" && /^https?:\/\//.test(url) ? url : "");

const personOf = (user) =>
  user && user.id
    ? { _id: user.id, id: user.id, name: user.name, profileImage: webPhoto(user.profileImage) }
    : { _id: null, id: null, name: "PlotPost user", profileImage: "" };

const postSummaryOf = (post) => {
  if (!post || !post.id) return null;
  const photo = [...(post.imageUrls || []), post.imageUrl || ""].find(Boolean) || "";
  return {
    _id: post.id,
    id: post.id,
    title: post.title,
    price: post.price || "",
    location: post.location || "",
    image: webPhoto(photo),
    status: post.status || "active",
  };
};

const blockState = async (meId, otherId) => {
  const [me, other] = await Promise.all([
    User.findByPk(meId),
    User.findByPk(otherId),
  ]);
  const has = (list, id) => (list || []).some((item) => String(item) === String(id));
  return {
    otherExists: Boolean(other),
    blockedByMe: has(me?.blockedUsers, otherId),
    blockedMe: has(other?.blockedUsers, meId),
  };
};

const sendProblem = (state) => {
  if (!state.otherExists) return [404, "This person's account no longer exists."];
  if (state.blockedByMe) return [403, "You blocked this person. Unblock them to send a message."];
  if (state.blockedMe) return [403, "You can't message this person."];
  return null;
};

const chatItem = (conversation, me, otherUser, post, blockedByMe = false) => {
  const key = String(me);
  const last = conversation.lastMessage || {};
  return {
    _id: conversation.id,
    id: conversation.id,
    other: personOf(otherUser),
    post: postSummaryOf(post),
    lastMessage: last?.sentAt
      ? { text: last.text, fromMe: String(last.sender) === key, sentAt: last.sentAt }
      : null,
    lastMessageAt: conversation.lastMessageAt,
    unread: Number(conversation.unread?.[key] || 0),
    blockedByMe,
  };
};

const messageItem = (message, me, post) => ({
  _id: message.id,
  id: message.id,
  text: message.text,
  fromMe: String(message.senderId) === String(me),
  sentAt: message.createdAt,
  post: postSummaryOf(post),
});

const startChat = async (req, res) => {
  try {
    const me = req.user.id;
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
      post = await Post.findByPk(postId);
      if (!post) {
        return res.status(404).json({ success: false, message: "This property is no longer available." });
      }
    }

    const pairKey = Conversation.pairKeyFor(me, userId);
    let conversation = await Conversation.findOne({ where: { pairKey } });
    let created = false;

    if (!conversation) {
      const problem = sendProblem(state);
      if (problem) return res.status(problem[0]).json({ success: false, message: problem[1] });

      const since = new Date(Date.now() - 24 * 60 * 60 * 1000);
      const count = await Conversation.count({ where: { createdBy: me, createdAt: { [Op.gte]: since } } });
      if (count >= NEW_CHATS_PER_DAY()) {
        return res.status(429).json({
          success: false,
          message: "You've started a lot of new chats today. Please try again tomorrow.",
        });
      }
      try {
        conversation = await Conversation.create({
          participants: [me, parseInt(userId, 10)],
          pairKey,
          createdBy: me,
          postId: post ? post.id : null,
        });
        created = true;
      } catch (error) {
        conversation = await Conversation.findOne({ where: { pairKey } });
      }
    } else if (post) {
      conversation.postId = post.id;
      await conversation.save();
    }

    const otherUser = await User.findByPk(userId);

    res.status(created ? 201 : 200).json({
      success: true,
      created,
      chat: chatItem(conversation, me, otherUser, post, state.blockedByMe),
    });
  } catch (error) {
    console.error("Start chat error:", error);
    res.status(500).json({ success: false, message: "Could not open the chat." });
  }
};

const listChats = async (req, res) => {
  try {
    const me = req.user.id;
    const key = String(me);
    const conversations = await Conversation.findAll({
      order: [["lastMessageAt", "DESC"]],
      limit: 200,
    });

    const myConversations = conversations.filter((c) =>
      (c.participants || []).map(String).includes(key) && c.lastMessage?.sentAt
    );

    const chats = [];
    for (const c of myConversations) {
      const otherId = (c.participants || []).find((p) => String(p) !== key);
      const [otherUser, post] = await Promise.all([
        User.findByPk(otherId),
        c.postId ? Post.findByPk(c.postId) : null,
      ]);
      chats.push(chatItem(c, me, otherUser, post, false));
    }

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

const unreadCount = async (req, res) => {
  try {
    const key = String(req.user.id);
    const conversations = await Conversation.findAll();
    const myConversations = conversations.filter((c) =>
      (c.participants || []).map(String).includes(key)
    );
    const counts = myConversations.map((c) => Number(c.unread?.[key] || 0));
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

const getMessages = async (req, res) => {
  try {
    const conversation = await Conversation.findByPk(req.params.id);
    if (!conversation) return res.status(404).json({ success: false, message: "Chat not found." });

    const me = req.user.id;
    const key = String(me);
    const otherId = (conversation.participants || []).find((p) => String(p) !== key);

    const messages = await Message.findAll({
      where: { conversationId: conversation.id },
      order: [["id", "ASC"]],
      limit: PAGE_SIZE,
    });

    const state = await blockState(me, otherId);

    res.status(200).json({
      success: true,
      messages: messages.map((m) => messageItem(m, me, null)),
      hasMore: false,
      otherReadAt: conversation.readAt?.[String(otherId)] || null,
      canMessage: !sendProblem(state),
      blockedByMe: state.blockedByMe,
    });
  } catch (error) {
    console.error("Get messages error:", error);
    res.status(500).json({ success: false, message: "Could not load messages." });
  }
};

const sendMessage = async (req, res) => {
  try {
    const conversation = await Conversation.findByPk(req.params.id);
    if (!conversation) return res.status(404).json({ success: false, message: "Chat not found." });

    const me = req.user.id;
    const key = String(me);
    const otherId = (conversation.participants || []).find((p) => String(p) !== key);

    const problem = sendProblem(await blockState(me, otherId));
    if (problem) return res.status(problem[0]).json({ success: false, message: problem[1] });

    let post = null;
    if (req.body.postId) {
      post = await Post.findByPk(req.body.postId);
    }

    const message = await Message.create({
      conversationId: conversation.id,
      senderId: me,
      text: req.body.text,
      postId: post ? post.id : null,
    });

    const unread = { ...(conversation.unread || {}) };
    unread[String(otherId)] = Number(unread[String(otherId)] || 0) + 1;
    unread[key] = 0;

    const readAt = { ...(conversation.readAt || {}) };
    readAt[key] = message.createdAt;

    conversation.lastMessage = { text: message.text.slice(0, 200), sender: me, sentAt: message.createdAt };
    conversation.lastMessageAt = message.createdAt;
    conversation.unread = unread;
    conversation.readAt = readAt;
    if (post) conversation.postId = post.id;
    await conversation.save();

    await notifications.messageSent({
      conversationId: conversation.id,
      sender: req.user,
      recipientId: otherId,
      text: message.text,
    });

    res.status(201).json({
      success: true,
      message: messageItem(message, me, post),
    });
  } catch (error) {
    console.error("Send message error:", error);
    res.status(500).json({ success: false, message: "Could not send your message." });
  }
};

const markRead = async (req, res) => {
  try {
    const conversation = await Conversation.findByPk(req.params.id);
    if (!conversation) return res.status(404).json({ success: false, message: "Chat not found." });

    const key = String(req.user.id);
    const unread = { ...(conversation.unread || {}) };
    unread[key] = 0;
    const readAt = { ...(conversation.readAt || {}) };
    readAt[key] = new Date();

    conversation.unread = unread;
    conversation.readAt = readAt;
    await conversation.save();

    res.status(200).json({ success: true });
  } catch (error) {
    console.error("Mark chat read error:", error);
    res.status(500).json({ success: false, message: "Could not update the chat." });
  }
};

const hideChat = async (req, res) => {
  try {
    const conversation = await Conversation.findByPk(req.params.id);
    if (!conversation) return res.status(404).json({ success: false, message: "Chat not found." });

    const key = String(req.user.id);
    const hiddenAt = { ...(conversation.hiddenAt || {}) };
    hiddenAt[key] = new Date();

    conversation.hiddenAt = hiddenAt;
    await conversation.save();

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

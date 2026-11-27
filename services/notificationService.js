const { Notification, Post, User } = require("../models");
const push = require("./pushService");
const emailService = require("./emailService");

const idOf = (value) => String(value?.id ?? value?._id ?? value);

const oneLine = (value, max) => {
  const text = String(value ?? "").replace(/\s+/g, " ").trim();
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
};

const safely = (label, fn) => async (...args) => {
  try {
    return await fn(...args);
  } catch (error) {
    console.error(`Notification error (${label}):`, error?.message || error);
    return null;
  }
};

const recipientOf = (userId) => User.findByPk(userId);

const saveGroup = async (recipientId, groupKey, fields) => {
  const [notification, created] = await Notification.findOrCreate({
    where: { recipient: recipientId, groupKey },
    defaults: { ...fields, recipient: recipientId, groupKey, lastAt: new Date() },
  });
  if (!created) {
    await notification.update({ ...fields, lastAt: new Date() });
  }
};

const likeChanged = safely("like", async (postId, actorId, liked) => {
  const post = await Post.findByPk(postId);
  if (!post) return;
  const recipient = await recipientOf(post.userId);
  if (!recipient) return;
  if (liked && String(actorId) !== String(post.userId)) {
    await saveGroup(
      post.userId,
      `like:${post.id}`,
      { type: "like", post: post.id, actors: [actorId], count: (post.likes || []).length }
    );
  }
});

const commentAdded = safely("comment", async (postId, actor, text) => {
  const post = await Post.findByPk(postId);
  if (!post || String(post.userId) === String(actor.id)) return;
  const recipient = await recipientOf(post.userId);
  if (!recipient) return;

  await saveGroup(
    post.userId,
    `comment:${post.id}`,
    {
      type: "comment",
      post: post.id,
      actors: [actor.id],
      count: 1,
      preview: oneLine(text, 140),
    }
  );

  await push.sendToUser(post.userId, {
    title: `${oneLine(actor.name, 60)} commented on ${oneLine(post.title, 60) || "your post"}`,
    body: oneLine(text, 150),
    tag: `comment:${post.id}`,
    data: { type: "comment", postId: idOf(post.id) },
  });
});

const commentRemoved = safely("comment removed", async (postId) => {});

const followed = safely("follow", async (actorId, targetId) => {
  if (String(actorId) === String(targetId)) return;
  const recipient = await recipientOf(targetId);
  if (!recipient) return;
  await saveGroup(targetId, `follow:${idOf(actorId)}`, { type: "follow", actors: [actorId], count: 1 });

  const actor = await User.findByPk(actorId);
  await push.sendToUser(targetId, {
    title: "New follower",
    body: `${oneLine(actor?.name, 60) || "Someone"} started following you`,
    tag: `follow:${idOf(actorId)}`,
    data: { type: "follow", userId: idOf(actorId) },
  });
});

const unfollowed = safely("unfollow", async (actorId, targetId) => {
  await Notification.destroy({ where: { recipient: targetId, groupKey: `follow:${idOf(actorId)}` } });
});

const enquiryReceived = safely("inquiry", async (enquiry, postTitle, updated = false) => {
  const sellerId = enquiry.sellerUserId;
  if (!sellerId) return;
  const recipient = await recipientOf(sellerId);
  if (!recipient) return;

  await saveGroup(
    sellerId,
    `enquiry:${enquiry.id}`,
    {
      type: "enquiry",
      post: enquiry.postId,
      enquiry: enquiry.id,
      actors: enquiry.userId ? [enquiry.userId] : [],
      count: 1,
      actorName: oneLine(enquiry.name, 80),
      preview: oneLine(enquiry.message, 140),
    }
  );

  await push.sendToUser(sellerId, {
    title: updated ? "Updated buyer inquiry" : "New buyer inquiry",
    body: `${oneLine(enquiry.name, 60)} is interested in ${oneLine(postTitle, 80) || "your property"}`,
    tag: `enquiry:${enquiry.id}`,
    data: { type: "enquiry", enquiryId: idOf(enquiry.id) },
  });

  if (recipient.settings?.emailInquiries !== false && recipient.email) {
    emailService.sendEnquiryCopy(recipient, enquiry, postTitle, updated);
  }
});

const enquiryDeleted = safely("inquiry deleted", async (enquiryId) => {
  await Notification.destroy({ where: { enquiry: enquiryId } });
});

const messageSent = safely("message", async ({ conversationId, sender, recipientId, text }) => {
  const recipient = await recipientOf(recipientId);
  if (!recipient) return;
  await push.sendToUser(recipientId, {
    title: oneLine(sender.name, 60) || "New message",
    body: oneLine(text, 150),
    tag: `chat:${idOf(conversationId)}`,
    data: { type: "message", chatId: idOf(conversationId), senderId: idOf(sender.id) },
  });
});

const postDeleted = safely("post deleted", async (postId) => {
  await Notification.destroy({ where: { post: postId } });
});

const blockChanged = safely("block", async (meId, otherId, blocked) => {});

const accountDeleted = safely("account deleted", async (userId) => {
  await Notification.destroy({ where: { recipient: userId } });
  await push.removeAllDevices(userId);
});

const sessionsEnded = safely("sessions ended", async (userId) => {
  await push.removeAllDevices(userId);
});

const removedByAdmin = safely("moderation", async ({ userId, post, commentId = null, reason }) => {
  if (!userId) return;
  const groupKey = commentId ? `moderation:comment:${commentId}` : `moderation:post:${idOf(post?.id)}`;
  await saveGroup(
    userId,
    groupKey,
    {
      type: "moderation",
      actors: [],
      count: 1,
      post: post?.id ?? null,
      commentId: commentId || null,
      actorName: "PlotPost",
      preview: oneLine(reason, 140),
    }
  );
  const recipient = await recipientOf(userId);
  if (recipient) {
    const what = commentId ? "your comment" : "your listing";
    await push.sendToUser(userId, {
      title: `PlotPost removed ${what}`,
      body: oneLine(`${post?.title ? `"${post.title}": ` : ""}${reason}`, 150),
      tag: groupKey,
      data: { type: "moderation", postId: post?.id ? idOf(post.id) : "" },
    });
  }
});

const listingExpiry = safely("listing expiry", async ({ post, daysLeft }) => {
  if (!post?.userId) return;
  const groupKey = `listing:${idOf(post.id)}`;
  const expired = daysLeft <= 0;
  const preview = expired
    ? "Expired. It no longer shows in the feed. Renew it in My Listings to show it again."
    : `Expires in ${daysLeft} day${daysLeft === 1 ? "" : "s"}. Renew it in My Listings to keep it in the feed.`;
  await saveGroup(
    post.userId,
    groupKey,
    { type: "listing", actors: [], count: 1, post: post.id, actorName: "PlotPost", preview }
  );
  const recipient = await recipientOf(post.userId);
  if (recipient) {
    await push.sendToUser(post.userId, {
      title: expired ? "Your listing has expired" : "Your listing expires soon",
      body: oneLine(`${post.title ? `"${post.title}": ` : ""}${preview}`, 150),
      tag: groupKey,
      data: { type: "listing", postId: idOf(post.id) },
    });
  }
});

const listingRenewed = safely("listing renewed", async ({ userId, postId }) => {
  await Notification.destroy({ where: { recipient: userId, groupKey: `listing:${idOf(postId)}` } });
});

const restoredByAdmin = safely("moderation restored", async ({ userId, postId }) => {
  await Notification.destroy({ where: { recipient: userId, groupKey: `moderation:post:${idOf(postId)}` } });
});

module.exports = {
  listingExpiry,
  listingRenewed,
  removedByAdmin,
  restoredByAdmin,
  likeChanged,
  commentAdded,
  commentRemoved,
  followed,
  unfollowed,
  enquiryReceived,
  enquiryDeleted,
  messageSent,
  postDeleted,
  blockChanged,
  accountDeleted,
  sessionsEnded,
};

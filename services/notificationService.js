// Fills the Notifications list and sends phone alerts and inquiry emails.
//
// What creates what:
//   buyer inquiry on your post  -> list + phone alert + email copy (Email Inquiries on)
//   chat message to you         -> phone alert only (Messages has its own list)
//   comment on your post        -> list (grouped per post) + phone alert
//   like on your post           -> list (grouped per post)
//   new follower                -> list
// Never about your own actions, never from people you've blocked. Taking
// something back (unlike, unfollow, deleted comment or post) takes it out of
// the list again. Phone alerts follow the Push Notifications switch.
//
// Every function here catches its own errors: a notification problem must
// never break the like, comment, inquiry or message that caused it.
const Notification = require("../models/Notification");
const Post = require("../models/Post");
const User = require("../models/User");
const push = require("./pushService");
const emailService = require("./emailService");

const SHOWN_PEOPLE = 3;

const idOf = (value) => String(value?._id ?? value);

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

const recipientOf = (userId) =>
  User.findById(userId).select("name email settings blockedUsers").lean();

const blockedBy = (recipient) => new Set((recipient?.blockedUsers || []).map(String));
const alertsOn = (recipient) => recipient?.settings?.pushNotifications !== false;

// Updates a group's row. With bump (something new happened) the row is
// created if needed and moves to the top as new; without bump (something
// was taken back) only an existing row is corrected.
const saveGroup = async (recipientId, groupKey, fields, bump) => {
  const filter = { recipient: recipientId, groupKey };
  if (!bump) {
    await Notification.updateOne(filter, { $set: fields });
    return;
  }
  const update = { $set: { ...fields, lastAt: new Date() } };
  try {
    await Notification.updateOne(filter, update, { upsert: true });
  } catch (error) {
    // Two events at the same moment: the other one created the row.
    if (error?.code !== 11000) throw error;
    await Notification.updateOne(filter, update);
  }
};

// ------------------------------------------------------------------ likes

// Rebuilds the "liked your post" row from the post's likes.
const writeLikes = async (post, recipient, bump) => {
  const owner = idOf(post.user);
  const blocked = blockedBy(recipient);
  const groupKey = `like:${post._id}`;
  const likers = (post.likes || []).map(String).filter((id) => id !== owner && !blocked.has(id));
  if (!likers.length) {
    await Notification.deleteOne({ recipient: owner, groupKey });
    return;
  }
  // New likes are added at the end of the list.
  const recent = likers.slice(-SHOWN_PEOPLE).reverse();
  await saveGroup(owner, groupKey, { type: "like", post: post._id, actors: recent, count: likers.length }, bump);
};

const syncLikes = async (postId, bump = false) => {
  const post = await Post.findById(postId).select("user likes").lean();
  if (!post || !post.user) return;
  const recipient = await recipientOf(post.user);
  if (!recipient) return;
  await writeLikes(post, recipient, bump);
};

// Someone liked (liked = true) or unliked a post.
const likeChanged = safely("like", async (postId, actorId, liked) => {
  const post = await Post.findById(postId).select("user likes").lean();
  if (!post || !post.user) return;
  const recipient = await recipientOf(post.user);
  if (!recipient) return;
  const isNew = liked && idOf(actorId) !== idOf(post.user) && !blockedBy(recipient).has(idOf(actorId));
  await writeLikes(post, recipient, isNew);
});

// --------------------------------------------------------------- comments

// Rebuilds the "commented on your post" row from the post's comments.
const writeComments = async (post, recipient, bump) => {
  const owner = idOf(post.user);
  const blocked = blockedBy(recipient);
  const groupKey = `comment:${post._id}`;
  // Comments are stored oldest first; newest first here.
  const comments = (post.comments || [])
    .filter((comment) => comment.user && idOf(comment.user) !== owner && !blocked.has(idOf(comment.user)))
    .reverse();
  if (!comments.length) {
    await Notification.deleteOne({ recipient: owner, groupKey });
    return;
  }
  const people = [...new Set(comments.map((comment) => idOf(comment.user)))];
  const latest = comments[0];
  await saveGroup(
    owner,
    groupKey,
    {
      type: "comment",
      post: post._id,
      actors: people.slice(0, SHOWN_PEOPLE),
      count: people.length,
      preview: oneLine(latest.text, 140),
      commentId: latest._id,
    },
    bump
  );
};

const syncComments = async (postId, bump = false) => {
  const post = await Post.findById(postId).select("user comments").lean();
  if (!post || !post.user) return;
  const recipient = await recipientOf(post.user);
  if (!recipient) return;
  await writeComments(post, recipient, bump);
};

// A new comment: the seller's list, plus a phone alert.
const commentAdded = safely("comment", async (postId, actor, text) => {
  const post = await Post.findById(postId).select("user title comments").lean();
  if (!post || !post.user || idOf(post.user) === idOf(actor._id)) return;
  const recipient = await recipientOf(post.user);
  if (!recipient || blockedBy(recipient).has(idOf(actor._id))) return;

  await writeComments(post, recipient, true);
  if (alertsOn(recipient)) {
    await push.sendToUser(post.user, {
      title: `${oneLine(actor.name, 60)} commented on ${oneLine(post.title, 60) || "your post"}`,
      body: oneLine(text, 150),
      tag: `comment:${post._id}`,
      data: { type: "comment", postId: idOf(post._id) },
    });
  }
});

// A comment was deleted: the row now shows the comments that are left.
const commentRemoved = safely("comment removed", async (postId) => {
  await syncComments(postId, false);
});

// ---------------------------------------------------------------- follows

const followed = safely("follow", async (actorId, targetId) => {
  if (idOf(actorId) === idOf(targetId)) return;
  const recipient = await recipientOf(targetId);
  if (!recipient || blockedBy(recipient).has(idOf(actorId))) return;
  await saveGroup(targetId, `follow:${idOf(actorId)}`, { type: "follow", actors: [actorId], count: 1 }, true);
  // A phone alert too (only for a new follower: repeat taps never get here).
  if (alertsOn(recipient)) {
    const actor = await User.findById(actorId).select("name").lean();
    await push.sendToUser(targetId, {
      title: "New follower",
      body: `${oneLine(actor?.name, 60) || "Someone"} started following you`,
      tag: `follow:${idOf(actorId)}`,
      data: { type: "follow", userId: idOf(actorId) },
    });
  }
});

const unfollowed = safely("unfollow", async (actorId, targetId) => {
  await Notification.deleteOne({ recipient: targetId, groupKey: `follow:${idOf(actorId)}` });
});

// -------------------------------------------------------------- inquiries

// A buyer sent (or, updated = true, re-sent) interest in a post.
// enquiry: the saved enquiry (with sellerUser, user, name, phone, email,
// message, contactMethod, wantsVisit, post).
const enquiryReceived = safely("inquiry", async (enquiry, postTitle, updated = false) => {
  const sellerId = enquiry.sellerUser;
  if (!sellerId) return;
  const recipient = await recipientOf(sellerId);
  if (!recipient) return;
  if (enquiry.user && blockedBy(recipient).has(idOf(enquiry.user))) return;

  await saveGroup(
    sellerId,
    `enquiry:${enquiry._id}`,
    {
      type: "enquiry",
      post: enquiry.post,
      enquiry: enquiry._id,
      actors: enquiry.user ? [enquiry.user] : [],
      count: 1,
      actorName: oneLine(enquiry.name, 80),
      preview: oneLine(enquiry.message, 140),
    },
    true
  );

  if (alertsOn(recipient)) {
    await push.sendToUser(sellerId, {
      title: updated ? "Updated buyer inquiry" : "New buyer inquiry",
      body: `${oneLine(enquiry.name, 60)} is interested in ${oneLine(postTitle, 80) || "your property"}`,
      tag: `enquiry:${enquiry._id}`,
      data: { type: "enquiry", enquiryId: idOf(enquiry._id) },
    });
  }
  if (recipient.settings?.emailInquiries !== false && recipient.email) {
    emailService.sendEnquiryCopy(recipient, enquiry, postTitle, updated);
  }
});

const enquiryDeleted = safely("inquiry deleted", async (enquiryId) => {
  await Notification.deleteMany({ enquiry: enquiryId });
});

// ------------------------------------------------------------------ chats

// A chat message: a phone alert only. One alert per chat in the phone's
// tray, replaced by the newest message.
const messageSent = safely("message", async ({ conversationId, sender, recipientId, text }) => {
  const recipient = await recipientOf(recipientId);
  if (!recipient || !alertsOn(recipient) || blockedBy(recipient).has(idOf(sender._id))) return;
  await push.sendToUser(recipientId, {
    title: oneLine(sender.name, 60) || "New message",
    body: oneLine(text, 150),
    tag: `chat:${idOf(conversationId)}`,
    data: { type: "message", chatId: idOf(conversationId), senderId: idOf(sender._id) },
  });
});

// ------------------------------------------------------------- clean-ups

const postDeleted = safely("post deleted", async (postId) => {
  await Notification.deleteMany({ post: postId });
});

// You blocked (or unblocked) someone: their follow and inquiry rows go, and
// your like and comment rows are rebuilt without (or with) them.
const blockChanged = safely("block", async (meId, otherId, blocked) => {
  if (blocked) {
    await Notification.deleteMany({ recipient: meId, type: { $in: ["follow", "enquiry"] }, actors: otherId });
  }
  const posts = await Post.find({ user: meId, $or: [{ likes: otherId }, { "comments.user": otherId }] })
    .select("_id")
    .lean();
  for (const post of posts) {
    await syncLikes(post._id, false);
    await syncComments(post._id, false);
  }
});

// Account deleted: its notifications, its phones, and its name in other
// people's rows. postIds: posts it had liked or commented on (their likes
// and comments are already removed).
const accountDeleted = safely("account deleted", async (userId, postIds = []) => {
  await Notification.deleteMany({
    $or: [{ recipient: userId }, { type: { $in: ["follow", "enquiry"] }, actors: userId }],
  });
  for (const postId of [...new Set(postIds.map(String))]) {
    await syncLikes(postId, false);
    await syncComments(postId, false);
  }
  await push.removeAllDevices(userId);
});

// Every login ended (password change or reset, "Log out of all devices"):
// no more alerts to any phone until it logs in again.
const sessionsEnded = safely("sessions ended", async (userId) => {
  await push.removeAllDevices(userId);
});

// ------------------------------------------------------------ moderation

// An admin removed one of your listings or comments: a row in your list
// ("PlotPost removed your listing ...", with the reason) and a phone alert.
const removedByAdmin = safely("moderation", async ({ userId, post, commentId = null, reason }) => {
  if (!userId) return;
  const groupKey = commentId ? `moderation:comment:${commentId}` : `moderation:post:${idOf(post._id)}`;
  await saveGroup(
    userId,
    groupKey,
    {
      type: "moderation",
      actors: [],
      count: 1,
      post: post?._id ?? null,
      commentId: commentId || null,
      actorName: "PlotPost",
      preview: oneLine(reason, 140),
    },
    true
  );
  const recipient = await recipientOf(userId);
  if (alertsOn(recipient)) {
    const what = commentId ? "your comment" : "your listing";
    await push.sendToUser(userId, {
      title: `PlotPost removed ${what}`,
      body: oneLine(`${post?.title ? `"${post.title}": ` : ""}${reason}`, 150),
      tag: groupKey,
      data: { type: "moderation", postId: post?._id ? idOf(post._id) : "" },
    });
  }
});

// ------------------------------------------------------------ expiry

// Your listing expires soon (daysLeft) or has expired (daysLeft = 0): one row
// per listing ("listing:<postId>"), replaced by the newer notice, plus a phone
// alert. Sent by services/expiryService.js.
const listingExpiry = safely("listing expiry", async ({ post, daysLeft }) => {
  if (!post?.user) return;
  const groupKey = `listing:${idOf(post._id)}`;
  const expired = daysLeft <= 0;
  const preview = expired
    ? "Expired. It no longer shows in the feed. Renew it in My Listings to show it again."
    : `Expires in ${daysLeft} day${daysLeft === 1 ? "" : "s"}. Renew it in My Listings to keep it in the feed.`;
  await saveGroup(
    post.user,
    groupKey,
    { type: "listing", actors: [], count: 1, post: post._id, actorName: "PlotPost", preview },
    true
  );
  const recipient = await recipientOf(post.user);
  if (alertsOn(recipient)) {
    await push.sendToUser(post.user, {
      title: expired ? "Your listing has expired" : "Your listing expires soon",
      body: oneLine(`${post.title ? `"${post.title}": ` : ""}${preview}`, 150),
      tag: groupKey,
      data: { type: "listing", postId: idOf(post._id) },
    });
  }
});

// Renewed, marked active again, or marked sold / rented: the notice goes away.
const listingRenewed = safely("listing renewed", async ({ userId, postId }) => {
  await Notification.deleteOne({ recipient: userId, groupKey: `listing:${idOf(postId)}` });
});

// The listing was put back: its "removed" row goes away.
const restoredByAdmin = safely("moderation restored", async ({ userId, postId }) => {
  await Notification.deleteOne({ recipient: userId, groupKey: `moderation:post:${idOf(postId)}` });
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

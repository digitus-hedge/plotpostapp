// Deletes an account and everything that belongs to it. Used by the app's
// Delete Account button (DELETE /api/users/me) and by the website's
// Delete account page (POST /api/auth/delete-account/confirm), so both
// remove exactly the same data.
//
// Kept on purpose (see the privacy policy): reports made by or about the
// person and the admin log, both deleted 12 months later by
// services/retentionService.js.
const User = require("../models/User");
const Post = require("../models/Post");
const Follow = require("../models/Follow");
const PostView = require("../models/PostView");
const Enquiry = require("../models/Enquiry");
const Conversation = require("../models/Conversation");
const Message = require("../models/Message");
const RefreshToken = require("../models/RefreshToken");
const notifications = require("./notificationService");
const { deleteCloudinaryPhotos } = require("../controllers/postController");

const deleteAccountData = async (user) => {
  const userId = user._id;

  // 1. Your posts and everything attached to them.
  const posts = await Post.find({ user: userId }).select("_id imageUrls imageUrl").lean();
  const postIds = posts.map((post) => post._id);
  if (postIds.length) {
    await deleteCloudinaryPhotos(posts.flatMap((post) => [...(post.imageUrls || []), post.imageUrl || ""]));
    await Promise.all([
      PostView.deleteMany({ post: { $in: postIds } }),
      Enquiry.deleteMany({ post: { $in: postIds } }),
      User.updateMany({ savedPosts: { $in: postIds } }, { $pullAll: { savedPosts: postIds } }),
    ]);
    await Post.deleteMany({ _id: { $in: postIds } });
  }

  // 2. Your comments and likes on other people's posts (each comment is
  // removed exactly as stored, which works on every MongoDB-compatible database).
  const commented = await Post.collection
    .find({ "comments.user": userId }, { projection: { comments: 1 } })
    .toArray();
  const liked = await Post.find({ likes: userId }).select("_id").lean();
  for (const post of commented) {
    const yours = (post.comments || []).filter((comment) => String(comment.user) === String(userId));
    if (yours.length) await Post.collection.updateOne({ _id: post._id }, { $pullAll: { comments: yours } });
  }
  await Post.updateMany({ likes: userId }, { $pull: { likes: userId } }, { timestamps: false });

  // 3. Follows both ways, enquiries you sent, your chats and their
  // messages, other people's blocks of you, the listings you opened today
  // and yesterday, old login rows.
  const chats = await Conversation.find({ participants: userId }).select("_id").lean();
  const chatIds = chats.map((chat) => chat._id);
  await Promise.all([
    Follow.deleteMany({ $or: [{ follower: userId }, { following: userId }] }),
    Enquiry.deleteMany({ user: userId }),
    Message.deleteMany({ conversation: { $in: chatIds } }),
    User.updateMany({ blockedUsers: userId }, { $pull: { blockedUsers: userId } }),
    PostView.deleteMany({ viewer: `user:${userId}` }),
    RefreshToken.deleteMany({ user: userId }),
  ]);
  await Conversation.deleteMany({ _id: { $in: chatIds } });

  // 4. Notifications to and from you, your phones, your name in other
  // people's "liked / commented" rows, your profile photo.
  await notifications.accountDeleted(userId, [...commented, ...liked].map((post) => post._id));
  await deleteCloudinaryPhotos([user.profileImage]);

  // 5. The account itself (this also ends every login).
  await User.deleteOne({ _id: userId });
};

module.exports = { deleteAccountData };

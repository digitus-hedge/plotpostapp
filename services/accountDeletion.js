const { User, Post, Follow, PostView, Enquiry, Conversation, Message, RefreshToken } = require("../models");
const notifications = require("./notificationService");
const { deleteCloudinaryPhotos } = require("../controllers/postController");
const videoService = require("./videoService");

const deleteAccountData = async (user) => {
  const userId = user.id;

  const posts = await Post.findAll({ where: { userId } });
  const postIds = posts.map((post) => post.id);
  if (postIds.length) {
    await deleteCloudinaryPhotos(posts.flatMap((post) => [...(post.imageUrls || []), post.imageUrl || ""]));
    await Promise.all(posts.map((post) => videoService.destroyVideo(post.videoPublicId)));
    await Promise.all([
      PostView.destroy({ where: { postId: postIds } }),
      Enquiry.destroy({ where: { postId: postIds } }),
    ]);
    await Post.destroy({ where: { userId } });
  }

  const conversations = await Conversation.findAll();
  const myConversations = conversations.filter((c) =>
    (c.participants || []).map(String).includes(String(userId))
  );
  const chatIds = myConversations.map((c) => c.id);

  if (chatIds.length) {
    await Message.destroy({ where: { conversationId: chatIds } });
    await Conversation.destroy({ where: { id: chatIds } });
  }

  await Promise.all([
    Follow.destroy({ where: { follower: userId } }),
    Follow.destroy({ where: { following: userId } }),
    Enquiry.destroy({ where: { userId } }),
    PostView.destroy({ where: { viewer: `user:${userId}` } }),
    RefreshToken.destroy({ where: { userId } }),
  ]);

  await notifications.accountDeleted(userId, []);
  await deleteCloudinaryPhotos([user.profileImage]);

  await user.destroy();
};

module.exports = { deleteAccountData };

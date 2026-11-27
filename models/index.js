const User = require("./User");
const Post = require("./Post");
const Conversation = require("./Conversation");
const Message = require("./Message");
const Enquiry = require("./Enquiry");
const Notification = require("./Notification");
const Report = require("./Report");
const AdminAction = require("./AdminAction");
const PushDevice = require("./PushDevice");
const RefreshToken = require("./RefreshToken");
const PostView = require("./PostView");
const Follow = require("./Follow");

// Associations
Post.belongsTo(User, { foreignKey: "userId", as: "user" });
User.hasMany(Post, { foreignKey: "userId", as: "posts" });

Message.belongsTo(Conversation, { foreignKey: "conversationId", as: "conversation" });
Conversation.hasMany(Message, { foreignKey: "conversationId", as: "messages" });

Message.belongsTo(User, { foreignKey: "senderId", as: "sender" });
Message.belongsTo(Post, { foreignKey: "postId", as: "post" });

Enquiry.belongsTo(Post, { foreignKey: "postId", as: "post" });
Enquiry.belongsTo(User, { foreignKey: "userId", as: "buyer" });
Enquiry.belongsTo(User, { foreignKey: "sellerUserId", as: "sellerUser" });

Notification.belongsTo(User, { foreignKey: "recipient", as: "recipientUser" });
Notification.belongsTo(Post, { foreignKey: "post", as: "postItem" });

Report.belongsTo(User, { foreignKey: "reporter", as: "reporterUser" });
Report.belongsTo(User, { foreignKey: "reportedUser", as: "targetUser" });
Report.belongsTo(Post, { foreignKey: "post", as: "postItem" });

PushDevice.belongsTo(User, { foreignKey: "userId", as: "user" });
RefreshToken.belongsTo(User, { foreignKey: "userId", as: "user" });

// MariaDB (e.g. XAMPP) stores JSON columns as LONGTEXT, so they come back as
// strings. Real MySQL returns objects. Either way the app gets an object.
const parseJson = (value) => {
  if (typeof value !== "string") return value;
  try {
    return JSON.parse(value);
  } catch {
    return value;
  }
};

const ALL_MODELS = [
  User,
  Post,
  Conversation,
  Message,
  Enquiry,
  Notification,
  Report,
  AdminAction,
  PushDevice,
  RefreshToken,
  PostView,
  Follow,
];

for (const Model of ALL_MODELS) {
  let changed = false;
  for (const [name, attribute] of Object.entries(Model.rawAttributes)) {
    if (attribute.type?.key !== "JSON" || attribute.get) continue;
    attribute.get = function getJson() {
      return parseJson(this.getDataValue(name));
    };
    changed = true;
  }
  if (changed) Model.refreshAttributes();

  // Older code (and the app's JSON) still reads `record._id` from the
  // MongoDB days. Every model answers `_id` with its numeric `id`.
  if (!Object.getOwnPropertyDescriptor(Model.prototype, "_id")) {
    Object.defineProperty(Model.prototype, "_id", {
      get() {
        return this.get("id");
      },
      configurable: true,
    });
  }
}

module.exports = {
  User,
  Post,
  Conversation,
  Message,
  Enquiry,
  Notification,
  Report,
  AdminAction,
  PushDevice,
  RefreshToken,
  PostView,
  Follow,
};

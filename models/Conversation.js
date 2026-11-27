const { DataTypes } = require("sequelize");
const sequelize = require("../config/db");

const Conversation = sequelize.define(
  "Conversation",
  {
    id: {
      type: DataTypes.INTEGER,
      autoIncrement: true,
      primaryKey: true,
    },
    pairKey: {
      type: DataTypes.STRING,
      allowNull: false,
      unique: true,
    },
    createdBy: {
      type: DataTypes.INTEGER,
      allowNull: false,
    },
    postId: {
      type: DataTypes.INTEGER,
      allowNull: true,
    },
    participants: {
      type: DataTypes.JSON,
      defaultValue: [],
    },
    lastMessage: {
      type: DataTypes.JSON,
      defaultValue: { text: "", sender: null, sentAt: null },
    },
    lastMessageAt: {
      type: DataTypes.DATE,
      defaultValue: DataTypes.NOW,
    },
    unread: {
      type: DataTypes.JSON,
      defaultValue: {},
    },
    readAt: {
      type: DataTypes.JSON,
      defaultValue: {},
    },
    hiddenAt: {
      type: DataTypes.JSON,
      defaultValue: {},
    },
  },
  {
    tableName: "conversations",
    timestamps: true,
  }
);

Conversation.pairKeyFor = (a, b) => [String(a), String(b)].sort().join(":");

module.exports = Conversation;

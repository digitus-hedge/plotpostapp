const { DataTypes } = require("sequelize");
const sequelize = require("../config/db");

const NOTIFICATION_TYPES = ["enquiry", "comment", "like", "follow", "moderation", "listing"];

const Notification = sequelize.define(
  "Notification",
  {
    id: {
      type: DataTypes.INTEGER,
      autoIncrement: true,
      primaryKey: true,
    },
    recipient: {
      type: DataTypes.INTEGER,
      allowNull: false,
    },
    type: {
      type: DataTypes.ENUM(...NOTIFICATION_TYPES),
      allowNull: false,
    },
    groupKey: {
      type: DataTypes.STRING,
      allowNull: false,
    },
    actors: {
      type: DataTypes.JSON,
      defaultValue: [],
    },
    count: {
      type: DataTypes.INTEGER,
      defaultValue: 1,
    },
    post: {
      type: DataTypes.INTEGER,
      allowNull: true,
    },
    enquiry: {
      type: DataTypes.INTEGER,
      allowNull: true,
    },
    actorName: {
      type: DataTypes.STRING,
      defaultValue: "",
    },
    preview: {
      type: DataTypes.TEXT,
      defaultValue: "",
    },
    commentId: {
      type: DataTypes.STRING,
      allowNull: true,
    },
    lastAt: {
      type: DataTypes.DATE,
      defaultValue: DataTypes.NOW,
    },
  },
  {
    tableName: "notifications",
    timestamps: true,
  }
);

Notification.NOTIFICATION_TYPES = NOTIFICATION_TYPES;

module.exports = Notification;

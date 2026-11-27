const { DataTypes } = require("sequelize");
const sequelize = require("../config/db");

const ADMIN_ACTIONS = [
  "remove_post",
  "restore_post",
  "remove_comment",
  "ban_user",
  "unban_user",
  "dismiss_reports",
];

const AdminAction = sequelize.define(
  "AdminAction",
  {
    id: {
      type: DataTypes.INTEGER,
      autoIncrement: true,
      primaryKey: true,
    },
    admin: {
      type: DataTypes.INTEGER,
      allowNull: false,
    },
    adminName: {
      type: DataTypes.STRING,
      defaultValue: "",
    },
    action: {
      type: DataTypes.ENUM(...ADMIN_ACTIONS),
      allowNull: false,
    },
    post: {
      type: DataTypes.INTEGER,
      allowNull: true,
    },
    comment: {
      type: DataTypes.STRING,
      allowNull: true,
    },
    user: {
      type: DataTypes.INTEGER,
      allowNull: true,
    },
    summary: {
      type: DataTypes.TEXT,
      defaultValue: "",
    },
    reason: {
      type: DataTypes.TEXT,
      defaultValue: "",
    },
    reportsClosed: {
      type: DataTypes.INTEGER,
      defaultValue: 0,
    },
  },
  {
    tableName: "admin_actions",
    timestamps: true,
  }
);

AdminAction.ADMIN_ACTIONS = ADMIN_ACTIONS;

module.exports = AdminAction;

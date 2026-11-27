const { DataTypes } = require("sequelize");
const sequelize = require("../config/db");

const User = sequelize.define(
  "User",
  {
    id: {
      type: DataTypes.INTEGER,
      autoIncrement: true,
      primaryKey: true,
    },
    name: {
      type: DataTypes.STRING,
      allowNull: false,
    },
    email: {
      type: DataTypes.STRING,
      allowNull: false,
      unique: true,
      validate: {
        isEmail: true,
      },
    },
    password: {
      type: DataTypes.STRING,
      allowNull: true,
    },
    googleId: {
      type: DataTypes.STRING,
      allowNull: true,
      unique: true,
    },
    phone: {
      type: DataTypes.STRING,
      defaultValue: "",
    },
    profileImage: {
      type: DataTypes.TEXT,
      defaultValue: "",
    },
    bio: {
      type: DataTypes.TEXT,
      defaultValue: "",
    },
    agency: {
      type: DataTypes.STRING,
      defaultValue: "",
    },
    profession: {
      type: DataTypes.STRING,
      defaultValue: "",
    },
    location: {
      type: DataTypes.STRING,
      defaultValue: "",
    },
    role: {
      type: DataTypes.ENUM("user", "admin"),
      defaultValue: "user",
    },
    emailVerifiedAt: {
      type: DataTypes.DATE,
      allowNull: true,
      defaultValue: DataTypes.NOW,
    },
    tokenVersion: {
      type: DataTypes.INTEGER,
      defaultValue: 0,
    },
    bannedAt: {
      type: DataTypes.DATE,
      allowNull: true,
    },
    banReason: {
      type: DataTypes.STRING,
      defaultValue: "",
    },
    bannedBy: {
      type: DataTypes.INTEGER,
      allowNull: true,
    },
    termsAcceptedAt: {
      type: DataTypes.DATE,
      allowNull: true,
    },
    notificationsSeenAt: {
      type: DataTypes.DATE,
      allowNull: true,
    },
    passwordReset: {
      type: DataTypes.JSON,
      allowNull: true,
    },
    emailVerification: {
      type: DataTypes.JSON,
      allowNull: true,
    },
    accountDeletion: {
      type: DataTypes.JSON,
      allowNull: true,
    },
    settings: {
      type: DataTypes.JSON,
      defaultValue: { pushNotifications: true, emailInquiries: true },
    },
    blockedUsers: {
      type: DataTypes.JSON,
      defaultValue: [],
    },
    savedPosts: {
      type: DataTypes.JSON,
      defaultValue: [],
    },
  },
  {
    tableName: "users",
    timestamps: true,
  }
);

User.upgradeOldUsers = async function () {
  const [result] = await sequelize.query(
    "UPDATE users SET emailVerifiedAt = NOW() WHERE emailVerifiedAt IS NULL"
  );
  return result?.affectedRows || 0;
};

module.exports = User;

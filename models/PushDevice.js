const { DataTypes } = require("sequelize");
const sequelize = require("../config/db");

const PUSH_PLATFORMS = ["android", "ios", "web"];

const PushDevice = sequelize.define(
  "PushDevice",
  {
    id: {
      type: DataTypes.INTEGER,
      autoIncrement: true,
      primaryKey: true,
    },
    token: {
      type: DataTypes.STRING(500),
      allowNull: false,
      unique: true,
    },
    userId: {
      type: DataTypes.INTEGER,
      allowNull: false,
    },
    platform: {
      type: DataTypes.ENUM(...PUSH_PLATFORMS),
      defaultValue: "android",
    },
    lastSeenAt: {
      type: DataTypes.DATE,
      defaultValue: DataTypes.NOW,
    },
  },
  {
    tableName: "push_devices",
    timestamps: true,
  }
);

PushDevice.PUSH_PLATFORMS = PUSH_PLATFORMS;

module.exports = PushDevice;

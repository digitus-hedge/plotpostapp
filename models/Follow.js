const { DataTypes } = require("sequelize");
const sequelize = require("../config/db");

const Follow = sequelize.define(
  "Follow",
  {
    id: {
      type: DataTypes.INTEGER,
      autoIncrement: true,
      primaryKey: true,
    },
    follower: {
      type: DataTypes.INTEGER,
      allowNull: false,
    },
    following: {
      type: DataTypes.INTEGER,
      allowNull: false,
    },
  },
  {
    tableName: "follows",
    timestamps: true,
    indexes: [
      // One row per follower/seller pair; following twice is refused.
      { unique: true, fields: ["follower", "following"] },
      { fields: ["following"] },
    ],
  }
);

module.exports = Follow;

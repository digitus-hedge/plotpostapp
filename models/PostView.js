const { DataTypes } = require("sequelize");
const sequelize = require("../config/db");

const PostView = sequelize.define(
  "PostView",
  {
    id: {
      type: DataTypes.INTEGER,
      autoIncrement: true,
      primaryKey: true,
    },
    postId: {
      type: DataTypes.INTEGER,
      allowNull: false,
    },
    viewer: {
      type: DataTypes.STRING,
      allowNull: false,
    },
    kind: {
      type: DataTypes.ENUM("view", "call", "link", "share"),
      allowNull: false,
    },
    day: {
      type: DataTypes.STRING,
      allowNull: false,
    },
  },
  {
    tableName: "post_views",
    timestamps: true,
  }
);

module.exports = PostView;

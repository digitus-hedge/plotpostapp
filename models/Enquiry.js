const { DataTypes } = require("sequelize");
const sequelize = require("../config/db");

const Enquiry = sequelize.define(
  "Enquiry",
  {
    id: {
      type: DataTypes.INTEGER,
      autoIncrement: true,
      primaryKey: true,
    },
    userId: {
      type: DataTypes.INTEGER,
      allowNull: true,
    },
    sellerUserId: {
      type: DataTypes.INTEGER,
      allowNull: true,
    },
    postId: {
      type: DataTypes.INTEGER,
      allowNull: true,
    },
    postTitle: {
      type: DataTypes.STRING,
      allowNull: false,
    },
    seller: {
      type: DataTypes.STRING,
      defaultValue: "",
    },
    name: {
      type: DataTypes.STRING,
      allowNull: false,
    },
    phone: {
      type: DataTypes.STRING,
      allowNull: false,
    },
    email: {
      type: DataTypes.STRING,
      defaultValue: "",
    },
    message: {
      type: DataTypes.TEXT,
      defaultValue: "",
    },
    contactMethod: {
      type: DataTypes.ENUM("Phone call", "WhatsApp", "Email"),
      defaultValue: "Phone call",
    },
    wantsVisit: {
      type: DataTypes.BOOLEAN,
      defaultValue: false,
    },
    status: {
      type: DataTypes.ENUM("Pending", "Contacted", "Closed"),
      defaultValue: "Pending",
    },
    readAt: {
      type: DataTypes.DATE,
      allowNull: true,
    },
    lastMessageAt: {
      type: DataTypes.DATE,
      defaultValue: DataTypes.NOW,
    },
  },
  {
    tableName: "enquiries",
    timestamps: true,
  }
);

Enquiry.CONTACT_METHODS = ["Phone call", "WhatsApp", "Email"];
Enquiry.ENQUIRY_STATUSES = ["Pending", "Contacted", "Closed"];

module.exports = Enquiry;

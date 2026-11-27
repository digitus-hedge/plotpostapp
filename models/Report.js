const { DataTypes } = require("sequelize");
const sequelize = require("../config/db");

const REPORT_REASONS = [
  "Fake or misleading listing",
  "Spam, scam, or fraud",
  "Incorrect price or location",
  "Property already sold or rented",
  "Inappropriate content",
  "Other reason",
];

const PERSON_REPORT_REASONS = [
  "Spam or scam",
  "Harassment or bullying",
  "Hate speech or offensive language",
  "Sexual or inappropriate content",
  "Pretending to be someone else",
  "Other reason",
];

const REPORT_KINDS = ["post", "comment", "user"];

const Report = sequelize.define(
  "Report",
  {
    id: {
      type: DataTypes.INTEGER,
      autoIncrement: true,
      primaryKey: true,
    },
    kind: {
      type: DataTypes.ENUM(...REPORT_KINDS),
      defaultValue: "post",
    },
    post: {
      type: DataTypes.INTEGER,
      allowNull: true,
    },
    comment: {
      type: DataTypes.STRING,
      allowNull: true,
    },
    reportedUser: {
      type: DataTypes.INTEGER,
      allowNull: true,
    },
    commentText: {
      type: DataTypes.TEXT,
      defaultValue: "",
    },
    reporter: {
      type: DataTypes.INTEGER,
      allowNull: false,
    },
    reason: {
      type: DataTypes.STRING,
      allowNull: false,
    },
    details: {
      type: DataTypes.TEXT,
      defaultValue: "",
    },
    status: {
      type: DataTypes.ENUM("open", "done"),
      defaultValue: "open",
    },
    resolvedAt: {
      type: DataTypes.DATE,
      allowNull: true,
    },
    resolvedBy: {
      type: DataTypes.INTEGER,
      allowNull: true,
    },
    resolution: {
      type: DataTypes.STRING,
      defaultValue: "",
    },
  },
  {
    tableName: "reports",
    timestamps: true,
  }
);

Report.REPORT_REASONS = REPORT_REASONS;
Report.PERSON_REPORT_REASONS = PERSON_REPORT_REASONS;
Report.REPORT_KINDS = REPORT_KINDS;

Report.upgradeOldReports = async function () {
  return 0;
};

module.exports = Report;

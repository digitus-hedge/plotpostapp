const { DataTypes, Op } = require("sequelize");
const sequelize = require("../config/db");
const { parsePrice, parseBedrooms, parseArea } = require("../utils/priceParser");

const LISTING_DAYS = 90;
const DAY_MS = 24 * 60 * 60 * 1000;
const expiryFromNow = (now = Date.now()) => new Date(now + LISTING_DAYS * DAY_MS);

const Post = sequelize.define(
  "Post",
  {
    id: {
      type: DataTypes.INTEGER,
      autoIncrement: true,
      primaryKey: true,
    },
    userId: {
      type: DataTypes.INTEGER,
      allowNull: false,
    },
    title: {
      type: DataTypes.STRING,
      defaultValue: "",
    },
    caption: {
      type: DataTypes.TEXT,
      defaultValue: "",
    },
    type: {
      type: DataTypes.STRING,
      defaultValue: "Plot",
    },
    deal: {
      type: DataTypes.STRING,
      defaultValue: "For sale",
    },
    price: {
      type: DataTypes.STRING,
      defaultValue: "",
    },
    priceValue: {
      type: DataTypes.DOUBLE,
      allowNull: true,
    },
    location: {
      type: DataTypes.STRING,
      defaultValue: "",
    },
    description: {
      type: DataTypes.TEXT,
      defaultValue: "",
    },
    socialUrl: {
      type: DataTypes.TEXT,
      defaultValue: "",
    },
    sellerPhone: {
      type: DataTypes.STRING,
      defaultValue: "",
    },
    area: {
      type: DataTypes.STRING,
      defaultValue: "",
    },
    areaValue: {
      type: DataTypes.DOUBLE,
      allowNull: true,
    },
    bedrooms: {
      type: DataTypes.STRING,
      defaultValue: "",
    },
    bedroomsCount: {
      type: DataTypes.INTEGER,
      allowNull: true,
    },
    bathrooms: {
      type: DataTypes.STRING,
      defaultValue: "",
    },
    platform: {
      type: DataTypes.STRING,
      defaultValue: "PlotPost",
    },
    sellerName: {
      type: DataTypes.STRING,
      defaultValue: "",
    },
    video: {
      type: DataTypes.BOOLEAN,
      defaultValue: false,
    },
    videoPublicId: {
      type: DataTypes.STRING,
      defaultValue: "",
    },
    videoUrl: {
      type: DataTypes.TEXT,
      defaultValue: "",
    },
    videoPoster: {
      type: DataTypes.TEXT,
      defaultValue: "",
    },
    videoDuration: {
      type: DataTypes.INTEGER,
      allowNull: true,
    },
    status: {
      type: DataTypes.ENUM("active", "sold", "rented"),
      defaultValue: "active",
    },
    expiresAt: {
      type: DataTypes.DATE,
      defaultValue: () => expiryFromNow(),
    },
    expiryReminderAt: {
      type: DataTypes.DATE,
      allowNull: true,
    },
    expiredNoticeAt: {
      type: DataTypes.DATE,
      allowNull: true,
    },
    removedAt: {
      type: DataTypes.DATE,
      allowNull: true,
    },
    removedReason: {
      type: DataTypes.TEXT,
      defaultValue: "",
    },
    removedBy: {
      type: DataTypes.INTEGER,
      allowNull: true,
    },
    sellerBanned: {
      type: DataTypes.BOOLEAN,
      defaultValue: false,
    },
    views: {
      type: DataTypes.INTEGER,
      defaultValue: 0,
    },
    stats: {
      type: DataTypes.JSON,
      defaultValue: { calls: 0, linkOpens: 0, shares: 0 },
    },
    imageUrl: {
      type: DataTypes.TEXT,
      defaultValue: "",
    },
    imageUrls: {
      type: DataTypes.JSON,
      defaultValue: [],
    },
    likes: {
      type: DataTypes.JSON,
      defaultValue: [],
    },
    comments: {
      type: DataTypes.JSON,
      defaultValue: [],
    },
  },
  {
    tableName: "posts",
    timestamps: true,
    hooks: {
      beforeSave: (post) => {
        post.priceValue = parsePrice(post.price);
        post.bedroomsCount = parseBedrooms(post.bedrooms);
        post.areaValue = parseArea(post.area);
        if (post.videoUrl) post.video = true;
      },
    },
  }
);

Post.LISTING_DAYS = LISTING_DAYS;
Post.expiryFromNow = expiryFromNow;
Post.notExpired = () => ({ expiresAt: { [Op.gt]: new Date() } });
Post.isExpired = (post) =>
  Boolean(post?.expiresAt) &&
  !["sold", "rented"].includes(post?.status) &&
  new Date(post.expiresAt).getTime() <= Date.now();

Post.upgradeOldPosts = async function () {
  const [result] = await sequelize.query(
    "UPDATE posts SET expiresAt = NOW() + INTERVAL 90 DAY WHERE expiresAt IS NULL"
  );
  return result?.affectedRows || 0;
};

module.exports = Post;

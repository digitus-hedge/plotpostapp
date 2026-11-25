
const mongoose = require("mongoose");
const { parsePrice, parseBedrooms, parseArea } = require("../utils/priceParser");

// A listing shows for 90 days after it's posted or last renewed. Then it
// leaves the feed until the seller taps Renew in My Listings.
const LISTING_DAYS = 90;
const DAY_MS = 24 * 60 * 60 * 1000;
const expiryFromNow = (now = Date.now()) => new Date(now + LISTING_DAYS * DAY_MS);

const commentSchema = new mongoose.Schema(
  {
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    text: {
      type: String,
      required: true,
      trim: true,
    },
  },
  { timestamps: true }
);

const postSchema = new mongoose.Schema(
  {
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },

    caption: {
      type: String,
      trim: true,
      default: "",
    },

    title: { type: String, trim: true, default: "" },
    type: { type: String, trim: true, default: "Plot" },
    deal: { type: String, trim: true, default: "For sale" },
    price: { type: String, trim: true, default: "" },
    // Worked out from the price text on every save (utils/priceParser.js),
    // for the price filter. Rupees; per month for rentals. null = no clear price.
    priceValue: { type: Number, default: null },
    location: { type: String, trim: true, default: "" },
    description: { type: String, trim: true, default: "" },
    socialUrl: { type: String, trim: true, default: "" },
    sellerPhone: { type: String, trim: true, default: "" },
    area: { type: String, trim: true, default: "" },
    // Square feet from the size text ("10 cents" -> 4356), for the size
    // filter. null = no clear size.
    areaValue: { type: Number, default: null },
    bedrooms: { type: String, trim: true, default: "" },
    // Number from the bedrooms text ("3 BHK" -> 3), for the bedrooms filter.
    bedroomsCount: { type: Number, default: null },
    bathrooms: { type: String, trim: true, default: "" },
    platform: { type: String, trim: true, default: "PlotPost" },
    // Name shown on the post ("Seller / Agent name" on Create Post).
    // Empty means the seller's account name is shown.
    sellerName: { type: String, trim: true, default: "" },
    // True for reels, YouTube videos and other video links.
    video: { type: Boolean, default: false },
    // Set by the seller in My Listings. Sold and rented posts leave the home
    // feed but stay in My Listings and on their own page.
    status: { type: String, enum: ["active", "sold", "rented"], default: "active" },
    // When an active listing leaves the feed (see LISTING_DAYS). Renew and
    // "Mark as active" start a new 90 days. Sold and rented posts are
    // already out of the feed, so their date doesn't matter.
    expiresAt: { type: Date, default: () => expiryFromNow() },
    // When the "expires in 3 days" and "has expired" notices were sent
    // (each once per 90 days; cleared by Renew).
    expiryReminderAt: { type: Date, default: null },
    expiredNoticeAt: { type: Date, default: null },
    // Removed by an admin (breaks the rules). Hidden from everyone except the
    // seller, who sees "Removed by PlotPost" and the reason in My Listings.
    removedAt: { type: Date, default: null },
    removedReason: { type: String, trim: true, default: "" },
    removedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
    // The seller's account is banned: hidden until they are unbanned.
    sellerBanned: { type: Boolean, default: false },
    // People who opened the details page (each person once a day, not the seller).
    views: { type: Number, default: 0 },
    // Taps on "Call", "Open on Instagram/YouTube" and Share (each person once
    // a day). Shown only to the seller.
    stats: {
      calls: { type: Number, default: 0 },
      linkOpens: { type: Number, default: 0 },
      shares: { type: Number, default: 0 },
    },

    imageUrl: {
      type: String,
      default: "",
    },
    imageUrls: {
      type: [String],
      default: [],
    },

    likes: [
      {
        type: mongoose.Schema.Types.ObjectId,
        ref: "User",
      },
    ],

    comments: [commentSchema],
  },
  { timestamps: true }
);

// Keep the home feed fast as posts grow: newest first, per seller
// (Following tab, My Listings) and per platform tab.
postSchema.index({ createdAt: -1, _id: -1 });
postSchema.index({ user: 1, createdAt: -1 });
postSchema.index({ platform: 1, createdAt: -1 });
// Filter screen: property type, and Sale/Rent with a price range.
postSchema.index({ type: 1, createdAt: -1 });
postSchema.index({ deal: 1, priceValue: 1 });
postSchema.index({ areaValue: 1 });
// The hourly expiry check.
postSchema.index({ expiresAt: 1 });

// Posts made before listings expired get their first 90 days from today,
// so nothing disappears the day this goes live. Safe to run on every start.
// Uses the raw collection so "last updated" times stay as they were.
postSchema.statics.upgradeOldPosts = async function upgradeOldPosts() {
  const result = await this.collection.updateMany(
    { $or: [{ expiresAt: { $exists: false } }, { expiresAt: null }] },
    { $set: { expiresAt: expiryFromNow() } }
  );
  return result.modifiedCount || 0;
};

// Keep the filter numbers in step with the text. Runs on create and on every
// edit (both use save()), so they can never go stale.
postSchema.pre("save", function setFilterNumbers() {
  this.priceValue = parsePrice(this.price);
  this.bedroomsCount = parseBedrooms(this.bedrooms);
  this.areaValue = parseArea(this.area);
});

const Post = mongoose.model("Post", postSchema);
Post.LISTING_DAYS = LISTING_DAYS;
Post.expiryFromNow = expiryFromNow;
// Matches posts that haven't expired yet (posts without a date count as not
// expired). Built fresh each time because "now" moves.
Post.notExpired = () => ({ expiresAt: { $not: { $lte: new Date() } } });
Post.isExpired = (post) =>
  Boolean(post?.expiresAt) &&
  !["sold", "rented"].includes(post?.status) &&
  new Date(post.expiresAt).getTime() <= Date.now();

module.exports = Post;

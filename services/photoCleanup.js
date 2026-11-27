// Finds photos and videos in Cloudinary that nothing uses any more: uploaded
// for a post that was never published, or left behind some other way. Used
// by scripts/cleanupPhotos.js. Only PlotPost's own folders are looked at:
// plotpost/posts (post photos), plotpost/avatars (profile photos) and
// plotpost/videos (post videos).
//
// Deleting a post, removing photos in Edit, changing a profile photo and
// deleting an account already delete their photos straight away. This only
// catches what slips through.

const { Op } = require("sequelize");

const FOLDERS = {
  posts: "plotpost/posts/",
  avatars: "plotpost/avatars/",
  videos: "plotpost/videos/",
};

// Cloudinary keeps photos and videos apart, so each folder says which it holds.
const RESOURCE_TYPES = {
  posts: "image",
  avatars: "image",
  videos: "video",
};

const DAY_MS = 24 * 60 * 60 * 1000;

// Everything in a folder (500 at a time, following Cloudinary's pages).
const listFolder = async (cloudinary, prefix, resourceType = "image") => {
  const all = [];
  let cursor;
  do {
    const page = await cloudinary.api.resources({
      type: "upload",
      resource_type: resourceType,
      prefix,
      max_results: 500,
      ...(cursor ? { next_cursor: cursor } : {}),
    });
    for (const item of page.resources || []) {
      all.push({ publicId: item.public_id, createdAt: item.created_at, bytes: item.bytes || 0 });
    }
    cursor = page.next_cursor;
  } while (cursor);
  return all;
};

// The photo IDs the database still points to: every post's photos (removed
// posts included, so they can be restored) and every profile photo.
const usedPhotoIds = async ({ Post, User, publicIdOf }) => {
  const used = new Set();
  const add = (url) => {
    const id = publicIdOf(url);
    if (id) used.add(id);
  };
  // Read in pages of 500 so a big table never sits in memory at once.
  const eachRow = async (Model, options, onRow) => {
    for (let lastId = 0; ; ) {
      const rows = await Model.findAll({
        ...options,
        where: { ...(options.where || {}), id: { [Op.gt]: lastId } },
        order: [["id", "ASC"]],
        limit: 500,
        raw: true,
      });
      rows.forEach(onRow);
      if (rows.length < 500) return;
      lastId = rows[rows.length - 1].id;
    }
  };

  await eachRow(Post, { attributes: ["id", "imageUrls", "imageUrl", "videoPublicId"] }, (post) => {
    const urls = typeof post.imageUrls === "string" ? JSON.parse(post.imageUrls || "[]") : post.imageUrls;
    for (const url of urls || []) add(url);
    add(post.imageUrl);
    if (post.videoPublicId) used.add(post.videoPublicId);
  });
  await eachRow(
    User,
    { attributes: ["id", "profileImage"], where: { profileImage: { [Op.and]: [{ [Op.ne]: null }, { [Op.ne]: "" }] } } },
    (user) => add(user.profileImage)
  );
  return used;
};

// The photos to delete: not used, and older than olderThanDays (a photo
// uploaded a minute ago may belong to a post being written right now).
const findUnused = ({ photos, used, olderThanDays = 2, now = Date.now() }) => {
  const cutoff = now - olderThanDays * DAY_MS;
  return photos.filter((photo) => {
    if (used.has(photo.publicId)) return false;
    const created = Date.parse(photo.createdAt);
    return Number.isFinite(created) && created < cutoff;
  });
};

// Deletes in groups of 100 (Cloudinary's limit per call). Returns how many
// were deleted; failures are counted, not thrown.
const deletePhotos = async (cloudinary, publicIds, resourceType = "image") => {
  let deleted = 0;
  let failed = 0;
  for (let i = 0; i < publicIds.length; i += 100) {
    const batch = publicIds.slice(i, i + 100);
    try {
      const result = await cloudinary.api.delete_resources(batch, { type: "upload", resource_type: resourceType });
      for (const id of batch) {
        if (result?.deleted?.[id] === "deleted") deleted += 1;
        else failed += 1;
      }
    } catch (error) {
      failed += batch.length;
      console.error(`Could not delete ${batch.length} photo(s): ${error.message || error}`);
    }
  }
  return { deleted, failed };
};

module.exports = { FOLDERS, RESOURCE_TYPES, listFolder, usedPhotoIds, findUnused, deletePhotos };

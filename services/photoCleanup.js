// Finds photos in Cloudinary that nothing uses any more: uploaded for a post
// that was never published, or left behind some other way. Used by
// scripts/cleanupPhotos.js. Only PlotPost's own folders are looked at:
// plotpost/posts (post photos) and plotpost/avatars (profile photos).
//
// Deleting a post, removing photos in Edit, changing a profile photo and
// deleting an account already delete their photos straight away. This only
// catches what slips through.

const FOLDERS = {
  posts: "plotpost/posts/",
  avatars: "plotpost/avatars/",
};

const DAY_MS = 24 * 60 * 60 * 1000;

// Everything in a folder (500 at a time, following Cloudinary's pages).
const listFolder = async (cloudinary, prefix) => {
  const all = [];
  let cursor;
  do {
    const page = await cloudinary.api.resources({
      type: "upload",
      resource_type: "image",
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
  for await (const post of Post.find({}).select("imageUrls imageUrl").lean().cursor()) {
    for (const url of post.imageUrls || []) add(url);
    add(post.imageUrl);
  }
  for await (const user of User.find({ profileImage: { $nin: [null, ""] } }).select("profileImage").lean().cursor()) {
    add(user.profileImage);
  }
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
const deletePhotos = async (cloudinary, publicIds) => {
  let deleted = 0;
  let failed = 0;
  for (let i = 0; i < publicIds.length; i += 100) {
    const batch = publicIds.slice(i, i + 100);
    try {
      const result = await cloudinary.api.delete_resources(batch, { type: "upload", resource_type: "image" });
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

module.exports = { FOLDERS, listFolder, usedPhotoIds, findUnused, deletePhotos };

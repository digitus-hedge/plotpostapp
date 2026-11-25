const cloudinary = require("../config/cloudinary");
const AppError = require("../utils/AppError");
const { config } = require("../config/env");

const ensureConfigured = () => {
  if (!config.cloudinary.configured) {
    throw AppError.unavailable("Image uploads are not set up on the server yet.");
  }
};

// Uploads an image held in memory (from multer) to Cloudinary.
const uploadBuffer = (buffer, options = {}) => {
  ensureConfigured();
  return new Promise((resolve, reject) => {
    const stream = cloudinary.uploader.upload_stream(
      { resource_type: "image", ...options },
      (error, result) => (error ? reject(error) : resolve(result))
    );
    stream.end(buffer);
  });
};

const uploadAvatar = (buffer, userId) =>
  uploadBuffer(buffer, {
    folder: "plotpost/avatars",
    public_id: `${userId}-${Date.now()}`,
    transformation: [{ width: 400, height: 400, crop: "fill", gravity: "face" }],
  });

// Deletes an image. Failures are logged, not thrown: a leftover file in
// Cloudinary must never block a user action like deleting their account.
const destroyImage = async (publicId) => {
  if (!publicId || !config.cloudinary.configured) return;
  try {
    await cloudinary.uploader.destroy(publicId, { resource_type: "image" });
  } catch (error) {
    if (!config.isTest) console.warn("Cloudinary delete failed:", publicId, error.message);
  }
};

// Works out the Cloudinary public ID from one of our own image URLs, e.g.
// https://res.cloudinary.com/<cloud>/image/upload/v123/plotpost/abc.jpg -> plotpost/abc
// Returns null for anything else (base64 images, other sites).
const publicIdFromUrl = (url) => {
  if (typeof url !== "string" || !config.cloudinary.cloudName) return null;
  const prefix = `https://res.cloudinary.com/${config.cloudinary.cloudName}/image/upload/`;
  if (!url.startsWith(prefix)) return null;
  const parts = url.slice(prefix.length).split("/");
  while (parts.length && (/^v\d+$/.test(parts[0]) || parts[0].includes(","))) parts.shift();
  const path = parts.join("/").replace(/\.[a-z0-9]+$/i, "");
  return path.startsWith("plotpost") ? path : null;
};

module.exports = { uploadBuffer, uploadAvatar, destroyImage, publicIdFromUrl };

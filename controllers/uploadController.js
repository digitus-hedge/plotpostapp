const cloudinary = require("../config/cloudinary");
const videoService = require("../services/videoService");

const cloudinaryConfigured = () =>
  Boolean(
    process.env.CLOUDINARY_CLOUD_NAME &&
      process.env.CLOUDINARY_API_KEY &&
      process.env.CLOUDINARY_API_SECRET
  );

// Sends one image to Cloudinary with the given folder and size rules.
const sendToCloudinary = (buffer, folder, transformation) =>
  new Promise((resolve, reject) => {
    const stream = cloudinary.uploader.upload_stream(
      { folder, resource_type: "image", format: "jpg", transformation },
      (error, result) => {
        if (error) return reject(error);
        resolve(result);
      }
    );
    stream.end(buffer);
  });

// Shared by both uploads: checks, upload, answer. onUploaded(req, result),
// if given, runs after the upload and its return value is added to the answer.
const handleUpload = (folder, transformation, label, onUploaded) => async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({
        success: false,
        message: "Please select an image.",
      });
    }

    if (!cloudinaryConfigured()) {
      return res.status(503).json({
        success: false,
        message: "Photo uploads aren't set up on the server yet.",
      });
    }

    const result = await sendToCloudinary(req.file.buffer, folder, transformation);
    const extra = onUploaded ? await onUploaded(req, result) : {};

    return res.status(200).json({
      success: true,
      message: "Image uploaded successfully.",
      imageUrl: result.secure_url,
      publicId: result.public_id,
      ...extra,
    });
  } catch (error) {
    console.error(`${label} upload error:`, error);
    return res.status(500).json({
      success: false,
      message: "Image upload failed. Please try again.",
    });
  }
};

// POST /api/upload (multipart field "image")
// Uploads one property photo to Cloudinary and returns its link. Photos are
// shrunk to at most 1600 x 1600 px, compressed, and stored as JPG (so iPhone
// HEIC photos display everywhere). The app then puts the links in the post.
const uploadImage = handleUpload(
  "plotpost/posts",
  [{ width: 1600, height: 1600, crop: "limit" }, { quality: "auto" }],
  "Image"
);

// POST /api/upload/avatar (multipart field "image")
// A profile photo: cropped square around the face, 400 x 400 px, JPG. The app
// then saves the link with PUT /api/users/profile.
const uploadAvatar = handleUpload(
  "plotpost/avatars",
  [{ width: 400, height: 400, crop: "fill", gravity: "face" }, { quality: "auto" }],
  "Profile photo"
);

// POST /api/upload/video/ticket
// A signed ticket for sending one video (60 seconds at most) straight from
// the phone to Cloudinary. The app posts the file to ticket.uploadUrl with
// every field in ticket.fields, unchanged, then puts ticket.publicId on the
// post as videoPublicId. See services/videoService.js.
const videoUploadTicket = (req, res, next) => {
  try {
    const ticket = videoService.uploadTicket(req.user._id);
    return res.status(200).json({ success: true, ticket });
  } catch (error) {
    return next(error);
  }
};

// The same profile-photo upload, with a step that runs once it's in Cloudinary.
const avatarUpload = (onUploaded) =>
  handleUpload(
    "plotpost/avatars",
    [{ width: 400, height: 400, crop: "fill", gravity: "face" }, { quality: "auto" }],
    "Profile photo",
    onUploaded
  );

module.exports = { uploadImage, uploadAvatar, avatarUpload, videoUploadTicket };

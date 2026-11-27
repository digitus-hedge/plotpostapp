// Videos uploaded to PlotPost (not links to Instagram, YouTube...).
//
// Big video files never pass through our server. Instead:
//   1. The app asks for an upload ticket: POST /api/upload/video/ticket.
//      The ticket is signed with our Cloudinary secret, so it only works for
//      this one video, in our folder, under a name that starts with the
//      uploader's account id, for about an hour.
//   2. The app sends the file straight to Cloudinary with the ticket.
//   3. The app creates or edits the post with videoPublicId. The server asks
//      Cloudinary how long the video is (60 seconds at most), checks it
//      belongs to that account, and saves the playback link and cover picture.
//
// Cloudinary makes the phone-friendly copy and the cover picture straight
// after the upload (the "eager" versions), so the first view is quick.
const crypto = require("crypto");
const cloudinary = require("../config/cloudinary");
const { config } = require("../config/env");
const AppError = require("../utils/AppError");

const MAX_SECONDS = 60;
// Cloudinary's free plan refuses videos over 100 MB.
const MAX_BYTES = 100 * 1024 * 1024;
const FOLDER = "plotpost/videos";
// The copy people watch: at most 720 px wide, MP4 (H.264) so every phone
// plays it, quality chosen by Cloudinary.
const PLAYBACK = "c_limit,w_720,q_auto,vc_h264";
// The cover picture: the frame 1 second in, at most 1080 px wide.
const POSTER = "so_1,c_limit,w_1080,q_auto";
const EAGER = `${PLAYBACK}/mp4|${POSTER}/jpg`;
const ALLOWED_FORMATS = "mp4,mov,m4v,webm,3gp,mkv";

const ensureConfigured = () => {
  if (!config.cloudinary.configured) {
    throw AppError.unavailable("Video uploads aren't set up on the server yet.");
  }
};

// plotpost/videos/<accountId>_<random>: the account is part of the name, so
// nobody can attach someone else's video to their post.
const ownerPrefix = (userId) => `${FOLDER}/${userId}_`;
// <accountId> is the MySQL user id (a number).
const ID_PATTERN = /^plotpost\/videos\/\d+_[a-f0-9]{16}$/;

const deliveryBase = () => `https://res.cloudinary.com/${config.cloudinary.cloudName}/video/upload`;
const playbackUrl = (publicId) => `${deliveryBase()}/${PLAYBACK}/${publicId}.mp4`;
const posterUrl = (publicId) => `${deliveryBase()}/${POSTER}/${publicId}.jpg`;

// The fields the app sends to Cloudinary with the file. Every value is text,
// exactly as signed: Cloudinary refuses the upload if anything is changed.
const uploadTicket = (userId, now = Date.now()) => {
  ensureConfigured();
  const signed = {
    public_id: `${ownerPrefix(userId)}${crypto.randomBytes(8).toString("hex")}`,
    timestamp: String(Math.floor(now / 1000)),
    eager: EAGER,
    eager_async: "true",
    allowed_formats: ALLOWED_FORMATS,
  };
  const signature = cloudinary.utils.api_sign_request(signed, config.cloudinary.apiSecret);
  return {
    uploadUrl: `https://api.cloudinary.com/v1_1/${config.cloudinary.cloudName}/video/upload`,
    fields: { ...signed, api_key: config.cloudinary.apiKey, signature },
    publicId: signed.public_id,
    maxSeconds: MAX_SECONDS,
    maxBytes: MAX_BYTES,
  };
};

// Deletes a video. Failures are only logged: a leftover file must never
// stop someone from deleting or editing their post or their account.
const destroyVideo = async (publicId) => {
  if (!publicId || !config.cloudinary.configured) return;
  try {
    await cloudinary.uploader.destroy(publicId, { resource_type: "video", invalidate: true });
  } catch (error) {
    if (!config.isTest) console.warn("Cloudinary video delete failed:", publicId, error.message);
  }
};

const notFound = (error) =>
  error?.http_code === 404 || error?.error?.http_code === 404 || /not found/i.test(error?.message || "");

// Checks an uploaded video before it goes on a post, and returns the fields
// to save. A video that's too long or too big is deleted from Cloudinary.
const videoFieldsFor = async (publicId, userId) => {
  if (typeof publicId !== "string" || !ID_PATTERN.test(publicId) || !publicId.startsWith(ownerPrefix(userId))) {
    throw AppError.badRequest("That video wasn't uploaded from your account. Please add it again.");
  }
  ensureConfigured();

  let video;
  try {
    video = await cloudinary.api.resource(publicId, { resource_type: "video" });
  } catch (error) {
    if (notFound(error)) {
      throw AppError.badRequest("The video upload didn't finish. Please add the video again.");
    }
    if (!config.isTest) console.error("Cloudinary video check failed:", publicId, error.message || error);
    throw AppError.unavailable("We couldn't check the video just now. Please try again.");
  }

  const seconds = Number(video.duration) || 0;
  if (seconds > MAX_SECONDS + 0.5) {
    await destroyVideo(publicId);
    throw AppError.badRequest(
      `Videos can be up to ${MAX_SECONDS} seconds. This one is ${Math.round(seconds)} seconds; please trim it and add it again.`
    );
  }
  if (Number(video.bytes) > MAX_BYTES) {
    await destroyVideo(publicId);
    throw AppError.badRequest("That video is over 100 MB. Please choose a shorter or smaller one.");
  }

  return {
    videoPublicId: publicId,
    videoUrl: playbackUrl(publicId),
    videoPoster: posterUrl(publicId),
    videoDuration: Math.round(seconds * 10) / 10,
    video: true,
  };
};

// What a post without an uploaded video has (used when a video is removed).
const NO_VIDEO = { videoPublicId: "", videoUrl: "", videoPoster: "", videoDuration: null };

module.exports = {
  MAX_SECONDS,
  MAX_BYTES,
  FOLDER,
  EAGER,
  ID_PATTERN,
  NO_VIDEO,
  uploadTicket,
  videoFieldsFor,
  destroyVideo,
  playbackUrl,
  posterUrl,
};

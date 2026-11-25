
const multer = require("multer");

const storage = multer.memoryStorage();

const fileFilter = (req, file, callback) => {
  // HEIC/HEIF is the iPhone photo format; Cloudinary converts it to JPG.
  const allowedTypes = [
    "image/jpeg",
    "image/png",
    "image/webp",
    "image/heic",
    "image/heif",
  ];

  if (!allowedTypes.includes(file.mimetype)) {
    return callback(
      new Error("Only JPG, PNG, WEBP and HEIC photos are allowed.")
    );
  }

  callback(null, true);
};

const upload = multer({
  storage,
  limits: {
    fileSize: 8 * 1024 * 1024,
    files: 1, // one photo per request
    fields: 10,
    fieldSize: 100 * 1024,
  },
  fileFilter,
});

// The type above is what the phone *says* the file is. This checks the
// file's first bytes, so a renamed text file, script or PDF is refused.
const looksLikePhoto = (buffer) => {
  if (!Buffer.isBuffer(buffer) || buffer.length < 12) return false;
  const ascii = (start, end) => buffer.toString("latin1", start, end);
  // JPEG: FF D8 FF
  if (buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) return true;
  // PNG: 89 50 4E 47 0D 0A 1A 0A
  if (buffer.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return true;
  // WEBP: "RIFF" .... "WEBP"
  if (ascii(0, 4) === "RIFF" && ascii(8, 12) === "WEBP") return true;
  // HEIC / HEIF (iPhone photos): "ftyp" box with a HEIF brand
  if (ascii(4, 8) === "ftyp") {
    return ["heic", "heix", "hevc", "hevx", "heim", "heis", "mif1", "msf1"].includes(ascii(8, 12));
  }
  return false;
};

// Reads the one file in field "image" and checks it really is a photo.
// Bad files get a 400 with the reason.
const oneImage = (req, res, next) => {
  upload.single("image")(req, res, (error) => {
    if (error) {
      const message =
        error.code === "LIMIT_FILE_SIZE"
          ? "That photo is too large (8 MB at most)."
          : error.code === "LIMIT_FILE_COUNT" || error.code === "LIMIT_UNEXPECTED_FILE"
            ? "Send one photo at a time."
            : error.message;
      return res.status(400).json({ success: false, message });
    }
    if (req.file && !looksLikePhoto(req.file.buffer)) {
      return res.status(400).json({
        success: false,
        message: "This file isn't a photo PlotPost can use. Please choose a JPG, PNG, WEBP or HEIC photo.",
      });
    }
    next();
  });
};

module.exports = upload;
module.exports.oneImage = oneImage;
module.exports.looksLikePhoto = looksLikePhoto;

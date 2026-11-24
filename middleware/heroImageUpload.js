// Multer setup: reads the "image" file into memory and checks type and size.
const multer = require("multer");
const { MAX_IMAGE_SIZE_BYTES, ALLOWED_IMAGE_TYPES } = require("../config/heroBannerConfig");

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_IMAGE_SIZE_BYTES },
  // Only jpeg, png and webp files are accepted.
  fileFilter: (req, file, callback) => {
    if (!ALLOWED_IMAGE_TYPES.includes(file.mimetype)) {
      const error = new Error("Image must be a JPEG, PNG or WebP file.");
      error.statusCode = 400;
      return callback(error);
    }
    callback(null, true);
  },
});

// Express middleware that handles the upload and turns multer errors into clean 400 replies.
function receiveHeroImage(req, res, next) {
  upload.single("image")(req, res, (error) => {
    if (!error) return next();
    if (error.code === "LIMIT_FILE_SIZE") {
      return res.status(400).json({ error: "Image must be 5 MB or smaller." });
    }
    return res.status(error.statusCode || 400).json({ error: error.message });
  });
}

module.exports = { receiveHeroImage };

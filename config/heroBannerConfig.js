// Settings for the Hero Banners feature, kept in one place.
const MAX_ACTIVE_BANNERS = 5;
const MAX_IMAGE_SIZE_BYTES = 5 * 1024 * 1024; // 5 MB
const ALLOWED_IMAGE_TYPES = ["image/jpeg", "image/png", "image/webp"];
const CLOUDINARY_FOLDER = "imaans-store/hero-banners";
const LIMIT_MESSAGE = `Only ${MAX_ACTIVE_BANNERS} banners can be active at the same time. Turn one off first.`;

module.exports = {
  MAX_ACTIVE_BANNERS,
  MAX_IMAGE_SIZE_BYTES,
  ALLOWED_IMAGE_TYPES,
  CLOUDINARY_FOLDER,
  LIMIT_MESSAGE,
};

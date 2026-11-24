// Uploads hero banner images to Cloudinary.
const cloudinary = require("cloudinary").v2;
const { CLOUDINARY_FOLDER } = require("../config/heroBannerConfig");

// Loads the Cloudinary keys from the environment.
function configureCloudinary() {
  cloudinary.config({
    cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
    api_key: process.env.CLOUDINARY_API_KEY,
    api_secret: process.env.CLOUDINARY_API_SECRET,
    secure: true,
  });
}

// Uploads an image file buffer (from multer memory storage) and returns its https URL.
function uploadImageBuffer(buffer) {
  configureCloudinary();
  return new Promise((resolve, reject) => {
    const stream = cloudinary.uploader.upload_stream(
      { folder: CLOUDINARY_FOLDER, resource_type: "image" },
      (error, result) => {
        if (error) return reject(error);
        resolve(result.secure_url);
      }
    );
    stream.end(buffer);
  });
}

// Uploads an image that already lives at a remote URL (used by the seed script).
async function uploadImageFromUrl(imageUrl) {
  configureCloudinary();
  const result = await cloudinary.uploader.upload(imageUrl, {
    folder: CLOUDINARY_FOLDER,
    resource_type: "image",
  });
  return result.secure_url;
}

module.exports = { uploadImageBuffer, uploadImageFromUrl };

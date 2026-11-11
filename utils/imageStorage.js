const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { UPLOADS_PRODUCTS_DIR } = require("../config/mysql");

const MIME_TO_EXT = {
  "image/jpeg": "jpg",
  "image/jpg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
};

/**
 * Validates buffer against file signatures (magic bytes).
 * Rejects SVG, executables, HTML, or unknown binary formats.
 */
function detectImageFormat(buffer) {
  if (!buffer || buffer.length < 12) return null;

  // PNG: 89 50 4E 47 0D 0A 1A 0A
  if (
    buffer[0] === 0x89 &&
    buffer[1] === 0x50 &&
    buffer[2] === 0x4e &&
    buffer[3] === 0x47 &&
    buffer[4] === 0x0d &&
    buffer[5] === 0x0a &&
    buffer[6] === 0x1a &&
    buffer[7] === 0x0a
  ) {
    return "png";
  }

  // JPEG: FF D8 FF
  if (buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) {
    return "jpg";
  }

  // WebP: RIFF (bytes 0-3) and WEBP (bytes 8-11)
  if (
    buffer[0] === 0x52 &&
    buffer[1] === 0x49 &&
    buffer[2] === 0x46 &&
    buffer[3] === 0x46 &&
    buffer[8] === 0x57 &&
    buffer[9] === 0x45 &&
    buffer[10] === 0x42 &&
    buffer[11] === 0x50
  ) {
    return "webp";
  }

  return null;
}

/**
 * Ensures product images are stored on disk inside `ibrew-backend/uploads/products/`
 * and returns a clean URL path (never base64 data) for storage in MySQL.
 * Strictly accepts only PNG, JPEG, and WebP, validated by file magic bytes.
 */
function resolveAndSaveProductImage(imageInput, prefix = "product") {
  const raw = String(imageInput || "").trim();
  if (!raw) return "";

  // Check if input is a base64 data URI: data:image/png;base64,iVBOR...
  const dataUriMatch = raw.match(/^data:(image\/[a-zA-Z0-9.+-]+);base64,([\s\S]+)$/);
  if (dataUriMatch) {
    const mime = dataUriMatch[1].toLowerCase();

    // Reject SVG or disallowed MIME types immediately
    if (!MIME_TO_EXT[mime]) {
      return "";
    }

    const base64Data = dataUriMatch[2].replace(/\s/g, "");
    let buffer;
    try {
      buffer = Buffer.from(base64Data, "base64");
    } catch {
      return "";
    }

    // Validate true content magic bytes
    const detectedExt = detectImageFormat(buffer);
    if (!detectedExt) {
      return ""; // Content does not match valid PNG, JPG, or WebP signatures
    }

    const safePrefix =
      String(prefix || "product")
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/(^-|-$)/g, "")
        .slice(0, 48) || "product";

    const uniqueSuffix = `${Date.now()}-${crypto.randomBytes(4).toString("hex")}`;
    const filename = `${safePrefix}-${uniqueSuffix}.${detectedExt}`;
    const filePath = path.join(UPLOADS_PRODUCTS_DIR, filename);

    if (!fs.existsSync(UPLOADS_PRODUCTS_DIR)) {
      fs.mkdirSync(UPLOADS_PRODUCTS_DIR, { recursive: true });
    }

    fs.writeFileSync(filePath, buffer);

    // Served by Express at both /uploads/products/:file and /api/uploads/products/:file
    return `/api/uploads/products/${filename}`;
  }

  // Never allow raw data URI strings into database
  if (raw.startsWith("data:")) {
    return "";
  }

  // If already a hosted or relative URL, reject any .svg URLs to be thorough
  if (/\.svg(\?.*)?$/i.test(raw)) {
    return "";
  }

  return raw.slice(0, 500);
}

module.exports = {
  resolveAndSaveProductImage,
  detectImageFormat,
};

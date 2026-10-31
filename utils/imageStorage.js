const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { UPLOADS_PRODUCTS_DIR } = require("../config/mysql");

const MIME_TO_EXT = {
  "image/jpeg": "jpg",
  "image/jpg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "image/gif": "gif",
  "image/svg+xml": "svg",
  "image/avif": "avif",
};

/**
 * Ensures product images are stored on disk inside `ibrew-backend/uploads/products/`
 * and returns a clean URL path (never base64 data) for storage in MySQL.
 */
function resolveAndSaveProductImage(imageInput, prefix = "product") {
  const raw = String(imageInput || "").trim();
  if (!raw) return "";

  // Check if input is a base64 data URI: data:image/png;base64,iVBOR...
  const dataUriMatch = raw.match(/^data:(image\/[a-zA-Z0-9.+-]+);base64,([\s\S]+)$/);
  if (dataUriMatch) {
    const mime = dataUriMatch[1].toLowerCase();
    const base64Data = dataUriMatch[2].replace(/\s/g, "");
    const ext = MIME_TO_EXT[mime] || "jpg";

    const safePrefix =
      String(prefix || "product")
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/(^-|-$)/g, "")
        .slice(0, 48) || "product";

    const uniqueSuffix = `${Date.now()}-${crypto.randomBytes(4).toString("hex")}`;
    const filename = `${safePrefix}-${uniqueSuffix}.${ext}`;
    const filePath = path.join(UPLOADS_PRODUCTS_DIR, filename);

    if (!fs.existsSync(UPLOADS_PRODUCTS_DIR)) {
      fs.mkdirSync(UPLOADS_PRODUCTS_DIR, { recursive: true });
    }

    const buffer = Buffer.from(base64Data, "base64");
    fs.writeFileSync(filePath, buffer);

    // Served by Express at both /uploads/products/:file and /api/uploads/products/:file
    // (/api/uploads/... also works automatically through Next.js /api/:path* rewrite)
    return `/api/uploads/products/${filename}`;
  }

  // Never allow raw base64 strings into MySQL VARCHAR(500)
  if (raw.startsWith("data:")) {
    return "";
  }

  return raw.slice(0, 500);
}

module.exports = {
  resolveAndSaveProductImage,
};


// Handles hero banner requests: validates input, calls the service, sends the reply.
const service = require("../services/heroBannerService");
const { uploadImageBuffer } = require("../utils/heroImageUpload");
const { detectImageFormat } = require("../utils/imageStorage");
const { MAX_ACTIVE_BANNERS, LIMIT_MESSAGE } = require("../config/heroBannerConfig");

// Turns form text like "true", "1" or "on" into 1, anything else into 0.
function toActiveFlag(value) {
  return ["true", "1", "on"].includes(String(value).toLowerCase()) ? 1 : 0;
}

// Trims a form value, or returns the fallback when the value was not sent.
function textOrFallback(value, fallback) {
  return value === undefined ? fallback : String(value).trim();
}

// Builds the banner data by mixing form values over the existing banner (or defaults).
function buildBannerData(body, existing) {
  const base = existing || {
    title: "",
    subtitle: "",
    image_url: "",
    cta_text: "Shop now",
    cta_link: "/",
    display_order: 1,
    is_active: 1,
  };
  return {
    title: textOrFallback(body.title, base.title),
    subtitle: textOrFallback(body.subtitle, base.subtitle),
    image_url: base.image_url,
    cta_text: textOrFallback(body.cta_text, base.cta_text),
    cta_link: textOrFallback(body.cta_link, base.cta_link),
    display_order: body.display_order === undefined ? base.display_order : Number(body.display_order),
    is_active: body.is_active === undefined ? base.is_active : toActiveFlag(body.is_active),
  };
}

// Checks the banner data. Returns an error message, or "" when everything is fine.
function validateBannerData(data) {
  if (!data.title) return "Title is required.";
  if (data.title.length > 150) return "Title must be 150 characters or fewer.";
  if (data.subtitle.length > 300) return "Subtitle must be 300 characters or fewer.";
  if (!data.cta_text || data.cta_text.length > 60) return "Button text is required (max 60 characters).";
  if (!data.cta_link || data.cta_link.length > 200) return "Button link is required (max 200 characters).";
  if (!Number.isInteger(data.display_order)) return "Display order must be a number.";
  return "";
}

// Checks the uploaded file really is a jpeg, png or webp image. Returns an error or "".
function validateImageFile(file) {
  if (!file) return "";
  if (!detectImageFormat(file.buffer)) return "Image must be a real JPEG, PNG or WebP file.";
  return "";
}

// Returns true if turning this banner on would make more than 5 active banners.
async function isOverActiveLimit(data, bannerId) {
  if (!data.is_active) return false;
  const otherActive = await service.countActiveBanners(bannerId);
  return otherActive >= MAX_ACTIVE_BANNERS;
}

// Parses the :id URL value. Returns 0 when it is not a valid id.
function readId(req) {
  const id = Number(req.params.id);
  return Number.isInteger(id) && id > 0 ? id : 0;
}

// Public: list active banners for the homepage.
async function listPublicBanners(req, res) {
  const banners = await service.getActiveBanners();
  res.json({ success: true, banners });
}

// Admin: list all banners.
async function listAdminBanners(req, res) {
  const banners = await service.getAllBanners();
  res.json({ success: true, banners });
}

// Admin: create a banner (image file is required).
async function createBanner(req, res) {
  const data = buildBannerData(req.body, null);

  const problem = validateBannerData(data) || validateImageFile(req.file);
  if (problem) return res.status(400).json({ error: problem });
  if (!req.file) return res.status(400).json({ error: "Image file is required." });

  if (await isOverActiveLimit(data, 0)) {
    return res.status(409).json({ error: LIMIT_MESSAGE });
  }

  data.image_url = await uploadImageBuffer(req.file.buffer);
  const banner = await service.createBanner(data);
  res.status(201).json({ success: true, banner });
}

// Admin: update a banner (all fields and the image are optional).
async function updateBanner(req, res) {
  const id = readId(req);
  const existing = id ? await service.getBannerById(id) : null;
  if (!existing) return res.status(404).json({ error: "Banner not found." });

  const data = buildBannerData(req.body, existing);

  const problem = validateBannerData(data) || validateImageFile(req.file);
  if (problem) return res.status(400).json({ error: problem });

  if (await isOverActiveLimit(data, id)) {
    return res.status(409).json({ error: LIMIT_MESSAGE });
  }

  if (req.file) data.image_url = await uploadImageBuffer(req.file.buffer);
  const banner = await service.updateBanner(id, data);
  res.json({ success: true, banner });
}

// Admin: delete a banner.
async function deleteBanner(req, res) {
  const id = readId(req);
  const wasDeleted = id ? await service.deleteBanner(id) : false;
  if (!wasDeleted) return res.status(404).json({ error: "Banner not found." });
  res.json({ success: true, message: "Banner deleted." });
}

module.exports = {
  listPublicBanners,
  listAdminBanners,
  createBanner,
  updateBanner,
  deleteBanner,
};

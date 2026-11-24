// All database queries for hero_banners. Every query uses ? placeholders.
const { getTidbPool } = require("../config/tidb");
const { MAX_ACTIVE_BANNERS } = require("../config/heroBannerConfig");

// Returns active banners for the public homepage (max 5, in display order).
async function getActiveBanners() {
  const [rows] = await getTidbPool().query(
    "SELECT * FROM hero_banners WHERE is_active = 1 ORDER BY display_order ASC, id ASC LIMIT ?",
    [MAX_ACTIVE_BANNERS]
  );
  return rows;
}

// Returns every banner (active and hidden) for the admin panel.
async function getAllBanners() {
  const [rows] = await getTidbPool().query(
    "SELECT * FROM hero_banners ORDER BY display_order ASC, id ASC"
  );
  return rows;
}

// Returns one banner by id, or null if it does not exist.
async function getBannerById(id) {
  const [rows] = await getTidbPool().query("SELECT * FROM hero_banners WHERE id = ?", [id]);
  return rows[0] || null;
}

// Counts active banners, ignoring the banner with excludeId (the one being edited).
async function countActiveBanners(excludeId) {
  const [rows] = await getTidbPool().query(
    "SELECT COUNT(*) AS total FROM hero_banners WHERE is_active = 1 AND id <> ?",
    [excludeId]
  );
  return Number(rows[0].total);
}

// Inserts a new banner and returns it.
async function createBanner(data) {
  const [result] = await getTidbPool().query(
    `INSERT INTO hero_banners (title, subtitle, image_url, cta_text, cta_link, display_order, is_active)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [data.title, data.subtitle, data.image_url, data.cta_text, data.cta_link, data.display_order, data.is_active]
  );
  return getBannerById(result.insertId);
}

// Saves all fields of an existing banner and returns it.
async function updateBanner(id, data) {
  await getTidbPool().query(
    `UPDATE hero_banners
     SET title = ?, subtitle = ?, image_url = ?, cta_text = ?, cta_link = ?, display_order = ?, is_active = ?
     WHERE id = ?`,
    [data.title, data.subtitle, data.image_url, data.cta_text, data.cta_link, data.display_order, data.is_active, id]
  );
  return getBannerById(id);
}

// Deletes a banner. Returns true if a row was removed.
async function deleteBanner(id) {
  const [result] = await getTidbPool().query("DELETE FROM hero_banners WHERE id = ?", [id]);
  return result.affectedRows > 0;
}

module.exports = {
  getActiveBanners,
  getAllBanners,
  getBannerById,
  countActiveBanners,
  createBanner,
  updateBanner,
  deleteBanner,
};

const Banner = require("../models/Banner");

exports.getActiveBanners = async (req, res) => {
  try {
    const { type, slot } = req.query;
    const banners = await Banner.listActive(type || slot || null);
    res.json({ success: true, banners });
  } catch (error) {
    console.error("getActiveBanners error:", error);
    res.status(500).json({ error: "Failed to fetch banners" });
  }
};

exports.getAllBanners = async (req, res) => {
  try {
    const { type, slot } = req.query;
    const banners = await Banner.listAll(type || slot || null);
    res.json({ success: true, banners });
  } catch (error) {
    console.error("getAllBanners error:", error);
    res.status(500).json({ error: "Failed to fetch banners" });
  }
};

exports.createBanner = async (req, res) => {
  try {
    const { title } = req.body;
    if (!title) {
      return res.status(400).json({ error: "Banner title is required" });
    }
    const banner = await Banner.create(req.body);
    res.status(201).json({ success: true, banner });
  } catch (error) {
    console.error("createBanner error:", error);
    res.status(500).json({ error: "Failed to create banner" });
  }
};

exports.updateBanner = async (req, res) => {
  try {
    const { id } = req.params;
    const banner = await Banner.update(id, req.body);
    if (!banner) {
      return res.status(404).json({ error: "Banner not found" });
    }
    res.json({ success: true, banner });
  } catch (error) {
    console.error("updateBanner error:", error);
    res.status(500).json({ error: "Failed to update banner" });
  }
};

exports.deleteBanner = async (req, res) => {
  try {
    const { id } = req.params;
    await Banner.delete(id);
    res.json({ success: true, message: "Banner deleted successfully" });
  } catch (error) {
    console.error("deleteBanner error:", error);
    res.status(500).json({ error: "Failed to delete banner" });
  }
};

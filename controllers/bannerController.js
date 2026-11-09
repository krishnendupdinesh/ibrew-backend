const Banner = require("../models/Banner");

exports.getActiveBanners = async (req, res) => {
  try {
    const { type, slot } = req.query;
    const rawBanners = await Banner.listActive(type || slot || null);
    const banners = rawBanners.map((b) => ({
      id: b.id,
      bannerType: b.type,
      type: b.type,
      title: b.title,
      subtitle: b.subtitle || "",
      imageUrl: b.image || "",
      image: b.image || "",
      ctaText: b.cta_text || "Shop Now",
      ctaLink: b.link || "/",
      link: b.link || "/",
      displayOrder: b.sort_order ?? 0,
      sort_order: b.sort_order ?? 0,
      isActive: Boolean(b.is_active),
      is_active: b.is_active ? 1 : 0,
      startDate: b.start_date,
      endDate: b.end_date,
    }));
    res.json({ success: true, banners });
  } catch (error) {
    console.error("getActiveBanners error:", error);
    res.status(500).json({ error: "Failed to fetch banners" });
  }
};

exports.getAllBanners = async (req, res) => {
  try {
    const { type, slot } = req.query;
    const rawBanners = await Banner.listAll(type || slot || null);
    const banners = rawBanners.map((b) => ({
      id: b.id,
      bannerType: b.type,
      type: b.type,
      title: b.title,
      subtitle: b.subtitle || "",
      imageUrl: b.image || "",
      image: b.image || "",
      ctaText: b.cta_text || "Shop Now",
      ctaLink: b.link || "/",
      link: b.link || "/",
      displayOrder: b.sort_order ?? 0,
      sort_order: b.sort_order ?? 0,
      isActive: Boolean(b.is_active),
      is_active: b.is_active ? 1 : 0,
      startDate: b.start_date,
      endDate: b.end_date,
      createdAt: b.created_at,
      updatedAt: b.updated_at,
    }));
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

const BulkProduct = require("../models/BulkProduct");

exports.getActiveBulkProducts = async (req, res) => {
  try {
    const items = await BulkProduct.listActive();
    res.json({ success: true, items });
  } catch (error) {
    console.error("getActiveBulkProducts error:", error);
    res.status(500).json({ error: "Failed to load bulk catalog items." });
  }
};

exports.getAdminBulkProducts = async (req, res) => {
  try {
    const items = await BulkProduct.listAll();
    res.json({ success: true, items });
  } catch (error) {
    console.error("getAdminBulkProducts error:", error);
    res.status(500).json({ error: "Failed to load bulk catalog items." });
  }
};

exports.createBulkProduct = async (req, res) => {
  try {
    const { name } = req.body || {};
    if (!name || !String(name).trim()) {
      return res.status(400).json({ error: "Product name is required." });
    }
    const item = await BulkProduct.create(req.body);
    res.status(201).json({ success: true, item });
  } catch (error) {
    console.error("createBulkProduct error:", error);
    res.status(500).json({ error: "Failed to create bulk product." });
  }
};

exports.updateBulkProduct = async (req, res) => {
  try {
    const { id } = req.params;
    const item = await BulkProduct.update(id, req.body);
    if (!item) {
      return res.status(404).json({ error: "Bulk product not found." });
    }
    res.json({ success: true, item });
  } catch (error) {
    console.error("updateBulkProduct error:", error);
    res.status(500).json({ error: "Failed to update bulk product." });
  }
};

exports.deleteBulkProduct = async (req, res) => {
  try {
    const { id } = req.params;
    const deleted = await BulkProduct.delete(id);
    if (!deleted) {
      return res.status(404).json({ error: "Bulk product not found." });
    }
    res.json({ success: true, message: "Bulk product deleted." });
  } catch (error) {
    console.error("deleteBulkProduct error:", error);
    res.status(500).json({ error: "Failed to delete bulk product." });
  }
};


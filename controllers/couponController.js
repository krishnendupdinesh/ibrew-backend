const Coupon = require("../models/Coupon");

// POST /api/coupons/apply -> Customer validates and gets discount calculation
async function applyCoupon(req, res) {
  try {
    const { code, subtotal, email, phone } = req.body || {};
    if (!code) {
      return res.status(400).json({ error: "Please enter a coupon code." });
    }

    const result = await Coupon.validateForCart(code, {
      subtotal: Number(subtotal) || 0,
      email,
      phone,
    });

    if (!result.valid) {
      return res.status(400).json({ error: result.error });
    }

    return res.json({
      valid: true,
      coupon: result.coupon,
      message: `Coupon "${result.coupon.code}" applied successfully! You saved ₹${result.coupon.discountAmount}.`,
    });
  } catch (err) {
    console.error("applyCoupon error:", err);
    res.status(500).json({ error: "Failed to validate coupon." });
  }
}

// GET /api/coupons/active -> Public list of available active promo coupons for suggestions
async function getActiveCoupons(req, res) {
  try {
    const coupons = await Coupon.findActive();
    return res.json({ coupons });
  } catch (err) {
    console.error("getActiveCoupons error:", err);
    res.status(500).json({ error: "Failed to fetch coupons." });
  }
}

// GET /api/admin/coupons -> Admin list all coupons
async function adminGetCoupons(req, res) {
  try {
    const coupons = await Coupon.findAll();
    return res.json({ coupons });
  } catch (err) {
    console.error("adminGetCoupons error:", err);
    res.status(500).json({ error: "Failed to fetch coupons." });
  }
}

// POST /api/admin/coupons -> Admin creates a coupon
async function adminCreateCoupon(req, res) {
  try {
    const { code, discountValue } = req.body || {};
    if (!code || !discountValue) {
      return res.status(400).json({ error: "Coupon code and discount value are required." });
    }

    const existing = await Coupon.findByCode(code);
    if (existing) {
      return res.status(400).json({ error: `Coupon code "${code.toUpperCase()}" already exists.` });
    }

    const id = await Coupon.create(req.body);
    const created = await Coupon.findByCode(code);
    return res.status(201).json({ coupon: created, message: "Coupon created successfully." });
  } catch (err) {
    console.error("adminCreateCoupon error:", err);
    res.status(500).json({ error: "Failed to create coupon." });
  }
}

// PUT /api/admin/coupons/:id -> Admin updates coupon
async function adminUpdateCoupon(req, res) {
  try {
    const { id } = req.params;
    await Coupon.update(id, req.body);
    return res.json({ message: "Coupon updated successfully." });
  } catch (err) {
    console.error("adminUpdateCoupon error:", err);
    res.status(500).json({ error: "Failed to update coupon." });
  }
}

// DELETE /api/admin/coupons/:id -> Admin deletes coupon
async function adminDeleteCoupon(req, res) {
  try {
    const { id } = req.params;
    await Coupon.delete(id);
    return res.json({ message: "Coupon deleted successfully." });
  } catch (err) {
    console.error("adminDeleteCoupon error:", err);
    res.status(500).json({ error: "Failed to delete coupon." });
  }
}

module.exports = {
  applyCoupon,
  getActiveCoupons,
  adminGetCoupons,
  adminCreateCoupon,
  adminUpdateCoupon,
  adminDeleteCoupon,
};


const { getPool } = require("../config/mysql");

const Coupon = {
  async findByCode(code) {
    const clean = String(code || "").trim().toUpperCase();
    if (!clean) return null;
    const pool = getPool();
    const [rows] = await pool.query(
      "SELECT * FROM `coupons` WHERE UPPER(`code`) = ? LIMIT 1",
      [clean]
    );
    return rows.length > 0 ? rows[0] : null;
  },

  async findAll() {
    const pool = getPool();
    const [rows] = await pool.query(
      "SELECT * FROM `coupons` ORDER BY `is_active` DESC, `created_at` DESC"
    );
    return rows;
  },

  async findActive() {
    const pool = getPool();
    const [rows] = await pool.query(
      "SELECT `id`, `code`, `description`, `discount_type`, `discount_value`, `min_order_value`, `max_discount`, `free_shipping`, `expires_at` FROM `coupons` WHERE `is_active` = 1 AND (`expires_at` IS NULL OR `expires_at` > NOW()) ORDER BY `discount_value` DESC"
    );
    return rows;
  },

  async validateForCart(code, { subtotal = 0, email = "", phone = "" }) {
    const cleanCode = String(code || "").trim().toUpperCase();
    if (!cleanCode) {
      return { valid: false, error: "Please enter a coupon code." };
    }

    const coupon = await this.findByCode(cleanCode);
    if (!coupon) {
      return { valid: false, error: `Coupon code "${cleanCode}" is invalid.` };
    }

    if (!coupon.is_active) {
      return { valid: false, error: `Coupon "${cleanCode}" is no longer active.` };
    }

    if (coupon.expires_at && new Date(coupon.expires_at) < new Date()) {
      return { valid: false, error: `Coupon "${cleanCode}" has expired.` };
    }

    const sub = Number(subtotal) || 0;
    const minVal = Number(coupon.min_order_value) || 0;
    if (sub < minVal) {
      return {
        valid: false,
        error: `Minimum order value of ₹${minVal.toFixed(0)} required for "${cleanCode}". (Cart: ₹${sub.toFixed(0)})`,
      };
    }

    if (coupon.usage_limit !== null && coupon.usage_limit !== undefined) {
      if (coupon.used_count >= coupon.usage_limit) {
        return { valid: false, error: `Coupon "${cleanCode}" has reached its maximum usage limit.` };
      }
    }

    // Check per-user limit
    const cleanEmail = String(email || "").trim().toLowerCase();
    const cleanPhone = String(phone || "").trim();
    if (cleanEmail || cleanPhone) {
      const pool = getPool();
      let query = "SELECT COUNT(*) as cnt FROM `coupon_usages` WHERE `coupon_id` = ? AND (";
      const params = [coupon.id];
      const conds = [];
      if (cleanEmail) {
        conds.push("`customer_email` = ?");
        params.push(cleanEmail);
      }
      if (cleanPhone) {
        conds.push("`customer_phone` = ?");
        params.push(cleanPhone);
      }
      query += conds.join(" OR ") + ")";

      const [usageRows] = await pool.query(query, params);
      const userUsed = Number(usageRows[0]?.cnt || 0);
      if (userUsed >= coupon.per_user_limit) {
        return {
          valid: false,
          error: `You have already used coupon "${cleanCode}" the maximum allowed times (${coupon.per_user_limit}).`,
        };
      }
    }

    // Calculate discount amount
    let discountAmount = 0;
    if (coupon.discount_type === "percentage") {
      discountAmount = Math.round((sub * Number(coupon.discount_value)) / 100);
      if (coupon.max_discount && discountAmount > Number(coupon.max_discount)) {
        discountAmount = Number(coupon.max_discount);
      }
    } else {
      discountAmount = Number(coupon.discount_value);
    }

    // Discount cannot exceed subtotal
    discountAmount = Math.min(discountAmount, sub);

    return {
      valid: true,
      coupon: {
        id: coupon.id,
        code: coupon.code,
        description: coupon.description,
        discountType: coupon.discount_type,
        discountValue: Number(coupon.discount_value),
        discountAmount,
        freeShipping: Boolean(coupon.free_shipping),
      },
    };
  },

  async recordUsage(connOrPool, couponId, orderId, { email = "", phone = "", discountAmount = 0 }) {
    if (!couponId) return;
    await connOrPool.query(
      "UPDATE `coupons` SET `used_count` = `used_count` + 1 WHERE `id` = ?",
      [couponId]
    );
    await connOrPool.query(
      "INSERT INTO `coupon_usages` (`coupon_id`, `order_id`, `customer_email`, `customer_phone`, `discount_amount`) VALUES (?, ?, ?, ?, ?)",
      [couponId, String(orderId), String(email).trim().toLowerCase(), String(phone).trim(), Number(discountAmount || 0)]
    );
  },

  async create(data) {
    const pool = getPool();
    const code = String(data.code || "").trim().toUpperCase();
    const [res] = await pool.query(
      `INSERT INTO \`coupons\` (\`code\`, \`description\`, \`discount_type\`, \`discount_value\`, \`min_order_value\`, \`max_discount\`, \`free_shipping\`, \`usage_limit\`, \`per_user_limit\`, \`expires_at\`, \`is_active\`)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        code,
        String(data.description || "").trim(),
        data.discountType === "flat" ? "flat" : "percentage",
        Number(data.discountValue || 0),
        Number(data.minOrderValue || 0),
        data.maxDiscount ? Number(data.maxDiscount) : null,
        data.freeShipping ? 1 : 0,
        data.usageLimit ? Number(data.usageLimit) : null,
        Number(data.perUserLimit || 1),
        data.expiresAt ? new Date(data.expiresAt) : null,
        data.isActive === false ? 0 : 1,
      ]
    );
    return res.insertId;
  },

  async update(id, data) {
    const pool = getPool();
    const existing = await pool.query("SELECT * FROM `coupons` WHERE `id` = ? LIMIT 1", [id]);
    const current = existing[0]?.[0] || {};

    const description = data.description !== undefined ? String(data.description || "").trim() : (current.description || "");
    const discountType = (data.discountType || data.discount_type || current.discount_type) === "flat" ? "flat" : "percentage";
    const discountValue = data.discountValue !== undefined ? Number(data.discountValue) : (data.discount_value !== undefined ? Number(data.discount_value) : Number(current.discount_value || 0));
    const minOrderValue = data.minOrderValue !== undefined ? Number(data.minOrderValue) : (data.min_order_value !== undefined ? Number(data.min_order_value) : Number(current.min_order_value || 0));
    const maxDiscount = data.maxDiscount !== undefined ? (data.maxDiscount ? Number(data.maxDiscount) : null) : (data.max_discount !== undefined ? (data.max_discount ? Number(data.max_discount) : null) : current.max_discount);
    const freeShipping = data.freeShipping !== undefined ? (data.freeShipping ? 1 : 0) : (data.free_shipping !== undefined ? (data.free_shipping ? 1 : 0) : (current.free_shipping ? 1 : 0));
    const usageLimit = data.usageLimit !== undefined ? (data.usageLimit ? Number(data.usageLimit) : null) : (data.usage_limit !== undefined ? (data.usage_limit ? Number(data.usage_limit) : null) : current.usage_limit);
    const perUserLimit = data.perUserLimit !== undefined ? Number(data.perUserLimit) : (data.per_user_limit !== undefined ? Number(data.per_user_limit) : Number(current.per_user_limit || 1));
    const expiresAt = data.expiresAt !== undefined ? (data.expiresAt ? new Date(data.expiresAt) : null) : (data.expires_at !== undefined ? (data.expires_at ? new Date(data.expires_at) : null) : current.expires_at);
    
    // Support boolean true/false, integer 1/0, or string
    let isActive = current.is_active ? 1 : 0;
    if (data.isActive !== undefined) {
      isActive = data.isActive === true || data.isActive === 1 || data.isActive === "1" ? 1 : 0;
    } else if (data.is_active !== undefined) {
      isActive = data.is_active === true || data.is_active === 1 || data.is_active === "1" ? 1 : 0;
    }

    await pool.query(
      `UPDATE \`coupons\` SET
        \`description\` = ?,
        \`discount_type\` = ?,
        \`discount_value\` = ?,
        \`min_order_value\` = ?,
        \`max_discount\` = ?,
        \`free_shipping\` = ?,
        \`usage_limit\` = ?,
        \`per_user_limit\` = ?,
        \`expires_at\` = ?,
        \`is_active\` = ?
       WHERE \`id\` = ?`,
      [
        description,
        discountType,
        discountValue,
        minOrderValue,
        maxDiscount,
        freeShipping,
        usageLimit,
        perUserLimit,
        expiresAt,
        isActive,
        id,
      ]
    );
  },

  async delete(id) {
    const pool = getPool();
    await pool.query("DELETE FROM `coupons` WHERE `id` = ?", [id]);
  },
};

module.exports = Coupon;


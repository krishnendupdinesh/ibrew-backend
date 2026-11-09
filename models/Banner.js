const { getPool } = require("../config/mysql");

class Banner {
  static async listActive(type = null) {
    const pool = getPool();
    const now = new Date();
    let query = `
      SELECT * FROM homepage_banners 
      WHERE is_active = 1 
        AND (start_date IS NULL OR start_date <= ?)
        AND (end_date IS NULL OR end_date >= ?)
    `;
    const params = [now, now];

    if (type) {
      query += ` AND type = ?`;
      params.push(type);
    }
    query += ` ORDER BY sort_order ASC, id ASC`;

    const [rows] = await pool.query(query, params);
    return rows;
  }

  static async listAll(type = null) {
    const pool = getPool();
    let query = `SELECT * FROM homepage_banners`;
    const params = [];
    if (type) {
      query += ` WHERE type = ?`;
      params.push(type);
    }
    query += ` ORDER BY type ASC, sort_order ASC, id ASC`;
    const [rows] = await pool.query(query, params);
    return rows;
  }

  static async findById(id) {
    const pool = getPool();
    const [rows] = await pool.query(`SELECT * FROM homepage_banners WHERE id = ?`, [id]);
    return rows[0] || null;
  }

  static async create(data) {
    const pool = getPool();
    const isActive = data.isActive !== undefined 
      ? (data.isActive === true || data.isActive === 1 || data.isActive === "1" ? 1 : 0)
      : (data.is_active ?? 1);

    const [res] = await pool.query(
      `INSERT INTO homepage_banners 
       (type, title, subtitle, image, link, cta_text, sort_order, is_active, start_date, end_date)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        data.type || data.bannerType || "hero_slide",
        data.title,
        data.subtitle || "",
        data.image || data.imageUrl || "",
        data.link || data.ctaLink || "/",
        data.cta_text || data.ctaText || "Shop Now",
        data.sort_order ?? data.sortOrder ?? data.displayOrder ?? 0,
        isActive,
        data.start_date || null,
        data.end_date || null,
      ]
    );
    return this.findById(res.insertId);
  }

  static async update(id, data) {
    const pool = getPool();
    const fields = [];
    const values = [];

    const fieldMap = {
      type: "type",
      bannerType: "type",
      title: "title",
      subtitle: "subtitle",
      image: "image",
      imageUrl: "image",
      link: "link",
      ctaLink: "link",
      cta_text: "cta_text",
      ctaText: "cta_text",
      sort_order: "sort_order",
      sortOrder: "sort_order",
      displayOrder: "sort_order",
      is_active: "is_active",
      isActive: "is_active",
      start_date: "start_date",
      end_date: "end_date",
    };

    const handledDbCols = new Set();
    for (const [key, col] of Object.entries(fieldMap)) {
      if (data[key] !== undefined && !handledDbCols.has(col)) {
        handledDbCols.add(col);
        fields.push(`\`${col}\` = ?`);
        if (col === "is_active") {
          values.push(data[key] === true || data[key] === 1 || data[key] === "1" ? 1 : 0);
        } else {
          values.push(data[key]);
        }
      }
    }

    if (fields.length === 0) return this.findById(id);

    values.push(id);
    await pool.query(`UPDATE homepage_banners SET ${fields.join(", ")} WHERE id = ?`, values);
    return this.findById(id);
  }

  static async delete(id) {
    const pool = getPool();
    await pool.query(`DELETE FROM homepage_banners WHERE id = ?`, [id]);
    return true;
  }
}

module.exports = Banner;

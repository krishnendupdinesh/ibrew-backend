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
    const [res] = await pool.query(
      `INSERT INTO homepage_banners 
       (type, title, subtitle, image, link, cta_text, sort_order, is_active, start_date, end_date)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        data.type || "hero_slide",
        data.title,
        data.subtitle || "",
        data.image || "",
        data.link || "/",
        data.cta_text || "Shop Now",
        data.sort_order ?? 0,
        data.is_active ?? 1,
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

    const allowed = [
      "type",
      "title",
      "subtitle",
      "image",
      "link",
      "cta_text",
      "sort_order",
      "is_active",
      "start_date",
      "end_date",
    ];

    allowed.forEach((col) => {
      if (data[col] !== undefined) {
        fields.push(`${col} = ?`);
        values.push(data[col]);
      }
    });

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

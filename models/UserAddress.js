const { getPool } = require("../config/mysql");

const UserAddress = {
  async findByUserId(userId) {
    const pool = getPool();
    const [rows] = await pool.query(
      "SELECT * FROM `user_addresses` WHERE `user_id` = ? ORDER BY `is_default` DESC, `updated_at` DESC",
      [Number(userId)]
    );
    return rows.map((r) => ({
      id: r.id,
      label: r.label,
      fullName: r.full_name,
      phone: r.phone,
      addressLine: r.address_line,
      city: r.city,
      state: r.state,
      pincode: r.pincode,
      isDefault: Boolean(r.is_default),
      createdAt: r.created_at,
    }));
  },

  async create(userId, data) {
    const pool = getPool();
    const isDefault = data.isDefault ? 1 : 0;

    // If setting as default, clear previous defaults
    if (isDefault) {
      await pool.query("UPDATE `user_addresses` SET `is_default` = 0 WHERE `user_id` = ?", [Number(userId)]);
    } else {
      // If this is the user's first address, make it default automatically
      const [countRows] = await pool.query("SELECT COUNT(*) as cnt FROM `user_addresses` WHERE `user_id` = ?", [Number(userId)]);
      if (Number(countRows[0]?.cnt || 0) === 0) {
        data.isDefault = true;
      }
    }

    const [res] = await pool.query(
      `INSERT INTO \`user_addresses\`
        (\`user_id\`, \`label\`, \`full_name\`, \`phone\`, \`address_line\`, \`city\`, \`state\`, \`pincode\`, \`is_default\`)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        Number(userId),
        String(data.label || "Home").trim().slice(0, 50),
        String(data.fullName || "").trim(),
        String(data.phone || "").trim(),
        String(data.addressLine || "").trim(),
        String(data.city || "").trim(),
        String(data.state || "Karnataka").trim(),
        String(data.pincode || "").trim(),
        data.isDefault ? 1 : 0,
      ]
    );

    return res.insertId;
  },

  async update(userId, addressId, data) {
    const pool = getPool();
    if (data.isDefault) {
      await pool.query("UPDATE `user_addresses` SET `is_default` = 0 WHERE `user_id` = ?", [Number(userId)]);
    }

    await pool.query(
      `UPDATE \`user_addresses\` SET
        \`label\` = ?,
        \`full_name\` = ?,
        \`phone\` = ?,
        \`address_line\` = ?,
        \`city\` = ?,
        \`state\` = ?,
        \`pincode\` = ?,
        \`is_default\` = ?
       WHERE \`id\` = ? AND \`user_id\` = ?`,
      [
        String(data.label || "Home").trim().slice(0, 50),
        String(data.fullName || "").trim(),
        String(data.phone || "").trim(),
        String(data.addressLine || "").trim(),
        String(data.city || "").trim(),
        String(data.state || "Karnataka").trim(),
        String(data.pincode || "").trim(),
        data.isDefault ? 1 : 0,
        Number(addressId),
        Number(userId),
      ]
    );
  },

  async delete(userId, addressId) {
    const pool = getPool();
    await pool.query("DELETE FROM `user_addresses` WHERE `id` = ? AND `user_id` = ?", [
      Number(addressId),
      Number(userId),
    ]);
  },

  async setDefault(userId, addressId) {
    const pool = getPool();
    await pool.query("UPDATE `user_addresses` SET `is_default` = 0 WHERE `user_id` = ?", [Number(userId)]);
    await pool.query("UPDATE `user_addresses` SET `is_default` = 1 WHERE `id` = ? AND `user_id` = ?", [
      Number(addressId),
      Number(userId),
    ]);
  },
};

module.exports = UserAddress;


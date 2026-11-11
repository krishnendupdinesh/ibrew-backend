// MySQL Model for `users` table using mysql2/promise
const { getPool } = require("../config/mysql");

function toIso(val) {
  if (!val) return new Date().toISOString();
  return val instanceof Date ? val.toISOString() : new Date(val).toISOString();
}

function attachUserJsonSerializer(obj) {
  if (!obj) return null;
  Object.defineProperty(obj, "toJSON", {
    enumerable: false,
    value: function () {
      return {
        id: String(this.id),
        name: this.name,
        email: this.email,
        phone: this.phone || "",
        role: this.role || "customer",
        mustResetPassword: Boolean(this.mustResetPassword),
        createdAt: this.createdAt,
        updatedAt: this.updatedAt,
      };
    },
  });
  return obj;
}

function formatUserRow(row) {
  if (!row) return null;
  const userObj = {
    id: String(row.id),
    _id: String(row.id),
    mongoId: row.mongo_id || null,
    name: row.name,
    email: row.email,
    phone: row.phone || "",
    password: row.password,
    role: row.role || "customer",
    mustResetPassword: Boolean(row.must_reset_password),
    createdAt: toIso(row.created_at),
    updatedAt: toIso(row.updated_at),
  };
  return attachUserJsonSerializer(userObj);
}

// Helper to support both `await User.findOne(...)` and `await User.findOne(...).lean()`
function withLeanSupport(promise) {
  promise.lean = () => promise;
  return promise;
}

const User = {
  findOne(filter = {}) {
    const promise = (async () => {
      const pool = getPool();
      if (filter.email) {
        const [rows] = await pool.execute(
          "SELECT * FROM `users` WHERE `email` = ? LIMIT 1",
          [String(filter.email).trim().toLowerCase()]
        );
        return rows.length > 0 ? formatUserRow(rows[0]) : null;
      }
      if (filter.id || filter._id) {
        return User.findById(filter.id || filter._id);
      }
      if (filter.role) {
        const [rows] = await pool.execute(
          "SELECT * FROM `users` WHERE `role` = ? LIMIT 1",
          [String(filter.role)]
        );
        return rows.length > 0 ? formatUserRow(rows[0]) : null;
      }
      return null;
    })();
    return withLeanSupport(promise);
  },

  async findById(id) {
    if (!id) return null;
    const raw = String(id).trim();
    const pool = getPool();
    const isNum = /^\d+$/.test(raw);
    const [rows] = await pool.execute(
      isNum
        ? "SELECT * FROM `users` WHERE `id` = ? OR `mongo_id` = ? LIMIT 1"
        : "SELECT * FROM `users` WHERE `mongo_id` = ? LIMIT 1",
      isNum ? [Number(raw), raw] : [raw]
    );
    return rows.length > 0 ? formatUserRow(rows[0]) : null;
  },

  async create(data) {
    const pool = getPool();
    const name = String(data.name || "").trim();
    const email = String(data.email || "").trim().toLowerCase();
    const phone = String(data.phone || "").trim();
    const password = String(data.password || "");
    const role = data.role === "admin" ? "admin" : "customer";
    const mustReset = data.mustResetPassword ? 1 : 0;
    const mongoId = data.mongoId ? String(data.mongoId) : null;

    const [result] = await pool.execute(
      `INSERT INTO \`users\` (\`mongo_id\`, \`name\`, \`email\`, \`phone\`, \`password\`, \`role\`, \`must_reset_password\`)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [mongoId, name, email, phone, password, role, mustReset]
    );

    return User.findById(result.insertId);
  },

  async findAllSorted() {
    const pool = getPool();
    const [rows] = await pool.execute(
      "SELECT * FROM `users` ORDER BY `created_at` DESC, `id` DESC"
    );
    return rows.map((r) => formatUserRow(r).toJSON());
  },

  async findOneAndUpdate(filter, update, options = {}) {
    const pool = getPool();
    const email = String(filter.email || "").trim().toLowerCase();
    if (!email) return null;

    const payload = update.$set ? update.$set : update;
    const existing = await User.findOne({ email });

    if (!existing) {
      if (!options.upsert) return null;
      return User.create({
        name: payload.name || "Admin",
        email,
        phone: payload.phone || "",
        password: payload.password || "",
        role: payload.role || "customer",
        mustResetPassword: Boolean(payload.mustResetPassword),
      });
    }

    const nextName = payload.name !== undefined ? String(payload.name).trim() : existing.name;
    const nextPhone = payload.phone !== undefined ? String(payload.phone).trim() : existing.phone;
    const nextPassword = payload.password !== undefined ? String(payload.password) : existing.password;
    const nextRole = payload.role !== undefined ? payload.role : existing.role;
    const nextMustReset =
      payload.mustResetPassword !== undefined
        ? payload.mustResetPassword
          ? 1
          : 0
        : existing.mustResetPassword
        ? 1
        : 0;

    await pool.execute(
      `UPDATE \`users\`
       SET \`name\` = ?, \`phone\` = ?, \`password\` = ?, \`role\` = ?, \`must_reset_password\` = ?
       WHERE \`id\` = ?`,
      [nextName, nextPhone, nextPassword, nextRole, nextMustReset, Number(existing.id)]
    );

    return User.findById(existing.id);
  },

  async findByIdAndUpdate(id, update) {
    const pool = getPool();
    const existing = await User.findById(id);
    if (!existing) return null;

    const payload = update.$set ? update.$set : update;
    const nextName = payload.name !== undefined ? String(payload.name).trim() : existing.name;
    const nextPhone = payload.phone !== undefined ? String(payload.phone).trim() : existing.phone;
    const nextPassword = payload.password !== undefined ? String(payload.password) : existing.password;
    const nextRole = payload.role !== undefined ? payload.role : existing.role;
    const nextMustReset =
      payload.mustResetPassword !== undefined
        ? payload.mustResetPassword
          ? 1
          : 0
        : existing.mustResetPassword
        ? 1
        : 0;

    await pool.execute(
      `UPDATE \`users\`
       SET \`name\` = ?, \`phone\` = ?, \`password\` = ?, \`role\` = ?, \`must_reset_password\` = ?
       WHERE \`id\` = ?`,
      [nextName, nextPhone, nextPassword, nextRole, nextMustReset, Number(id)]
    );

    return User.findById(id);
  },
};

module.exports = User;

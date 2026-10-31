// MySQL Model for `products` and `product_sizes` tables using mysql2/promise and transactions
const { getPool } = require("../config/mysql");
const { resolveAndSaveProductImage } = require("../utils/imageStorage");

function toIso(val) {
  if (!val) return new Date().toISOString();
  return val instanceof Date ? val.toISOString() : new Date(val).toISOString();
}

function serializeTags(tags) {
  if (!Array.isArray(tags)) return "";
  return Array.from(new Set(tags.map((t) => String(t).trim()).filter(Boolean)))
    .join("|")
    .slice(0, 500);
}

function parseTags(raw) {
  if (!raw) return [];
  const str = String(raw).trim();
  if (!str) return [];
  if (str.startsWith("[")) {
    try {
      const parsed = JSON.parse(str);
      if (Array.isArray(parsed)) return parsed.map(String);
    } catch {
      // fall through
    }
  }
  return str
    .split("|")
    .map((s) => s.trim())
    .filter(Boolean);
}

function makeSlug(name) {
  return (
    String(name || "product")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/(^-|-$)/g, "")
      .slice(0, 140) +
    "-" +
    Math.floor(1000 + Math.random() * 9000)
  );
}

function formatSizeRow(s) {
  const price = Number(s.price || 0);
  const mrp = s.mrp !== null && s.mrp !== undefined ? Number(s.mrp) : undefined;
  return {
    label: String(s.label || ""),
    price,
    ...(mrp !== undefined && mrp > price ? { mrp } : {}),
    stock: Math.max(0, Number(s.stock || 0)),
  };
}

function formatProductRow(row, sizeRows = []) {
  if (!row) return null;
  const formattedSizes = sizeRows.map(formatSizeRow);
  return {
    id: String(row.id),
    slug: row.slug || String(row.id),
    name: row.name,
    section: row.section,
    category: row.category,
    description: row.description || "",
    detail: row.detail || "",
    image: row.image || "",
    badge: row.badge || "",
    tags: parseTags(row.tags),
    isBestSeller: Boolean(row.is_best_seller),
    isMostSelling: Boolean(row.is_most_selling),
    featuredOnHome: Boolean(row.featured_on_home),
    rating: Number(row.rating ?? 4.6),
    reviewCount: Number(row.review_count ?? 24),
    sizes: formattedSizes,
    createdAt: toIso(row.created_at),
    updatedAt: toIso(row.updated_at),
  };
}

async function attachSizesToProducts(connOrPool, productRows) {
  if (!productRows || productRows.length === 0) return [];
  const productIds = productRows.map((r) => r.id);
  const placeholders = productIds.map(() => "?").join(", ");
  const [sizeRows] = await connOrPool.execute(
    `SELECT * FROM \`product_sizes\` WHERE \`product_id\` IN (${placeholders}) ORDER BY \`sort_order\` ASC, \`id\` ASC`,
    productIds
  );

  const sizesByProductId = new Map();
  for (const s of sizeRows) {
    const list = sizesByProductId.get(s.product_id) || [];
    list.push(s);
    sizesByProductId.set(s.product_id, list);
  }

  return productRows.map((r) => formatProductRow(r, sizesByProductId.get(r.id) || []));
}

async function resolveProductRow(connOrPool, idOrSlug) {
  const raw = String(idOrSlug || "").trim();
  if (!raw) return null;
  const isNum = /^\d+$/.test(raw);
  const [rows] = await connOrPool.execute(
    isNum
      ? "SELECT * FROM `products` WHERE `id` = ? OR `slug` = ? OR `mongo_id` = ? LIMIT 1"
      : "SELECT * FROM `products` WHERE `slug` = ? OR `mongo_id` = ? LIMIT 1",
    isNum ? [Number(raw), raw, raw] : [raw, raw]
  );
  return rows.length > 0 ? rows[0] : null;
}

const Product = {
  async countDocuments() {
    const pool = getPool();
    const [rows] = await pool.execute("SELECT COUNT(*) AS cnt FROM `products`");
    return Number(rows[0]?.cnt || 0);
  },

  async findAllSlugs() {
    const pool = getPool();
    const [rows] = await pool.execute("SELECT `slug` FROM `products`");
    return rows.map((r) => r.slug).filter(Boolean);
  },

  async find(filter = {}, sortMode = "default") {
    const pool = getPool();
    const whereClauses = [];
    const params = [];

    if (filter.section) {
      whereClauses.push("`section` = ?");
      params.push(String(filter.section));
    }
    if (filter.isBestSeller !== undefined) {
      whereClauses.push("`is_best_seller` = ?");
      params.push(filter.isBestSeller ? 1 : 0);
    }
    if (filter.isMostSelling !== undefined) {
      whereClauses.push("`is_most_selling` = ?");
      params.push(filter.isMostSelling ? 1 : 0);
    }

    const whereSql = whereClauses.length > 0 ? `WHERE ${whereClauses.join(" AND ")}` : "";
    const orderSql =
      sortMode === "admin"
        ? "ORDER BY `created_at` DESC, `id` DESC"
        : "ORDER BY `is_most_selling` DESC, `is_best_seller` DESC, `created_at` DESC, `id` DESC";

    const [rows] = await pool.execute(`SELECT * FROM \`products\` ${whereSql} ${orderSql}`, params);
    return attachSizesToProducts(pool, rows);
  },

  async findById(idOrSlug) {
    const pool = getPool();
    const row = await resolveProductRow(pool, idOrSlug);
    if (!row) return null;
    const [products] = await attachSizesToProducts(pool, [row]);
    return products || null;
  },

  async create(data) {
    const pool = getPool();
    const conn = await pool.getConnection();
    try {
      await conn.beginTransaction();

      const slug = String(data.slug || makeSlug(data.name)).trim();
      const imagePath = resolveAndSaveProductImage(data.image, slug);
      const tagsStr = serializeTags(data.tags);
      const mongoId = data.mongoId ? String(data.mongoId) : null;

      const [res] = await conn.execute(
        `INSERT INTO \`products\`
         (\`mongo_id\`, \`slug\`, \`name\`, \`section\`, \`category\`, \`description\`, \`detail\`, \`image\`, \`badge\`, \`tags\`, \`is_best_seller\`, \`is_most_selling\`, \`featured_on_home\`, \`rating\`, \`review_count\`)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          mongoId,
          slug,
          String(data.name || "").trim(),
          String(data.section || "coffee"),
          String(data.category || "").trim(),
          String(data.description || "").trim(),
          String(data.detail || "").trim().slice(0, 500),
          imagePath,
          String(data.badge || "").trim().slice(0, 100),
          tagsStr,
          data.isBestSeller ? 1 : 0,
          data.isMostSelling ? 1 : 0,
          data.featuredOnHome === false ? 0 : 1,
          Number(data.rating ?? 4.6),
          Math.max(0, Math.floor(Number(data.reviewCount ?? 24))),
        ]
      );

      const productId = res.insertId;
      const sizes = Array.isArray(data.sizes) ? data.sizes : [];

      for (let i = 0; i < sizes.length; i++) {
        const s = sizes[i];
        const price = Number(s.price || 0);
        const mrp =
          s.mrp !== undefined && s.mrp !== null && s.mrp !== "" && Number(s.mrp) > price
            ? Number(s.mrp)
            : null;
        const stock = Math.max(0, Math.floor(Number(s.stock ?? 0)));

        await conn.execute(
          `INSERT INTO \`product_sizes\` (\`product_id\`, \`label\`, \`price\`, \`mrp\`, \`stock\`, \`sort_order\`)
           VALUES (?, ?, ?, ?, ?, ?)`,
          [productId, String(s.label || "").trim(), price, mrp, stock, i]
        );
      }

      await conn.commit();
      return Product.findById(productId);
    } catch (err) {
      await conn.rollback();
      throw err;
    } finally {
      conn.release();
    }
  },

  async insertMany(productsList) {
    if (!Array.isArray(productsList) || productsList.length === 0) return [];
    const created = [];
    for (const item of productsList) {
      try {
        const p = await Product.create(item);
        if (p) created.push(p);
      } catch (err) {
        // Ignore duplicate slug during seed
        if (err.code !== "ER_DUP_ENTRY") {
          throw err;
        }
      }
    }
    return created;
  },

  async findByIdAndUpdate(idOrSlug, data) {
    const pool = getPool();
    const conn = await pool.getConnection();
    try {
      await conn.beginTransaction();

      const existingRow = await resolveProductRow(conn, idOrSlug);
      if (!existingRow) {
        await conn.rollback();
        return null;
      }

      const productId = existingRow.id;
      const imagePath =
        data.image !== undefined
          ? resolveAndSaveProductImage(data.image, existingRow.slug || data.name)
          : existingRow.image;

      const tagsStr =
        data.tags !== undefined ? serializeTags(data.tags) : existingRow.tags;

      await conn.execute(
        `UPDATE \`products\`
         SET \`name\` = ?, \`section\` = ?, \`category\` = ?, \`description\` = ?, \`detail\` = ?,
             \`image\` = ?, \`badge\` = ?, \`tags\` = ?, \`is_best_seller\` = ?, \`is_most_selling\` = ?,
             \`featured_on_home\` = ?, \`rating\` = ?, \`review_count\` = ?
         WHERE \`id\` = ?`,
        [
          String(data.name ?? existingRow.name).trim(),
          String(data.section ?? existingRow.section),
          String(data.category ?? existingRow.category).trim(),
          String(data.description ?? existingRow.description).trim(),
          String(data.detail ?? existingRow.detail).trim().slice(0, 500),
          imagePath,
          String(data.badge ?? existingRow.badge).trim().slice(0, 100),
          tagsStr,
          data.isBestSeller !== undefined ? (data.isBestSeller ? 1 : 0) : existingRow.is_best_seller,
          data.isMostSelling !== undefined ? (data.isMostSelling ? 1 : 0) : existingRow.is_most_selling,
          data.featuredOnHome !== undefined ? (data.featuredOnHome ? 1 : 0) : existingRow.featured_on_home,
          Number(data.rating ?? existingRow.rating),
          Math.max(0, Math.floor(Number(data.reviewCount ?? existingRow.review_count))),
          productId,
        ]
      );

      if (Array.isArray(data.sizes) && data.sizes.length > 0) {
        await conn.execute("DELETE FROM `product_sizes` WHERE `product_id` = ?", [productId]);
        for (let i = 0; i < data.sizes.length; i++) {
          const s = data.sizes[i];
          const price = Number(s.price || 0);
          const mrp =
            s.mrp !== undefined && s.mrp !== null && s.mrp !== "" && Number(s.mrp) > price
              ? Number(s.mrp)
              : null;
          const stock = Math.max(0, Math.floor(Number(s.stock ?? 0)));

          await conn.execute(
            `INSERT INTO \`product_sizes\` (\`product_id\`, \`label\`, \`price\`, \`mrp\`, \`stock\`, \`sort_order\`)
             VALUES (?, ?, ?, ?, ?, ?)`,
            [productId, String(s.label || "").trim(), price, mrp, stock, i]
          );
        }
      }

      await conn.commit();
      return Product.findById(productId);
    } catch (err) {
      await conn.rollback();
      throw err;
    } finally {
      conn.release();
    }
  },

  async findByIdAndDelete(idOrSlug) {
    const pool = getPool();
    const existingRow = await resolveProductRow(pool, idOrSlug);
    if (!existingRow) return null;
    await pool.execute("DELETE FROM `products` WHERE `id` = ?", [existingRow.id]);
    return existingRow;
  },
};

module.exports = Product;

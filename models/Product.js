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

function parseImages(raw, fallback) {
  if (Array.isArray(raw)) return raw;
  if (!raw) return fallback ? [fallback] : [];
  try {
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed) && parsed.length > 0) return parsed;
  } catch { }
  if (typeof raw === "string" && raw.includes(",")) {
    return raw.split(",").map((s) => s.trim()).filter(Boolean);
  }
  return fallback ? [fallback] : [];
}

function parseSpecifications(raw) {
  if (!raw) return {};
  if (typeof raw === "object") return raw;
  try {
    return JSON.parse(raw);
  } catch {
    return {};
  }
}

function formatProductRow(row, sizeRows = []) {
  if (!row) return null;
  const formattedSizes = sizeRows.map(formatSizeRow);
  const images = parseImages(row.images, row.image);
  const specifications = parseSpecifications(row.specifications);

  return {
    id: String(row.id),
    slug: row.slug || String(row.id),
    name: row.name,
    section: row.section,
    category: row.category,
    description: row.description || "",
    detail: row.detail || "",
    image: row.image || (images[0] || ""),
    images: images.length > 0 ? images : (row.image ? [row.image] : []),
    badge: row.badge || "",
    tags: parseTags(row.tags),
    isBestSeller: Boolean(row.is_best_seller),
    isMostSelling: Boolean(row.is_most_selling),
    featuredOnHome: Boolean(row.featured_on_home),
    rating: Number(row.rating ?? 4.6),
    reviewCount: Number(row.review_count ?? 24),
    ingredients: row.ingredients || "",
    origin: row.origin || "",
    roastLevel: row.roast_level || "",
    brewingGuide: row.brewing_guide || "",
    specifications,
    lowStockThreshold: Number(row.low_stock_threshold ?? 5),
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
    const [rows] = await pool.execute("SELECT COUNT(*) AS cnt FROM `products` WHERE `is_active` = 1 AND `deleted_at` IS NULL");
    return Number(rows[0]?.cnt || 0);
  },

  async findAllSlugs() {
    const pool = getPool();
    const [rows] = await pool.execute("SELECT `slug` FROM `products` WHERE `is_active` = 1 AND `deleted_at` IS NULL");
    return rows.map((r) => r.slug).filter(Boolean);
  },

  async find(filter = {}, sortMode = "default") {
    const pool = getPool();
    const whereClauses = [];
    const params = [];

    // Filter out deleted/inactive products unless explicitly requested by admin
    if (sortMode !== "admin_all") {
      whereClauses.push("`is_active` = 1 AND `deleted_at` IS NULL");
    }

    if (filter.section) {
      whereClauses.push("`section` = ?");
      params.push(String(filter.section));
    }
    if (filter.category) {
      whereClauses.push("`category` = ?");
      params.push(String(filter.category));
    }
    if (filter.q) {
      const qStr = `%${String(filter.q).trim()}%`;
      whereClauses.push("(`name` LIKE ? OR `description` LIKE ? OR `category` LIKE ? OR `tags` LIKE ? OR `badge` LIKE ?)");
      params.push(qStr, qStr, qStr, qStr, qStr);
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
      sortMode === "admin" || sortMode === "admin_all"
        ? "ORDER BY `created_at` DESC, `id` DESC"
        : "ORDER BY `is_most_selling` DESC, `is_best_seller` DESC, `created_at` DESC, `id` DESC";

    const [rows] = await pool.execute(`SELECT * FROM \`products\` ${whereSql} ${orderSql}`, params);
    return attachSizesToProducts(pool, rows);
  },

  async findById(idOrSlug) {
    const pool = getPool();
    const row = await resolveProductRow(pool, idOrSlug);
    if (!row) return null;
    if (row.is_active === 0 || row.deleted_at !== null) return null;
    const [products] = await attachSizesToProducts(pool, [row]);
    return products || null;
  },

  async create(data) {
    const pool = getPool();
    const conn = await pool.getConnection();
    try {
      await conn.beginTransaction();

      const slug = String(data.slug || makeSlug(data.name)).trim();
      const imagePath = await Promise.resolve(resolveAndSaveProductImage(data.image, slug));
      const tagsStr = serializeTags(data.tags);
      const mongoId = data.mongoId ? String(data.mongoId) : null;

      const imagesJson = data.images ? JSON.stringify(data.images) : null;
      const specsJson = data.specifications ? JSON.stringify(data.specifications) : null;

      const [res] = await conn.execute(
        `INSERT INTO \`products\`
         (\`mongo_id\`, \`slug\`, \`name\`, \`section\`, \`category\`, \`description\`, \`detail\`, \`image\`, \`badge\`, \`tags\`, \`is_best_seller\`, \`is_most_selling\`, \`featured_on_home\`, \`rating\`, \`review_count\`, \`images\`, \`ingredients\`, \`origin\`, \`roast_level\`, \`brewing_guide\`, \`specifications\`, \`low_stock_threshold\`)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
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
          imagesJson,
          data.ingredients ? String(data.ingredients) : null,
          data.origin ? String(data.origin) : "", // NOT NULL column
          data.roastLevel ? String(data.roastLevel) : "", // NOT NULL column
          data.brewingGuide ? String(data.brewingGuide) : null,
          specsJson,
          Number(data.lowStockThreshold ?? 5),
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
          ? await Promise.resolve(resolveAndSaveProductImage(data.image, existingRow.slug || data.name))
          : existingRow.image;

      const tagsStr =
        data.tags !== undefined ? serializeTags(data.tags) : existingRow.tags;

      const imagesJson =
        data.images !== undefined ? JSON.stringify(data.images) : existingRow.images;
      const specsJson =
        data.specifications !== undefined ? JSON.stringify(data.specifications) : existingRow.specifications;

      await conn.execute(
        `UPDATE \`products\`
         SET \`name\` = ?, \`section\` = ?, \`category\` = ?, \`description\` = ?, \`detail\` = ?,
             \`image\` = ?, \`badge\` = ?, \`tags\` = ?, \`is_best_seller\` = ?, \`is_most_selling\` = ?,
             \`featured_on_home\` = ?, \`rating\` = ?, \`review_count\` = ?,
             \`images\` = ?, \`ingredients\` = ?, \`origin\` = ?, \`roast_level\` = ?, \`brewing_guide\` = ?,
             \`specifications\` = ?, \`low_stock_threshold\` = ?
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
          imagesJson,
          data.ingredients !== undefined ? String(data.ingredients) : existingRow.ingredients,
          data.origin !== undefined ? String(data.origin) : existingRow.origin,
          data.roastLevel !== undefined ? String(data.roastLevel) : existingRow.roast_level,
          data.brewingGuide !== undefined ? String(data.brewingGuide) : existingRow.brewing_guide,
          specsJson,
          data.lowStockThreshold !== undefined ? Number(data.lowStockThreshold) : existingRow.low_stock_threshold,
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

    const productId = existingRow.id;

    // Check if product is referenced in order_items
    const [orderRefs] = await pool.execute(
      "SELECT COUNT(*) AS cnt FROM `order_items` WHERE `product_id` = ? OR `product_key` = ? OR `product_key` = ?",
      [productId, String(productId), existingRow.slug]
    );
    const hasOrders = Number(orderRefs[0]?.cnt || 0) > 0;

    const conn = await pool.getConnection();
    try {
      await conn.beginTransaction();

      // Clean up dependent child rows: product_sizes, product_reviews, product_recommendations
      await conn.execute("DELETE FROM `product_sizes` WHERE `product_id` = ?", [productId]);
      await conn.execute("DELETE FROM `product_reviews` WHERE `product_id` = ?", [productId]);
      await conn.execute(
        "DELETE FROM `product_recommendations` WHERE `product_id` = ? OR `recommended_product_id` = ?",
        [productId, productId]
      );

      if (hasOrders) {
        // Safe soft-delete: preserve historical order items and analytics
        await conn.execute(
          "UPDATE `products` SET `is_active` = 0, `deleted_at` = NOW() WHERE `id` = ?",
          [productId]
        );
      } else {
        // Hard-delete: remove from products table completely
        await conn.execute("DELETE FROM `products` WHERE `id` = ?", [productId]);
      }

      await conn.commit();
      return { ...existingRow, softDeleted: hasOrders };
    } catch (err) {
      await conn.rollback();
      throw err;
    } finally {
      conn.release();
    }
  },

  async getRecommendations(idOrSlug) {
    const pool = getPool();
    const target = await resolveProductRow(pool, idOrSlug);
    if (!target) return [];

    // 1. Look in product_recommendations table
    const [recs] = await pool.query(
      `SELECT pr.bundle_discount_percent, pr.sort_order, p.*
       FROM product_recommendations pr
       JOIN products p ON pr.recommended_product_id = p.id
       WHERE pr.product_id = ?
       ORDER BY pr.sort_order ASC, pr.id ASC`,
      [target.id]
    );

    if (recs.length > 0) {
      return attachSizesToProducts(pool, recs);
    }

    // 2. Fallback: Complementary logic
    // If coffee, recommend spices or coffee-skin; otherwise recommend coffee
    const altSection = target.section === "coffee" ? "spices" : "coffee";
    const [fallback] = await pool.query(
      `SELECT * FROM products 
       WHERE id != ? AND (section = ? OR is_most_selling = 1) 
       ORDER BY is_most_selling DESC, is_best_seller DESC, rating DESC 
       LIMIT 3`,
      [target.id, altSection]
    );

    return attachSizesToProducts(pool, fallback);
  },

  async getLowStockProducts(customThreshold = null) {
    const pool = getPool();
    const thresholdVal = customThreshold !== null ? Number(customThreshold) : null;

    let query = `
      SELECT p.id, p.name, p.slug, p.section, p.category, p.image, p.low_stock_threshold,
             ps.id AS size_id, ps.label AS size_label, ps.price, ps.stock
      FROM product_sizes ps
      JOIN products p ON ps.product_id = p.id
    `;

    const params = [];
    if (thresholdVal !== null) {
      query += ` WHERE ps.stock <= ? ORDER BY ps.stock ASC, p.name ASC`;
      params.push(thresholdVal);
    } else {
      query += ` WHERE ps.stock <= COALESCE(p.low_stock_threshold, 5) ORDER BY ps.stock ASC, p.name ASC`;
    }

    const [rows] = await pool.query(query, params);
    return rows;
  },
};

module.exports = Product;

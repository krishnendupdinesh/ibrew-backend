const { getPool } = require("../config/mysql");
const { resolveAndSaveProductImage } = require("../utils/imageStorage");

const DEFAULT_BULK_PRODUCTS = [
  // Coffee Powder
  {
    slug: "arabica-coffee",
    name: "Arabica Filter Coffee Powder",
    category: "Coffee Powder",
    description:
      "Medium-roast ground arabica with a smooth, rounded body. Suited to cafes, hotels and gifting.",
    unit: "kg",
    moq: 10,
    step: 5,
    image:
      "https://images.unsplash.com/photo-1559056199-641a0ac8b55e?w=600&auto=format&fit=crop&q=60",
    sort_order: 1,
  },
  {
    slug: "instant-coffee",
    name: "Instant Coffee Powder",
    category: "Coffee Powder",
    description:
      "Spray-dried instant coffee that dissolves quickly in hot or cold milk and water.",
    unit: "kg",
    moq: 5,
    step: 5,
    image:
      "https://images.unsplash.com/photo-1514432324607-a09d9b4aefdd?w=600&auto=format&fit=crop&q=60",
    sort_order: 2,
  },
  {
    slug: "chicory-coffee",
    name: "Coffee and Chicory Blend",
    category: "Coffee Powder",
    description: "Classic South Indian style blend with a strong, bitter-sweet cup.",
    unit: "kg",
    moq: 10,
    step: 5,
    image:
      "https://images.unsplash.com/photo-1495474472287-4d71bcdd2085?w=600&auto=format&fit=crop&q=60",
    sort_order: 3,
  },

  // Coffee Skin Care
  {
    slug: "coffee-face-scrub",
    name: "Coffee Face Scrub",
    category: "Coffee Skin Care",
    description:
      "Gentle exfoliating scrub made with fine coffee grounds. Available for retail and private label.",
    unit: "pcs",
    moq: 24,
    step: 12,
    image:
      "https://images.unsplash.com/photo-1608248597359-0e6d526a6c18?w=600&auto=format&fit=crop&q=60",
    sort_order: 4,
  },
  {
    slug: "coffee-body-scrub",
    name: "Coffee Body Scrub",
    category: "Coffee Skin Care",
    description: "Coarser body scrub that smooths skin and leaves a light coffee aroma.",
    unit: "pcs",
    moq: 24,
    step: 12,
    image:
      "https://images.unsplash.com/photo-1556228720-195a672e8a03?w=600&auto=format&fit=crop&q=60",
    sort_order: 5,
  },
  {
    slug: "coffee-eye-cream",
    name: "Coffee Under-Eye Cream",
    category: "Coffee Skin Care",
    description: "Lightweight cream with caffeine for the delicate skin under the eyes.",
    unit: "pcs",
    moq: 24,
    step: 12,
    image:
      "https://images.unsplash.com/photo-1620916566398-39f1143ab7be?w=600&auto=format&fit=crop&q=60",
    sort_order: 6,
  },

  // Fragrances
  {
    slug: "oud-attar",
    name: "Oud Attar (Alcohol-Free)",
    category: "Fragrances",
    description: "Long-lasting oil-based perfume in a roll-on bottle. Woody, warm and deep.",
    unit: "pcs",
    moq: 24,
    step: 12,
    image:
      "https://images.unsplash.com/photo-1592945403244-b3fbafd7f539?w=600&auto=format&fit=crop&q=60",
    sort_order: 7,
  },
  {
    slug: "eau-de-parfum",
    name: "Imported Eau de Parfum",
    category: "Fragrances",
    description: "Boxed spray perfumes in assorted men's and women's scents.",
    unit: "pcs",
    moq: 24,
    step: 12,
    image:
      "https://images.unsplash.com/photo-1541643600914-78b084683601?w=600&auto=format&fit=crop&q=60",
    sort_order: 8,
  },
  {
    slug: "bakhoor",
    name: "Bakhoor and Incense",
    category: "Fragrances",
    description: "Scented wood chips and incense tablets for home and gifting.",
    unit: "boxes",
    moq: 24,
    step: 12,
    image:
      "https://images.unsplash.com/photo-1602928321679-560bb453f190?w=600&auto=format&fit=crop&q=60",
    sort_order: 9,
  },

  // Imported Mattresses
  {
    slug: "queen-mattress",
    name: "Queen Size Mattress",
    category: "Imported Mattresses",
    description:
      "Imported multi-layer luxury mattress engineered for restful sleep and spine alignment.",
    unit: "pcs",
    moq: 2,
    step: 1,
    image:
      "https://images.unsplash.com/photo-1505693416388-ac5ce068fe85?w=600&auto=format&fit=crop&q=60",
    sort_order: 10,
  },
  {
    slug: "king-mattress",
    name: "King Size Mattress",
    category: "Imported Mattresses",
    description: "Wide king premium mattress for hotels, resorts and luxury bedrooms.",
    unit: "pcs",
    moq: 2,
    step: 1,
    image:
      "https://images.unsplash.com/photo-1631049307264-da0ec9d70304?w=600&auto=format&fit=crop&q=60",
    sort_order: 11,
  },
  {
    slug: "ortho-mattress",
    name: "Orthopedic Mattress",
    category: "Imported Mattresses",
    description: "Firm posture-support orthopedic mattress with breathable imported fabric.",
    unit: "pcs",
    moq: 2,
    step: 1,
    image:
      "https://images.unsplash.com/photo-1540518614846-7ede433c4576?w=600&auto=format&fit=crop&q=60",
    sort_order: 12,
  },

  // Dates
  {
    slug: "medjool-dates",
    name: "Medjool Dates",
    category: "Dates",
    description: "Large, soft and caramel-like dates. Packed in 5 kg boxes.",
    unit: "kg",
    moq: 10,
    step: 5,
    image:
      "https://images.unsplash.com/photo-1596040033229-a9821ebd058d?w=600&auto=format&fit=crop&q=60",
    sort_order: 13,
  },
  {
    slug: "ajwa-dates",
    name: "Ajwa Dates",
    category: "Dates",
    description: "Dark, soft dates from Madinah. A popular choice for gifting and Ramadan.",
    unit: "kg",
    moq: 5,
    step: 5,
    image:
      "https://images.unsplash.com/photo-1590080875515-8a3a8dc5735e?w=600&auto=format&fit=crop&q=60",
    sort_order: 14,
  },
  {
    slug: "sukkari-dates",
    name: "Sukkari Dates",
    category: "Dates",
    description: "Golden, crisp-soft dates with a naturally sweet, honey-like taste.",
    unit: "kg",
    moq: 10,
    step: 5,
    image:
      "https://images.unsplash.com/photo-1582284540020-8acbe03f4924?w=600&auto=format&fit=crop&q=60",
    sort_order: 15,
  },

  // Groceries
  {
    slug: "basmati-rice",
    name: "Basmati Rice",
    category: "Groceries",
    description: "Aged long-grain basmati that cooks fluffy and separate. 25 kg bags.",
    unit: "kg",
    moq: 100,
    step: 25,
    image:
      "https://images.unsplash.com/photo-1586201375761-83865001e31c?w=600&auto=format&fit=crop&q=60",
    sort_order: 16,
  },
  {
    slug: "toor-dal",
    name: "Toor Dal",
    category: "Groceries",
    description: "Polished split pigeon peas, cleaned and graded. 25 kg bags.",
    unit: "kg",
    moq: 100,
    step: 25,
    image:
      "https://images.unsplash.com/photo-1515543904379-3d757afe72e4?w=600&auto=format&fit=crop&q=60",
    sort_order: 17,
  },
  {
    slug: "sugar",
    name: "Refined Sugar",
    category: "Groceries",
    description: "Fine white sugar for bakeries, caterers and retail repacking.",
    unit: "kg",
    moq: 100,
    step: 50,
    image:
      "https://images.unsplash.com/photo-1581441363689-1f3c3c414635?w=600&auto=format&fit=crop&q=60",
    sort_order: 18,
  },
  {
    slug: "tea-leaves",
    name: "CTC Tea Leaves",
    category: "Groceries",
    description: "Strong, bright-liquor Assam CTC tea for chai stalls and hotels.",
    unit: "kg",
    moq: 20,
    step: 10,
    image:
      "https://images.unsplash.com/photo-1564890369478-c89ca6d9cde9?w=600&auto=format&fit=crop&q=60",
    sort_order: 19,
  },

  // Spices
  {
    slug: "turmeric-powder",
    name: "Turmeric Powder",
    category: "Spices",
    description: "Bright golden haldi with high curcumin content.",
    unit: "kg",
    moq: 10,
    step: 5,
    image:
      "https://images.unsplash.com/photo-1615485500704-8e990f9900f7?w=600&auto=format&fit=crop&q=60",
    sort_order: 20,
  },
  {
    slug: "black-pepper",
    name: "Black Pepper Whole",
    category: "Spices",
    description: "Bold, pungent peppercorns from the Malabar coast.",
    unit: "kg",
    moq: 5,
    step: 5,
    image:
      "https://images.unsplash.com/photo-1599909533681-74dc7d5c2b93?w=600&auto=format&fit=crop&q=60",
    sort_order: 21,
  },
  {
    slug: "cardamom",
    name: "Green Cardamom",
    category: "Spices",
    description: "Plump, aromatic pods sorted by size. Ideal for sweets, tea and masala blends.",
    unit: "kg",
    moq: 5,
    step: 5,
    image:
      "https://images.unsplash.com/photo-1596040033229-a9821ebd058d?w=600&auto=format&fit=crop&q=60",
    sort_order: 22,
  },
];

let tableVerified = false;

async function ensureBulkProductsTableAndSeed() {
  const pool = getPool();
  if (!tableVerified) {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS \`bulk_products\` (
        \`id\` INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
        \`slug\` VARCHAR(191) NOT NULL UNIQUE,
        \`name\` VARCHAR(255) NOT NULL,
        \`category\` VARCHAR(191) NOT NULL DEFAULT 'Coffee Powder',
        \`description\` TEXT NOT NULL,
        \`unit\` VARCHAR(64) NOT NULL DEFAULT 'kg',
        \`moq\` INT UNSIGNED NOT NULL DEFAULT 10,
        \`step\` INT UNSIGNED NOT NULL DEFAULT 5,
        \`image\` VARCHAR(500) NOT NULL DEFAULT '',
        \`sort_order\` INT UNSIGNED NOT NULL DEFAULT 0,
        \`is_active\` TINYINT(1) NOT NULL DEFAULT 1,
        \`created_at\` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        \`updated_at\` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        INDEX \`idx_bulk_products_category\` (\`category\`, \`is_active\`, \`sort_order\`)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `);
    tableVerified = true;
  }

  const [countRows] = await pool.query("SELECT COUNT(*) AS c FROM `bulk_products`");
  if (countRows[0].c === 0) {
    for (const item of DEFAULT_BULK_PRODUCTS) {
      await pool.query(
        `INSERT IGNORE INTO \`bulk_products\`
         (\`slug\`, \`name\`, \`category\`, \`description\`, \`unit\`, \`moq\`, \`step\`, \`image\`, \`sort_order\`, \`is_active\`)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 1)`,
        [
          item.slug,
          item.name,
          item.category,
          item.description,
          item.unit,
          item.moq,
          item.step,
          item.image,
          item.sort_order,
        ]
      );
    }
  }
}

function formatBulkRow(row) {
  if (!row) return null;
  return {
    id: row.slug || String(row.id),
    dbId: row.id,
    slug: row.slug,
    name: row.name,
    category: row.category || "Coffee Powder",
    description: row.description || "",
    unit: row.unit || "kg",
    moq: Number(row.moq || 1),
    step: Number(row.step || 1),
    image: row.image || "",
    sortOrder: Number(row.sort_order || 0),
    isActive: Boolean(row.is_active),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

class BulkProduct {
  static async listActive() {
    await ensureBulkProductsTableAndSeed();
    const pool = getPool();
    const [rows] = await pool.query(
      "SELECT * FROM `bulk_products` WHERE `is_active` = 1 ORDER BY `sort_order` ASC, `id` ASC"
    );
    return rows.map(formatBulkRow);
  }

  static async listAll() {
    await ensureBulkProductsTableAndSeed();
    const pool = getPool();
    const [rows] = await pool.query(
      "SELECT * FROM `bulk_products` ORDER BY `sort_order` ASC, `id` ASC"
    );
    return rows.map(formatBulkRow);
  }

  static async findByIdOrSlug(identifier) {
    await ensureBulkProductsTableAndSeed();
    const pool = getPool();
    const raw = String(identifier || "").trim();
    const isNum = /^\d+$/.test(raw);
    const [rows] = await pool.query(
      isNum
        ? "SELECT * FROM `bulk_products` WHERE `id` = ? OR `slug` = ? LIMIT 1"
        : "SELECT * FROM `bulk_products` WHERE `slug` = ? LIMIT 1",
      isNum ? [Number(raw), raw] : [raw]
    );
    return formatBulkRow(rows[0]);
  }

  static async create(data) {
    await ensureBulkProductsTableAndSeed();
    const pool = getPool();
    const name = String(data.name || "").trim();
    const baseSlug =
      String(data.slug || name)
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/(^-|-$)/g, "") || `bulk-${Date.now()}`;

    // Ensure unique slug
    let slug = baseSlug;
    const [existing] = await pool.query("SELECT id FROM `bulk_products` WHERE `slug` = ?", [slug]);
    if (existing.length > 0) {
      slug = `${baseSlug}-${Math.floor(100 + Math.random() * 900)}`;
    }

    const cleanImage = await Promise.resolve(
      resolveAndSaveProductImage(data.image || data.imageUrl || "", slug)
    );
    const isActive =
      data.isActive !== undefined
        ? data.isActive === true || data.isActive === 1 || data.isActive === "1"
          ? 1
          : 0
        : 1;

    const [res] = await pool.query(
      `INSERT INTO \`bulk_products\`
       (\`slug\`, \`name\`, \`category\`, \`description\`, \`unit\`, \`moq\`, \`step\`, \`image\`, \`sort_order\`, \`is_active\`)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        slug,
        name,
        String(data.category || "Coffee Powder").trim(),
        String(data.description || "").trim(),
        String(data.unit || "kg").trim(),
        Math.max(1, Number(data.moq || 10)),
        Math.max(1, Number(data.step || 5)),
        cleanImage,
        Number(data.sortOrder ?? data.sort_order ?? 0),
        isActive,
      ]
    );
    return this.findByIdOrSlug(res.insertId);
  }

  static async update(identifier, data) {
    const existing = await this.findByIdOrSlug(identifier);
    if (!existing) return null;

    const pool = getPool();
    const nextName = data.name !== undefined ? String(data.name).trim() : existing.name;
    const nextCategory =
      data.category !== undefined ? String(data.category).trim() : existing.category;
    const nextDesc =
      data.description !== undefined ? String(data.description).trim() : existing.description;
    const nextUnit = data.unit !== undefined ? String(data.unit).trim() : existing.unit;
    const nextMoq =
      data.moq !== undefined ? Math.max(1, Number(data.moq || 1)) : existing.moq;
    const nextStep =
      data.step !== undefined ? Math.max(1, Number(data.step || 1)) : existing.step;

    let nextImage = existing.image;
    const rawImg = data.image !== undefined ? data.image : data.imageUrl;
    if (rawImg !== undefined) {
      nextImage = await Promise.resolve(resolveAndSaveProductImage(rawImg, existing.slug));
    }

    const nextSortOrder =
      data.sortOrder !== undefined
        ? Number(data.sortOrder)
        : data.sort_order !== undefined
        ? Number(data.sort_order)
        : existing.sortOrder;

    const nextActive =
      data.isActive !== undefined
        ? data.isActive === true || data.isActive === 1 || data.isActive === "1"
          ? 1
          : 0
        : data.is_active !== undefined
        ? data.is_active
          ? 1
          : 0
        : existing.isActive
        ? 1
        : 0;

    await pool.query(
      `UPDATE \`bulk_products\`
       SET \`name\` = ?, \`category\` = ?, \`description\` = ?, \`unit\` = ?,
           \`moq\` = ?, \`step\` = ?, \`image\` = ?, \`sort_order\` = ?, \`is_active\` = ?
       WHERE \`id\` = ?`,
      [
        nextName,
        nextCategory,
        nextDesc,
        nextUnit,
        nextMoq,
        nextStep,
        nextImage,
        nextSortOrder,
        nextActive,
        existing.dbId,
      ]
    );

    return this.findByIdOrSlug(existing.dbId);
  }

  static async delete(identifier) {
    const existing = await this.findByIdOrSlug(identifier);
    if (!existing) return false;
    const pool = getPool();
    await pool.query("DELETE FROM `bulk_products` WHERE `id` = ?", [existing.dbId]);
    return true;
  }
}

module.exports = BulkProduct;


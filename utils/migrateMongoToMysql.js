// Stage 3: Safe, Idempotent, Transactional MongoDB -> MySQL Data Migration & Verification
// Never modifies or deletes MongoDB collections, never logs passwords/hashes,
// creates a pre-migration MySQL backup, preserves existing MySQL product IDs,
// converts base64 product images to physical files in uploads/products/,
// and verifies all counts, FKs, HTTP images, and auth post-migration.

const path = require("path");
const fs = require("fs");
require("dotenv").config({ path: path.join(__dirname, "..", ".env") });

const bcrypt = require("bcryptjs");
const app = require("../server");
const { initMySQL, getPool, UPLOADS_PRODUCTS_DIR } = require("../config/mysql");
const { resolveAndSaveProductImage } = require("./imageStorage");

const BACKUP_DIR = path.join(__dirname, "..", "backups");
const MONGO_BACKUP_PATH = path.join(BACKUP_DIR, "mongodb-full-backup.json");
const MYSQL_PRE_BACKUP_PATH = path.join(BACKUP_DIR, "mysql-pre-migration-backup.json");

function toMysqlDate(val) {
  if (!val) return null;
  const d = val instanceof Date ? val : new Date(val);
  return Number.isNaN(d.getTime()) ? new Date() : d;
}

function serializeTags(tags) {
  if (!Array.isArray(tags)) return "";
  return Array.from(new Set(tags.map((t) => String(t).trim()).filter(Boolean)))
    .join("|")
    .slice(0, 500);
}

async function getTableCounts(pool) {
  const tables = [
    "users",
    "products",
    "product_sizes",
    "orders",
    "order_items",
    "quotes",
    "quote_items",
  ];
  const counts = {};
  for (const t of tables) {
    const [rows] = await pool.query(`SELECT COUNT(*) AS cnt FROM \`${t}\``);
    counts[t] = Number(rows[0].cnt);
  }
  return counts;
}

async function backupMysqlDatabase(pool) {
  if (!fs.existsSync(BACKUP_DIR)) {
    fs.mkdirSync(BACKUP_DIR, { recursive: true });
  }
  const tables = [
    "users",
    "products",
    "product_sizes",
    "orders",
    "order_items",
    "quotes",
    "quote_items",
  ];
  const dump = {
    backedUpAt: new Date().toISOString(),
    database: process.env.MYSQL_DATABASE || "imaans_db",
    tables: {},
  };
  for (const t of tables) {
    const [rows] = await pool.query(`SELECT * FROM \`${t}\``);
    dump.tables[t] = rows;
  }
  fs.writeFileSync(MYSQL_PRE_BACKUP_PATH, JSON.stringify(dump, null, 2), "utf8");
  return MYSQL_PRE_BACKUP_PATH;
}

async function runStage3Migration() {
  const summary = {
    backups: {},
    preMigrationCounts: {},
    users: { imported: 0, linked: 0, skipped: 0, failed: 0 },
    products: {
      imported: 0,
      linkedAndPreservedId: 0,
      skipped: 0,
      failed: 0,
      sizesTotalInMysql: 0,
      metadataOrPriceStockChanges: [],
      convertedBase64Images: [],
    },
    quotes: { imported: 0, linked: 0, skipped: 0, failed: 0, itemsImported: 0 },
    orders: { imported: 0, linked: 0, skipped: 0, failed: 0, itemsImported: 0 },
    postMigrationCounts: {},
    verifications: {},
  };

  // 1. Verify existing MongoDB JSON backup is readable and complete
  if (!fs.existsSync(MONGO_BACKUP_PATH)) {
    throw new Error(`MongoDB backup file not found at ${MONGO_BACKUP_PATH}`);
  }
  const mongoBackup = JSON.parse(fs.readFileSync(MONGO_BACKUP_PATH, "utf8"));
  if (
    !mongoBackup.collections ||
    !Array.isArray(mongoBackup.collections.users) ||
    !Array.isArray(mongoBackup.collections.products) ||
    !Array.isArray(mongoBackup.collections.orders) ||
    !Array.isArray(mongoBackup.collections.quotes)
  ) {
    throw new Error("MongoDB backup JSON is incomplete or malformed.");
  }
  summary.backups.mongoBackupVerified = MONGO_BACKUP_PATH;

  // Read preserved MongoDB collections directly from backups/mongodb-full-backup.json
  const mongoUsers = mongoBackup.collections.users;
  const mongoProducts = mongoBackup.collections.products;
  const mongoOrders = mongoBackup.collections.orders;
  const mongoQuotes = mongoBackup.collections.quotes;

  // 2. Connect to MySQL and create pre-migration MySQL backup (if not already created)
  await initMySQL();
  const pool = getPool();
  if (!fs.existsSync(MYSQL_PRE_BACKUP_PATH)) {
    const mysqlBackupPath = await backupMysqlDatabase(pool);
    summary.backups.mysqlPreMigrationBackup = mysqlBackupPath;
  } else {
    summary.backups.mysqlPreMigrationBackup = MYSQL_PRE_BACKUP_PATH;
  }

  summary.preMigrationCounts = {
    mongo: {
      users: mongoUsers.length,
      products: mongoProducts.length,
      product_sizes: mongoProducts.reduce(
        (s, p) => s + (Array.isArray(p.sizes) ? p.sizes.length : 0),
        0
      ),
      orders: mongoOrders.length,
      order_items: mongoOrders.reduce(
        (s, o) => s + (Array.isArray(o.items) ? o.items.length : 0),
        0
      ),
      quotes: mongoQuotes.length,
      quote_items: mongoQuotes.reduce(
        (s, q) => s + (Array.isArray(q.items) ? q.items.length : 0),
        0
      ),
    },
    mysql: await getTableCounts(pool),
  };

  // =========================================================================
  // STEP A: MIGRATE USERS (Preserving password hashes, roles, timestamps)
  // =========================================================================
  {
    const conn = await pool.getConnection();
    try {
      await conn.beginTransaction();

      for (const u of mongoUsers) {
        const mongoId = String(u._id);
        const email = String(u.email || "").trim().toLowerCase();
        const name = String(u.name || "User").trim();
        const phone = String(u.phone || "").trim();
        const passwordHash = String(u.password || "");
        const role = u.role === "admin" ? "admin" : "customer";
        const mustReset = u.mustResetPassword ? 1 : 0;
        const createdAt = toMysqlDate(u.createdAt) || new Date();
        const updatedAt = toMysqlDate(u.updatedAt) || createdAt;

        const [existing] = await conn.execute(
          "SELECT `id`, `mongo_id`, `email` FROM `users` WHERE `mongo_id` = ? OR `email` = ? LIMIT 1 FOR UPDATE",
          [mongoId, email]
        );

        if (existing.length > 0) {
          const row = existing[0];
          if (row.mongo_id === mongoId) {
            summary.users.skipped++;
          } else {
            await conn.execute(
              "UPDATE `users` SET `mongo_id` = ?, `name` = ?, `phone` = ?, `password` = ?, `role` = ?, `must_reset_password` = ?, `created_at` = ?, `updated_at` = ? WHERE `id` = ?",
              [mongoId, name, phone, passwordHash, role, mustReset, createdAt, updatedAt, row.id]
            );
            summary.users.linked++;
          }
        } else {
          await conn.execute(
            `INSERT INTO \`users\`
             (\`mongo_id\`, \`name\`, \`email\`, \`phone\`, \`password\`, \`role\`, \`must_reset_password\`, \`created_at\`, \`updated_at\`)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [mongoId, name, email, phone, passwordHash, role, mustReset, createdAt, updatedAt]
          );
          summary.users.imported++;
        }
      }

      await conn.commit();
    } catch (err) {
      await conn.rollback();
      summary.users.failed++;
      throw err;
    } finally {
      conn.release();
    }
  }

  // =========================================================================
  // STEP B: MIGRATE PRODUCTS & PRODUCT_SIZES (Link 39 by slug, insert 3 new)
  // =========================================================================
  {
    const conn = await pool.getConnection();
    try {
      await conn.beginTransaction();

      for (const p of mongoProducts) {
        const mongoId = String(p._id);
        const slug = String(p.slug || "").trim();
        const name = String(p.name || "").trim();
        const section = String(p.section || "coffee").trim();
        const category = String(p.category || "").trim();
        const description = String(p.description || "").trim();
        const detail = String(p.detail || "").trim().slice(0, 500);
        const rawImage = String(p.image || "").trim();
        const wasBase64 = rawImage.startsWith("data:image/");

        const [existingRows] = await conn.execute(
          "SELECT * FROM `products` WHERE `mongo_id` = ? OR `slug` = ? LIMIT 1 FOR UPDATE",
          [mongoId, slug]
        );

        if (existingRows.length > 0) {
          const existing = existingRows[0];
          const productId = existing.id; // Preserve existing MySQL ID!

          const existingLocalImgValid =
            existing.image &&
            existing.image.startsWith("/api/uploads/products/") &&
            fs.existsSync(path.join(UPLOADS_PRODUCTS_DIR, path.basename(existing.image)));

          if (existing.mongo_id === mongoId && (!wasBase64 || existingLocalImgValid)) {
            summary.products.skipped++;
            continue;
          }

          // Convert base64 images to physical files in ibrew-backend/uploads/products/
          const imagePath = resolveAndSaveProductImage(rawImage, slug || name);
          if (wasBase64) {
            summary.products.convertedBase64Images.push({
              mongoId,
              slug,
              name,
              imagePath,
              filePath: path.join(UPLOADS_PRODUCTS_DIR, path.basename(imagePath)),
            });
          }

          const badge = String(p.badge || "").trim().slice(0, 100);
          const tagsStr = serializeTags(p.tags);
          const isBestSeller = p.isBestSeller ? 1 : 0;
          const isMostSelling = p.isMostSelling ? 1 : 0;
          const featuredOnHome = p.featuredOnHome === false ? 0 : 1;
          const rating = Number(p.rating ?? 4.6);
          const reviewCount = Math.max(0, Math.floor(Number(p.reviewCount ?? 24)));
          const createdAt = toMysqlDate(p.createdAt) || new Date();
          const updatedAt = toMysqlDate(p.updatedAt) || createdAt;
          const mongoSizes = Array.isArray(p.sizes) ? p.sizes : [];

          // Check and report any differences between existing MySQL row and MongoDB row
          const [existingSizeRows] = await conn.execute(
            "SELECT * FROM `product_sizes` WHERE `product_id` = ? ORDER BY `sort_order` ASC, `id` ASC FOR UPDATE",
            [productId]
          );

          const diffs = [];
          if (existing.name !== name) diffs.push(`name: "${existing.name}" -> "${name}"`);
          if (existing.badge !== badge) diffs.push(`badge: "${existing.badge}" -> "${badge}"`);
          if (Number(existing.is_best_seller) !== isBestSeller) {
            diffs.push(`isBestSeller: ${Boolean(existing.is_best_seller)} -> ${Boolean(isBestSeller)}`);
          }
          if (Number(existing.is_most_selling) !== isMostSelling) {
            diffs.push(`isMostSelling: ${Boolean(existing.is_most_selling)} -> ${Boolean(isMostSelling)}`);
          }
          if (wasBase64) {
            diffs.push(`image: converted base64 -> "${imagePath}"`);
          } else if (existing.image !== imagePath) {
            diffs.push(`image: "${existing.image}" -> "${imagePath}"`);
          }

          // Compare sizes (price, mrp, stock)
          if (existingSizeRows.length !== mongoSizes.length) {
            diffs.push(`sizes count: ${existingSizeRows.length} -> ${mongoSizes.length}`);
          } else {
            for (let i = 0; i < mongoSizes.length; i++) {
              const ms = mongoSizes[i];
              const es = existingSizeRows[i];
              const mPrice = Number(ms.price || 0);
              const mMrp = ms.mrp !== undefined && ms.mrp !== null && Number(ms.mrp) > mPrice ? Number(ms.mrp) : null;
              const mStock = Math.max(0, Math.floor(Number(ms.stock ?? 0)));
              const ePrice = Number(es.price || 0);
              const eMrp = es.mrp !== null && es.mrp !== undefined ? Number(es.mrp) : null;
              const eStock = Number(es.stock || 0);

              if (es.label !== ms.label || ePrice !== mPrice || eMrp !== mMrp || eStock !== mStock) {
                diffs.push(
                  `size[${ms.label}]: price ${ePrice}->${mPrice}, mrp ${eMrp}->${mMrp}, stock ${eStock}->${mStock}`
                );
              }
            }
          }

          if (diffs.length > 0) {
            summary.products.metadataOrPriceStockChanges.push({
              mysqlId: productId,
              slug,
              name,
              changes: diffs,
            });
          }

          // Link mongo_id and sync product metadata while preserving MySQL ID
          await conn.execute(
            `UPDATE \`products\`
             SET \`mongo_id\` = ?, \`name\` = ?, \`section\` = ?, \`category\` = ?, \`description\` = ?,
                 \`detail\` = ?, \`image\` = ?, \`badge\` = ?, \`tags\` = ?, \`is_best_seller\` = ?,
                 \`is_most_selling\` = ?, \`featured_on_home\` = ?, \`rating\` = ?, \`review_count\` = ?,
                 \`created_at\` = ?, \`updated_at\` = ?
             WHERE \`id\` = ?`,
            [
              mongoId,
              name,
              section,
              category,
              description,
              detail,
              imagePath,
              badge,
              tagsStr,
              isBestSeller,
              isMostSelling,
              featuredOnHome,
              rating,
              reviewCount,
              createdAt,
              updatedAt,
              productId,
            ]
          );

          // Sync existing product_sizes in place (or insert if count changed)
          if (existingSizeRows.length === mongoSizes.length) {
            for (let i = 0; i < mongoSizes.length; i++) {
              const s = mongoSizes[i];
              const price = Number(s.price || 0);
              const mrp =
                s.mrp !== undefined && s.mrp !== null && s.mrp !== "" && Number(s.mrp) > price
                  ? Number(s.mrp)
                  : null;
              const stock = Math.max(0, Math.floor(Number(s.stock ?? 0)));
              await conn.execute(
                `UPDATE \`product_sizes\`
                 SET \`label\` = ?, \`price\` = ?, \`mrp\` = ?, \`stock\` = ?, \`sort_order\` = ?
                 WHERE \`id\` = ?`,
                [String(s.label || "").trim(), price, mrp, stock, i, existingSizeRows[i].id]
              );
            }
          } else {
            await conn.execute("DELETE FROM `product_sizes` WHERE `product_id` = ?", [productId]);
            for (let i = 0; i < mongoSizes.length; i++) {
              const s = mongoSizes[i];
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

          summary.products.linkedAndPreservedId++;
        } else {
          const imagePath = resolveAndSaveProductImage(rawImage, slug || name);
          if (wasBase64) {
            summary.products.convertedBase64Images.push({
              mongoId,
              slug,
              name,
              imagePath,
              filePath: path.join(UPLOADS_PRODUCTS_DIR, path.basename(imagePath)),
            });
          }

          const badge = String(p.badge || "").trim().slice(0, 100);
          const tagsStr = serializeTags(p.tags);
          const isBestSeller = p.isBestSeller ? 1 : 0;
          const isMostSelling = p.isMostSelling ? 1 : 0;
          const featuredOnHome = p.featuredOnHome === false ? 0 : 1;
          const rating = Number(p.rating ?? 4.6);
          const reviewCount = Math.max(0, Math.floor(Number(p.reviewCount ?? 24)));
          const createdAt = toMysqlDate(p.createdAt) || new Date();
          const updatedAt = toMysqlDate(p.updatedAt) || createdAt;
          const mongoSizes = Array.isArray(p.sizes) ? p.sizes : [];

          // Insert new admin-created product
          const [res] = await conn.execute(
            `INSERT INTO \`products\`
             (\`mongo_id\`, \`slug\`, \`name\`, \`section\`, \`category\`, \`description\`, \`detail\`, \`image\`, \`badge\`, \`tags\`, \`is_best_seller\`, \`is_most_selling\`, \`featured_on_home\`, \`rating\`, \`review_count\`, \`created_at\`, \`updated_at\`)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [
              mongoId,
              slug,
              name,
              section,
              category,
              description,
              detail,
              imagePath,
              badge,
              tagsStr,
              isBestSeller,
              isMostSelling,
              featuredOnHome,
              rating,
              reviewCount,
              createdAt,
              updatedAt,
            ]
          );
          const newProductId = res.insertId;

          for (let i = 0; i < mongoSizes.length; i++) {
            const s = mongoSizes[i];
            const price = Number(s.price || 0);
            const mrp =
              s.mrp !== undefined && s.mrp !== null && s.mrp !== "" && Number(s.mrp) > price
                ? Number(s.mrp)
                : null;
            const stock = Math.max(0, Math.floor(Number(s.stock ?? 0)));
            await conn.execute(
              `INSERT INTO \`product_sizes\` (\`product_id\`, \`label\`, \`price\`, \`mrp\`, \`stock\`, \`sort_order\`)
               VALUES (?, ?, ?, ?, ?, ?)`,
              [newProductId, String(s.label || "").trim(), price, mrp, stock, i]
            );
          }

          summary.products.imported++;
        }
      }

      await conn.commit();
    } catch (err) {
      await conn.rollback();
      summary.products.failed++;
      throw err;
    } finally {
      conn.release();
    }
  }

  // =========================================================================
  // STEP C: MIGRATE QUOTES & QUOTE_ITEMS (Resolving user FK via mongo_id)
  // =========================================================================
  {
    const conn = await pool.getConnection();
    try {
      await conn.beginTransaction();

      for (const q of mongoQuotes) {
        const mongoId = String(q._id);
        const reference = String(q.reference || "").trim();
        const status = ["new", "contacted", "quoted", "closed"].includes(q.status)
          ? q.status
          : "new";

        const [existing] = await conn.execute(
          "SELECT `id`, `mongo_id` FROM `quotes` WHERE `mongo_id` = ? OR `reference` = ? LIMIT 1 FOR UPDATE",
          [mongoId, reference]
        );

        if (existing.length > 0) {
          summary.quotes.skipped++;
          continue;
        }

        let resolvedUserId = null;
        if (q.user) {
          const [uRows] = await conn.execute(
            "SELECT `id` FROM `users` WHERE `mongo_id` = ? LIMIT 1",
            [String(q.user)]
          );
          if (uRows.length > 0) resolvedUserId = uRows[0].id;
        }

        const c = q.contact || {};
        const createdAt = toMysqlDate(q.createdAt) || new Date();
        const updatedAt = toMysqlDate(q.updatedAt) || createdAt;

        const [res] = await conn.execute(
          `INSERT INTO \`quotes\`
           (\`mongo_id\`, \`reference\`, \`status\`, \`user_id\`, \`contact_name\`, \`contact_company\`, \`contact_email\`, \`contact_phone\`, \`contact_city\`, \`contact_timeline\`, \`contact_notes\`, \`created_at\`, \`updated_at\`)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [
            mongoId,
            reference,
            status,
            resolvedUserId,
            String(c.name || "").trim(),
            String(c.company || "").trim(),
            String(c.email || "").trim(),
            String(c.phone || "").trim(),
            String(c.city || "").trim(),
            String(c.timeline || "").trim(),
            String(c.notes || "").trim(),
            createdAt,
            updatedAt,
          ]
        );

        const quoteDbId = res.insertId;
        const items = Array.isArray(q.items) ? q.items : [];
        for (const item of items) {
          await conn.execute(
            `INSERT INTO \`quote_items\` (\`quote_id\`, \`item_code\`, \`name\`, \`category\`, \`quantity\`, \`unit\`)
             VALUES (?, ?, ?, ?, ?, ?)`,
            [
              quoteDbId,
              String(item.id || "").trim(),
              String(item.name || "").trim(),
              String(item.category || "").trim(),
              Math.max(1, Math.floor(Number(item.quantity || 1))),
              String(item.unit || "").trim(),
            ]
          );
          summary.quotes.itemsImported++;
        }

        summary.quotes.imported++;
      }

      await conn.commit();
    } catch (err) {
      await conn.rollback();
      summary.quotes.failed++;
      throw err;
    } finally {
      conn.release();
    }
  }

  // =========================================================================
  // STEP D: MIGRATE HISTORICAL ORDERS & ORDER_ITEMS (skipStockDeduction)
  // =========================================================================
  {
    const conn = await pool.getConnection();
    try {
      await conn.beginTransaction();

      for (const o of mongoOrders) {
        const mongoId = String(o._id);
        const orderId = String(o.orderId || "").trim();

        const [existing] = await conn.execute(
          "SELECT `id`, `mongo_id` FROM `orders` WHERE `mongo_id` = ? OR `order_id` = ? LIMIT 1 FOR UPDATE",
          [mongoId, orderId]
        );

        if (existing.length > 0) {
          summary.orders.skipped++;
          continue;
        }

        const cust = o.customer || {};
        const createdAt = toMysqlDate(o.createdAt) || new Date();
        const updatedAt = toMysqlDate(o.updatedAt) || createdAt;
        const confirmedAt = toMysqlDate(o.confirmedAt);
        const shippedAt = toMysqlDate(o.shippedAt);
        const deliveredAt = toMysqlDate(o.deliveredAt);

        const [orderRes] = await conn.execute(
          `INSERT INTO \`orders\`
           (\`mongo_id\`, \`order_id\`, \`customer_name\`, \`customer_email\`, \`customer_phone\`, \`customer_address\`, \`customer_city\`, \`customer_state\`, \`customer_pincode\`, \`customer_notes\`,
            \`subtotal\`, \`shipping\`, \`savings\`, \`total\`, \`payment_method\`, \`payment_status\`, \`status\`, \`tracking_number\`, \`courier_name\`, \`admin_notes\`, \`confirmed_at\`, \`shipped_at\`, \`delivered_at\`, \`created_at\`, \`updated_at\`)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [
            mongoId,
            orderId,
            String(cust.name || "").trim(),
            String(cust.email || "").trim(),
            String(cust.phone || "").trim(),
            String(cust.address || "").trim(),
            String(cust.city || "").trim(),
            String(cust.state || "Karnataka").trim(),
            String(cust.pincode || "").trim(),
            String(cust.notes || "").trim(),
            Number(o.subtotal || 0),
            Number(o.shipping || 0),
            Number(o.savings || 0),
            Number(o.total || 0),
            ["cod", "upi", "card"].includes(o.paymentMethod) ? o.paymentMethod : "cod",
            ["unpaid", "paid", "refunded"].includes(o.paymentStatus) ? o.paymentStatus : "unpaid",
            o.status || "pending",
            String(o.trackingNumber || "").trim(),
            String(o.courierName || "").trim(),
            String(o.adminNotes || "").trim(),
            confirmedAt,
            shippedAt,
            deliveredAt,
            createdAt,
            updatedAt,
          ]
        );

        const orderDbId = orderRes.insertId;
        const items = Array.isArray(o.items) ? o.items : [];

        // NOTE: skipStockDeduction = true for historical orders (stock is NOT deducted again)
        for (const item of items) {
          const productKey = String(item.productId || item.id || "item").trim();
          const [pRows] = await conn.execute(
            "SELECT `id` FROM `products` WHERE `mongo_id` = ? OR `slug` = ? LIMIT 1",
            [productKey, productKey]
          );
          const resolvedProductId = pRows.length > 0 ? pRows[0].id : null;
          const cleanImage = resolveAndSaveProductImage(item.image, productKey);
          const mrp =
            item.mrp !== undefined && item.mrp !== null && item.mrp !== ""
              ? Number(item.mrp)
              : null;

          await conn.execute(
            `INSERT INTO \`order_items\`
             (\`order_ref_id\`, \`product_id\`, \`product_key\`, \`name\`, \`size\`, \`price\`, \`mrp\`, \`quantity\`, \`image\`, \`category\`)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [
              orderDbId,
              resolvedProductId,
              productKey,
              String(item.name || "Product").trim(),
              String(item.size || "").trim(),
              Number(item.price || 0),
              mrp,
              Math.max(1, Math.floor(Number(item.quantity || 1))),
              cleanImage,
              String(item.category || "").trim(),
            ]
          );
          summary.orders.itemsImported++;
        }

        summary.orders.imported++;
      }

      await conn.commit();
    } catch (err) {
      await conn.rollback();
      summary.orders.failed++;
      throw err;
    } finally {
      conn.release();
    }
  }

  // =========================================================================
  // STEP E: POST-MIGRATION VERIFICATIONS
  // =========================================================================
  summary.postMigrationCounts = await getTableCounts(pool);
  summary.products.sizesTotalInMysql = summary.postMigrationCounts.product_sizes;

  // 1. Verify Foreign Keys
  const [[fkOrderItems]] = await pool.query(
    `SELECT o.order_id, oi.product_id, oi.product_key, p.slug AS resolved_slug, p.name AS resolved_product_name
     FROM \`order_items\` oi
     JOIN \`orders\` o ON o.id = oi.order_ref_id
     LEFT JOIN \`products\` p ON p.id = oi.product_id`
  );
  const [[fkQuotes]] = await pool.query(
    `SELECT q.reference, q.user_id, u.email AS resolved_user_email
     FROM \`quotes\` q
     LEFT JOIN \`users\` u ON u.id = q.user_id`
  );
  const [[base64InMysqlCheck]] = await pool.query(
    "SELECT COUNT(*) AS cnt FROM `products` WHERE `image` LIKE 'data:%'"
  );

  summary.verifications.foreignKeys = {
    orderItemResolution: fkOrderItems,
    quoteUserResolution: fkQuotes,
    remainingBase64InMysql: Number(base64InMysqlCheck.cnt),
  };

  // 2. Verify HTTP image serving, customer password hash verification, and order/quote details
  const server = await new Promise((resolve) => {
    const s = app.listen(0, "127.0.0.1", () => resolve(s));
  });
  const baseUrl = `http://127.0.0.1:${server.address().port}`;

  try {
    // Check converted base64 images on disk and via HTTP
    const imageChecks = [];
    const [uploadedProducts] = await pool.query(
      "SELECT id, mongo_id, slug, name, image FROM `products` WHERE `image` LIKE '/api/uploads/products/%'"
    );
    for (const up of uploadedProducts) {
      const diskFile = path.join(UPLOADS_PRODUCTS_DIR, path.basename(up.image));
      const existsOnDisk = fs.existsSync(diskFile);
      const httpRes = await fetch(`${baseUrl}${up.image}`);
      imageChecks.push({
        mysqlId: up.id,
        slug: up.slug,
        name: up.name,
        imageUrl: up.image,
        existsOnDisk,
        httpStatus: httpRes.status,
      });
    }
    summary.verifications.convertedImagesVerification = imageChecks;

    // Verify customer password hashes in MySQL match MongoDB hashes (without logging hashes)
    const [mysqlUserRows] = await pool.query("SELECT id, mongo_id, email, password, role FROM `users`");
    const hashChecks = [];
    for (const mu of mysqlUserRows) {
      const orig = mongoUsers.find((u) => String(u._id) === mu.mongo_id);
      hashChecks.push({
        email: mu.email,
        role: mu.role,
        mongoIdPreserved: Boolean(mu.mongo_id),
        bcryptHashIdenticalToMongo: Boolean(orig && orig.password === mu.password),
        validBcryptFormat: String(mu.password).startsWith("$2"),
      });
    }
    summary.verifications.userPasswordPreservation = hashChecks;

    // Test admin login and verify historical order & quote details through API
    const adminLoginRes = await fetch(`${baseUrl}/api/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        email: process.env.ADMIN_USERNAME || "admin",
        password: process.env.ADMIN_PASSWORD || "Admin@12345",
      }),
    });
    const adminCookie = (adminLoginRes.headers.get("set-cookie") || "").split(";")[0];

    const ordersApiRes = await fetch(`${baseUrl}/api/admin/orders`, {
      headers: { Cookie: adminCookie },
    });
    const ordersApiData = await ordersApiRes.json();

    const quotesApiRes = await fetch(`${baseUrl}/api/admin/quotes`, {
      headers: { Cookie: adminCookie },
    });
    const quotesApiData = await quotesApiRes.json();

    summary.verifications.apiContractCheck = {
      adminLoginStatus: adminLoginRes.status,
      migratedOrderFromApi: ordersApiData.orders?.[0] || null,
      migratedQuoteFromApi: quotesApiData.quotes?.[0] || null,
    };
  } finally {
    server.close();
  }

  console.log(JSON.stringify(summary, null, 2));

  await pool.end();
}

runStage3Migration().catch((err) => {
  console.error("Stage 3 migration error:", err);
  process.exit(1);
});


// Migration script: idempotent addition of new e-commerce tables and columns
const { getPool } = require("./mysql");

async function runEnhancementsMigration() {
  const pool = getPool();
  console.log("Starting e-commerce enhancements database migration...");

  // 1. Helper to safely add column if not exists
  async function ensureColumn(table, column, definition) {
    try {
      const [rows] = await pool.query(
        `SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND COLUMN_NAME = ?`,
        [table, column]
      );
      if (rows.length === 0) {
        await pool.query(`ALTER TABLE \`${table}\` ADD COLUMN \`${column}\` ${definition}`);
        console.log(`+ Added column ${table}.${column}`);
      } else {
        console.log(`= Column ${table}.${column} already exists`);
      }
    } catch (err) {
      console.warn(`! Could not add ${table}.${column}:`, err.message);
    }
  }

  // 2. Add product details columns
  await ensureColumn("products", "images", "TEXT NULL");
  await ensureColumn("products", "ingredients", "TEXT NULL");
  await ensureColumn("products", "origin", "VARCHAR(191) NOT NULL DEFAULT ''");
  await ensureColumn("products", "roast_level", "VARCHAR(100) NOT NULL DEFAULT ''");
  await ensureColumn("products", "brewing_guide", "TEXT NULL");
  await ensureColumn("products", "specifications", "JSON NULL");
  await ensureColumn("products", "low_stock_threshold", "INT UNSIGNED NOT NULL DEFAULT 5");

  // 3. Add order payment & coupon columns
  await ensureColumn("orders", "coupon_code", "VARCHAR(50) NOT NULL DEFAULT ''");
  await ensureColumn("orders", "coupon_discount", "DECIMAL(12,2) NOT NULL DEFAULT 0.00");
  await ensureColumn("orders", "razorpay_order_id", "VARCHAR(100) NOT NULL DEFAULT ''");
  await ensureColumn("orders", "razorpay_payment_id", "VARCHAR(100) NOT NULL DEFAULT ''");
  await ensureColumn("orders", "razorpay_signature", "VARCHAR(255) NOT NULL DEFAULT ''");
  await ensureColumn("orders", "invoice_number", "VARCHAR(64) NOT NULL DEFAULT ''");

  // 3b. Allow "razorpay" as a payment method (order code accepts it; old enum did not)
  try {
    const [pmRows] = await pool.query(
      `SELECT COLUMN_TYPE FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'orders' AND COLUMN_NAME = 'payment_method'`
    );
    if (pmRows.length > 0 && !String(pmRows[0].COLUMN_TYPE).includes("'razorpay'")) {
      await pool.query(
        "ALTER TABLE `orders` MODIFY COLUMN `payment_method` ENUM('cod', 'upi', 'card', 'razorpay') NOT NULL DEFAULT 'cod'"
      );
      console.log("+ Extended orders.payment_method enum with 'razorpay'");
    }
  } catch (err) {
    console.warn("! Could not extend orders.payment_method enum:", err.message);
  }

  // 4. Create new tables
  const NEW_TABLES = [
    // Coupons
    `CREATE TABLE IF NOT EXISTS \`coupons\` (
      \`id\` INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
      \`code\` VARCHAR(50) NOT NULL UNIQUE,
      \`description\` VARCHAR(255) NOT NULL DEFAULT '',
      \`discount_type\` ENUM('percentage', 'flat') NOT NULL DEFAULT 'percentage',
      \`discount_value\` DECIMAL(10,2) NOT NULL DEFAULT 0.00,
      \`min_order_value\` DECIMAL(10,2) NOT NULL DEFAULT 0.00,
      \`max_discount\` DECIMAL(10,2) NULL DEFAULT NULL,
      \`free_shipping\` TINYINT(1) NOT NULL DEFAULT 0,
      \`usage_limit\` INT UNSIGNED NULL DEFAULT NULL,
      \`used_count\` INT UNSIGNED NOT NULL DEFAULT 0,
      \`per_user_limit\` INT UNSIGNED NOT NULL DEFAULT 1,
      \`expires_at\` DATETIME NULL DEFAULT NULL,
      \`is_active\` TINYINT(1) NOT NULL DEFAULT 1,
      \`created_at\` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      \`updated_at\` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      INDEX \`idx_coupons_code\` (\`code\`),
      INDEX \`idx_coupons_active\` (\`is_active\`)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,

    // Coupon usages
    `CREATE TABLE IF NOT EXISTS \`coupon_usages\` (
      \`id\` INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
      \`coupon_id\` INT UNSIGNED NOT NULL,
      \`order_id\` VARCHAR(64) NOT NULL,
      \`customer_email\` VARCHAR(191) NOT NULL DEFAULT '',
      \`customer_phone\` VARCHAR(64) NOT NULL DEFAULT '',
      \`discount_amount\` DECIMAL(10,2) NOT NULL DEFAULT 0.00,
      \`created_at\` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      CONSTRAINT \`fk_coupon_usages_coupon\`
        FOREIGN KEY (\`coupon_id\`) REFERENCES \`coupons\`(\`id\`)
        ON DELETE CASCADE,
      INDEX \`idx_coupon_usages_coupon\` (\`coupon_id\`),
      INDEX \`idx_coupon_usages_order\` (\`order_id\`),
      INDEX \`idx_coupon_usages_user\` (\`customer_email\`, \`customer_phone\`)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,

    // Customer Reviews
    `CREATE TABLE IF NOT EXISTS \`product_reviews\` (
      \`id\` INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
      \`product_id\` INT UNSIGNED NOT NULL,
      \`user_id\` INT UNSIGNED NULL,
      \`order_id\` VARCHAR(64) NULL,
      \`customer_name\` VARCHAR(191) NOT NULL,
      \`customer_email\` VARCHAR(191) NOT NULL DEFAULT '',
      \`rating\` TINYINT UNSIGNED NOT NULL DEFAULT 5,
      \`title\` VARCHAR(255) NOT NULL DEFAULT '',
      \`comment\` TEXT NOT NULL,
      \`images\` JSON NULL,
      \`is_verified_purchase\` TINYINT(1) NOT NULL DEFAULT 0,
      \`is_approved\` TINYINT(1) NOT NULL DEFAULT 1,
      \`created_at\` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      \`updated_at\` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      CONSTRAINT \`fk_product_reviews_product\`
        FOREIGN KEY (\`product_id\`) REFERENCES \`products\`(\`id\`)
        ON DELETE CASCADE,
      INDEX \`idx_reviews_product\` (\`product_id\`, \`is_approved\`),
      INDEX \`idx_reviews_created\` (\`created_at\` DESC)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,

    // Frequently Bought Together / Product Recommendations
    `CREATE TABLE IF NOT EXISTS \`product_recommendations\` (
      \`id\` INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
      \`product_id\` INT UNSIGNED NOT NULL,
      \`recommended_product_id\` INT UNSIGNED NOT NULL,
      \`sort_order\` INT UNSIGNED NOT NULL DEFAULT 0,
      \`bundle_discount_percent\` INT UNSIGNED NOT NULL DEFAULT 5,
      CONSTRAINT \`fk_recom_product\`
        FOREIGN KEY (\`product_id\`) REFERENCES \`products\`(\`id\`)
        ON DELETE CASCADE,
      CONSTRAINT \`fk_recom_target\`
        FOREIGN KEY (\`recommended_product_id\`) REFERENCES \`products\`(\`id\`)
        ON DELETE CASCADE,
      UNIQUE KEY \`uk_product_recom\` (\`product_id\`, \`recommended_product_id\`)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,

    // User Saved Delivery Addresses
    `CREATE TABLE IF NOT EXISTS \`user_addresses\` (
      \`id\` INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
      \`user_id\` INT UNSIGNED NOT NULL,
      \`label\` VARCHAR(50) NOT NULL DEFAULT 'Home',
      \`full_name\` VARCHAR(191) NOT NULL,
      \`phone\` VARCHAR(64) NOT NULL,
      \`address_line\` TEXT NOT NULL,
      \`city\` VARCHAR(120) NOT NULL,
      \`state\` VARCHAR(120) NOT NULL DEFAULT 'Karnataka',
      \`pincode\` VARCHAR(32) NOT NULL,
      \`is_default\` TINYINT(1) NOT NULL DEFAULT 0,
      \`created_at\` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      \`updated_at\` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      CONSTRAINT \`fk_user_addresses_user\`
        FOREIGN KEY (\`user_id\`) REFERENCES \`users\`(\`id\`)
        ON DELETE CASCADE,
      INDEX \`idx_user_addresses_user\` (\`user_id\`)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,

    // Homepage Banners & Promotions
    `CREATE TABLE IF NOT EXISTS \`homepage_banners\` (
      \`id\` INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
      \`type\` ENUM('hero_slide', 'announcement_bar', 'promo_card') NOT NULL DEFAULT 'hero_slide',
      \`title\` VARCHAR(255) NOT NULL,
      \`subtitle\` VARCHAR(255) NOT NULL DEFAULT '',
      \`image\` VARCHAR(500) NOT NULL DEFAULT '',
      \`link\` VARCHAR(255) NOT NULL DEFAULT '/',
      \`cta_text\` VARCHAR(100) NOT NULL DEFAULT 'Shop Now',
      \`sort_order\` INT UNSIGNED NOT NULL DEFAULT 0,
      \`is_active\` TINYINT(1) NOT NULL DEFAULT 1,
      \`start_date\` DATETIME NULL DEFAULT NULL,
      \`end_date\` DATETIME NULL DEFAULT NULL,
      \`created_at\` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      \`updated_at\` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      INDEX \`idx_banners_type_active\` (\`type\`, \`is_active\`, \`sort_order\`)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,

    // Order Notifications audit log
    `CREATE TABLE IF NOT EXISTS \`order_notifications\` (
      \`id\` INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
      \`order_id\` VARCHAR(64) NOT NULL,
      \`type\` ENUM('email', 'whatsapp', 'sms') NOT NULL DEFAULT 'email',
      \`event\` VARCHAR(64) NOT NULL,
      \`recipient\` VARCHAR(191) NOT NULL,
      \`subject\` VARCHAR(255) NOT NULL DEFAULT '',
      \`status\` ENUM('sent', 'failed', 'mock_sent') NOT NULL DEFAULT 'sent',
      \`details\` TEXT NULL,
      \`created_at\` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      INDEX \`idx_order_notif_order\` (\`order_id\`),
      INDEX \`idx_order_notif_created\` (\`created_at\` DESC)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,

    // Bulk Quotation Products Catalog
    `CREATE TABLE IF NOT EXISTS \`bulk_products\` (
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
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,
  ];

  for (const ddl of NEW_TABLES) {
    await pool.query(ddl);
  }
  console.log("All enhancement tables created/verified successfully.");

  // 5. Seed initial standard coupons if none exist
  const [existingCoupons] = await pool.query("SELECT COUNT(*) as c FROM coupons");
  if (existingCoupons[0].c === 0) {
    await pool.query(`
      INSERT INTO \`coupons\` (\`code\`, \`description\`, \`discount_type\`, \`discount_value\`, \`min_order_value\`, \`max_discount\`, \`free_shipping\`, \`is_active\`) VALUES
      ('WELCOME10', 'Enjoy 10% off on your first order above ₹299', 'percentage', 10.00, 299.00, 200.00, 0, 1),
      ('FLAT100', 'Flat ₹100 instant discount on orders above ₹599', 'flat', 100.00, 599.00, NULL, 0, 1),
      ('FREESHIP', 'Free standard shipping on orders above ₹399', 'flat', 0.00, 399.00, NULL, 1, 1),
      ('IMAAN20', 'Special 20% off on premium artisanal products above ₹999', 'percentage', 20.00, 999.00, 500.00, 0, 1)
    `);
    console.log("+ Seeded 4 default promotional coupons (WELCOME10, FLAT100, FREESHIP, IMAAN20)");
  }

  // 6. Seed initial homepage hero slides if none exist
  const [existingBanners] = await pool.query("SELECT COUNT(*) as c FROM homepage_banners");
  if (existingBanners[0].c === 0) {
    await pool.query(`
      INSERT INTO \`homepage_banners\` (\`type\`, \`title\`, \`subtitle\`, \`image\`, \`link\`, \`cta_text\`, \`sort_order\`, \`is_active\`) VALUES
      ('hero_slide', 'Artisanal Chikmagalur Coffee', 'Single-estate shade-grown Arabica & Robusta, slow roasted to perfection.', 'https://images.pexels.com/photos/302899/pexels-photo-302899.jpeg?auto=compress&cs=tinysrgb&w=1600', '/coffee', 'Explore Coffee', 1, 1),
      ('hero_slide', 'Handpicked Malabar Spices', 'Pure, unadulterated whole black pepper, green cardamom, and turmeric.', 'https://images.pexels.com/photos/2802527/pexels-photo-2802527.jpeg?auto=compress&cs=tinysrgb&w=1600', '/spices', 'Shop Spices', 2, 1),
      ('hero_slide', 'Natural Coffee Skincare', 'Antioxidant-rich exfoliating soap bars and revitalizing face cleansers.', 'https://images.pexels.com/photos/14856372/pexels-photo-14856372.jpeg?auto=compress&cs=tinysrgb&w=1600', '/coffee-skin', 'Discover Skincare', 3, 1),
      ('announcement_bar', 'Free Express Delivery Across India on Orders Above ₹499 | Use Code WELCOME10 for 10% Off', '', '', '/coffee', 'Shop Now', 1, 1),
      ('promo_card', 'Freshly Harvested Royal Medjool Dates', 'Premium quality, naturally sweet and energy packed.', 'https://images.pexels.com/photos/4551832/pexels-photo-4551832.jpeg?auto=compress&cs=tinysrgb&w=800', '/dates', 'Buy Dates', 1, 1),
      ('promo_card', 'Pure Oudh & Arabic Attars', 'Long-lasting luxury fragrance mists crafted with natural essences.', 'https://images.pexels.com/photos/965989/pexels-photo-965989.jpeg?auto=compress&cs=tinysrgb&w=800', '/fragrances', 'Explore Fragrances', 2, 1)
    `);
    console.log("+ Seeded initial homepage banners and announcement bar");
  }

  // 7. Seed sample initial reviews for popular products if reviews table is empty
  const [existingReviews] = await pool.query("SELECT COUNT(*) as c FROM product_reviews");
  if (existingReviews[0].c === 0) {
    const [popularProds] = await pool.query("SELECT id, name FROM products LIMIT 6");
    for (const p of popularProds) {
      await pool.query(`
        INSERT INTO \`product_reviews\` (\`product_id\`, \`customer_name\`, \`customer_email\`, \`rating\`, \`title\`, \`comment\`, \`is_verified_purchase\`, \`is_approved\`) VALUES
        (?, 'Rahul Sharma', 'rahul.s@example.com', 5, 'Outstanding Quality & Aroma!', 'The freshness is immediately noticeable the moment you open the package. Highly recommend to everyone.', 1, 1),
        (?, 'Priya Nair', 'priya.nair@example.com', 5, 'Authentic and pure', 'Exactly as described. Fast delivery and premium packaging. Will definitely buy again.', 1, 1)
      `, [p.id, p.id]);
    }
    console.log("+ Seeded verified buyer sample reviews for popular products");
  }

  // 8. Populate default specs / origins / brewing guides for existing coffee & spices products
  await pool.query(`
    UPDATE \`products\` SET 
      \`origin\` = 'Chikmagalur & Coorg, Karnataka',
      \`roast_level\` = 'Medium-Dark Roast',
      \`brewing_guide\` = '1. Add 15g ground coffee to your French press or South Indian filter.\\n2. Pour 100ml boiling water (92-95°C).\\n3. Let brew for 4-5 minutes.\\n4. Press down plunger slowly and pour.',
      \`ingredients\` = '100% Specialty Arabica / Robusta Beans'
    WHERE \`section\` = 'coffee' AND (\`origin\` IS NULL OR \`origin\` = '')
  `);

  await pool.query(`
    UPDATE \`products\` SET 
      \`origin\` = 'Idukki & Wayanad, Kerala',
      \`ingredients\` = '100% Pure Natural Spice, No Additives'
    WHERE \`section\` = 'spices' AND (\`origin\` IS NULL OR \`origin\` = '')
  `);

  console.log("Migration completed successfully!");
}

module.exports = { runEnhancementsMigration };

if (require.main === module) {
  require("dotenv").config({ path: require("path").join(__dirname, "..", ".env") });
  runEnhancementsMigration()
    .then(() => process.exit(0))
    .catch((e) => {
      console.error("Migration failed:", e);
      process.exit(1);
    });
}


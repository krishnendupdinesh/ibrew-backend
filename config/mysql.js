// Stage 1: MySQL connection pool & schema initializer using mysql2/promise
const mysql = require("mysql2/promise");
const fs = require("fs");
const path = require("path");

function getMySQLCredentials() {
  const host =
    process.env.DB_HOST ||
    process.env.MYSQL_HOST ||
    process.env.MYSQLHOST ||
    "localhost";
  const port = Number(
    process.env.DB_PORT ||
    process.env.MYSQL_PORT ||
    process.env.MYSQLPORT ||
    3306
  );
  const user =
    process.env.DB_USER ||
    process.env.MYSQL_USER ||
    process.env.MYSQLUSER ||
    "root";
  const password =
    process.env.DB_PASSWORD !== undefined
      ? process.env.DB_PASSWORD
      : (process.env.MYSQL_PASSWORD || process.env.MYSQLPASSWORD || "");
  const database =
    process.env.DB_NAME ||
    process.env.MYSQL_DATABASE ||
    process.env.MYSQLDATABASE ||
    "imaans_db";
  return { host, port, user, password, database };
}

// Ensure uploads/products directory exists locally (safe guard for local environments)
const UPLOADS_PRODUCTS_DIR = path.join(__dirname, "..", "uploads", "products");
try {
  if (!fs.existsSync(UPLOADS_PRODUCTS_DIR)) {
    fs.mkdirSync(UPLOADS_PRODUCTS_DIR, { recursive: true });
  }
} catch {
  // Read-only filesystem in serverless environments
}

let pool = null;

function getPool() {
  if (!pool) {
    const dbUrl = process.env.DATABASE_URL || process.env.MYSQL_URL;

    // SSL configuration: enable rejectUnauthorized: false by default for managed cloud MySQL (TiDB, PlanetScale, Aiven, RDS, DigitalOcean)
    // Can be explicitly disabled locally with DB_SSL=false or MYSQL_SSL=false
    const sslEnv = process.env.DB_SSL ?? process.env.MYSQL_SSL;
    const isLocalHost = !dbUrl && (process.env.DB_HOST === "localhost" || process.env.DB_HOST === "127.0.0.1" || (!process.env.DB_HOST && !process.env.MYSQL_HOST));
    const useSSL = sslEnv !== undefined ? sslEnv === "true" || sslEnv === "1" : !isLocalHost;
    const sslConfig = useSSL ? { rejectUnauthorized: false } : undefined;

    if (dbUrl) {
      pool = mysql.createPool({
        uri: dbUrl,
        waitForConnections: true,
        connectionLimit: 5,
        queueLimit: 0,
        charset: "utf8mb4",
        ssl: sslConfig,
      });
    } else {
      const creds = getMySQLCredentials();
      pool = mysql.createPool({
        host: creds.host,
        port: creds.port,
        user: creds.user,
        password: creds.password,
        database: creds.database,
        waitForConnections: true,
        connectionLimit: 5,
        queueLimit: 0,
        charset: "utf8mb4",
        ssl: sslConfig,
      });
    }
  }
  return pool;
}

const TABLE_DDLS = [
  `CREATE TABLE IF NOT EXISTS \`users\` (
    \`id\` INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    \`mongo_id\` VARCHAR(64) NULL UNIQUE,
    \`name\` VARCHAR(191) NOT NULL,
    \`email\` VARCHAR(191) NOT NULL UNIQUE,
    \`phone\` VARCHAR(64) NOT NULL DEFAULT '',
    \`password\` VARCHAR(255) NOT NULL,
    \`role\` ENUM('customer', 'admin') NOT NULL DEFAULT 'customer',
    \`must_reset_password\` TINYINT(1) NOT NULL DEFAULT 0,
    \`created_at\` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    \`updated_at\` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    INDEX \`idx_users_created_at\` (\`created_at\` DESC)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,

  `CREATE TABLE IF NOT EXISTS \`products\` (
    \`id\` INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    \`mongo_id\` VARCHAR(64) NULL UNIQUE,
    \`slug\` VARCHAR(191) NOT NULL UNIQUE,
    \`name\` VARCHAR(255) NOT NULL,
    \`section\` ENUM('coffee', 'coffee-skin', 'spices', 'fragrances', 'importedbed', 'groceries', 'dates') NOT NULL DEFAULT 'coffee',
    \`category\` VARCHAR(191) NOT NULL,
    \`description\` TEXT NOT NULL,
    \`detail\` VARCHAR(500) NOT NULL DEFAULT '',
    \`image\` VARCHAR(500) NOT NULL DEFAULT '',
    \`badge\` VARCHAR(100) NOT NULL DEFAULT '',
    \`tags\` VARCHAR(500) NOT NULL DEFAULT '',
    \`is_best_seller\` TINYINT(1) NOT NULL DEFAULT 0,
    \`is_most_selling\` TINYINT(1) NOT NULL DEFAULT 0,
    \`featured_on_home\` TINYINT(1) NOT NULL DEFAULT 1,
    \`rating\` DECIMAL(3,2) NOT NULL DEFAULT 4.60,
    \`review_count\` INT UNSIGNED NOT NULL DEFAULT 24,
    \`created_at\` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    \`updated_at\` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    INDEX \`idx_products_section\` (\`section\`),
    INDEX \`idx_products_sorting\` (\`is_most_selling\` DESC, \`is_best_seller\` DESC, \`created_at\` DESC)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,

  `CREATE TABLE IF NOT EXISTS \`product_sizes\` (
    \`id\` INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    \`product_id\` INT UNSIGNED NOT NULL,
    \`label\` VARCHAR(100) NOT NULL,
    \`price\` DECIMAL(10,2) NOT NULL DEFAULT 0.00,
    \`mrp\` DECIMAL(10,2) NULL DEFAULT NULL,
    \`stock\` INT UNSIGNED NOT NULL DEFAULT 0,
    \`sort_order\` INT UNSIGNED NOT NULL DEFAULT 0,
    CONSTRAINT \`fk_product_sizes_product\`
      FOREIGN KEY (\`product_id\`) REFERENCES \`products\`(\`id\`)
      ON DELETE CASCADE,
    INDEX \`idx_product_sizes_product_id\` (\`product_id\`),
    INDEX \`idx_product_sizes_lookup\` (\`product_id\`, \`label\`)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,

  `CREATE TABLE IF NOT EXISTS \`orders\` (
    \`id\` INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    \`mongo_id\` VARCHAR(64) NULL UNIQUE,
    \`order_id\` VARCHAR(64) NOT NULL UNIQUE,
    \`customer_name\` VARCHAR(191) NOT NULL,
    \`customer_email\` VARCHAR(191) NOT NULL DEFAULT '',
    \`customer_phone\` VARCHAR(64) NOT NULL,
    \`customer_address\` TEXT NOT NULL,
    \`customer_city\` VARCHAR(120) NOT NULL,
    \`customer_state\` VARCHAR(120) NOT NULL DEFAULT 'Karnataka',
    \`customer_pincode\` VARCHAR(32) NOT NULL,
    \`customer_notes\` TEXT NOT NULL,
    \`subtotal\` DECIMAL(12,2) NOT NULL DEFAULT 0.00,
    \`shipping\` DECIMAL(12,2) NOT NULL DEFAULT 0.00,
    \`savings\` DECIMAL(12,2) NOT NULL DEFAULT 0.00,
    \`total\` DECIMAL(12,2) NOT NULL DEFAULT 0.00,
    \`payment_method\` ENUM('cod', 'upi', 'card') NOT NULL DEFAULT 'cod',
    \`payment_status\` ENUM('unpaid', 'paid', 'refunded') NOT NULL DEFAULT 'unpaid',
    \`status\` ENUM('pending', 'confirmed', 'packed', 'shipped', 'delivered', 'cancelled') NOT NULL DEFAULT 'pending',
    \`tracking_number\` VARCHAR(191) NOT NULL DEFAULT '',
    \`courier_name\` VARCHAR(191) NOT NULL DEFAULT '',
    \`admin_notes\` TEXT NOT NULL,
    \`confirmed_at\` DATETIME NULL DEFAULT NULL,
    \`shipped_at\` DATETIME NULL DEFAULT NULL,
    \`delivered_at\` DATETIME NULL DEFAULT NULL,
    \`created_at\` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    \`updated_at\` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    INDEX \`idx_orders_created_at\` (\`created_at\` DESC),
    INDEX \`idx_orders_status\` (\`status\`)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,

  `CREATE TABLE IF NOT EXISTS \`order_items\` (
    \`id\` INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    \`order_ref_id\` INT UNSIGNED NOT NULL,
    \`product_id\` INT UNSIGNED NULL,
    \`product_key\` VARCHAR(191) NOT NULL,
    \`name\` VARCHAR(255) NOT NULL,
    \`size\` VARCHAR(100) NOT NULL DEFAULT '',
    \`price\` DECIMAL(10,2) NOT NULL DEFAULT 0.00,
    \`mrp\` DECIMAL(10,2) NULL DEFAULT NULL,
    \`quantity\` INT UNSIGNED NOT NULL DEFAULT 1,
    \`image\` VARCHAR(500) NOT NULL DEFAULT '',
    \`category\` VARCHAR(191) NOT NULL DEFAULT '',
    CONSTRAINT \`fk_order_items_order\`
      FOREIGN KEY (\`order_ref_id\`) REFERENCES \`orders\`(\`id\`)
      ON DELETE CASCADE,
    CONSTRAINT \`fk_order_items_product\`
      FOREIGN KEY (\`product_id\`) REFERENCES \`products\`(\`id\`)
      ON DELETE SET NULL,
    INDEX \`idx_order_items_order\` (\`order_ref_id\`),
    INDEX \`idx_order_items_product\` (\`product_id\`)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,

  `CREATE TABLE IF NOT EXISTS \`quotes\` (
    \`id\` INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    \`mongo_id\` VARCHAR(64) NULL UNIQUE,
    \`reference\` VARCHAR(64) NOT NULL UNIQUE,
    \`status\` ENUM('new', 'contacted', 'quoted', 'closed') NOT NULL DEFAULT 'new',
    \`user_id\` INT UNSIGNED NULL,
    \`contact_name\` VARCHAR(191) NOT NULL,
    \`contact_company\` VARCHAR(191) NOT NULL DEFAULT '',
    \`contact_email\` VARCHAR(191) NOT NULL,
    \`contact_phone\` VARCHAR(64) NOT NULL,
    \`contact_city\` VARCHAR(120) NOT NULL DEFAULT '',
    \`contact_timeline\` VARCHAR(191) NOT NULL DEFAULT '',
    \`contact_notes\` TEXT NOT NULL,
    \`created_at\` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    \`updated_at\` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    CONSTRAINT \`fk_quotes_user\`
      FOREIGN KEY (\`user_id\`) REFERENCES \`users\`(\`id\`)
      ON DELETE SET NULL,
    INDEX \`idx_quotes_created_at\` (\`created_at\` DESC)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,

  `CREATE TABLE IF NOT EXISTS \`quote_items\` (
    \`id\` INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    \`quote_id\` INT UNSIGNED NOT NULL,
    \`item_code\` VARCHAR(100) NOT NULL DEFAULT '',
    \`name\` VARCHAR(255) NOT NULL,
    \`category\` VARCHAR(191) NOT NULL DEFAULT '',
    \`quantity\` INT UNSIGNED NOT NULL DEFAULT 1,
    \`unit\` VARCHAR(64) NOT NULL DEFAULT '',
    CONSTRAINT \`fk_quote_items_quote\`
      FOREIGN KEY (\`quote_id\`) REFERENCES \`quotes\`(\`id\`)
      ON DELETE CASCADE,
    INDEX \`idx_quote_items_quote\` (\`quote_id\`)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,
];

async function initMySQL() {
  const dbUrl = process.env.DATABASE_URL || process.env.MYSQL_URL;

  // 1. In local development without connection URL, ensure database exists if privileged
  if (!dbUrl) {
    try {
      const creds = getMySQLCredentials();
      const bootstrapConn = await mysql.createConnection({
        host: creds.host,
        port: creds.port,
        user: creds.user,
        password: creds.password,
      });

      await bootstrapConn.query(
        `CREATE DATABASE IF NOT EXISTS \`${creds.database}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`
      );
      await bootstrapConn.end();
    } catch {
      // In cloud environments (Render, AWS, etc.), database is pre-created by provider
    }
  }

  // 2. Initialize connection pool and create the 7 tables if they don't exist
  const dbPool = getPool();
  for (const ddl of TABLE_DDLS) {
    await dbPool.query(ddl);
  }

  // 3. Ensure enhancements schema (coupons, reviews, addresses, banners, invoice)
  try {
    const { runEnhancementsMigration } = require("./migration_enhancements");
    await runEnhancementsMigration();
  } catch (err) {
    console.warn("Enhancements migration warning:", err.message);
  }

  return dbPool;
}

module.exports = {
  getPool,
  initMySQL,
  UPLOADS_PRODUCTS_DIR,
};


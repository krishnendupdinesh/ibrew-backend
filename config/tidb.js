// Connection pool for TiDB (MySQL compatible) used by the Hero Banners feature.
const mysql = require("mysql2/promise");

let pool = null;

// Reads TIDB_* variables (falls back to the older DB_* names already in .env).
function readDatabaseSettings() {
  return {
    host: process.env.TIDB_HOST || process.env.DB_HOST,
    port: Number(process.env.TIDB_PORT || process.env.DB_PORT || 4000),
    user: process.env.TIDB_USER || process.env.DB_USER,
    password: process.env.TIDB_PASSWORD || process.env.DB_PASSWORD,
    database: process.env.TIDB_DATABASE || process.env.DB_NAME,
  };
}

// Creates the pool the first time it is needed, then reuses it.
function getTidbPool() {
  if (pool) return pool;

  pool = mysql.createPool({
    ...readDatabaseSettings(),
    ssl: { minVersion: "TLSv1.2", rejectUnauthorized: true }, // TiDB Cloud requires SSL
    waitForConnections: true,
    connectionLimit: 5,
  });
  return pool;
}

module.exports = { getTidbPool };

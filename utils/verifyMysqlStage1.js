// Stage 1 Verification Script: Connects to local MySQL at localhost:3306,
// ensures `imaans_db` and all 7 tables exist, and prints the verified table list.
const path = require("path");
require("dotenv").config({ path: path.join(__dirname, "..", ".env") });
const { initMySQL, getPool } = require("../config/mysql");

async function verifyStage1() {
  try {
    await initMySQL();
    const pool = getPool();
    const [rows] = await pool.query("SHOW TABLES");
    const tables = rows.map((r) => Object.values(r)[0]);
    console.log("MySQL connected successfully to database:", process.env.MYSQL_DATABASE || "imaans_db");
    console.log("Verified tables (" + tables.length + "):", tables.join(", "));
    await pool.end();
    process.exit(0);
  } catch (err) {
    console.error("MySQL Stage 1 verification error:", err.code || "", err.message);
    process.exit(1);
  }
}

verifyStage1();

// Creates the hero_banners table from config/hero_banners.sql. Safe to run more than once.
const path = require("path");
const fs = require("fs");
require("dotenv").config({ path: path.join(__dirname, "..", ".env") });
const { getTidbPool } = require("../config/tidb");

// Reads the SQL file and runs it.
async function run() {
  const sql = fs.readFileSync(path.join(__dirname, "..", "config", "hero_banners.sql"), "utf8");
  await getTidbPool().query(sql);
  console.log("hero_banners table is ready.");
  await getTidbPool().end();
}

run().catch((error) => {
  console.error("Migration failed:", error.message);
  process.exit(1);
});

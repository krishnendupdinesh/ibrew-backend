// Run once with:  npm run seed:admin
// Creates the admin account in MySQL used to open /admin on the website.
const path = require("path");
require("dotenv").config({ path: path.join(__dirname, "..", ".env") });
const bcrypt = require("bcryptjs");
const { initMySQL, getPool } = require("../config/mysql");
const User = require("../models/User");

async function createAdmin() {
  const adminPassword = process.env.ADMIN_PASSWORD;
  if (!adminPassword || !adminPassword.trim()) {
    throw new Error("ADMIN_PASSWORD environment variable must be set in .env before seeding admin.");
  }

  await initMySQL();

  const email = (process.env.ADMIN_EMAIL || "admin@ibrew.com").toLowerCase();
  const hashedPassword = await bcrypt.hash(adminPassword.trim(), 10);

  // If this email already exists, make it an admin. Otherwise create it.
  await User.findOneAndUpdate(
    { email },
    {
      name: process.env.ADMIN_NAME || "ibrew Admin",
      email,
      password: hashedPassword,
      role: "admin",
    },
    { upsert: true }
  );

  console.log(`Admin account verified in MySQL -> email: ${email}`);
  await getPool().end();
}

createAdmin().catch((error) => {
  console.error("Could not create admin:", error.message);
  process.exit(1);
});

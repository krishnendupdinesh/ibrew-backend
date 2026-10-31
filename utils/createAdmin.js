// Run once with:  npm run seed:admin
// Creates the admin account in MySQL used to open /admin on the website.
const path = require("path");
require("dotenv").config({ path: path.join(__dirname, "..", ".env") });
const bcrypt = require("bcryptjs");
const { initMySQL, getPool } = require("../config/mysql");
const User = require("../models/User");

async function createAdmin() {
  await initMySQL();

  const email = (process.env.ADMIN_EMAIL || "admin@ibrew.com").toLowerCase();
  const hashedPassword = await bcrypt.hash(process.env.ADMIN_PASSWORD || "Admin@12345", 10);

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

  console.log(`Admin ready in MySQL -> email: ${email}`);
  await getPool().end();
}

createAdmin().catch((error) => {
  console.log("Could not create admin:", error.message);
  process.exit(1);
});

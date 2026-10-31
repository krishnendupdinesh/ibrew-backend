// The starting point of the backend. Run with: npm run dev
const path = require("path");
require("dotenv").config({ path: path.join(__dirname, ".env") }); // loads the values from the .env file

const express = require("express");
const cors = require("cors");
const cookieParser = require("cookie-parser");
const { initMySQL } = require("./config/mysql");

const authRoutes = require("./routes/authRoutes");
const quoteRoutes = require("./routes/quoteRoutes");
const adminRoutes = require("./routes/adminRoutes");
const productRoutes = require("./routes/productRoutes");
const orderRoutes = require("./routes/orderRoutes");

const app = express();

// ----- middleware (runs on every request) -----
app.use(cors({ origin: process.env.CLIENT_URL, credentials: true }));
app.use(express.json({ limit: "10mb" })); // lets us read JSON & uploaded image data URLs sent by the frontend
app.use(cookieParser()); // lets us read cookies (the login token)

// ----- static local product image serving (no external hosting) -----
const uploadsDir = path.join(__dirname, "uploads");
app.use("/uploads", express.static(uploadsDir));
app.use("/api/uploads", express.static(uploadsDir));

// ----- routes -----
app.get("/", (req, res) => res.send("ibrew backend is running (MySQL)"));
app.use("/api/auth", authRoutes);
app.use("/api/quote", quoteRoutes);
app.use("/api/admin", adminRoutes);
app.use("/api/products", productRoutes);
app.use("/api/orders", orderRoutes);

// ----- unknown URL -----
app.use((req, res) => res.status(404).json({ error: "Route not found." }));

// ----- start -----
const PORT = process.env.PORT || 5001;

if (require.main === module) {
  initMySQL()
    .then(() => {
      console.log(`MySQL connected (${process.env.MYSQL_DATABASE || "imaans_db"})`);
      app.listen(PORT, () => console.log(`Server running on http://localhost:${PORT}`));
    })
    .catch((err) => {
      console.error("MySQL initialization failed:", err.message);
      process.exit(1);
    });
}

module.exports = app;

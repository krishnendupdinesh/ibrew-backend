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
const couponRoutes = require("./routes/couponRoutes");
const reviewRoutes = require("./routes/reviewRoutes");
const bannerRoutes = require("./routes/bannerRoutes");
const userAddressRoutes = require("./routes/userAddressRoutes");
const shippingRoutes = require("./routes/shippingRoutes");

const app = express();

// ----- middleware (runs on every request) -----
const allowedOrigins = [
  process.env.CLIENT_URL,
  "http://localhost:3000",
  "http://127.0.0.1:3000",
].filter(Boolean);

app.use(
  cors({
    origin: function (origin, callback) {
      if (!origin) return callback(null, true);
      const clean = origin.replace(/\/+$/, "");
      const isAllowed = allowedOrigins.some(
        (allowed) => allowed.replace(/\/+$/, "") === clean
      );
      if (isAllowed || process.env.NODE_ENV !== "production") {
        return callback(null, true);
      }
      return callback(new Error("CORS origin blocked"));
    },
    credentials: true,
  })
);
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
app.use("/api/coupons", couponRoutes);
app.use("/api/products", reviewRoutes);
app.use("/api/banners", bannerRoutes);
app.use("/api/user/addresses", userAddressRoutes);
app.use("/api/shipping", shippingRoutes);

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

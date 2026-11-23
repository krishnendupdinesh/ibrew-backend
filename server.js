// The starting point of the backend. Run with: npm run dev
const path = require("path");
require("dotenv").config({ path: path.join(__dirname, ".env") }); // loads the values from the .env file

// Validate required JWT_SECRET at startup: refuse to start if missing or empty
if (!process.env.JWT_SECRET || !process.env.JWT_SECRET.trim()) {
  console.error("FATAL: JWT_SECRET environment variable is missing. Set a strong secret in .env or your deployment dashboard.");
  process.exit(1);
}

const express = require("express");
const cors = require("cors");
const cookieParser = require("cookie-parser");
const helmet = require("helmet");
const rateLimit = require("express-rate-limit");
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

// Enable trust proxy so rate limiters see the real client IP behind Nginx, Render, or Vercel
app.set("trust proxy", 1);

// Security headers with crossOriginResourcePolicy enabled so product images load on the frontend
app.use(
  helmet({
    crossOriginResourcePolicy: { policy: "cross-origin" },
  })
);

// ----- CORS Configuration -----
// Allow all origins by reflecting request origin so cookies/credentials and Next.js / Vercel / mobile succeed without block
app.use(
  cors({
    origin: true,
    credentials: true,
  })
);

app.use(express.json({ limit: "10mb" })); // lets us read JSON & uploaded image data URLs sent by the frontend
app.use(cookieParser()); // lets us read cookies (the login token)

// ----- Rate Limiters (return clean JSON 429 messages) -----
const createLimiter = (maxRequests, windowMinutes, message) =>
  rateLimit({
    windowMs: windowMinutes * 60 * 1000,
    max: maxRequests,
    standardHeaders: true,
    legacyHeaders: false,
    handler: (req, res) => {
      res.status(429).json({ error: message });
    },
  });

const authLimiter = createLimiter(10, 15, "Too many login/registration attempts. Please try again after 15 minutes.");
const trackLimiter = createLimiter(30, 15, "Too many order tracking requests. Please slow down.");
const couponLimiter = createLimiter(20, 15, "Too many coupon validation attempts. Please try again later.");

// ----- static local product image serving with security headers -----
const uploadsDir = path.join(__dirname, "uploads");
const staticUploadsMiddleware = express.static(uploadsDir, {
  setHeaders: (res) => {
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("Content-Security-Policy", "default-src 'none'");
  },
});
app.use("/uploads", staticUploadsMiddleware);
app.use("/api/uploads", staticUploadsMiddleware);

let mySqlInitialized = false;
let mySqlInitPromise = null;

async function ensureMySQLReady() {
  if (mySqlInitialized) return;
  if (!mySqlInitPromise) {
    mySqlInitPromise = initMySQL()
      .then(() => {
        mySqlInitialized = true;
      })
      .catch((err) => {
        mySqlInitPromise = null;
        throw err;
      });
  }
  return mySqlInitPromise;
}

// In serverless environments (like Vercel), ensure MySQL is initialized before handling /api requests
app.use(async (req, res, next) => {
  if (req.path === "/" || req.path === "/favicon.ico") return next();
  try {
    await ensureMySQLReady();
    next();
  } catch (err) {
    console.error("Database initialization failed during request:", err.message);
    res.status(500).json({ error: "Database connection failed. Please verify DB credentials." });
  }
});
app.get("/", (req, res) => res.send("ibrew backend is running (MySQL)"));

// Mount rate limited public endpoints
app.use("/api/auth/login", authLimiter);
app.use("/api/auth/register", authLimiter);
app.use("/api/orders/track", trackLimiter);
app.use("/api/coupons/apply", couponLimiter);

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

// ----- global error handler to always return JSON errors instead of HTML -----
app.use((err, req, res, next) => {
  console.error("Unhandled server error:", err?.message || err);
  if (res.headersSent) {
    return next(err);
  }
  return res.status(err.statusCode || err.status || 500).json({
    error: err.message || "Internal Server Error",
  });
});

// ----- start -----
const PORT = process.env.PORT || 5001;

if (require.main === module) {
  initMySQL()
    .then(() => {
      console.log(`MySQL connected (${process.env.MYSQL_DATABASE || "imaans_db"})`);
      app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
    })
    .catch((err) => {
      console.error("MySQL initialization failed:", err.message);
      process.exit(1);
    });
}

module.exports = app;

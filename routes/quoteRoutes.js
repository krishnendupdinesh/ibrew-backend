const express = require("express");
const rateLimit = require("express-rate-limit");
const { createQuote } = require("../controllers/quoteController");
const { getActiveBulkProducts } = require("../controllers/bulkProductController");

const router = express.Router();

const quoteLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  handler: (req, res) => {
    res.status(429).json({ error: "Too many quotation requests. Please wait a few minutes before submitting again." });
  },
});

router.get("/products", getActiveBulkProducts); // public bulk quotation catalog
router.post("/", quoteLimiter, createQuote); // anyone can send a quotation request

module.exports = router;

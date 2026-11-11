const express = require("express");
const rateLimit = require("express-rate-limit");
const {
  getReviewsForProduct,
  submitReview,
} = require("../controllers/reviewController");

const router = express.Router();

const reviewLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  handler: (req, res) => {
    res.status(429).json({ error: "Too many review submissions. Please wait before submitting more reviews." });
  },
});

// Product reviews
router.get("/:id/reviews", getReviewsForProduct);
router.post("/:id/reviews", reviewLimiter, submitReview);

module.exports = router;

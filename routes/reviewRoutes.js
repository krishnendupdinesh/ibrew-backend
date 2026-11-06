const express = require("express");
const {
    getReviewsForProduct,
    submitReview,
} = require("../controllers/reviewController");

const router = express.Router();

// Product reviews
router.get("/:id/reviews", getReviewsForProduct);
router.post("/:id/reviews", submitReview);

module.exports = router;
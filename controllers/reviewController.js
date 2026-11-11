const Review = require("../models/Review");
const Product = require("../models/Product");

// GET /api/products/:id/reviews -> Get approved reviews for a product
async function getReviewsForProduct(req, res) {
  try {
    const { id } = req.params;
    const { page, limit } = req.query;

    const prod = await Product.findById(id);
    if (!prod) {
      return res.status(404).json({ error: "Product not found." });
    }

    const data = await Review.findByProductId(prod.id, { page, limit });
    return res.json(data);
  } catch (err) {
    console.error("getReviewsForProduct error:", err);
    res.status(500).json({ error: "Failed to fetch reviews." });
  }
}

// POST /api/products/:id/reviews -> Submit a new review
async function submitReview(req, res) {
  try {
    const { id } = req.params;
    const body = req.body || {};

    const prod = await Product.findById(id);
    if (!prod) {
      return res.status(404).json({ error: "Product not found." });
    }

    const rating = Number(body.rating);
    if (!rating || rating < 1 || rating > 5) {
      return res.status(400).json({ error: "Please provide a rating between 1 and 5 stars." });
    }

    if (!body.customerName || !body.comment) {
      return res.status(400).json({ error: "Name and comment are required." });
    }

    // Process customer images if uploaded as data URIs (Cloudinary or local)
    let cleanImages = [];
    if (Array.isArray(body.images)) {
      const { resolveAndSaveProductImage } = require("../utils/imageStorage");
      const processed = await Promise.all(
        body.images.map((img, idx) =>
          Promise.resolve(resolveAndSaveProductImage(img, `review-${prod.slug}-${idx}`))
        )
      );
      cleanImages = processed.filter(Boolean);
    }

    const reviewId = await Review.create({
      productId: prod.id,
      userId: req.user?.id || null,
      customerName: body.customerName,
      customerEmail: body.customerEmail || req.user?.email || "",
      customerPhone: body.customerPhone || "",
      rating,
      title: body.title || "",
      comment: body.comment,
      images: cleanImages,
    });

    const updatedStats = await Review.findByProductId(prod.id, { page: 1, limit: 5 });

    return res.status(201).json({
      message: "Review submitted successfully! Thank you for your feedback.",
      reviewId,
      summary: updatedStats.summary,
    });
  } catch (err) {
    console.error("submitReview error:", err);
    res.status(500).json({ error: "Failed to submit review." });
  }
}

// GET /api/admin/reviews -> Admin list all reviews
async function adminGetReviews(req, res) {
  try {
    const { page, limit } = req.query;
    const data = await Review.findAllForAdmin({ page, limit });
    return res.json(data);
  } catch (err) {
    console.error("adminGetReviews error:", err);
    res.status(500).json({ error: "Failed to fetch reviews." });
  }
}

// PATCH /api/admin/reviews/:id/approval -> Admin toggle approve/reject
async function adminUpdateReviewApproval(req, res) {
  try {
    const { id } = req.params;
    const { isApproved } = req.body;
    await Review.updateApproval(id, Boolean(isApproved));
    return res.json({ message: "Review status updated successfully." });
  } catch (err) {
    console.error("adminUpdateReviewApproval error:", err);
    res.status(500).json({ error: "Failed to update review." });
  }
}

// DELETE /api/admin/reviews/:id -> Admin delete review
async function adminDeleteReview(req, res) {
  try {
    const { id } = req.params;
    await Review.delete(id);
    return res.json({ message: "Review deleted successfully." });
  } catch (err) {
    console.error("adminDeleteReview error:", err);
    res.status(500).json({ error: "Failed to delete review." });
  }
}

module.exports = {
  getReviewsForProduct,
  submitReview,
  adminGetReviews,
  adminUpdateReviewApproval,
  adminDeleteReview,
};


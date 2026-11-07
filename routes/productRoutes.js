const express = require("express");
const {
  getPublicProducts,
  getSingleProduct,
  getProductRecommendations,
} = require("../controllers/productController");

const router = express.Router();

// GET /api/products  (?section=coffee&bestSeller=true&mostSelling=true)
router.get("/", getPublicProducts);

// GET /api/products/:idOrSlug
router.get("/:idOrSlug", getSingleProduct);

// GET /api/products/:idOrSlug/recommendations
router.get("/:idOrSlug/recommendations", getProductRecommendations);

module.exports = router;


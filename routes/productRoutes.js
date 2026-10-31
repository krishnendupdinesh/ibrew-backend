const express = require("express");
const { getPublicProducts } = require("../controllers/productController");

const router = express.Router();

// GET /api/products  (?section=coffee&bestSeller=true&mostSelling=true)
router.get("/", getPublicProducts);

module.exports = router;


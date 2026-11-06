const express = require("express");
const { estimateDelivery } = require("../controllers/shippingController");

const router = express.Router();

// Delivery estimate and PIN code serviceability
router.get("/estimate", estimateDelivery);

module.exports = router;
const express = require("express");
const { createOrder } = require("../controllers/orderController");

const router = express.Router();

// Public checkout order placement
router.post("/", createOrder);

module.exports = router;


const express = require("express");
const { createQuote } = require("../controllers/quoteController");
const { getActiveBulkProducts } = require("../controllers/bulkProductController");

const router = express.Router();

router.get("/products", getActiveBulkProducts); // public bulk quotation catalog
router.post("/", createQuote); // anyone can send a quotation request

module.exports = router;

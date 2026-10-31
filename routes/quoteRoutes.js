const express = require("express");
const { createQuote } = require("../controllers/quoteController");

const router = express.Router();

router.post("/", createQuote); // anyone can send a quotation request

module.exports = router;

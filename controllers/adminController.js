// Things only the admin dashboard needs.
const Quote = require("../models/Quote");
const User = require("../models/User");

const ALLOWED_STATUS = ["new", "contacted", "quoted", "closed"];

// GET /api/admin/quotes  -> all requests, newest first
async function getQuotes(req, res) {
  try {
    const quotes = await Quote.findAllSorted();
    res.json({ quotes });
  } catch (error) {
    res.status(500).json({ error: "Could not load quotes." });
  }
}

// PATCH /api/admin/quotes  body: { id, status }
async function updateQuoteStatus(req, res) {
  try {
    const { id, status } = req.body;

    if (!ALLOWED_STATUS.includes(status)) {
      return res.status(400).json({ error: "Invalid status." });
    }

    const quote = await Quote.findOneAndUpdate({ reference: id }, { status });
    if (!quote) {
      return res.status(404).json({ error: "Quote not found." });
    }

    res.json({ quote });
  } catch (error) {
    res.status(500).json({ error: "Could not update the quote." });
  }
}

// GET /api/admin/users  -> all registered users, newest first
async function getUsers(req, res) {
  try {
    const users = await User.findAllSorted();
    res.json({ users });
  } catch (error) {
    res.status(500).json({ error: "Could not load users." });
  }
}

module.exports = { getQuotes, updateQuoteStatus, getUsers };

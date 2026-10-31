// Saves a bulk-order quotation request sent from the website.
const Quote = require("../models/Quote");
const { getUserFromCookie } = require("../middleware/auth");

// Makes a short reference like IBQ-20261030-4821
function makeReference() {
  const today = new Date().toISOString().slice(0, 10).replaceAll("-", "");
  const random = Math.floor(1000 + Math.random() * 9000);
  return `IBQ-${today}-${random}`;
}

// POST /api/quote
async function createQuote(req, res) {
  try {
    const { contact, items } = req.body;

    // ----- check the data -----
    if (!contact || !contact.name || !contact.name.trim()) {
      return res.status(400).json({ error: "Name is required." });
    }
    if (!contact.email || !/^\S+@\S+\.\S+$/.test(contact.email.trim())) {
      return res.status(400).json({ error: "A valid email is required." });
    }
    if (!contact.phone || contact.phone.replace(/\D/g, "").length < 8) {
      return res.status(400).json({ error: "A valid phone number is required." });
    }

    const itemList = Array.isArray(items) ? items : [];
    const hasNotes = contact.notes && contact.notes.trim();
    if (itemList.length === 0 && !hasNotes) {
      return res.status(400).json({ error: "Add items or describe what you need." });
    }
    for (const item of itemList) {
      if (!item.name || !(Number(item.quantity) > 0)) {
        return res.status(400).json({ error: "Every item needs a name and a quantity." });
      }
    }

    // ----- save it -----
    const loggedInUser = await getUserFromCookie(req); // optional

    const quote = await Quote.create({
      reference: makeReference(),
      user: loggedInUser ? loggedInUser._id : null,
      contact,
      items: itemList,
    });

    // The Bulk Orders page shows this reference to the customer
    res.status(201).json({ reference: quote.reference });
  } catch (error) {
    console.log("createQuote error:", error.message);
    res.status(500).json({ error: "Could not save your request." });
  }
}

module.exports = { createQuote };

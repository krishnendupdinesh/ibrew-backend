const UserAddress = require("../models/UserAddress");

// GET /api/user/addresses
async function getAddresses(req, res) {
  try {
    const userId = req.user?.id;
    if (!userId) {
      return res.status(401).json({ error: "Please log in to view saved addresses." });
    }
    const addresses = await UserAddress.findByUserId(userId);
    return res.json({ addresses });
  } catch (err) {
    console.error("getAddresses error:", err);
    res.status(500).json({ error: "Failed to fetch addresses." });
  }
}

// POST /api/user/addresses
async function createAddress(req, res) {
  try {
    const userId = req.user?.id;
    if (!userId) {
      return res.status(401).json({ error: "Please log in to save an address." });
    }

    const { fullName, phone, addressLine, city, pincode } = req.body || {};
    if (!fullName || !phone || !addressLine || !city || !pincode) {
      return res.status(400).json({ error: "Full name, phone, address, city, and PIN code are required." });
    }

    const id = await UserAddress.create(userId, req.body);
    const addresses = await UserAddress.findByUserId(userId);
    return res.status(201).json({ addresses, message: "Address saved successfully." });
  } catch (err) {
    console.error("createAddress error:", err);
    res.status(500).json({ error: "Failed to save address." });
  }
}

// PUT /api/user/addresses/:id
async function updateAddress(req, res) {
  try {
    const userId = req.user?.id;
    const { id } = req.params;
    if (!userId) {
      return res.status(401).json({ error: "Unauthorized." });
    }

    await UserAddress.update(userId, id, req.body);
    const addresses = await UserAddress.findByUserId(userId);
    return res.json({ addresses, message: "Address updated successfully." });
  } catch (err) {
    console.error("updateAddress error:", err);
    res.status(500).json({ error: "Failed to update address." });
  }
}

// DELETE /api/user/addresses/:id
async function deleteAddress(req, res) {
  try {
    const userId = req.user?.id;
    const { id } = req.params;
    if (!userId) {
      return res.status(401).json({ error: "Unauthorized." });
    }

    await UserAddress.delete(userId, id);
    const addresses = await UserAddress.findByUserId(userId);
    return res.json({ addresses, message: "Address deleted successfully." });
  } catch (err) {
    console.error("deleteAddress error:", err);
    res.status(500).json({ error: "Failed to delete address." });
  }
}

// PATCH /api/user/addresses/:id/default
async function setDefaultAddress(req, res) {
  try {
    const userId = req.user?.id;
    const { id } = req.params;
    if (!userId) {
      return res.status(401).json({ error: "Unauthorized." });
    }

    await UserAddress.setDefault(userId, id);
    const addresses = await UserAddress.findByUserId(userId);
    return res.json({ addresses, message: "Default address updated." });
  } catch (err) {
    console.error("setDefaultAddress error:", err);
    res.status(500).json({ error: "Failed to set default address." });
  }
}

module.exports = {
  getAddresses,
  createAddress,
  updateAddress,
  deleteAddress,
  setDefaultAddress,
};


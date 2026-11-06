const express = require("express");
const { requireLogin } = require("../middleware/auth");

const {
    getAddresses,
    createAddress,
    updateAddress,
    deleteAddress,
    setDefaultAddress,
} = require("../controllers/userAddressController");

const router = express.Router();

// All address routes require login
router.use(requireLogin);

router.get("/", getAddresses);
router.post("/", createAddress);
router.put("/:id", updateAddress);
router.delete("/:id", deleteAddress);
router.patch("/:id/default", setDefaultAddress);

module.exports = router;
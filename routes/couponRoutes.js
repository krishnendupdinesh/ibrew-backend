const express = require("express");
const {
    applyCoupon,
    getActiveCoupons,
} = require("../controllers/couponController");

const router = express.Router();

// Public coupon routes
router.post("/apply", applyCoupon);
router.get("/active", getActiveCoupons);

module.exports = router;
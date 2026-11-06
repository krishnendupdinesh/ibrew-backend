const express = require("express");
const {
    getActiveBanners,
} = require("../controllers/bannerController");

const router = express.Router();

// Public active banners
router.get("/", getActiveBanners);

module.exports = router;
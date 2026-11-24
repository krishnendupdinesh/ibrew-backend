// Routes for hero banners. Public router: /api/hero-banners. Admin router: /api/admin/hero-banners.
const express = require("express");
const controller = require("../controllers/heroBannerController");
const { receiveHeroImage } = require("../middleware/heroImageUpload");

const publicRouter = express.Router();
publicRouter.get("/", controller.listPublicBanners);

// The admin router is mounted inside adminRoutes.js, which already requires admin login.
const adminRouter = express.Router();
adminRouter.get("/", controller.listAdminBanners);
adminRouter.post("/", receiveHeroImage, controller.createBanner);
adminRouter.put("/:id", receiveHeroImage, controller.updateBanner);
adminRouter.delete("/:id", controller.deleteBanner);

module.exports = { publicRouter, adminRouter };

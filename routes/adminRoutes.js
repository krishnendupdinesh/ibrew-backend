const couponController = require("../controllers/couponController");
const reviewController = require("../controllers/reviewController");
const bannerController = require("../controllers/bannerController");

const express = require("express");
const { requireLogin, requireAdmin } = require("../middleware/auth");
const { getQuotes, updateQuoteStatus, getUsers } = require("../controllers/adminController");
const {
  getAdminProducts,
  createProduct,
  updateProduct,
  patchProduct,
  deleteProduct,
} = require("../controllers/productController");
const {
  getAdminOrders,
  updateOrder,
  deleteOrder,
} = require("../controllers/orderController");

const router = express.Router();

// Every route below needs: logged in AND admin
router.use(requireLogin, requireAdmin);

router.get("/quotes", getQuotes);
router.patch("/quotes", updateQuoteStatus);
router.get("/users", getUsers);

// Product & Inventory management
router.get("/products", getAdminProducts);
router.post("/products", createProduct);
router.put("/products/:id", updateProduct);
router.patch("/products/:id", patchProduct);
router.delete("/products/:id", deleteProduct);

// Orders management
router.get("/orders", getAdminOrders);
router.patch("/orders/:id", updateOrder);
router.delete("/orders/:id", deleteOrder);

// Coupon management
router.get("/coupons", couponController.adminGetCoupons);
router.post("/coupons", couponController.adminCreateCoupon);
router.put("/coupons/:id", couponController.adminUpdateCoupon);
router.delete("/coupons/:id", couponController.adminDeleteCoupon);

// Review management
router.get("/reviews", reviewController.adminGetReviews);
router.patch("/reviews/:id/approval", reviewController.adminUpdateReviewApproval);
router.delete("/reviews/:id", reviewController.adminDeleteReview);

// Banner management
router.get("/banners", bannerController.getAllBanners);
router.post("/banners", bannerController.createBanner);
router.put("/banners/:id", bannerController.updateBanner);
router.delete("/banners/:id", bannerController.deleteBanner);

module.exports = router;

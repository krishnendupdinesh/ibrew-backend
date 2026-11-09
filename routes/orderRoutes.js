const express = require("express");
const {
  createOrder,
  getMyOrders,
  trackOrder,
  createRazorpayOrder,
  verifyRazorpayPayment,
  getOrderInvoice,
  reorderOrderItems,
  cancelOrder,
} = require("../controllers/orderController");

const router = express.Router();

// Public checkout order placement
router.post("/", createOrder);

// Customer order history (logged-in user) and tracking by Order ID
router.get("/my-orders", getMyOrders);
router.get("/track/:orderId", trackOrder);

// Razorpay payment flow
router.post("/razorpay/create", createRazorpayOrder);
router.post("/razorpay/verify", verifyRazorpayPayment);

// Invoice, reorder & cancellation helpers
router.get("/:orderId/invoice", getOrderInvoice);
router.get("/:orderId/reorder", reorderOrderItems);
router.post("/:orderId/cancel", cancelOrder);

module.exports = router;

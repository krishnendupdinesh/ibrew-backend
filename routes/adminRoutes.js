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

module.exports = router;

const Order = require("../models/Order");
const { ensureDefaultProducts } = require("./productController");

const ALLOWED_ORDER_STATUS = [
  "pending",
  "confirmed",
  "packed",
  "shipped",
  "delivered",
  "cancelled",
];
const ALLOWED_PAYMENT_STATUS = ["unpaid", "paid", "refunded"];

function generateOrderId() {
  const datePart = new Date().toISOString().slice(0, 10).replace(/-/g, "");
  const rand = Math.floor(100000 + Math.random() * 900000);
  return `IBREW-${datePart}-${rand}`;
}

// POST /api/orders -> Customer places a new order at checkout
async function createOrder(req, res) {
  try {
    await ensureDefaultProducts();

    const body = req.body || {};
    const customer = body.customer || {};
    const items = Array.isArray(body.items) ? body.items : [];

    if (!customer.name || !customer.phone || !customer.address || !customer.city || !customer.pincode) {
      return res.status(400).json({
        error: "Customer name, phone, address, city, and PIN code are required.",
      });
    }

    if (items.length === 0) {
      return res.status(400).json({ error: "Order must contain at least one item." });
    }

    const orderId = body.orderId || generateOrderId();
    const subtotal =
      typeof body.subtotal === "number"
        ? body.subtotal
        : items.reduce((s, i) => s + Number(i.price || 0) * Number(i.quantity || 1), 0);
    const shipping = typeof body.shipping === "number" ? body.shipping : subtotal >= 999 ? 0 : 60;
    const savings = typeof body.savings === "number" ? body.savings : 0;
    const total = typeof body.total === "number" ? body.total : subtotal + shipping;

    // Transactional order creation + stock validation & deduction
    const order = await Order.create({
      orderId,
      customer: {
        name: String(customer.name).trim(),
        email: String(customer.email || "").trim(),
        phone: String(customer.phone).trim(),
        address: String(customer.address).trim(),
        city: String(customer.city).trim(),
        state: String(customer.state || "Karnataka").trim(),
        pincode: String(customer.pincode).trim(),
        notes: String(customer.notes || "").trim(),
      },
      items: items.map((item) => ({
        productId: String(item.productId || item.id || "item"),
        name: String(item.name || "Product"),
        size: String(item.size || ""),
        price: Number(item.price || 0),
        mrp: item.mrp !== undefined ? Number(item.mrp) : undefined,
        quantity: Math.max(1, Number(item.quantity || 1)),
        image: String(item.image || ""),
        category: String(item.category || ""),
      })),
      subtotal,
      shipping,
      savings,
      total,
      paymentMethod: ["cod", "upi", "card"].includes(body.paymentMethod) ? body.paymentMethod : "cod",
      paymentStatus: body.paymentStatus === "paid" ? "paid" : "unpaid",
      status: "pending",
    });

    res.status(201).json({ order });
  } catch (error) {
    if (error && error.statusCode === 400) {
      return res.status(400).json({ error: error.message });
    }
    console.log("createOrder error:", error.message);
    res.status(500).json({ error: "Could not place order." });
  }
}

// GET /api/admin/orders -> All orders newest first
async function getAdminOrders(req, res) {
  try {
    const orders = await Order.findAllSorted();
    res.json({ orders });
  } catch (error) {
    console.log("getAdminOrders error:", error.message);
    res.status(500).json({ error: "Could not load orders." });
  }
}

// PATCH /api/admin/orders/:id -> Confirm order, update status, payment status, tracking, notes
async function updateOrder(req, res) {
  try {
    const { id } = req.params;
    const body = req.body || {};
    const update = {};

    if (body.status !== undefined) {
      if (!ALLOWED_ORDER_STATUS.includes(body.status)) {
        return res.status(400).json({ error: "Invalid order status." });
      }
      update.status = body.status;
      if (body.status === "confirmed") update.confirmedAt = new Date();
      if (body.status === "shipped") update.shippedAt = new Date();
      if (body.status === "delivered") update.deliveredAt = new Date();
    }

    if (body.paymentStatus !== undefined) {
      if (!ALLOWED_PAYMENT_STATUS.includes(body.paymentStatus)) {
        return res.status(400).json({ error: "Invalid payment status." });
      }
      update.paymentStatus = body.paymentStatus;
    }

    if (body.trackingNumber !== undefined) {
      update.trackingNumber = String(body.trackingNumber).trim();
    }
    if (body.courierName !== undefined) {
      update.courierName = String(body.courierName).trim();
    }
    if (body.adminNotes !== undefined) {
      update.adminNotes = String(body.adminNotes).trim();
    }

    const order = await Order.findOneAndUpdateByIdentifier(id, update);

    if (!order) {
      return res.status(404).json({ error: "Order not found." });
    }

    res.json({ order });
  } catch (error) {
    if (error && error.statusCode === 400) {
      return res.status(400).json({ error: error.message });
    }
    console.log("updateOrder error:", error.message);
    res.status(500).json({ error: "Could not update order." });
  }
}

// DELETE /api/admin/orders/:id
async function deleteOrder(req, res) {
  try {
    const { id } = req.params;
    const deleted = await Order.findOneAndDeleteByIdentifier(id);
    if (!deleted) {
      return res.status(404).json({ error: "Order not found." });
    }
    res.json({ message: "Order deleted." });
  } catch (error) {
    console.log("deleteOrder error:", error.message);
    res.status(500).json({ error: "Could not delete order." });
  }
}

module.exports = {
  createOrder,
  getAdminOrders,
  updateOrder,
  deleteOrder,
};

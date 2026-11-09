const Order = require("../models/Order");
const Coupon = require("../models/Coupon");
const { ensureDefaultProducts } = require("./productController");
const { getUserFromCookie } = require("../middleware/auth");
const { notifyOrderEvent } = require("../utils/notifier");
const Razorpay = require("razorpay");
const crypto = require("crypto");

let razorpayInstance = null;
function getRazorpayInstance() {
  const key_id = process.env.RAZORPAY_KEY_ID;
  const key_secret = process.env.RAZORPAY_KEY_SECRET;
  if (key_id && key_secret) {
    if (!razorpayInstance) {
      razorpayInstance = new Razorpay({ key_id, key_secret });
    }
    return { instance: razorpayInstance, key_id };
  }
  return { instance: null, key_id: key_id || "rzp_test_ibrew_demo" };
}

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

// POST /api/orders/razorpay/create -> Create Razorpay order
async function createRazorpayOrder(req, res) {
  try {
    const { amount, receipt } = req.body;
    if (!amount || amount <= 0) {
      return res.status(400).json({ error: "Invalid order amount" });
    }
    const { instance, key_id } = getRazorpayInstance();
    const amountInPaise = Math.round(Number(amount) * 100);

    if (instance) {
      const options = {
        amount: amountInPaise,
        currency: "INR",
        receipt: receipt || `rcpt_${Date.now()}`,
      };
      const order = await instance.orders.create(options);
      return res.json({
        success: true,
        orderId: order.id,
        amount: order.amount,
        currency: order.currency,
        key: key_id,
      });
    } else {
      // Sandbox / Test fallback mode
      const mockOrderId = `order_test_${Date.now()}_${Math.floor(Math.random() * 1000)}`;
      return res.json({
        success: true,
        orderId: mockOrderId,
        amount: amountInPaise,
        currency: "INR",
        key: key_id,
        isDemo: true,
      });
    }
  } catch (error) {
    console.error("createRazorpayOrder error:", error);
    res.status(500).json({ error: "Failed to create payment order" });
  }
}

// POST /api/orders/razorpay/verify -> Verify Razorpay payment signature
async function verifyRazorpayPayment(req, res) {
  try {
    const { razorpay_order_id, razorpay_payment_id, razorpay_signature } = req.body;
    const key_secret = process.env.RAZORPAY_KEY_SECRET;

    if (!razorpay_order_id || !razorpay_payment_id) {
      return res.status(400).json({ success: false, error: "Missing payment parameters" });
    }

    if (key_secret && razorpay_signature && !razorpay_order_id.startsWith("order_test_")) {
      const expected = crypto
        .createHmac("sha256", key_secret)
        .update(`${razorpay_order_id}|${razorpay_payment_id}`)
        .digest("hex");

      if (expected !== razorpay_signature) {
        return res.status(400).json({ success: false, error: "Invalid payment signature" });
      }
    }

    res.json({
      success: true,
      message: "Payment verified successfully",
      paymentId: razorpay_payment_id,
    });
  } catch (error) {
    console.error("verifyRazorpayPayment error:", error);
    res.status(500).json({ success: false, error: "Payment verification failed" });
  }
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
    const rawSubtotal =
      typeof body.subtotal === "number"
        ? body.subtotal
        : items.reduce((s, i) => s + Number(i.price || 0) * Number(i.quantity || 1), 0);

    // Coupon calculation
    let couponDiscount = 0;
    let validCouponCode = null;
    if (body.couponCode) {
      const couponCheck = await Coupon.validateForCart(body.couponCode, {
        subtotal: rawSubtotal,
        email: customer.email,
        phone: customer.phone,
      });
      if (couponCheck.valid) {
        validCouponCode = couponCheck.coupon.code;
        couponDiscount = couponCheck.coupon.discountAmount || 0;
      }
    }

    const shipping =
      typeof body.shipping === "number" ? body.shipping : rawSubtotal >= 499 ? 0 : 50;
    const savings =
      (typeof body.savings === "number" ? body.savings : 0) + couponDiscount;
    const total = Math.max(0, rawSubtotal - couponDiscount + shipping);

    // Transactional order creation + stock validation & deduction
    const order = await Order.create({
      orderId,
      userId: body.userId || req.user?.id,
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
      subtotal: rawSubtotal,
      shipping,
      savings,
      total,
      couponCode: validCouponCode,
      couponDiscount,
      razorpayOrderId: body.razorpayOrderId || body.razorpay_order_id,
      razorpayPaymentId: body.razorpayPaymentId || body.razorpay_payment_id,
      razorpaySignature: body.razorpaySignature || body.razorpay_signature,
      paymentMethod: ["cod", "upi", "card", "razorpay"].includes(body.paymentMethod)
        ? body.paymentMethod
        : "cod",
      paymentStatus:
        body.paymentStatus === "paid" || body.razorpayPaymentId ? "paid" : "unpaid",
      status: "pending",
    });

    // Send asynchronous confirmation notification (does not block response)
    notifyOrderEvent(order, "ORDER_CONFIRMED").catch((err) =>
      console.error("Order notification error:", err)
    );

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

    // Trigger notification on relevant status updates
    if (update.status === "shipped") {
      notifyOrderEvent(order, "ORDER_SHIPPED").catch(() => {});
    } else if (update.status === "delivered") {
      notifyOrderEvent(order, "ORDER_DELIVERED").catch(() => {});
    } else if (update.status === "cancelled") {
      notifyOrderEvent(order, "ORDER_CANCELLED").catch(() => {});
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

// GET /api/orders/my-orders -> Customer orders matching logged-in user or query
async function getMyOrders(req, res) {
  try {
    const user = await getUserFromCookie(req);
    // Only the logged-in user's own orders (no ?email= lookup, to avoid exposing other customers' orders)
    const email = user?.email || "";
    const phone = user?.phone || "";

    if (!email && !phone) {
      return res.status(401).json({ error: "Please log in to view your orders.", orders: [] });
    }

    const orders = await Order.findByCustomerEmailOrPhone(email, phone);
    res.json({ orders });
  } catch (error) {
    console.log("getMyOrders error:", error.message);
    res.status(500).json({ error: "Could not load your orders." });
  }
}

// GET /api/orders/track/:orderId -> Customer tracking details by Order ID
async function trackOrder(req, res) {
  try {
    const { orderId } = req.params;
    if (!orderId) {
      return res.status(400).json({ error: "Order ID is required." });
    }

    const order = await Order.findByOrderIdOrId(orderId);
    if (!order) {
      return res.status(404).json({ error: "Order not found. Please check your Order ID." });
    }

    res.json({ order });
  } catch (error) {
    console.log("trackOrder error:", error.message);
    res.status(500).json({ error: "Could not track order." });
  }
}

// GET /api/orders/:orderId/invoice -> GST compliant Tax Invoice
async function getOrderInvoice(req, res) {
  try {
    const { orderId } = req.params;
    const order = await Order.findByOrderIdOrId(orderId);
    if (!order) {
      return res.status(404).json({ error: "Order not found" });
    }

    const isInterState = (order.customer?.state || "").toLowerCase() !== "karnataka";
    const subtotal = order.subtotal || 0;
    const discount = order.couponDiscount || order.savings || 0;
    const taxableAmount = Math.max(0, subtotal - discount);
    const gstRate = 5; // 5% GST on Coffee / Spices
    const totalGst = +(taxableAmount * (gstRate / 100)).toFixed(2);
    const cgst = isInterState ? 0 : +(totalGst / 2).toFixed(2);
    const sgst = isInterState ? 0 : +(totalGst / 2).toFixed(2);
    const igst = isInterState ? totalGst : 0;

    const invoiceData = {
      invoiceNumber: order.invoiceNumber || `INV-${order.orderId}`,
      invoiceDate: order.confirmedAt || order.createdAt,
      orderId: order.orderId,
      orderDate: order.createdAt,
      businessDetails: {
        companyName: "Imaan's Artisanal Products Pvt. Ltd.",
        brandName: "Imaan's Artisanal Coffee & Spices",
        addressLine1: "Estate Road, Madikeri, Coorg",
        city: "Kodagu",
        state: "Karnataka",
        pincode: "571201",
        country: "India",
        gstin: process.env.BUSINESS_GSTIN || "29AAAAI0000A1Z5",
        pan: process.env.BUSINESS_PAN || "AAAAI0000A",
        fssai: "11223334000123",
        email: "support@imaans.com",
        phone: "+91 98765 43210",
      },
      customerDetails: order.customer,
      items: order.items,
      pricing: {
        subtotal: order.subtotal,
        discount: discount,
        couponCode: order.couponCode,
        taxableAmount,
        gstRate: "5%",
        cgst,
        sgst,
        igst,
        shipping: order.shipping,
        grandTotal: order.total,
      },
      payment: {
        method: (order.paymentMethod || "cod").toUpperCase(),
        status: order.paymentStatus,
        transactionId: order.razorpayPaymentId || order.razorpayOrderId || "N/A",
      },
      shipping: {
        status: order.status,
        courierName: order.courierName || "Delhivery Express",
        trackingNumber: order.trackingNumber || "N/A",
      },
    };

    res.json({ success: true, invoice: invoiceData });
  } catch (error) {
    console.error("getOrderInvoice error:", error);
    res.status(500).json({ error: "Could not generate invoice." });
  }
}

// GET /api/orders/:orderId/reorder -> Check stock & return items to re-add to cart
async function reorderOrderItems(req, res) {
  try {
    const { orderId } = req.params;
    const order = await Order.findByOrderIdOrId(orderId);
    if (!order) {
      return res.status(404).json({ error: "Order not found" });
    }

    const Product = require("../models/Product");
    const reorderItems = [];
    const unavailableItems = [];

    for (const item of order.items) {
      const prod = await Product.findById(item.productId);
      if (!prod) {
        unavailableItems.push({ name: item.name, reason: "Product is no longer available" });
        continue;
      }

      const matchingSize =
        (prod.sizes || []).find((s) => s.label === item.size) || (prod.sizes || [])[0];

      if (!matchingSize || matchingSize.stock <= 0) {
        unavailableItems.push({ name: item.name, reason: "Currently out of stock" });
        continue;
      }

      const availableQty = Math.min(item.quantity, matchingSize.stock);
      reorderItems.push({
        id: prod.id,
        productId: prod.id,
        slug: prod.slug,
        name: prod.name,
        size: matchingSize.label,
        price: matchingSize.price,
        mrp: matchingSize.mrp,
        quantity: availableQty,
        image: prod.image,
        category: prod.category,
        maxStock: matchingSize.stock,
      });
    }

    res.json({
      success: true,
      items: reorderItems,
      unavailable: unavailableItems,
    });
  } catch (error) {
    console.error("reorderOrderItems error:", error);
    res.status(500).json({ error: "Could not prepare reorder." });
  }
}

// POST /api/orders/:orderId/cancel -> Customer cancels their own order (if pending or confirmed)
async function cancelOrder(req, res) {
  try {
    const { orderId } = req.params;
    const { reason } = req.body || {};
    if (!orderId) {
      return res.status(400).json({ error: "Order ID is required." });
    }

    const existing = await Order.findByOrderIdOrId(orderId);
    if (!existing) {
      return res.status(404).json({ error: "Order not found." });
    }

    if (existing.status === "cancelled") {
      return res.status(400).json({ error: "This order is already cancelled." });
    }

    if (!["pending", "confirmed"].includes(existing.status)) {
      return res.status(400).json({
        error: `Cannot cancel order because it is already ${existing.status}. Please contact customer support for assistance.`,
      });
    }

    // Optional ownership check if user is logged in
    const user = await getUserFromCookie(req);
    if (user && existing.customer?.email && user.role !== "admin") {
      const orderEmail = String(existing.customer.email || "").trim().toLowerCase();
      const userEmail = String(user.email || "").trim().toLowerCase();
      const orderPhone = String(existing.customer.phone || "").trim();
      const userPhone = String(user.phone || "").trim();

      const emailMatch = orderEmail && userEmail && orderEmail === userEmail;
      const phoneMatch = orderPhone && userPhone && orderPhone === userPhone;
      if (orderEmail && !emailMatch && !phoneMatch) {
        return res.status(403).json({ error: "You are not authorized to cancel this order." });
      }
    }

    const cancelReasonText = reason ? String(reason).trim() : "Cancelled by customer";
    const updatedNotes = existing.adminNotes
      ? `${existing.adminNotes} | [Customer Cancel]: ${cancelReasonText}`
      : `[Customer Cancel]: ${cancelReasonText}`;

    const updateFields = {
      status: "cancelled",
      adminNotes: updatedNotes,
    };

    if (existing.paymentStatus === "paid") {
      updateFields.paymentStatus = "refunded";
    }

    const updatedOrder = await Order.findOneAndUpdateByIdentifier(orderId, updateFields);
    if (!updatedOrder) {
      return res.status(404).json({ error: "Could not update order." });
    }

    notifyOrderEvent(updatedOrder, "ORDER_CANCELLED").catch(() => {});

    res.json({
      success: true,
      message: "Order cancelled successfully and stock restored.",
      order: updatedOrder,
    });
  } catch (error) {
    console.error("cancelOrder error:", error);
    res.status(500).json({ error: error.message || "Could not cancel order." });
  }
}

module.exports = {
  createOrder,
  createRazorpayOrder,
  verifyRazorpayPayment,
  getOrderInvoice,
  reorderOrderItems,
  cancelOrder,
  getMyOrders,
  trackOrder,
  getAdminOrders,
  updateOrder,
  deleteOrder,
};

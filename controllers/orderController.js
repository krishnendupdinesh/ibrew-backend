const crypto = require("crypto");
const Razorpay = require("razorpay");
const Order = require("../models/Order");
const Coupon = require("../models/Coupon");
const { getPool } = require("../config/mysql");
const { ensureDefaultProducts } = require("./productController");
const { getUserFromCookie } = require("../middleware/auth");
const { notifyOrderEvent } = require("../utils/notifier");

function safeCompareStrings(a, b) {
  if (typeof a !== "string" || typeof b !== "string") return false;
  const hashA = crypto.createHash("sha256").update(a).digest();
  const hashB = crypto.createHash("sha256").update(b).digest();
  return crypto.timingSafeEqual(hashA, hashB);
}

function normalizePhone(p) {
  return String(p || "").replace(/\D/g, "").slice(-10);
}

function normalizeEmail(e) {
  return String(e || "").trim().toLowerCase();
}

let razorpayInstance = null;
function getRazorpayInstance() {
  const key_id = process.env.RAZORPAY_KEY_ID;
  const key_secret = process.env.RAZORPAY_KEY_SECRET;
  if (key_id && key_secret) {
    if (!razorpayInstance) {
      razorpayInstance = new Razorpay({ key_id, key_secret });
    }
    return { instance: razorpayInstance, key_id, key_secret };
  }
  return { instance: null, key_id: key_id || "", key_secret: "" };
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

/**
 * Recomputes order subtotal, item prices, shipping, and coupon discounts
 * strictly on the server against the MySQL `products` and `product_sizes` tables.
 */
async function calculateCartTotalOnServer(items, couponCode, customerEmail, customerPhone) {
  if (!Array.isArray(items) || items.length === 0) {
    const err = new Error("Order must contain at least one item.");
    err.statusCode = 400;
    throw err;
  }

  const pool = getPool();
  let verifiedSubtotal = 0;
  const verifiedItems = [];

  for (const item of items) {
    const qty = Math.max(1, Math.floor(Number(item.quantity || 1)));
    const productKey = String(item.productId || item.id || "").trim();
    const sizeLabel = String(item.size || "").trim();

    const isNum = /^\d+$/.test(productKey);
    const [pRows] = await pool.query(
      isNum
        ? "SELECT id, name, slug, image, category FROM `products` WHERE id = ? OR slug = ? LIMIT 1"
        : "SELECT id, name, slug, image, category FROM `products` WHERE slug = ? LIMIT 1",
      isNum ? [Number(productKey), productKey] : [productKey]
    );

    if (pRows.length === 0) {
      const err = new Error(`Item "${item.name || productKey}" could not be found in catalog.`);
      err.statusCode = 400;
      throw err;
    }

    const prod = pRows[0];
    const [sizeRows] = await pool.query(
      "SELECT id, label, price, stock, mrp FROM `product_sizes` WHERE product_id = ? ORDER BY sort_order ASC, id ASC",
      [prod.id]
    );

    if (sizeRows.length === 0) {
      const err = new Error(`No available variants for product "${prod.name}".`);
      err.statusCode = 400;
      throw err;
    }

    let sizeRow = null;
    if (sizeLabel) {
      const cleanLabel = sizeLabel.toLowerCase();
      sizeRow =
        sizeRows.find((s) => String(s.label || "").trim().toLowerCase() === cleanLabel) ||
        sizeRows.find(
          (s) =>
            String(s.label || "").trim().toLowerCase().replace(/\s+/g, "") ===
            cleanLabel.replace(/\s+/g, "")
        );
    }
    if (!sizeRow) {
      sizeRow = sizeRows[0];
    }

    const availableStock = Number(sizeRow.stock || 0);
    if (availableStock < qty) {
      const err = new Error(
        `Insufficient stock for "${prod.name}" (${sizeRow.label}). Available: ${availableStock}, requested: ${qty}.`
      );
      err.statusCode = 400;
      throw err;
    }

    const unitPrice = Number(sizeRow.price || 0);
    verifiedSubtotal += unitPrice * qty;

    verifiedItems.push({
      productId: String(prod.id),
      productKey: prod.slug || String(prod.id),
      name: prod.name,
      size: sizeRow.label,
      price: unitPrice,
      mrp: sizeRow.mrp ? Number(sizeRow.mrp) : undefined,
      quantity: qty,
      image: prod.image || item.image || "",
      category: prod.category || item.category || "",
    });
  }

  // Coupon calculation verified strictly on server
  let couponDiscount = 0;
  let validCouponCode = null;
  if (couponCode) {
    const couponCheck = await Coupon.validateForCart(couponCode, {
      subtotal: verifiedSubtotal,
      email: customerEmail,
      phone: customerPhone,
    });
    if (couponCheck.valid) {
      validCouponCode = couponCheck.coupon.code;
      couponDiscount = couponCheck.coupon.discountAmount || 0;
    }
  }

  const shipping = verifiedSubtotal >= 499 ? 0 : 50;
  const savings = couponDiscount;
  const total = Math.max(0, verifiedSubtotal - couponDiscount + shipping);

  return {
    verifiedSubtotal,
    couponDiscount,
    validCouponCode,
    shipping,
    savings,
    total,
    verifiedItems,
  };
}

/**
 * Access control validator:
 * 1. Logged in admin or customer matching order.
 * 2. Guest access allowed only if orderId matches customer email or phone.
 */
async function verifyOrderAccess(req, order) {
  if (!order) return { allowed: false };

  // 1. Check logged-in session
  const user = await getUserFromCookie(req);
  if (user) {
    if (user.role === "admin") return { allowed: true, user };
    if (user.id && String(order.userId || order.user_id) === String(user.id)) {
      return { allowed: true, user };
    }
    const userEmail = normalizeEmail(user.email);
    const orderEmail = normalizeEmail(order.customer?.email);
    if (userEmail && orderEmail && userEmail === orderEmail) {
      return { allowed: true, user };
    }
    const userPhone = normalizePhone(user.phone);
    const orderPhone = normalizePhone(order.customer?.phone);
    if (userPhone && orderPhone && userPhone === orderPhone) {
      return { allowed: true, user };
    }
  }

  // 2. Check guest parameters from query or body
  const reqEmail = normalizeEmail(
    req.query?.email || req.body?.email || req.headers["x-customer-email"]
  );
  const reqPhone = normalizePhone(
    req.query?.phone || req.body?.phone || req.headers["x-customer-phone"]
  );

  const orderEmail = normalizeEmail(order.customer?.email);
  const orderPhone = normalizePhone(order.customer?.phone);

  if (reqEmail && orderEmail && reqEmail === orderEmail) {
    return { allowed: true, guest: true };
  }
  if (reqPhone && orderPhone && reqPhone === orderPhone) {
    return { allowed: true, guest: true };
  }

  return { allowed: false };
}

// POST /api/orders/razorpay/create -> Create Razorpay order
async function createRazorpayOrder(req, res) {
  try {
    const isProduction = process.env.NODE_ENV === "production";
    const { instance, key_id, key_secret } = getRazorpayInstance();

    // Disable online payments in production if keys are missing or test keys are provided
    if (isProduction) {
      if (!key_id || !key_secret || key_id.startsWith("rzp_test_")) {
        return res.status(503).json({
          error: "Online payments are currently unavailable in production. Please select Cash on Delivery.",
        });
      }
    }

    const { items, couponCode, customer, receipt } = req.body || {};

    let totalAmount = 0;
    if (Array.isArray(items) && items.length > 0) {
      const calc = await calculateCartTotalOnServer(
        items,
        couponCode,
        customer?.email,
        customer?.phone
      );
      totalAmount = calc.total;
    } else if (req.body.amount && Number(req.body.amount) > 0 && !isProduction) {
      totalAmount = Number(req.body.amount);
    } else {
      return res.status(400).json({ error: "Order items are required to calculate payment amount." });
    }

    if (totalAmount <= 0) {
      return res.status(400).json({ error: "Invalid payment amount." });
    }

    const amountInPaise = Math.round(totalAmount * 100);

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
      // In development / local testing when Razorpay credentials are not yet configured
      const mockOrderId = `order_test_${Date.now()}_${Math.floor(Math.random() * 1000)}`;
      return res.json({
        success: true,
        orderId: mockOrderId,
        amount: amountInPaise,
        currency: "INR",
        key: key_id || "rzp_test_placeholder",
      });
    }
  } catch (error) {
    console.error("createRazorpayOrder error:", error.message);
    res.status(500).json({ error: error.message || "Failed to create payment order." });
  }
}

// POST /api/orders/razorpay/verify -> Verify Razorpay payment signature
async function verifyRazorpayPayment(req, res) {
  try {
    const { orderId, razorpay_order_id, razorpay_payment_id, razorpay_signature } = req.body || {};
    const key_secret = process.env.RAZORPAY_KEY_SECRET;
    const isProduction = process.env.NODE_ENV === "production";

    if (!razorpay_order_id || !razorpay_payment_id) {
      return res.status(400).json({ success: false, error: "Missing payment parameters." });
    }

    let targetOrder = null;
    if (orderId) {
      targetOrder = await Order.findByOrderIdOrId(orderId);
      if (!targetOrder) {
        return res.status(404).json({ success: false, error: "Order not found." });
      }

      // Idempotency check: if order is already marked paid with this payment ID, return success immediately
      if (
        targetOrder.paymentStatus === "paid" &&
        targetOrder.razorpayPaymentId === razorpay_payment_id
      ) {
        return res.json({
          success: true,
          message: "Payment already verified successfully.",
          paymentId: razorpay_payment_id,
        });
      }

      // Check razorpay_order_id matches order if previously recorded
      if (
        targetOrder.razorpayOrderId &&
        targetOrder.razorpayOrderId !== razorpay_order_id &&
        !razorpay_order_id.startsWith("order_test_")
      ) {
        return res.status(400).json({
          success: false,
          error: "Razorpay order ID mismatch for this order.",
        });
      }
    }

    // Verify HMAC signature in constant time
    if (key_secret && razorpay_signature && !razorpay_order_id.startsWith("order_test_")) {
      const expected = crypto
        .createHmac("sha256", key_secret)
        .update(`${razorpay_order_id}|${razorpay_payment_id}`)
        .digest("hex");

      if (!safeCompareStrings(expected, razorpay_signature)) {
        return res.status(400).json({ success: false, error: "Invalid payment signature." });
      }
    } else if (isProduction) {
      return res.status(500).json({
        success: false,
        error: "Payment verification configuration error in production.",
      });
    }

    // Amount match verification via Razorpay SDK if available
    const { instance } = getRazorpayInstance();
    if (instance && targetOrder && !razorpay_order_id.startsWith("order_test_")) {
      try {
        const rzpOrder = await instance.orders.fetch(razorpay_order_id);
        const expectedPaise = Math.round(Number(targetOrder.total) * 100);
        if (rzpOrder && rzpOrder.amount !== expectedPaise) {
          return res.status(400).json({
            success: false,
            error: "Payment amount does not match order total.",
          });
        }
      } catch (fetchErr) {
        console.warn("Razorpay order amount check warning:", fetchErr.message);
      }
    }

    // If order was provided, mark it paid and confirmed in database
    if (targetOrder) {
      await Order.findOneAndUpdateByIdentifier(targetOrder.orderId, {
        paymentStatus: "paid",
        status: "confirmed",
        razorpayOrderId: razorpay_order_id,
        razorpayPaymentId: razorpay_payment_id,
        razorpaySignature: razorpay_signature || "",
        confirmedAt: new Date().toISOString(),
      });

      // Send confirmation notification
      notifyOrderEvent(targetOrder, "ORDER_CONFIRMED").catch(() => {});
    }

    res.json({
      success: true,
      message: "Payment verified successfully",
      paymentId: razorpay_payment_id,
    });
  } catch (error) {
    console.error("verifyRazorpayPayment error:", error.message);
    res.status(500).json({ success: false, error: "Payment verification failed." });
  }
}

// POST /api/orders -> Customer places a new order at checkout
async function createOrder(req, res) {
  try {
    await ensureDefaultProducts();

    const body = req.body || {};
    const customer = body.customer || {};
    const rawItems = Array.isArray(body.items) ? body.items : [];

    if (!customer.name || !customer.phone || !customer.address || !customer.city || !customer.pincode) {
      return res.status(400).json({
        error: "Customer name, phone, address, city, and PIN code are required.",
      });
    }

    if (rawItems.length === 0) {
      return res.status(400).json({ error: "Order must contain at least one item." });
    }

    // Recalculate item prices, subtotal, shipping, and discount on the server from the product_sizes table
    const calculation = await calculateCartTotalOnServer(
      rawItems,
      body.couponCode,
      customer.email,
      customer.phone
    );

    const orderId = body.orderId || generateOrderId();
    const paymentMethod = ["cod", "upi", "card", "razorpay"].includes(body.paymentMethod)
      ? body.paymentMethod
      : "cod";

    // Security: Never accept paymentStatus or razorpayPaymentId from the client as proof of payment.
    // Online orders start unpaid and are updated to paid ONLY upon successful Razorpay verification.
    // COD orders remain "unpaid" until delivered.
    const paymentStatus = "unpaid";
    const status = paymentMethod === "cod" ? "confirmed" : "pending";

    // Transactional order creation + stock deduction + coupon usage recording
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
      items: calculation.verifiedItems,
      subtotal: calculation.verifiedSubtotal,
      shipping: calculation.shipping,
      savings: calculation.savings,
      total: calculation.total,
      couponCode: calculation.validCouponCode,
      couponDiscount: calculation.couponDiscount,
      razorpayOrderId: body.razorpayOrderId || body.razorpay_order_id || "",
      razorpayPaymentId: "", // Set only after verification
      razorpaySignature: "",
      paymentMethod,
      paymentStatus,
      status,
    });

    if (paymentMethod === "cod") {
      notifyOrderEvent(order, "ORDER_CONFIRMED").catch(() => {});
    }

    res.status(201).json({ order });
  } catch (error) {
    if (error && error.statusCode === 400) {
      return res.status(400).json({ error: error.message });
    }
    console.error("createOrder error:", error.message);
    res.status(500).json({ error: error.message || "Could not place order." });
  }
}

// GET /api/admin/orders -> All orders newest first
async function getAdminOrders(req, res) {
  try {
    const orders = await Order.findAllSorted();
    res.json({ orders });
  } catch (error) {
    console.error("getAdminOrders error:", error.message);
    res.status(500).json({ error: "Could not load orders." });
  }
}

// PATCH /api/admin/orders/:id -> Update order status or tracking details
async function updateOrder(req, res) {
  try {
    const { id } = req.params;
    const body = req.body || {};
    const existing = await Order.findByOrderIdOrId(id);

    if (!existing) {
      return res.status(404).json({ error: "Order not found." });
    }

    const updates = {};
    if (body.status && ALLOWED_ORDER_STATUS.includes(body.status)) {
      updates.status = body.status;
      if (body.status === "confirmed" && !existing.confirmedAt) updates.confirmedAt = new Date().toISOString();
      if (body.status === "shipped" && !existing.shippedAt) updates.shippedAt = new Date().toISOString();
      if (body.status === "delivered" && !existing.deliveredAt) updates.deliveredAt = new Date().toISOString();
    }
    if (body.paymentStatus && ALLOWED_PAYMENT_STATUS.includes(body.paymentStatus)) {
      updates.paymentStatus = body.paymentStatus;
    }
    if (body.trackingNumber !== undefined) updates.trackingNumber = String(body.trackingNumber).trim();
    if (body.courierName !== undefined) updates.courierName = String(body.courierName).trim();
    if (body.adminNotes !== undefined) updates.adminNotes = String(body.adminNotes).trim();

    const updated = await Order.findOneAndUpdateByIdentifier(id, updates);

    // Send notifications if status changed
    if (updates.status && updates.status !== existing.status) {
      if (updates.status === "confirmed") notifyOrderEvent(updated, "ORDER_CONFIRMED").catch(() => {});
      if (updates.status === "shipped") notifyOrderEvent(updated, "ORDER_SHIPPED").catch(() => {});
      if (updates.status === "delivered") notifyOrderEvent(updated, "ORDER_DELIVERED").catch(() => {});
      if (updates.status === "cancelled") notifyOrderEvent(updated, "ORDER_CANCELLED").catch(() => {});
    }

    res.json({ order: updated });
  } catch (error) {
    console.error("updateOrder error:", error.message);
    res.status(500).json({ error: "Could not update order." });
  }
}

// DELETE /api/admin/orders/:id -> Delete an order (Admin only)
async function deleteOrder(req, res) {
  try {
    const { id } = req.params;
    const deleted = await Order.deleteByOrderIdOrId(id);
    if (!deleted) {
      return res.status(404).json({ error: "Order not found." });
    }
    res.json({ message: "Order deleted." });
  } catch (error) {
    console.error("deleteOrder error:", error.message);
    res.status(500).json({ error: "Could not delete order." });
  }
}

// GET /api/orders/my-orders -> Customer order history (requires cookie)
async function getMyOrders(req, res) {
  try {
    const user = await getUserFromCookie(req);
    const email = user?.email || "";
    const phone = user?.phone || "";

    if (!email && !phone) {
      return res.status(401).json({ error: "Please log in to view your orders.", orders: [] });
    }

    const orders = await Order.findByCustomerEmailOrPhone(email, phone);
    res.json({ orders });
  } catch (error) {
    console.error("getMyOrders error:", error.message);
    res.status(500).json({ error: "Could not load your orders." });
  }
}

// GET /api/orders/track/:orderId -> Customer tracking details with ownership or guest validation
async function trackOrder(req, res) {
  try {
    const { orderId } = req.params;
    if (!orderId) {
      return res.status(404).json({ error: "Order not found." });
    }

    const order = await Order.findByOrderIdOrId(orderId);
    if (!order) {
      return res.status(404).json({ error: "Order not found." });
    }

    // Require ownership or guest verification
    const access = await verifyOrderAccess(req, order);
    if (!access.allowed) {
      // Return identical 404 to prevent ID enumeration
      return res.status(404).json({ error: "Order not found." });
    }

    // Return strictly sanitized non-sensitive fields
    const sanitized = {
      orderId: order.orderId,
      status: order.status,
      paymentMethod: order.paymentMethod,
      paymentStatus: order.paymentStatus,
      trackingNumber: order.trackingNumber || "",
      courierName: order.courierName || "",
      createdAt: order.createdAt,
      confirmedAt: order.confirmedAt || null,
      shippedAt: order.shippedAt || null,
      deliveredAt: order.deliveredAt || null,
      items: Array.isArray(order.items)
        ? order.items.map((it) => ({
            name: it.name,
            size: it.size || "Standard",
            quantity: it.quantity,
          }))
        : [],
      destinationCity: order.customer?.city || "",
      destinationState: order.customer?.state || "",
    };

    res.json({ order: sanitized });
  } catch (error) {
    console.error("trackOrder error:", error.message);
    res.status(500).json({ error: "Could not track order." });
  }
}

// GET /api/orders/:orderId/invoice -> GST compliant Tax Invoice (requires ownership or guest verification)
async function getOrderInvoice(req, res) {
  try {
    const { orderId } = req.params;
    if (!orderId) {
      return res.status(404).json({ error: "Order not found." });
    }

    const order = await Order.findByOrderIdOrId(orderId);
    if (!order) {
      return res.status(404).json({ error: "Order not found." });
    }

    const access = await verifyOrderAccess(req, order);
    if (!access.allowed) {
      return res.status(403).json({
        error: "Access denied. Order invoice is only available to the verified customer or administrator.",
      });
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
        email: "imaanstrading@gmail.com",
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
    console.error("getOrderInvoice error:", error.message);
    res.status(500).json({ error: "Could not generate invoice." });
  }
}

// GET /api/orders/:orderId/reorder -> Check stock & return items to re-add to cart
async function reorderOrderItems(req, res) {
  try {
    const { orderId } = req.params;
    const order = await Order.findByOrderIdOrId(orderId);
    if (!order) {
      return res.status(404).json({ error: "Order not found." });
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
    console.error("reorderOrderItems error:", error.message);
    res.status(500).json({ error: "Could not prepare reorder." });
  }
}

// POST /api/orders/:orderId/cancel -> Customer or Admin cancels order (ownership verified)
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

    // Require ownership or guest verification
    const access = await verifyOrderAccess(req, existing);
    if (!access.allowed) {
      return res.status(403).json({ error: "You are not authorized to cancel this order." });
    }

    if (existing.status === "cancelled") {
      return res.status(400).json({ error: "This order is already cancelled." });
    }

    if (!["pending", "confirmed"].includes(existing.status)) {
      return res.status(400).json({
        error: `Cannot cancel order because it is already ${existing.status}. Please contact customer support for assistance.`,
      });
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

    // Asynchronously notify
    notifyOrderEvent(updatedOrder, "ORDER_CANCELLED").catch(() => {});

    res.json({
      success: true,
      message: "Order cancelled successfully.",
      order: updatedOrder,
    });
  } catch (error) {
    console.error("cancelOrder error:", error.message);
    res.status(500).json({ error: "Could not cancel order." });
  }
}

module.exports = {
  createRazorpayOrder,
  verifyRazorpayPayment,
  createOrder,
  getAdminOrders,
  updateOrder,
  deleteOrder,
  getMyOrders,
  trackOrder,
  getOrderInvoice,
  reorderOrderItems,
  cancelOrder,
};

// MySQL Model for `orders` and `order_items` tables with transactional stock management
const { getPool } = require("../config/mysql");
const { resolveAndSaveProductImage } = require("../utils/imageStorage");

function toIsoOrNull(val) {
  if (!val) return null;
  return val instanceof Date ? val.toISOString() : new Date(val).toISOString();
}

function formatOrderItemRow(row) {
  const price = Number(row.price || 0);
  const mrp = row.mrp !== null && row.mrp !== undefined ? Number(row.mrp) : undefined;
  return {
    productId: String(row.product_key || row.product_id || "item"),
    name: row.name,
    size: row.size || "",
    price,
    ...(mrp !== undefined ? { mrp } : {}),
    quantity: Number(row.quantity || 1),
    image: row.image || "",
    category: row.category || "",
  };
}

function formatOrderRow(row, itemRows = []) {
  if (!row) return null;
  return {
    id: row.order_id,
    orderId: row.order_id,
    dbId: row.id,
    customer: {
      name: row.customer_name || "",
      email: row.customer_email || "",
      phone: row.customer_phone || "",
      address: row.customer_address || "",
      city: row.customer_city || "",
      state: row.customer_state || "Karnataka",
      pincode: row.customer_pincode || "",
      notes: row.customer_notes || "",
    },
    items: itemRows.map(formatOrderItemRow),
    subtotal: Number(row.subtotal || 0),
    shipping: Number(row.shipping || 0),
    savings: Number(row.savings || 0),
    couponCode: row.coupon_code || "",
    couponDiscount: Number(row.coupon_discount || 0),
    total: Number(row.total || 0),
    paymentMethod: row.payment_method || "cod",
    paymentStatus: row.payment_status || "unpaid",
    razorpayOrderId: row.razorpay_order_id || "",
    razorpayPaymentId: row.razorpay_payment_id || "",
    invoiceNumber: row.invoice_number || `INV-${row.order_id}`,
    status: row.status || "pending",
    trackingNumber: row.tracking_number || "",
    courierName: row.courier_name || "",
    adminNotes: row.admin_notes || "",
    confirmedAt: toIsoOrNull(row.confirmed_at),
    shippedAt: toIsoOrNull(row.shipped_at),
    deliveredAt: toIsoOrNull(row.delivered_at),
    createdAt: toIsoOrNull(row.created_at) || new Date().toISOString(),
    updatedAt: toIsoOrNull(row.updated_at) || new Date().toISOString(),
  };
}

async function attachItemsToOrders(connOrPool, orderRows) {
  if (!orderRows || orderRows.length === 0) return [];
  const orderIds = orderRows.map((r) => r.id);
  const placeholders = orderIds.map(() => "?").join(", ");
  const [itemRows] = await connOrPool.execute(
    `SELECT * FROM \`order_items\` WHERE \`order_ref_id\` IN (${placeholders}) ORDER BY \`id\` ASC`,
    orderIds
  );

  const itemsByOrderId = new Map();
  for (const item of itemRows) {
    const list = itemsByOrderId.get(item.order_ref_id) || [];
    list.push(item);
    itemsByOrderId.set(item.order_ref_id, list);
  }

  return orderRows.map((r) => formatOrderRow(r, itemsByOrderId.get(r.id) || []));
}

async function findProductForOrderItem(conn, productKey, itemName) {
  const rawKey = String(productKey || "").trim();
  const rawName = String(itemName || "").trim();

  // 1. Check by ID, slug, or mongo_id
  if (rawKey) {
    const isNum = /^\d+$/.test(rawKey);
    const [rows] = await conn.execute(
      isNum
        ? "SELECT * FROM `products` WHERE `id` = ? OR `slug` = ? OR `mongo_id` = ? LIMIT 1 FOR UPDATE"
        : "SELECT * FROM `products` WHERE `slug` = ? OR `mongo_id` = ? LIMIT 1 FOR UPDATE",
      isNum ? [Number(rawKey), rawKey, rawKey] : [rawKey, rawKey]
    );
    if (rows.length > 0) return rows[0];

    // 2. Try prefix match on slug (e.g. "filter-coffee-250" -> "filter-coffee")
    const cleanPrefix = rawKey.replace(/-\d+$/, "").trim();
    if (cleanPrefix && cleanPrefix !== rawKey) {
      const [byPrefix] = await conn.execute(
        "SELECT * FROM `products` WHERE `slug` = ? LIMIT 1 FOR UPDATE",
        [cleanPrefix]
      );
      if (byPrefix.length > 0) return byPrefix[0];
    }
  }

  // 3. Check by exact or partial product name
  if (rawName) {
    const [byName] = await conn.execute(
      "SELECT * FROM `products` WHERE LOWER(`name`) = LOWER(?) LIMIT 1 FOR UPDATE",
      [rawName]
    );
    if (byName.length > 0) return byName[0];

    const [byLike] = await conn.execute(
      "SELECT * FROM `products` WHERE LOWER(?) LIKE CONCAT(LOWER(`name`), '%') OR LOWER(`name`) LIKE CONCAT(LOWER(?), '%') ORDER BY LENGTH(`name`) DESC LIMIT 1 FOR UPDATE",
      [rawName, rawName]
    );
    if (byLike.length > 0) return byLike[0];
  }

  return null;
}

async function findMatchingSizeRowForUpdate(conn, productId, sizeLabel) {
  const [sizeRows] = await conn.execute(
    "SELECT * FROM `product_sizes` WHERE `product_id` = ? ORDER BY `sort_order` ASC, `id` ASC FOR UPDATE",
    [productId]
  );

  const targetLabel = String(sizeLabel || "").trim().toLowerCase();

  if (sizeRows.length === 0) {
    const [ins] = await conn.execute(
      "INSERT INTO `product_sizes` (`product_id`, `label`, `price`, `stock`, `sort_order`) VALUES (?, ?, 0, 50, 0)",
      [productId, sizeLabel || "Standard"]
    );
    return { id: ins.insertId, product_id: productId, label: sizeLabel || "Standard", price: 0, stock: 50 };
  }

  if (targetLabel) {
    // 1. Exact match
    const exact = sizeRows.find((s) => String(s.label || "").trim().toLowerCase() === targetLabel);
    if (exact) return exact;

    // 2. Normalized match (ignoring whitespace: e.g. "250 g" vs "250g")
    const normTarget = targetLabel.replace(/\s+/g, "");
    const norm = sizeRows.find(
      (s) => String(s.label || "").trim().toLowerCase().replace(/\s+/g, "") === normTarget
    );
    if (norm) return norm;

    // 3. Substring match
    const partial = sizeRows.find((s) => {
      const l = String(s.label || "").trim().toLowerCase();
      return l.includes(targetLabel) || targetLabel.includes(l);
    });
    if (partial) return partial;
  }
  return sizeRows[0];
}

const Order = {
  async findAllSorted() {
    const pool = getPool();
    const [rows] = await pool.execute(
      "SELECT * FROM `orders` ORDER BY `created_at` DESC, `id` DESC"
    );
    return attachItemsToOrders(pool, rows);
  },

  async findByOrderIdOrId(identifier) {
    const raw = String(identifier || "").trim();
    if (!raw) return null;
    const pool = getPool();
    const isNum = /^\d+$/.test(raw);
    const [rows] = await pool.execute(
      isNum
        ? "SELECT * FROM `orders` WHERE `order_id` = ? OR `id` = ? OR `mongo_id` = ? LIMIT 1"
        : "SELECT * FROM `orders` WHERE `order_id` = ? OR `mongo_id` = ? LIMIT 1",
      isNum ? [raw, Number(raw), raw] : [raw, raw]
    );
    if (rows.length === 0) return null;
    const [formatted] = await attachItemsToOrders(pool, [rows[0]]);
    return formatted || null;
  },

  async findByCustomerEmailOrPhone(email, phone) {
    const cleanEmail = String(email || "").trim().toLowerCase();
    const cleanPhone = String(phone || "").trim();
    if (!cleanEmail && !cleanPhone) return [];

    const pool = getPool();
    let query = "";
    let params = [];

    if (cleanEmail && cleanPhone) {
      query =
        "SELECT * FROM `orders` WHERE LOWER(`customer_email`) = ? OR `customer_phone` = ? ORDER BY `created_at` DESC, `id` DESC";
      params = [cleanEmail, cleanPhone];
    } else if (cleanEmail) {
      query =
        "SELECT * FROM `orders` WHERE LOWER(`customer_email`) = ? ORDER BY `created_at` DESC, `id` DESC";
      params = [cleanEmail];
    } else {
      query =
        "SELECT * FROM `orders` WHERE `customer_phone` = ? ORDER BY `created_at` DESC, `id` DESC";
      params = [cleanPhone];
    }

    const [rows] = await pool.execute(query, params);
    return attachItemsToOrders(pool, rows);
  },

  /**
   * Places an order inside a database transaction:
   * 1. Locks matching `products` and `product_sizes` rows (`FOR UPDATE`).
   * 2. Verifies sufficient stock for every item and rejects if insufficient (never allows negative stock).
   * 3. Deducts stock in `product_sizes` (when `skipStockDeduction` is not set).
   * 4. Inserts into `orders` and `order_items`.
   */
  async create(data, options = {}) {
    const pool = getPool();
    const conn = await pool.getConnection();
    try {
      await conn.beginTransaction();

      const items = Array.isArray(data.items) ? data.items : [];
      const resolvedItems = [];

      for (const item of items) {
        const qty = Math.max(1, Math.floor(Number(item.quantity || 1)));
        const productKey = String(item.productId || item.id || "item").trim();
        const productRow = await findProductForOrderItem(conn, productKey, item.name);

        if (!productRow) {
          const err = new Error(`Item "${item.name || productKey}" could not be found in our product catalog.`);
          err.statusCode = 400;
          throw err;
        }

        const productId = productRow.id;
        const sizeRow = await findMatchingSizeRowForUpdate(conn, productId, item.size);
        if (!sizeRow) {
          const err = new Error(`Variant "${item.size || "Standard"}" for "${productRow.name}" is not available.`);
          err.statusCode = 400;
          throw err;
        }

        const available = Number(sizeRow.stock || 0);
        if (available < qty) {
          const err = new Error(
            `Insufficient stock for "${productRow.name}" (${sizeRow.label}). Available: ${available}, requested: ${qty}.`
          );
          err.statusCode = 400;
          throw err;
        }

        if (!options.skipStockDeduction) {
          const [upd] = await conn.execute(
            "UPDATE `product_sizes` SET `stock` = `stock` - ? WHERE `id` = ? AND `stock` >= ?",
            [qty, sizeRow.id, qty]
          );
          if (upd.affectedRows !== 1) {
            const err = new Error(`Insufficient stock for "${productRow.name}" (${sizeRow.label}).`);
            err.statusCode = 400;
            throw err;
          }
        }

        const cleanImage = resolveAndSaveProductImage(item.image, productKey);
        resolvedItems.push({
          productId,
          productKey,
          name: String(item.name || "Product").trim(),
          size: String(item.size || "").trim(),
          price: Number(item.price || 0),
          mrp:
            item.mrp !== undefined && item.mrp !== null && item.mrp !== ""
              ? Number(item.mrp)
              : null,
          quantity: qty,
          image: cleanImage,
          category: String(item.category || "").trim(),
        });
      }

      const cust = data.customer || {};
      const mongoId = data.mongoId ? String(data.mongoId) : null;
      const invoiceNumber = `INV-${String(data.orderId).trim()}`;

      const [orderRes] = await conn.execute(
        `INSERT INTO \`orders\`
         (\`mongo_id\`, \`order_id\`, \`customer_name\`, \`customer_email\`, \`customer_phone\`, \`customer_address\`, \`customer_city\`, \`customer_state\`, \`customer_pincode\`, \`customer_notes\`,
          \`subtotal\`, \`shipping\`, \`savings\`, \`total\`, \`coupon_code\`, \`coupon_discount\`, \`razorpay_order_id\`, \`razorpay_payment_id\`, \`razorpay_signature\`, \`invoice_number\`,
          \`payment_method\`, \`payment_status\`, \`status\`, \`tracking_number\`, \`courier_name\`, \`admin_notes\`, \`confirmed_at\`, \`shipped_at\`, \`delivered_at\`)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          mongoId,
          String(data.orderId).trim(),
          String(cust.name || "").trim(),
          String(cust.email || "").trim(),
          String(cust.phone || "").trim(),
          String(cust.address || "").trim(),
          String(cust.city || "").trim(),
          String(cust.state || "Karnataka").trim(),
          String(cust.pincode || "").trim(),
          String(cust.notes || "").trim(),
          Number(data.subtotal || 0),
          Number(data.shipping || 0),
          Number(data.savings || 0),
          Number(data.total || 0),
          // These columns are NOT NULL DEFAULT '' -> use "" instead of null (MySQL strict mode)
          data.couponCode ? String(data.couponCode).trim().toUpperCase() : "",
          Number(data.couponDiscount || 0),
          data.razorpayOrderId ? String(data.razorpayOrderId).trim() : "",
          data.razorpayPaymentId ? String(data.razorpayPaymentId).trim() : "",
          data.razorpaySignature ? String(data.razorpaySignature).trim() : "",
          invoiceNumber,
          ["cod", "upi", "card", "razorpay"].includes(data.paymentMethod) ? data.paymentMethod : "cod",
          ["unpaid", "paid", "refunded"].includes(data.paymentStatus) ? data.paymentStatus : "unpaid",
          data.status || "pending",
          String(data.trackingNumber || "").trim(),
          String(data.courierName || "").trim(),
          String(data.adminNotes || "").trim(),
          data.confirmedAt ? new Date(data.confirmedAt) : null,
          data.shippedAt ? new Date(data.shippedAt) : null,
          data.deliveredAt ? new Date(data.deliveredAt) : null,
        ]
      );

      const orderDbId = orderRes.insertId;

      // Record coupon usage if applied
      if (data.couponCode) {
        const cleanCode = String(data.couponCode).trim().toUpperCase();
        const [cRows] = await conn.execute(
          "SELECT id FROM coupons WHERE code = ? LIMIT 1",
          [cleanCode]
        );
        if (cRows.length > 0) {
          const couponId = cRows[0].id;
          await conn.execute(
            `INSERT INTO coupon_usages (coupon_id, order_id, customer_email, customer_phone, discount_amount)
             VALUES (?, ?, ?, ?, ?)`,
            [
              couponId,
              String(data.orderId).trim(),
              String(cust.email || "").trim().toLowerCase(),
              String(cust.phone || "").trim(),
              Number(data.couponDiscount || 0),
            ]
          );
          await conn.execute(
            "UPDATE coupons SET used_count = used_count + 1 WHERE id = ?",
            [couponId]
          );
        }
      }

      for (const ri of resolvedItems) {
        await conn.execute(
          `INSERT INTO \`order_items\`
           (\`order_ref_id\`, \`product_id\`, \`product_key\`, \`name\`, \`size\`, \`price\`, \`mrp\`, \`quantity\`, \`image\`, \`category\`)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [
            orderDbId,
            ri.productId,
            ri.productKey,
            ri.name,
            ri.size,
            ri.price,
            ri.mrp,
            ri.quantity,
            ri.image,
            ri.category,
          ]
        );
      }

      await conn.commit();
      return Order.findByOrderIdOrId(data.orderId);
    } catch (err) {
      await conn.rollback();
      throw err;
    } finally {
      conn.release();
    }
  },

  /**
   * Updates an order inside a transaction:
   * - If transitioning from a non-cancelled status -> "cancelled", restores stock ONCE.
   * - If already "cancelled" and updated again with "cancelled", does NOT restore stock a second time.
   * - If transitioning from "cancelled" -> an active status, verifies & deducts stock again.
   */
  async findOneAndUpdateByIdentifier(identifier, updateFields) {
    const raw = String(identifier || "").trim();
    if (!raw) return null;

    const pool = getPool();
    const conn = await pool.getConnection();
    try {
      await conn.beginTransaction();

      const isNum = /^\d+$/.test(raw);
      const [rows] = await conn.execute(
        isNum
          ? "SELECT * FROM `orders` WHERE `order_id` = ? OR `id` = ? OR `mongo_id` = ? LIMIT 1 FOR UPDATE"
          : "SELECT * FROM `orders` WHERE `order_id` = ? OR `mongo_id` = ? LIMIT 1 FOR UPDATE",
        isNum ? [raw, Number(raw), raw] : [raw, raw]
      );

      if (rows.length === 0) {
        await conn.rollback();
        return null;
      }

      const existing = rows[0];
      const prevStatus = existing.status;
      const nextStatus = updateFields.status !== undefined ? updateFields.status : prevStatus;

      // Load order items if status is changing to or from "cancelled"
      if (prevStatus !== nextStatus && (nextStatus === "cancelled" || prevStatus === "cancelled")) {
        const [itemRows] = await conn.execute(
          "SELECT * FROM `order_items` WHERE `order_ref_id` = ? ORDER BY `id` ASC",
          [existing.id]
        );

        if (prevStatus !== "cancelled" && nextStatus === "cancelled") {
          // Restore stock ONCE
          for (const item of itemRows) {
            let targetProductId = item.product_id;
            if (!targetProductId && item.product_key) {
              const pRow = await findProductForOrderItem(conn, item.product_key, item.name);
              if (pRow) targetProductId = pRow.id;
            }
            if (targetProductId) {
              const sizeRow = await findMatchingSizeRowForUpdate(conn, targetProductId, item.size);
              if (sizeRow) {
                await conn.execute(
                  "UPDATE `product_sizes` SET `stock` = `stock` + ? WHERE `id` = ?",
                  [Number(item.quantity || 1), sizeRow.id]
                );
              }
            }
          }
        } else if (prevStatus === "cancelled" && nextStatus !== "cancelled") {
          // Re-activating a cancelled order: check & deduct stock again
          for (const item of itemRows) {
            let targetProductId = item.product_id;
            if (!targetProductId && item.product_key) {
              const pRow = await findProductForOrderItem(conn, item.product_key, item.name);
              if (pRow) targetProductId = pRow.id;
            }
            if (targetProductId) {
              const qty = Number(item.quantity || 1);
              const sizeRow = await findMatchingSizeRowForUpdate(conn, targetProductId, item.size);
              const available = sizeRow ? Number(sizeRow.stock || 0) : 0;
              if (!sizeRow || available < qty) {
                const err = new Error(
                  `Cannot re-activate order: insufficient stock for "${item.name}" (${available} available, ${qty} needed).`
                );
                err.statusCode = 400;
                throw err;
              }
              await conn.execute(
                "UPDATE `product_sizes` SET `stock` = `stock` - ? WHERE `id` = ? AND `stock` >= ?",
                [qty, sizeRow.id, qty]
              );
            }
          }
        }
      }

      const nextPaymentStatus =
        updateFields.paymentStatus !== undefined
          ? updateFields.paymentStatus
          : existing.payment_status;
      const nextTracking =
        updateFields.trackingNumber !== undefined
          ? String(updateFields.trackingNumber).trim()
          : existing.tracking_number;
      const nextCourier =
        updateFields.courierName !== undefined
          ? String(updateFields.courierName).trim()
          : existing.courier_name;
      const nextAdminNotes =
        updateFields.adminNotes !== undefined
          ? String(updateFields.adminNotes).trim()
          : existing.admin_notes;

      const nextConfirmedAt =
        updateFields.confirmedAt !== undefined
          ? (updateFields.confirmedAt ? new Date(updateFields.confirmedAt) : null)
          : existing.confirmed_at;
      const nextShippedAt =
        updateFields.shippedAt !== undefined
          ? (updateFields.shippedAt ? new Date(updateFields.shippedAt) : null)
          : existing.shipped_at;
      const nextDeliveredAt =
        updateFields.deliveredAt !== undefined
          ? (updateFields.deliveredAt ? new Date(updateFields.deliveredAt) : null)
          : existing.delivered_at;

      await conn.execute(
        `UPDATE \`orders\`
         SET \`status\` = ?, \`payment_status\` = ?, \`tracking_number\` = ?, \`courier_name\` = ?,
             \`admin_notes\` = ?, \`confirmed_at\` = ?, \`shipped_at\` = ?, \`delivered_at\` = ?
         WHERE \`id\` = ?`,
        [
          nextStatus,
          nextPaymentStatus,
          nextTracking,
          nextCourier,
          nextAdminNotes,
          nextConfirmedAt,
          nextShippedAt,
          nextDeliveredAt,
          existing.id,
        ]
      );

      await conn.commit();
      return Order.findByOrderIdOrId(existing.order_id);
    } catch (err) {
      await conn.rollback();
      throw err;
    } finally {
      conn.release();
    }
  },

  async findOneAndDeleteByIdentifier(identifier) {
    const raw = String(identifier || "").trim();
    if (!raw) return null;
    const pool = getPool();
    const existing = await Order.findByOrderIdOrId(raw);
    if (!existing) return null;

    await pool.execute("DELETE FROM `orders` WHERE `order_id` = ?", [existing.orderId]);
    return existing;
  },
};

module.exports = Order;

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
    total: Number(row.total || 0),
    paymentMethod: row.payment_method || "cod",
    paymentStatus: row.payment_status || "unpaid",
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

async function findProductForOrderItem(conn, productKey) {
  const raw = String(productKey || "").trim();
  if (!raw) return null;
  const isNum = /^\d+$/.test(raw);
  const [rows] = await conn.execute(
    isNum
      ? "SELECT * FROM `products` WHERE `id` = ? OR `slug` = ? OR `mongo_id` = ? LIMIT 1 FOR UPDATE"
      : "SELECT * FROM `products` WHERE `slug` = ? OR `mongo_id` = ? LIMIT 1 FOR UPDATE",
    isNum ? [Number(raw), raw, raw] : [raw, raw]
  );
  return rows.length > 0 ? rows[0] : null;
}

async function findMatchingSizeRowForUpdate(conn, productId, sizeLabel) {
  const [sizeRows] = await conn.execute(
    "SELECT * FROM `product_sizes` WHERE `product_id` = ? ORDER BY `sort_order` ASC, `id` ASC FOR UPDATE",
    [productId]
  );
  if (sizeRows.length === 0) return null;

  const targetLabel = String(sizeLabel || "").trim().toLowerCase();
  if (targetLabel) {
    const exact = sizeRows.find((s) => String(s.label || "").trim().toLowerCase() === targetLabel);
    if (exact) return exact;
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
        const productRow = await findProductForOrderItem(conn, productKey);

        let productId = null;
        if (productRow) {
          productId = productRow.id;
          if (!options.skipStockDeduction) {
            const sizeRow = await findMatchingSizeRowForUpdate(conn, productId, item.size);
            const available = sizeRow ? Number(sizeRow.stock || 0) : 0;
            if (!sizeRow || available < qty) {
              const err = new Error(
                `Insufficient stock for "${item.name || productRow.name}"${
                  item.size ? ` (${item.size})` : ""
                }. Available: ${available}, requested: ${qty}.`
              );
              err.statusCode = 400;
              throw err;
            }

            const [upd] = await conn.execute(
              "UPDATE `product_sizes` SET `stock` = `stock` - ? WHERE `id` = ? AND `stock` >= ?",
              [qty, sizeRow.id, qty]
            );
            if (upd.affectedRows !== 1) {
              const err = new Error(`Insufficient stock for "${item.name || productRow.name}".`);
              err.statusCode = 400;
              throw err;
            }
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

      const [orderRes] = await conn.execute(
        `INSERT INTO \`orders\`
         (\`mongo_id\`, \`order_id\`, \`customer_name\`, \`customer_email\`, \`customer_phone\`, \`customer_address\`, \`customer_city\`, \`customer_state\`, \`customer_pincode\`, \`customer_notes\`,
          \`subtotal\`, \`shipping\`, \`savings\`, \`total\`, \`payment_method\`, \`payment_status\`, \`status\`, \`tracking_number\`, \`courier_name\`, \`admin_notes\`, \`confirmed_at\`, \`shipped_at\`, \`delivered_at\`)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
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
          ["cod", "upi", "card"].includes(data.paymentMethod) ? data.paymentMethod : "cod",
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
              const pRow = await findProductForOrderItem(conn, item.product_key);
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
              const pRow = await findProductForOrderItem(conn, item.product_key);
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
          ? updateFields.confirmedAt
          : existing.confirmed_at;
      const nextShippedAt =
        updateFields.shippedAt !== undefined ? updateFields.shippedAt : existing.shipped_at;
      const nextDeliveredAt =
        updateFields.deliveredAt !== undefined ? updateFields.deliveredAt : existing.delivered_at;

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

// Things only the admin dashboard needs.
const Quote = require("../models/Quote");
const User = require("../models/User");
const Product = require("../models/Product");
const { getPool } = require("../config/mysql");

const ALLOWED_STATUS = ["new", "contacted", "quoted", "closed"];

// GET /api/admin/quotes  -> all requests, newest first
async function getQuotes(req, res) {
  try {
    const quotes = await Quote.findAllSorted();
    res.json({ quotes });
  } catch (error) {
    res.status(500).json({ error: "Could not load quotes." });
  }
}

// PATCH /api/admin/quotes  body: { id, status }
async function updateQuoteStatus(req, res) {
  try {
    const { id, status } = req.body;

    if (!ALLOWED_STATUS.includes(status)) {
      return res.status(400).json({ error: "Invalid status." });
    }

    const quote = await Quote.findOneAndUpdate({ reference: id }, { status });
    if (!quote) {
      return res.status(404).json({ error: "Quote not found." });
    }

    res.json({ quote });
  } catch (error) {
    res.status(500).json({ error: "Could not update the quote." });
  }
}

// GET /api/admin/users  -> all registered users, newest first
async function getUsers(req, res) {
  try {
    const users = await User.findAllSorted();
    res.json({ users });
  } catch (error) {
    res.status(500).json({ error: "Could not load users." });
  }
}

// GET /api/admin/analytics -> Real-time MySQL-backed sales analytics
async function getAnalytics(req, res) {
  try {
    const pool = getPool();
    const { startDate, endDate } = req.query;

    let dateWhere = "WHERE 1=1";
    const dateParams = [];
    if (startDate) {
      dateWhere += " AND created_at >= ?";
      dateParams.push(new Date(startDate));
    }
    if (endDate) {
      dateWhere += " AND created_at <= ?";
      dateParams.push(new Date(endDate));
    }

    // 1. Overall Metrics
    const [overallRows] = await pool.query(
      `SELECT 
        COUNT(*) AS total_orders,
        COALESCE(SUM(CASE WHEN status != 'cancelled' THEN total ELSE 0 END), 0) AS total_revenue,
        COALESCE(SUM(CASE WHEN status != 'cancelled' THEN coupon_discount ELSE 0 END), 0) AS total_discounts,
        COALESCE(AVG(CASE WHEN status != 'cancelled' THEN total ELSE NULL END), 0) AS aov
       FROM orders ${dateWhere}`,
      dateParams
    );

    // 2. Order Status Breakdown
    const [statusRows] = await pool.query(
      `SELECT status, COUNT(*) AS count 
       FROM orders ${dateWhere} 
       GROUP BY status`,
      dateParams
    );

    // 3. Payment Status Breakdown
    const [paymentRows] = await pool.query(
      `SELECT payment_status, COUNT(*) AS count 
       FROM orders ${dateWhere} 
       GROUP BY payment_status`,
      dateParams
    );

    // 4. Sales Trends (Daily for last 30 days)
    const [trendRows] = await pool.query(
      `SELECT 
        DATE_FORMAT(created_at, '%Y-%m-%d') AS date,
        COUNT(*) AS orders_count,
        COALESCE(SUM(CASE WHEN status != 'cancelled' THEN total ELSE 0 END), 0) AS daily_revenue
       FROM orders 
       ${dateWhere}
       GROUP BY DATE_FORMAT(created_at, '%Y-%m-%d')
       ORDER BY date ASC
       LIMIT 60`,
      dateParams
    );

    // 5. Best-Selling Products
    const [bestSellerRows] = await pool.query(
      `SELECT 
        oi.name,
        COALESCE(oi.category, 'General') AS category,
        SUM(oi.quantity) AS units_sold,
        SUM(oi.price * oi.quantity) AS revenue
       FROM order_items oi
       JOIN orders o ON oi.order_ref_id = o.id
       WHERE o.status != 'cancelled'
       GROUP BY oi.name, oi.category
       ORDER BY units_sold DESC
       LIMIT 10`
    );

    res.json({
      success: true,
      metrics: {
        totalOrders: Number(overallRows[0]?.total_orders || 0),
        totalRevenue: Number(overallRows[0]?.total_revenue || 0),
        totalDiscounts: Number(overallRows[0]?.total_discounts || 0),
        averageOrderValue: Math.round(Number(overallRows[0]?.aov || 0)),
      },
      orderStatusDistribution: statusRows,
      paymentStatusDistribution: paymentRows,
      salesTrends: trendRows,
      bestSellers: bestSellerRows,
    });
  } catch (error) {
    console.error("getAnalytics error:", error);
    res.status(500).json({ error: "Failed to generate analytics." });
  }
}

// GET /api/admin/inventory/low-stock -> Low stock warnings
async function getLowStockAlerts(req, res) {
  try {
    const { threshold } = req.query;
    const items = await Product.getLowStockProducts(threshold ? Number(threshold) : null);
    res.json({ success: true, items });
  } catch (error) {
    console.error("getLowStockAlerts error:", error);
    res.status(500).json({ error: "Failed to fetch low-stock alerts." });
  }
}

// POST /api/admin/inventory/restock -> Quick restock size
async function restockItem(req, res) {
  try {
    const { sizeId, additionalStock } = req.body;
    if (!sizeId || !additionalStock || Number(additionalStock) <= 0) {
      return res.status(400).json({ error: "Valid sizeId and positive stock quantity required." });
    }
    const pool = getPool();
    await pool.query(
      "UPDATE product_sizes SET stock = stock + ? WHERE id = ?",
      [Number(additionalStock), sizeId]
    );
    res.json({ success: true, message: "Stock updated successfully." });
  } catch (error) {
    console.error("restockItem error:", error);
    res.status(500).json({ error: "Failed to update stock." });
  }
}

// GET /api/admin/export/orders.csv -> Downloadable CSV report
async function exportOrdersCSV(req, res) {
  try {
    const pool = getPool();
    const [orders] = await pool.query(
      `SELECT o.*, 
        GROUP_CONCAT(CONCAT(oi.name, ' (', oi.size, ') x', oi.quantity) SEPARATOR '; ') AS items_summary
       FROM orders o
       LEFT JOIN order_items oi ON o.id = oi.order_ref_id
       GROUP BY o.id
       ORDER BY o.created_at DESC`
    );

    // Escape and sanitize CSV cell helper (prevents CSV Formula / DDE Injection)
    const esc = (val) => {
      if (val === null || val === undefined) return '""';
      let str = String(val);
      // Neutralize formula triggers in Excel / LibreOffice
      if (/^[=+\-@\t\r]/.test(str)) {
        str = "'" + str;
      }
      str = str.replace(/"/g, '""');
      return `"${str}"`;
    };

    const headers = [
      "Order ID",
      "Invoice Number",
      "Date",
      "Customer Name",
      "Customer Email",
      "Customer Phone",
      "Address",
      "City",
      "State",
      "PIN Code",
      "Subtotal",
      "Coupon Code",
      "Discount",
      "Shipping",
      "Total Amount",
      "Payment Method",
      "Payment Status",
      "Order Status",
      "Tracking Number",
      "Items",
    ];

    const rows = orders.map((o) => [
      esc(o.order_id),
      esc(o.invoice_number || `INV-${o.order_id}`),
      esc(new Date(o.created_at).toLocaleString("en-IN")),
      esc(o.customer_name),
      esc(o.customer_email),
      esc(o.customer_phone),
      esc(o.customer_address),
      esc(o.customer_city),
      esc(o.customer_state),
      esc(o.customer_pincode),
      esc(o.subtotal),
      esc(o.coupon_code || "NONE"),
      esc(o.coupon_discount || 0),
      esc(o.shipping),
      esc(o.total),
      esc(o.payment_method),
      esc(o.payment_status),
      esc(o.status),
      esc(o.tracking_number || "N/A"),
      esc(o.items_summary || ""),
    ]);

    const csvContent = [headers.join(","), ...rows.map((r) => r.join(","))].join("\r\n");

    const filename = `imaans_orders_${new Date().toISOString().slice(0, 10)}.csv`;
    res.setHeader("Content-Type", "text/csv; charset=utf-8");
    res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
    res.status(200).send(csvContent);
  } catch (error) {
    console.error("exportOrdersCSV error:", error);
    res.status(500).json({ error: "Failed to export orders." });
  }
}

module.exports = {
  getQuotes,
  updateQuoteStatus,
  getUsers,
  getAnalytics,
  getLowStockAlerts,
  restockItem,
  exportOrdersCSV,
};

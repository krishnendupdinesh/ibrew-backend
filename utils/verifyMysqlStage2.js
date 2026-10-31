// Stage 2 Integration Verification Suite
// Tests all MySQL-backed endpoints, transactions, stock checks, single cancellation restoration,
// and local product image storage without modifying existing data.
const path = require("path");
const fs = require("fs");
require("dotenv").config({ path: path.join(__dirname, "..", ".env") });

const app = require("../server");
const { initMySQL, getPool, UPLOADS_PRODUCTS_DIR } = require("../config/mysql");

// 1x1 transparent PNG in base64
const SAMPLE_BASE64_PNG =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=";

async function runStage2Tests() {
  await initMySQL();
  const pool = getPool();

  const server = await new Promise((resolve) => {
    const s = app.listen(0, "127.0.0.1", () => resolve(s));
  });
  const port = server.address().port;
  const baseUrl = `http://127.0.0.1:${port}`;

  let adminCookie = "";
  let createdProductId = null;
  let uploadedImageRelPath = null;
  let createdOrderId = null;
  let createdQuoteRef = null;
  const testCustomerEmail = `stage2.test.${Date.now()}@example.com`;

  try {
    console.log("1. Testing GET /api/products (Storefront Catalog & product_sizes)...");
    const prodRes = await fetch(`${baseUrl}/api/products`);
    const prodData = await prodRes.json();
    if (!prodRes.ok || !Array.isArray(prodData.products) || prodData.products.length === 0) {
      throw new Error("GET /api/products failed to return seeded products");
    }
    if (!Array.isArray(prodData.products[0].sizes) || prodData.products[0].sizes.length === 0) {
      throw new Error("Product sizes were not loaded from product_sizes table");
    }
    console.log(`   PASS: Loaded ${prodData.products.length} products with relational sizes.`);

    console.log("2. Testing Customer Registration & Login (/api/auth/register, /api/auth/login)...");
    const regRes = await fetch(`${baseUrl}/api/auth/register`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: "Stage2 Tester",
        email: testCustomerEmail,
        phone: "9876543210",
        password: "Password123!",
      }),
    });
    const regData = await regRes.json();
    if (regRes.status !== 201 || !regData.user || regData.user.email !== testCustomerEmail) {
      throw new Error(`Registration failed: ${JSON.stringify(regData)}`);
    }
    console.log("   PASS: Customer registered in MySQL users table.");

    console.log("3. Testing Admin Login & JWT Cookie (/api/auth/login)...");
    const adminLoginRes = await fetch(`${baseUrl}/api/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        email: process.env.ADMIN_USERNAME || "admin",
        password: process.env.ADMIN_PASSWORD || "Admin@12345",
      }),
    });
    const adminLoginData = await adminLoginRes.json();
    if (!adminLoginRes.ok || adminLoginData.user?.role !== "admin") {
      throw new Error(`Admin login failed: ${JSON.stringify(adminLoginData)}`);
    }
    const setCookieHeader = adminLoginRes.headers.get("set-cookie") || "";
    adminCookie = setCookieHeader.split(";")[0];
    console.log("   PASS: Admin authenticated with JWT cookie.");

    console.log("4. Testing Admin Product Creation + Local Image Upload + product_sizes...");
    const createProdRes = await fetch(`${baseUrl}/api/admin/products`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Cookie: adminCookie,
      },
      body: JSON.stringify({
        name: "Stage2 Test Reserve Roast",
        section: "coffee",
        category: "Coffee Beans",
        description: "Test product for MySQL Stage 2",
        image: SAMPLE_BASE64_PNG,
        isBestSeller: true,
        isMostSelling: true,
        sizes: [
          { label: "250g", price: 350, mrp: 420, stock: 10 },
          { label: "500g", price: 650, mrp: 780, stock: 5 },
        ],
      }),
    });
    const createProdData = await createProdRes.json();
    if (createProdRes.status !== 201 || !createProdData.product) {
      throw new Error(`Create product failed: ${JSON.stringify(createProdData)}`);
    }
    createdProductId = createProdData.product.id;
    uploadedImageRelPath = createProdData.product.image;

    if (!uploadedImageRelPath.startsWith("/api/uploads/products/") || uploadedImageRelPath.startsWith("data:")) {
      throw new Error(`Expected image path in MySQL, got: ${uploadedImageRelPath}`);
    }

    const filename = path.basename(uploadedImageRelPath);
    const diskPath = path.join(UPLOADS_PRODUCTS_DIR, filename);
    if (!fs.existsSync(diskPath)) {
      throw new Error(`Uploaded image file not found on disk: ${diskPath}`);
    }

    // Verify Express serves the uploaded image via HTTP
    const imgRes = await fetch(`${baseUrl}${uploadedImageRelPath}`);
    if (!imgRes.ok) {
      throw new Error(`Express static image serving failed with status ${imgRes.status}`);
    }
    console.log(`   PASS: Product #${createdProductId} saved in products + product_sizes, image stored at ${uploadedImageRelPath}.`);

    console.log("5. Testing Order Placement, Stock Deduction & Insufficient Stock Rejection...");
    const orderRes = await fetch(`${baseUrl}/api/orders`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        customer: {
          name: "Stage2 Buyer",
          email: testCustomerEmail,
          phone: "9876543210",
          address: "12 MG Road",
          city: "Bengaluru",
          state: "Karnataka",
          pincode: "560001",
        },
        items: [
          {
            productId: createdProductId,
            name: "Stage2 Test Reserve Roast",
            size: "250g",
            price: 350,
            mrp: 420,
            quantity: 3,
            image: uploadedImageRelPath,
            category: "Coffee Beans",
          },
        ],
        paymentMethod: "cod",
      }),
    });
    const orderData = await orderRes.json();
    if (orderRes.status !== 201 || !orderData.order) {
      throw new Error(`Order placement failed: ${JSON.stringify(orderData)}`);
    }
    createdOrderId = orderData.order.orderId;

    // Verify stock deducted from 10 -> 7 in product_sizes
    const [sizeAfterOrder] = await pool.execute(
      "SELECT `stock` FROM `product_sizes` WHERE `product_id` = ? AND `label` = '250g'",
      [Number(createdProductId)]
    );
    if (Number(sizeAfterOrder[0].stock) !== 7) {
      throw new Error(`Expected stock 7 after ordering 3, got ${sizeAfterOrder[0].stock}`);
    }

    // Attempt order exceeding available stock (requesting 25 when only 7 left)
    const overOrderRes = await fetch(`${baseUrl}/api/orders`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        customer: {
          name: "Stage2 Buyer",
          phone: "9876543210",
          address: "12 MG Road",
          city: "Bengaluru",
          pincode: "560001",
        },
        items: [
          {
            productId: createdProductId,
            name: "Stage2 Test Reserve Roast",
            size: "250g",
            price: 350,
            quantity: 25,
          },
        ],
      }),
    });
    if (overOrderRes.status !== 400) {
      throw new Error(`Expected 400 rejection for insufficient stock, got ${overOrderRes.status}`);
    }
    const [sizeAfterReject] = await pool.execute(
      "SELECT `stock` FROM `product_sizes` WHERE `product_id` = ? AND `label` = '250g'",
      [Number(createdProductId)]
    );
    if (Number(sizeAfterReject[0].stock) !== 7) {
      throw new Error("Stock changed after rejected order!");
    }
    console.log("   PASS: Stock deducted (10 -> 7) and insufficient-stock order rejected with 400.");

    console.log("6. Testing Order Confirmation & Single Stock Restoration on Cancellation...");
    // Confirm order
    const confirmRes = await fetch(`${baseUrl}/api/admin/orders/${createdOrderId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json", Cookie: adminCookie },
      body: JSON.stringify({ status: "confirmed" }),
    });
    if (!confirmRes.ok) throw new Error("Order confirmation failed");

    // Cancel order (1st time -> stock must restore 7 -> 10)
    const cancel1Res = await fetch(`${baseUrl}/api/admin/orders/${createdOrderId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json", Cookie: adminCookie },
      body: JSON.stringify({ status: "cancelled" }),
    });
    if (!cancel1Res.ok) throw new Error("Order cancellation failed");
    const [sizeAfterCancel1] = await pool.execute(
      "SELECT `stock` FROM `product_sizes` WHERE `product_id` = ? AND `label` = '250g'",
      [Number(createdProductId)]
    );
    if (Number(sizeAfterCancel1[0].stock) !== 10) {
      throw new Error(`Expected stock restored to 10 on cancel, got ${sizeAfterCancel1[0].stock}`);
    }

    // Cancel order (2nd time -> stock must remain 10, NOT 13!)
    const cancel2Res = await fetch(`${baseUrl}/api/admin/orders/${createdOrderId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json", Cookie: adminCookie },
      body: JSON.stringify({ status: "cancelled", adminNotes: "Duplicate cancel check" }),
    });
    if (!cancel2Res.ok) throw new Error("Second cancel patch failed");
    const [sizeAfterCancel2] = await pool.execute(
      "SELECT `stock` FROM `product_sizes` WHERE `product_id` = ? AND `label` = '250g'",
      [Number(createdProductId)]
    );
    if (Number(sizeAfterCancel2[0].stock) !== 10) {
      throw new Error(`Expected stock to stay 10 on repeated cancel, got ${sizeAfterCancel2[0].stock}`);
    }
    console.log("   PASS: Cancelled order restored stock once (7 -> 10) and ignored duplicate cancel.");

    console.log("7. Testing Bulk Quote Creation & Admin Status Update (/api/quote, /api/admin/quotes)...");
    const quoteRes = await fetch(`${baseUrl}/api/quote`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contact: {
          name: "Stage2 Cafe",
          company: "Test Roasters",
          email: testCustomerEmail,
          phone: "9876543210",
          city: "Bengaluru",
          timeline: "Next week",
          notes: "Need bulk espresso blend",
        },
        items: [{ id: "c-1", name: "Arabica Beans", category: "Coffee", quantity: 25, unit: "kg" }],
      }),
    });
    const quoteData = await quoteRes.json();
    if (quoteRes.status !== 201 || !quoteData.reference) {
      throw new Error(`Quote creation failed: ${JSON.stringify(quoteData)}`);
    }
    createdQuoteRef = quoteData.reference;

    const patchQuoteRes = await fetch(`${baseUrl}/api/admin/quotes`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json", Cookie: adminCookie },
      body: JSON.stringify({ id: createdQuoteRef, status: "quoted" }),
    });
    const patchQuoteData = await patchQuoteRes.json();
    if (!patchQuoteRes.ok || patchQuoteData.quote?.status !== "quoted") {
      throw new Error("Admin quote status update failed");
    }
    console.log(`   PASS: Quote ${createdQuoteRef} created in quotes + quote_items and updated to "quoted".`);

    console.log("\nALL STAGE 2 MYSQL INTEGRATION TESTS PASSED!");
  } finally {
    // Clean up temporary test artifacts
    try {
      if (createdOrderId) {
        await pool.execute("DELETE FROM `orders` WHERE `order_id` = ?", [createdOrderId]);
      }
      if (createdProductId) {
        await pool.execute("DELETE FROM `products` WHERE `id` = ?", [Number(createdProductId)]);
      }
      if (uploadedImageRelPath) {
        const f = path.join(UPLOADS_PRODUCTS_DIR, path.basename(uploadedImageRelPath));
        if (fs.existsSync(f)) fs.unlinkSync(f);
      }
      if (createdQuoteRef) {
        await pool.execute("DELETE FROM `quotes` WHERE `reference` = ?", [createdQuoteRef]);
      }
      await pool.execute("DELETE FROM `users` WHERE `email` = ?", [testCustomerEmail]);
    } catch {
      // ignore cleanup error
    }
    server.close();
    await pool.end();
  }
}

runStage2Tests().catch((err) => {
  console.error("Stage 2 verification failed:", err);
  process.exit(1);
});


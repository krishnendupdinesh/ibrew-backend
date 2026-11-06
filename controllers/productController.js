const Product = require("../models/Product");
const DEFAULT_PRODUCTS = require("../utils/defaultProducts");

const ALLOWED_SECTIONS = [
  "coffee",
  "coffee-skin",
  "spices",
  "fragrances",
  "importedbed",
  "groceries",
  "dates",
];

let seededOnce = false;

async function ensureDefaultProducts() {
  if (seededOnce) return;
  const count = await Product.countDocuments();
  if (count === 0) {
    await Product.insertMany(DEFAULT_PRODUCTS);
  }
  seededOnce = true;
}

function normalizeSizes(rawSizes) {
  if (!Array.isArray(rawSizes) || rawSizes.length === 0) return [];
  return rawSizes
    .map((s) => {
      const label = String(s.label ?? "").trim();
      const price = Number(s.price);
      const mrp = s.mrp !== undefined && s.mrp !== "" && Number(s.mrp) > 0 ? Number(s.mrp) : undefined;
      const stock = Math.max(0, Math.floor(Number(s.stock ?? 0)));
      if (!label || Number.isNaN(price) || price < 0) return null;
      return {
        label,
        price,
        ...(mrp && mrp > price ? { mrp } : {}),
        stock: Number.isNaN(stock) ? 0 : stock,
      };
    })
    .filter(Boolean);
}

function makeSlug(name) {
  return (
    String(name || "product")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/(^-|-$)/g, "") +
    "-" +
    Math.floor(1000 + Math.random() * 9000)
  );
}

// GET /api/products  (public storefront endpoint)
async function getPublicProducts(req, res) {
  try {
    await ensureDefaultProducts();

    const filter = {};
    if (req.query.section && ALLOWED_SECTIONS.includes(String(req.query.section))) {
      filter.section = String(req.query.section);
    }
    if (req.query.category) {
      filter.category = String(req.query.category).trim();
    }
    if (req.query.q) {
      filter.q = String(req.query.q).trim();
    }
    if (req.query.bestSeller === "true") {
      filter.isBestSeller = true;
    }
    if (req.query.mostSelling === "true") {
      filter.isMostSelling = true;
    }

    const products = await Product.find(filter, "default");
    res.json({ products });
  } catch (error) {
    console.log("getPublicProducts error:", error.message);
    res.status(500).json({ error: "Could not load products." });
  }
}

// GET /api/admin/products
async function getAdminProducts(req, res) {
  try {
    await ensureDefaultProducts();
    const products = await Product.find({}, "admin");
    res.json({ products });
  } catch (error) {
    console.log("getAdminProducts error:", error.message);
    res.status(500).json({ error: "Could not load products." });
  }
}

// POST /api/admin/products
async function createProduct(req, res) {
  try {
    const {
      name,
      section,
      category,
      description = "",
      detail = "",
      image = "",
      badge = "",
      tags = [],
      isBestSeller = false,
      isMostSelling = false,
      featuredOnHome = true,
      rating = 4.6,
      reviewCount = 24,
      sizes: rawSizes,
    } = req.body;

    if (!name || !String(name).trim()) {
      return res.status(400).json({ error: "Product name is required." });
    }
    if (!ALLOWED_SECTIONS.includes(section)) {
      return res.status(400).json({ error: "Please choose a valid store section." });
    }
    if (!category || !String(category).trim()) {
      return res.status(400).json({ error: "Product category is required." });
    }

    const sizes = normalizeSizes(rawSizes);
    if (sizes.length === 0) {
      return res.status(400).json({ error: "Add at least one size with a valid label and price." });
    }

    const cleanTags = Array.isArray(tags)
      ? Array.from(new Set(tags.map((t) => String(t).trim()).filter(Boolean)))
      : [];

    if (isBestSeller && !cleanTags.includes("Bestseller")) cleanTags.push("Bestseller");
    if (isMostSelling && !cleanTags.includes("Most Selling")) cleanTags.push("Most Selling");

    const resolvedBadge =
      String(badge).trim() ||
      (isMostSelling ? "Most Selling" : isBestSeller ? "Bestseller" : "");

    const product = await Product.create({
      slug: makeSlug(name),
      name: String(name).trim(),
      section,
      category: String(category).trim(),
      description: String(description).trim(),
      detail: String(detail).trim() || String(description).trim().slice(0, 60),
      image: String(image).trim(),
      badge: resolvedBadge,
      tags: cleanTags,
      isBestSeller: Boolean(isBestSeller),
      isMostSelling: Boolean(isMostSelling),
      featuredOnHome: Boolean(featuredOnHome),
      rating: Math.min(5, Math.max(0, Number(rating) || 4.6)),
      reviewCount: Math.max(0, Math.floor(Number(reviewCount) || 0)),
      sizes,
    });

    res.status(201).json({ product });
  } catch (error) {
    console.log("createProduct error:", error.message);
    res.status(500).json({ error: "Could not create the product." });
  }
}

// PUT /api/admin/products/:id
async function updateProduct(req, res) {
  try {
    const { id } = req.params;
    const {
      name,
      section,
      category,
      description = "",
      detail = "",
      image = "",
      badge = "",
      tags = [],
      isBestSeller = false,
      isMostSelling = false,
      featuredOnHome = true,
      rating = 4.6,
      reviewCount = 24,
      sizes: rawSizes,
    } = req.body;

    if (!name || !String(name).trim()) {
      return res.status(400).json({ error: "Product name is required." });
    }
    if (!ALLOWED_SECTIONS.includes(section)) {
      return res.status(400).json({ error: "Please choose a valid store section." });
    }
    if (!category || !String(category).trim()) {
      return res.status(400).json({ error: "Product category is required." });
    }

    const sizes = normalizeSizes(rawSizes);
    if (sizes.length === 0) {
      return res.status(400).json({ error: "Add at least one size with a valid label and price." });
    }

    const cleanTags = Array.isArray(tags)
      ? Array.from(new Set(tags.map((t) => String(t).trim()).filter(Boolean)))
      : [];

    if (isBestSeller && !cleanTags.includes("Bestseller")) cleanTags.push("Bestseller");
    if (isMostSelling && !cleanTags.includes("Most Selling")) cleanTags.push("Most Selling");

    const product = await Product.findByIdAndUpdate(id, {
      name: String(name).trim(),
      section,
      category: String(category).trim(),
      description: String(description).trim(),
      detail: String(detail).trim() || String(description).trim().slice(0, 60),
      image: String(image).trim(),
      badge: String(badge).trim(),
      tags: cleanTags,
      isBestSeller: Boolean(isBestSeller),
      isMostSelling: Boolean(isMostSelling),
      featuredOnHome: Boolean(featuredOnHome),
      rating: Math.min(5, Math.max(0, Number(rating) || 4.6)),
      reviewCount: Math.max(0, Math.floor(Number(reviewCount) || 0)),
      sizes,
    });

    if (!product) {
      return res.status(404).json({ error: "Product not found." });
    }

    res.json({ product });
  } catch (error) {
    console.log("updateProduct error:", error.message);
    res.status(500).json({ error: "Could not update the product." });
  }
}

// PATCH /api/admin/products/:id  (quick toggle for bestSeller, mostSelling, badge, or stock/price)
async function patchProduct(req, res) {
  try {
    const { id } = req.params;
    const existing = await Product.findById(id);
    if (!existing) {
      return res.status(404).json({ error: "Product not found." });
    }

    if (req.body.isBestSeller !== undefined) {
      existing.isBestSeller = Boolean(req.body.isBestSeller);
      if (existing.isBestSeller && !existing.tags.includes("Bestseller")) {
        existing.tags.push("Bestseller");
      } else if (!existing.isBestSeller) {
        existing.tags = existing.tags.filter((t) => t !== "Bestseller");
      }
      if (existing.isBestSeller && !existing.badge) {
        existing.badge = "Bestseller";
      } else if (!existing.isBestSeller && existing.badge === "Bestseller") {
        existing.badge = existing.isMostSelling ? "Most Selling" : "";
      }
    }

    if (req.body.isMostSelling !== undefined) {
      existing.isMostSelling = Boolean(req.body.isMostSelling);
      if (existing.isMostSelling && !existing.tags.includes("Most Selling")) {
        existing.tags.push("Most Selling");
      } else if (!existing.isMostSelling) {
        existing.tags = existing.tags.filter((t) => t !== "Most Selling");
      }
      if (existing.isMostSelling && (!existing.badge || existing.badge === "Bestseller")) {
        existing.badge = "Most Selling";
      } else if (!existing.isMostSelling && existing.badge === "Most Selling") {
        existing.badge = existing.isBestSeller ? "Bestseller" : "";
      }
    }

    if (req.body.featuredOnHome !== undefined) {
      existing.featuredOnHome = Boolean(req.body.featuredOnHome);
    }

    if (req.body.badge !== undefined) {
      existing.badge = String(req.body.badge).trim();
    }

    if (req.body.sizes !== undefined) {
      const sizes = normalizeSizes(req.body.sizes);
      if (sizes.length === 0) {
        return res.status(400).json({ error: "At least one valid size is required." });
      }
      existing.sizes = sizes;
    }

    const updated = await Product.findByIdAndUpdate(id, existing);
    res.json({ product: updated });
  } catch (error) {
    console.log("patchProduct error:", error.message);
    res.status(500).json({ error: "Could not update the product." });
  }
}

// DELETE /api/admin/products/:id
async function deleteProduct(req, res) {
  try {
    const { id } = req.params;
    const deleted = await Product.findByIdAndDelete(id);
    if (!deleted) {
      return res.status(404).json({ error: "Product not found." });
    }
    res.json({ ok: true, success: true });
  } catch (error) {
    console.log("deleteProduct error:", error.message);
    res.status(500).json({ error: "Could not delete the product." });
  }
}

// GET /api/products/:idOrSlug
async function getSingleProduct(req, res) {
  try {
    await ensureDefaultProducts();
    const { idOrSlug } = req.params;
    const product = await Product.findById(idOrSlug);
    if (!product) {
      return res.status(404).json({ error: "Product not found" });
    }
    res.json({ product });
  } catch (error) {
    console.log("getSingleProduct error:", error.message);
    res.status(500).json({ error: "Could not load product details." });
  }
}

// GET /api/products/:idOrSlug/recommendations
async function getProductRecommendations(req, res) {
  try {
    const { idOrSlug } = req.params;
    const recommendations = await Product.getRecommendations(idOrSlug);
    res.json({ success: true, recommendations });
  } catch (error) {
    console.log("getProductRecommendations error:", error.message);
    res.status(500).json({ error: "Could not load recommendations." });
  }
}

module.exports = {
  ensureDefaultProducts,
  getPublicProducts,
  getSingleProduct,
  getProductRecommendations,
  getAdminProducts,
  createProduct,
  updateProduct,
  patchProduct,
  deleteProduct,
};

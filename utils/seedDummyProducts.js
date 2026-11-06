// Adds 5 dummy products to each of the 7 storefront sections (35 total).
// Images are intentionally left empty — add them later from the Admin Dashboard.
// Safe to run multiple times: products whose slug already exists are skipped.
//
// Run with:  npm run seed:dummy
const path = require("path");
require("dotenv").config({ path: path.join(__dirname, "..", ".env"), quiet: true });
const { initMySQL, getPool } = require("../config/mysql");
const Product = require("../models/Product");

// Helper to keep the data list short
function p(section, slug, name, category, detail, description, sizes, extra = {}) {
  return {
    slug,
    name,
    section,
    category,
    detail,
    description,
    image: "", // no image — to be added by the store owner
    badge: "",
    tags: [],
    isBestSeller: false,
    isMostSelling: false,
    featuredOnHome: false,
    rating: 4.5,
    reviewCount: 0,
    sizes,
    ...extra,
  };
}

const DUMMY_PRODUCTS = [
  // ================= COFFEE (/coffee) =================
  p("coffee", "coorg-estate-arabica-beans", "Coorg Estate Arabica Beans", "Coffee Beans",
    "Single estate, light roast", "Shade-grown Arabica beans from Coorg with fruity notes and a clean finish.",
    [{ label: "250g", price: 449, mrp: 499, stock: 20 }, { label: "500g", price: 849, mrp: 949, stock: 10 }]),
  p("coffee", "chikmagalur-dark-roast-beans", "Chikmagalur Dark Roast Beans", "Coffee Beans",
    "Bold, chocolatey dark roast", "Dark roasted beans from Chikmagalur with deep cocoa and caramel notes.",
    [{ label: "250g", price: 399, mrp: 449, stock: 25 }, { label: "500g", price: 749, mrp: 849, stock: 12 }]),
  p("coffee", "classic-chicory-blend-powder", "Classic Chicory Blend Powder", "Coffee Powder",
    "80:20 coffee-chicory blend", "Traditional South Indian blend of coffee and chicory for a thick, strong decoction.",
    [{ label: "250g", price: 299, mrp: 349, stock: 30 }, { label: "500g", price: 549, mrp: 649, stock: 15 }]),
  p("coffee", "espresso-roast-ground-coffee", "Espresso Roast Ground Coffee", "Coffee Powder",
    "Fine grind for espresso", "Finely ground espresso roast with rich crema and an intense body.",
    [{ label: "250g", price: 429, mrp: 479, stock: 18 }]),
  p("coffee", "french-press-coarse-grind", "French Press Coarse Grind", "Coffee Powder",
    "Coarse grind, smooth cup", "Coarsely ground medium roast made for French press and cold brew.",
    [{ label: "250g", price: 379, mrp: 429, stock: 22 }, { label: "500g", price: 699, stock: 8 }]),

  // ================= COFFEE SKIN (/coffee-skin) =================
  p("coffee-skin", "coffee-charcoal-soap-bar", "Coffee Charcoal Soap Bar", "Soap",
    "Deep cleansing detox bar", "Handmade soap with coffee grounds and activated charcoal to deep-clean pores.",
    [{ label: "100g", price: 149, mrp: 179, stock: 40 }, { label: "Pack of 3", price: 399, mrp: 537, stock: 15 }]),
  p("coffee-skin", "coffee-honey-soap-bar", "Coffee & Honey Soap Bar", "Soap",
    "Gentle, moisturising", "Mild coffee soap enriched with honey for soft, hydrated skin.",
    [{ label: "100g", price: 159, mrp: 189, stock: 35 }]),
  p("coffee-skin", "coffee-face-scrub", "Coffee Face Scrub", "Face Care",
    "Brightening exfoliator", "Gentle coffee and walnut scrub that removes dead skin and brightens dullness.",
    [{ label: "50g", price: 249, mrp: 299, stock: 25 }, { label: "100g", price: 449, mrp: 549, stock: 12 }]),
  p("coffee-skin", "coffee-under-eye-cream", "Coffee Under Eye Cream", "Face Care",
    "Reduces puffiness", "Caffeine-infused cream that helps reduce puffiness and dark circles.",
    [{ label: "20ml", price: 349, mrp: 399, stock: 20 }]),
  p("coffee-skin", "coffee-body-butter", "Coffee Body Butter", "Body Care",
    "Rich shea & coffee butter", "Whipped body butter with shea and coffee oil for long-lasting moisture.",
    [{ label: "100g", price: 399, mrp: 449, stock: 18 }, { label: "200g", price: 699, mrp: 799, stock: 9 }]),

  // ================= SPICES (/spices) =================
  p("spices", "kashmiri-red-chilli-powder", "Kashmiri Red Chilli Powder", "Ground Spices",
    "Bright colour, mild heat", "Vibrant Kashmiri chilli powder that adds rich red colour with gentle heat.",
    [{ label: "100g", price: 99, mrp: 120, stock: 50 }, { label: "250g", price: 229, mrp: 270, stock: 25 }]),
  p("spices", "coriander-powder", "Coriander Powder", "Ground Spices",
    "Freshly ground, aromatic", "Stone-ground coriander seeds with a fresh citrusy aroma.",
    [{ label: "100g", price: 69, mrp: 85, stock: 60 }, { label: "250g", price: 159, mrp: 190, stock: 30 }]),
  p("spices", "whole-cloves", "Whole Cloves", "Whole Spices",
    "Hand-sorted, intense aroma", "Hand-sorted whole cloves from Kerala with strong, warm flavour.",
    [{ label: "50g", price: 129, mrp: 149, stock: 40 }, { label: "100g", price: 239, mrp: 279, stock: 20 }]),
  p("spices", "cinnamon-sticks", "Cinnamon Sticks", "Whole Spices",
    "True Ceylon-style quills", "Fragrant cinnamon quills for biryanis, curries, and spiced tea.",
    [{ label: "50g", price: 119, mrp: 139, stock: 35 }]),
  p("spices", "homestyle-garam-masala", "Homestyle Garam Masala", "Spice Blends",
    "Roasted 12-spice blend", "Slow-roasted blend of 12 whole spices, ground in small batches.",
    [{ label: "100g", price: 149, mrp: 179, stock: 45 }, { label: "250g", price: 339, mrp: 399, stock: 20 }]),

  // ================= FRAGRANCES (/fragrances) =================
  p("fragrances", "white-musk-attar", "White Musk Attar", "Attar",
    "Soft, clean, long-lasting", "Alcohol-free white musk attar with a soft, powdery and clean scent.",
    [{ label: "6ml", price: 299, mrp: 349, stock: 30 }, { label: "12ml", price: 549, mrp: 649, stock: 15 }]),
  p("fragrances", "rose-oudh-attar", "Rose Oudh Attar", "Attar",
    "Rich rose with smoky oudh", "Luxurious blend of Taif rose and smoky oudh in a concentrated oil.",
    [{ label: "6ml", price: 449, mrp: 499, stock: 20 }]),
  p("fragrances", "amber-noir-perfume", "Amber Noir Eau de Parfum", "Perfume",
    "Warm amber & vanilla", "Evening fragrance with warm amber, vanilla and a hint of spice.",
    [{ label: "50ml", price: 899, mrp: 1099, stock: 15 }, { label: "100ml", price: 1499, mrp: 1799, stock: 8 }]),
  p("fragrances", "citrus-fresh-perfume", "Citrus Fresh Eau de Toilette", "Perfume",
    "Bright, everyday scent", "Light citrus and bergamot fragrance ideal for daily wear.",
    [{ label: "50ml", price: 699, mrp: 849, stock: 18 }]),
  p("fragrances", "vanilla-bloom-body-mist", "Vanilla Bloom Body Mist", "Body Mist",
    "Sweet vanilla & florals", "Refreshing body mist with soft vanilla and white floral notes.",
    [{ label: "150ml", price: 349, mrp: 399, stock: 25 }]),

  // ================= IMPORTED BED (/importedbed) =================
  p("importedbed", "cloud-comfort-memory-foam-mattress", "Cloud Comfort Memory Foam Mattress", "Memory Foam",
    "Medium-soft, pressure relief", "Multi-layer memory foam mattress that contours to your body for deep sleep.",
    [{ label: "Single", price: 12999, mrp: 15999, stock: 6 }, { label: "Queen", price: 18999, mrp: 22999, stock: 4 }, { label: "King", price: 22999, mrp: 27999, stock: 3 }]),
  p("importedbed", "ortho-firm-support-mattress", "Ortho Firm Support Mattress", "Orthopedic",
    "Firm back support", "High-density orthopedic mattress designed for spinal alignment and back care.",
    [{ label: "Queen", price: 16999, mrp: 20999, stock: 5 }, { label: "King", price: 20999, mrp: 24999, stock: 3 }]),
  p("importedbed", "pocket-spring-luxury-mattress", "Pocket Spring Luxury Mattress", "Spring",
    "Individually wrapped springs", "Pocket spring mattress with zero motion transfer and a plush pillow top.",
    [{ label: "Queen", price: 24999, mrp: 29999, stock: 4 }, { label: "King", price: 28999, mrp: 34999, stock: 2 }]),
  p("importedbed", "memory-foam-contour-pillow", "Memory Foam Contour Pillow", "Accessories",
    "Neck & shoulder support", "Ergonomic contour pillow that supports the neck for side and back sleepers.",
    [{ label: "Standard", price: 1499, mrp: 1999, stock: 20 }]),
  p("importedbed", "waterproof-mattress-protector", "Waterproof Mattress Protector", "Accessories",
    "Breathable & washable", "Breathable waterproof protector that keeps your mattress clean and fresh.",
    [{ label: "Queen", price: 1299, mrp: 1599, stock: 15 }, { label: "King", price: 1499, mrp: 1899, stock: 10 }]),

  // ================= GROCERIES (/groceries) =================
  p("groceries", "basmati-rice-premium", "Premium Basmati Rice", "Staples & Grains",
    "Extra-long aged grains", "Aged basmati rice with long, fluffy grains and natural aroma.",
    [{ label: "1kg", price: 179, mrp: 210, stock: 50 }, { label: "5kg", price: 849, mrp: 999, stock: 20 }]),
  p("groceries", "whole-wheat-atta", "Whole Wheat Atta", "Staples & Grains",
    "Stone-ground chakki atta", "100% whole wheat flour, stone-ground for soft rotis.",
    [{ label: "5kg", price: 289, mrp: 330, stock: 30 }]),
  p("groceries", "roasted-cashew-nuts", "Roasted Cashew Nuts", "Snacks & Beverages",
    "Lightly salted W320", "Crunchy lightly salted roasted cashews, perfect for snacking.",
    [{ label: "200g", price: 249, mrp: 299, stock: 35 }, { label: "500g", price: 579, mrp: 699, stock: 15 }]),
  p("groceries", "assam-masala-chai", "Assam Masala Chai", "Snacks & Beverages",
    "Strong CTC with spices", "Bold Assam CTC tea blended with cardamom, ginger and cloves.",
    [{ label: "250g", price: 199, mrp: 240, stock: 40 }]),
  p("groceries", "pure-desi-ghee", "Pure Desi Ghee", "Dairy & Bakery",
    "Traditional bilona method", "Aromatic cow ghee made using the traditional bilona method.",
    [{ label: "500ml", price: 549, mrp: 620, stock: 25 }, { label: "1L", price: 1049, mrp: 1199, stock: 12 }]),

  // ================= DATES (/dates) =================
  p("dates", "ajwa-dates-premium", "Ajwa Dates", "Premium Dates",
    "Soft, rich Madinah dates", "Premium Ajwa dates from Madinah, soft with a rich, mildly sweet taste.",
    [{ label: "250g", price: 699, mrp: 799, stock: 20 }, { label: "500g", price: 1299, mrp: 1499, stock: 10 }]),
  p("dates", "safawi-dates", "Safawi Dates", "Premium Dates",
    "Dark, chewy & sweet", "Dark, chewy Safawi dates with a deep caramel sweetness.",
    [{ label: "500g", price: 549, mrp: 649, stock: 18 }]),
  p("dates", "dried-kimia-dates", "Dried Kimia Dates", "Dry Dates",
    "Naturally dried", "Naturally dried Kimia dates — firm texture, perfect for travel snacking.",
    [{ label: "500g", price: 299, mrp: 349, stock: 30 }]),
  p("dates", "date-syrup", "Pure Date Syrup", "Date Products",
    "Natural sweetener", "100% pure date syrup — a healthy natural alternative to sugar.",
    [{ label: "350g", price: 249, mrp: 299, stock: 25 }]),
  p("dates", "almond-stuffed-dates", "Almond Stuffed Dates", "Date Products",
    "Hand-stuffed with almonds", "Soft dates hand-stuffed with roasted almonds — a perfect gift.",
    [{ label: "250g", price: 449, mrp: 549, stock: 15 }]),
];

async function seedDummyProducts() {
  await initMySQL();
  let added = 0;
  let skipped = 0;
  for (const item of DUMMY_PRODUCTS) {
    const existing = await Product.findById(item.slug);
    if (existing) {
      skipped++;
      continue;
    }
    await Product.create(item);
    added++;
  }
  console.log(`Dummy products: ${added} added, ${skipped} already existed.`);
  await getPool().end();
}

module.exports = DUMMY_PRODUCTS;

if (require.main === module) {
  seedDummyProducts().catch((err) => {
    console.error("Could not seed dummy products:", err.message);
    process.exit(1);
  });
}


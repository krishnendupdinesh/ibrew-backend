// ONE-TIME script: copies the old hardcoded homepage slides into hero_banners.
// Run once with: npm run seed:hero-banners   (skips itself if the table already has rows)
const path = require("path");
require("dotenv").config({ path: path.join(__dirname, "..", ".env") });
const { getTidbPool } = require("../config/tidb");
const { uploadImageFromUrl } = require("../utils/heroImageUpload");
const { MAX_ACTIVE_BANNERS } = require("../config/heroBannerConfig");

// The slides that were hardcoded in ibrew-web/app/page.tsx, in their original order.
const OLD_SLIDES = [
  {
    title: "Fresh ground coffee, at your door",
    subtitle: "Filter and instant blends, roasted and packed with care.",
    image: "https://images.unsplash.com/photo-1495474472287-4d71bcdd2085?auto=format&fit=crop&w=1600&q=80",
    cta_text: "Shop coffee",
    cta_link: "/coffee",
  },
  {
    title: "Export-quality spices",
    subtitle: "Cardamom, pepper and more, picked for aroma and freshness.",
    image: "https://images.unsplash.com/photo-1596040033229-a9821ebd058d?auto=format&fit=crop&w=1600&q=80",
    cta_text: "Shop spices",
    cta_link: "/spices",
  },
  {
    title: "Imported fragrance and oils",
    subtitle: "Warm, woody and floral fragrances from around the world.",
    image: "https://images.unsplash.com/photo-1592945403244-b3fbafd7f539?auto=format&fit=crop&w=1600&q=80",
    cta_text: "Shop fragrance",
    cta_link: "/fragrances",
  },
  {
    title: "Sleep in luxury",
    subtitle: "Imported mattresses for better nights.",
    image: "https://images.unsplash.com/photo-1505693416388-ac5ce068fe85?auto=format&fit=crop&w=1600&q=80",
    cta_text: "Shop mattresses",
    cta_link: "/importedbed",
  },
  {
    title: "Buying in bulk?",
    subtitle: "Special prices for shops, hotels, offices and events.",
    image: "https://images.unsplash.com/photo-1578916171728-46686eac8d58?auto=format&fit=crop&w=1600&q=80",
    cta_text: "Get a bulk quote",
    cta_link: "/bulk-order",
  },
];

// Uploads the image to Cloudinary; keeps the original URL if the upload fails.
async function moveImageToCloudinary(imageUrl) {
  try {
    return await uploadImageFromUrl(imageUrl);
  } catch (error) {
    console.warn("Cloudinary upload failed, keeping original URL:", error.message);
    return imageUrl;
  }
}

// Inserts one slide. The first 5 are active, the rest are hidden.
async function insertSlide(slide, position) {
  const imageUrl = await moveImageToCloudinary(slide.image);
  const isActive = position <= MAX_ACTIVE_BANNERS ? 1 : 0;
  await getTidbPool().query(
    `INSERT INTO hero_banners (title, subtitle, image_url, cta_text, cta_link, display_order, is_active)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [slide.title, slide.subtitle, imageUrl, slide.cta_text, slide.cta_link, position, isActive]
  );
  console.log(`Added #${position}: ${slide.title} (${isActive ? "live" : "hidden"})`);
}

// Runs the seed, unless the table already has banners.
async function run() {
  const [rows] = await getTidbPool().query("SELECT COUNT(*) AS total FROM hero_banners");
  if (Number(rows[0].total) > 0) {
    console.log("hero_banners already has data. Nothing to do.");
    return;
  }
  for (let i = 0; i < OLD_SLIDES.length; i++) {
    await insertSlide(OLD_SLIDES[i], i + 1);
  }
  console.log("Seed finished.");
}

run()
  .catch((error) => {
    console.error("Seed failed:", error.message);
    process.exitCode = 1;
  })
  .finally(() => getTidbPool().end());

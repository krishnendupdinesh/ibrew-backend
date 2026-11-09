require('dotenv').config();
const { getPool } = require('../config/mysql');

(async () => {
  try {
    const pool = getPool();
    await pool.query("DELETE FROM homepage_banners WHERE type = 'hero_slide'");
    const heroSlides = [
      {
        type: 'hero_slide',
        title: 'Fresh ground coffee, at your door',
        subtitle: 'Filter and instant blends, roasted and packed with care.',
        image: 'https://images.unsplash.com/photo-1495474472287-4d71bcdd2085?auto=format&fit=crop&w=1600&q=80',
        link: '/coffee',
        cta_text: 'Shop coffee',
        sort_order: 1
      },
      {
        type: 'hero_slide',
        title: 'Export-quality spices',
        subtitle: 'Cardamom, pepper and more, picked for aroma and freshness.',
        image: 'https://images.unsplash.com/photo-1596040033229-a9821ebd058d?auto=format&fit=crop&w=1600&q=80',
        link: '/spices',
        cta_text: 'Shop spices',
        sort_order: 2
      },
      {
        type: 'hero_slide',
        title: 'Imported fragrance and oils',
        subtitle: 'Warm, woody and floral fragrances from around the world.',
        image: 'https://images.unsplash.com/photo-1592945403244-b3fbafd7f539?auto=format&fit=crop&w=1600&q=80',
        link: '/fragrances',
        cta_text: 'Shop fragrance',
        sort_order: 3
      },
      {
        type: 'hero_slide',
        title: 'Sleep in luxury',
        subtitle: 'Imported mattresses for better nights.',
        image: 'https://images.unsplash.com/photo-1505693416388-ac5ce068fe85?auto=format&fit=crop&w=1600&q=80',
        link: '/importedbed',
        cta_text: 'Shop mattresses',
        sort_order: 4
      },
      {
        type: 'hero_slide',
        title: 'Buying in bulk?',
        subtitle: 'Special prices for shops, hotels, offices and events.',
        image: 'https://images.unsplash.com/photo-1578916171728-46686eac8d58?auto=format&fit=crop&w=1600&q=80',
        link: '/bulk-order',
        cta_text: 'Get a bulk quote',
        sort_order: 5
      }
    ];

    for (const s of heroSlides) {
      await pool.query(
        "INSERT INTO homepage_banners (type, title, subtitle, image, link, cta_text, sort_order, is_active) VALUES (?, ?, ?, ?, ?, ?, ?, 1)",
        [s.type, s.title, s.subtitle, s.image, s.link, s.cta_text, s.sort_order]
      );
    }
    console.log('Homepage hero banners updated successfully in MySQL!');
    process.exit(0);
  } catch(e) {
    console.error('ERROR:', e.message);
    process.exit(1);
  }
})();

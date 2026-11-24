-- Hero banners shown in the homepage slideshow.
-- Run once:  mysql -h <host> -P 4000 -u <user> -p --ssl-mode=VERIFY_IDENTITY <database> < config/hero_banners.sql
-- Or run:    npm run migrate:hero-banners
CREATE TABLE IF NOT EXISTS hero_banners (
  id INT AUTO_INCREMENT PRIMARY KEY,
  title VARCHAR(150) NOT NULL,
  subtitle VARCHAR(300) NOT NULL DEFAULT '',
  image_url VARCHAR(500) NOT NULL,
  cta_text VARCHAR(60) NOT NULL DEFAULT 'Shop now',
  cta_link VARCHAR(200) NOT NULL DEFAULT '/',
  display_order INT NOT NULL DEFAULT 1,
  is_active TINYINT(1) NOT NULL DEFAULT 1,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
);

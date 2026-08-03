-- Slice 1: Seed data for portfolio content display
-- Implements page home + 6 section types with placeholder content (Nicepage-inspired)

-- Page: home
INSERT INTO pages (id, slug, title, meta_description, sort_order, is_published)
VALUES ('page_home', 'home', 'FanCPA — Professional Accounting & Tax Services', 'Comprehensive tax, bookkeeping, and advisory services for businesses and individuals.', 0, 1)
ON CONFLICT(slug) DO UPDATE SET
  title=excluded.title,
  meta_description=excluded.meta_description,
  updated_at=datetime('now');

-- Sections for home page (ordered)
-- Hero (0)
INSERT INTO sections (id, page_id, type, heading, subheading, sort_order, config, is_visible)
VALUES ('sec_hero', 'page_home', 'hero', 'Empowering Your Financial Success', 'Expert tax strategy, precise bookkeeping, and personalized financial guidance to help your business thrive.', 0, '{"theme":"light","align":"left"}', 1)
ON CONFLICT(id) DO UPDATE SET heading=excluded.heading, subheading=excluded.subheading, sort_order=excluded.sort_order, config=excluded.config, updated_at=datetime('now');

-- Services grid (1) — 6 cards
INSERT INTO sections (id, page_id, type, heading, subheading, sort_order, config, is_visible)
VALUES ('sec_services', 'page_home', 'cards-grid', 'Our Services', 'Tailored solutions to manage your finances', 1, '{"columns":3}', 1)
ON CONFLICT(id) DO UPDATE SET heading=excluded.heading, subheading=excluded.subheading, sort_order=excluded.sort_order, updated_at=datetime('now');

-- About / Text block (2)
INSERT INTO sections (id, page_id, type, heading, subheading, sort_order, config, is_visible)
VALUES ('sec_about', 'page_home', 'text-block', 'About FanCPA', 'Years of experience in navigating complex financial landscapes.', 2, '{"image_position":"left"}', 1)
ON CONFLICT(id) DO UPDATE SET heading=excluded.heading, subheading=excluded.subheading, sort_order=excluded.sort_order, updated_at=datetime('now');

-- Testimonials (3)
INSERT INTO sections (id, page_id, type, heading, subheading, sort_order, config, is_visible)
VALUES ('sec_testimonials', 'page_home', 'testimonials', 'Trusted by Our Clients', '', 3, '{}', 1)
ON CONFLICT(id) DO UPDATE SET heading=excluded.heading, sort_order=excluded.sort_order, updated_at=datetime('now');

-- CTA Banner (4)
INSERT INTO sections (id, page_id, type, heading, subheading, sort_order, config, is_visible)
VALUES ('sec_cta', 'page_home', 'cta-banner', 'Ready to simplify your finances?', 'Book a free 30-minute consultation to discuss your needs.', 4, '{}', 1)
ON CONFLICT(id) DO UPDATE SET heading=excluded.heading, subheading=excluded.subheading, sort_order=excluded.sort_order, updated_at=datetime('now');

-- Image Gallery (5) — removed/renamed for business relevance
INSERT INTO sections (id, page_id, type, heading, subheading, sort_order, config, is_visible)
VALUES ('sec_gallery', 'page_home', 'image-gallery', 'Our Workspace', '', 5, '{"columns":3}', 0)
ON CONFLICT(id) DO UPDATE SET heading=excluded.heading, sort_order=excluded.sort_order, updated_at=datetime('now');

-- Section Items

-- Hero items (1)
INSERT INTO section_items (id, section_id, title, body, image_url, link_url, link_text, sort_order, is_visible)
VALUES ('item_hero_1', 'sec_hero', 'Your Partner in Accounting', 'Professional financial services designed to save you time and maximize your returns. We handle the numbers, so you can focus on your business.', 'https://images.unsplash.com/photo-1554224155-8d04cb27cd6c?w=1200&auto=format&fit=crop', '/#calendar', 'Schedule a meeting', 0, 1)
ON CONFLICT(id) DO UPDATE SET title=excluded.title, body=excluded.body, image_url=excluded.image_url, link_url=excluded.link_url, link_text=excluded.link_text, updated_at=datetime('now');

-- Services — 6 cards (2 rows x 3 cols)
INSERT INTO section_items (id, section_id, title, body, icon, link_url, link_text, sort_order, is_visible) VALUES
('item_svc_1', 'sec_services', 'Tax Preparation', 'Expert preparation for individuals and business filings', '📋', '/#calendar', 'Learn more', 0, 1),
('item_svc_2', 'sec_services', 'Bookkeeping', 'Clean, organized financial records you can trust', '📈', '/#calendar', 'Learn more', 1, 1),
('item_svc_3', 'sec_services', 'Payroll Services', 'Stress-free payroll management and compliance', '💳', '/#calendar', 'Learn more', 2, 1),
('item_svc_4', 'sec_services', 'Financial Planning', 'Strategic advice for long-term growth', '📊', '/#calendar', 'Learn more', 3, 1),
('item_svc_5', 'sec_services', 'CFO Services', 'High-level financial strategy on demand', '👔', '/#calendar', 'Learn more', 4, 1),
('item_svc_6', 'sec_services', 'Business Consulting', 'Guidance to scale your business operations', '🚀', '/#calendar', 'Learn more', 5, 1)
ON CONFLICT(id) DO UPDATE SET title=excluded.title, body=excluded.body, icon=excluded.icon, sort_order=excluded.sort_order, updated_at=datetime('now');

-- About
INSERT INTO section_items (id, section_id, title, body, image_url, author, sort_order, is_visible)
VALUES ('item_about_1', 'sec_about', 'The FanCPA Advantage', 'With over 15 years of experience, we provide more than just number-crunching. We act as an extension of your team, providing actionable financial insights to help you make informed decisions.', 'https://images.unsplash.com/photo-1560520653-9e0e4c89eb11?w=400&auto=format&fit=crop', 'FanCPA Team', 0, 1)
ON CONFLICT(id) DO UPDATE SET title=excluded.title, body=excluded.body, image_url=excluded.image_url, author=excluded.author, updated_at=datetime('now');

-- Testimonials
INSERT INTO section_items (id, section_id, title, body, author, sort_order, is_visible) VALUES
('item_test_1', 'sec_testimonials', 'Small Business Owner', 'FanCPA has been a lifesaver. Tax season is no longer stressful, and their bookkeeping advice saved us thousands.', 'Alex R. — Founder', 0, 1),
('item_test_2', 'sec_testimonials', 'Entrepreneur', 'Their CFO services were exactly what I needed to scale my operations. Strategic, professional, and reliable.', 'Sarah L. — CEO', 1, 1),
('item_test_3', 'sec_testimonials', 'Professional', 'I’ve been with FanCPA for 5 years now. They make complex financial decisions simple and clear.', 'David K. — Consultant', 2, 1)
ON CONFLICT(id) DO UPDATE SET title=excluded.title, body=excluded.body, author=excluded.author, sort_order=excluded.sort_order, updated_at=datetime('now');

-- CTA
INSERT INTO section_items (id, section_id, title, body, link_url, link_text, sort_order, is_visible)
VALUES ('item_cta_1', 'sec_cta', NULL, NULL, '/#calendar', 'Schedule a meeting', 0, 1)
ON CONFLICT(id) DO UPDATE SET title=excluded.title, body=excluded.body, link_url=excluded.link_url, link_text=excluded.link_text, updated_at=datetime('now');

-- Gallery — 6 images
INSERT INTO section_items (id, section_id, title, body, image_url, sort_order, is_visible) VALUES
('item_gal_1', 'sec_gallery', 'BaseAI Brand', 'AI startup identity', 'https://images.unsplash.com/photo-1551288049-bebda4e38f71?w=600&auto=format&fit=crop', 0, 1),
('item_gal_2', 'sec_gallery', 'Loom Design System', 'Component library + tokens', 'https://images.unsplash.com/photo-1558655146-d09347e92766?w=600&auto=format&fit=crop', 1, 1),
('item_gal_3', 'sec_gallery', 'Linear Redesign', 'Marketing site + app', 'https://images.unsplash.com/photo-1460925895917-afdab827c52f?w=600&auto=format&fit=crop', 2, 1),
('item_gal_4', 'sec_gallery', 'Figma Workshops', 'Team training materials', 'https://images.unsplash.com/photo-1517245386807-bb43f82c33c4?w=600&auto=format&fit=crop', 3, 1),
('item_gal_5', 'sec_gallery', 'Onboarding Illustrations', 'Custom set for SaaS', 'https://images.unsplash.com/photo-1516321318423-f06f85e504b3?w=600&auto=format&fit=crop', 4, 1),
('item_gal_6', 'sec_gallery', 'Brand Guidelines', '150-page guidebook', 'https://images.unsplash.com/photo-1586717791821-3f44a563fa4c?w=600&auto=format&fit=crop', 5, 1)
ON CONFLICT(id) DO UPDATE SET title=excluded.title, body=excluded.body, image_url=excluded.image_url, sort_order=excluded.sort_order, updated_at=datetime('now');


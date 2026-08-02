-- Slice 1: Seed data for portfolio content display
-- Implements page home + 6 section types with placeholder content (Nicepage-inspired)

-- Page: home
INSERT INTO pages (id, slug, title, meta_description, sort_order, is_published)
VALUES ('page_home', 'home', 'Jane Doe — Designer & Developer', 'Portfolio of Jane Doe — branding, design, and development services', 0, 1)
ON CONFLICT(slug) DO UPDATE SET
  title=excluded.title,
  meta_description=excluded.meta_description,
  updated_at=datetime('now');

-- Sections for home page (ordered)
-- Hero (0)
INSERT INTO sections (id, page_id, type, heading, subheading, sort_order, config, is_visible)
VALUES ('sec_hero', 'page_home', 'hero', 'Hi, I am Jane — Designer & Developer', 'Crafting brand identities and digital experiences that inspire', 0, '{"theme":"light","align":"left"}', 1)
ON CONFLICT(id) DO UPDATE SET heading=excluded.heading, subheading=excluded.subheading, sort_order=excluded.sort_order, config=excluded.config, updated_at=datetime('now');

-- Services grid (1) — 6 cards
INSERT INTO sections (id, page_id, type, heading, subheading, sort_order, config, is_visible)
VALUES ('sec_services', 'page_home', 'cards-grid', 'Branding & More Services', 'What I can do for you', 1, '{"columns":3}', 1)
ON CONFLICT(id) DO UPDATE SET heading=excluded.heading, subheading=excluded.subheading, sort_order=excluded.sort_order, updated_at=datetime('now');

-- About / Text block (2)
INSERT INTO sections (id, page_id, type, heading, subheading, sort_order, config, is_visible)
VALUES ('sec_about', 'page_home', 'text-block', 'About Me', 'Passion for design, 10 years experience', 2, '{"image_position":"left"}', 1)
ON CONFLICT(id) DO UPDATE SET heading=excluded.heading, subheading=excluded.subheading, sort_order=excluded.sort_order, updated_at=datetime('now');

-- Testimonials (3)
INSERT INTO sections (id, page_id, type, heading, subheading, sort_order, config, is_visible)
VALUES ('sec_testimonials', 'page_home', 'testimonials', 'Happy Clients Say', '', 3, '{}', 1)
ON CONFLICT(id) DO UPDATE SET heading=excluded.heading, sort_order=excluded.sort_order, updated_at=datetime('now');

-- CTA Banner (4)
INSERT INTO sections (id, page_id, type, heading, subheading, sort_order, config, is_visible)
VALUES ('sec_cta', 'page_home', 'cta-banner', 'Ready to start your project?', 'Book a free 30-minute intro call — no pitch, just practical next steps.', 4, '{}', 1)
ON CONFLICT(id) DO UPDATE SET heading=excluded.heading, subheading=excluded.subheading, sort_order=excluded.sort_order, updated_at=datetime('now');

-- Image Gallery (5) — my work
INSERT INTO sections (id, page_id, type, heading, subheading, sort_order, config, is_visible)
VALUES ('sec_gallery', 'page_home', 'image-gallery', 'My Work — Selected Projects', '', 5, '{"columns":3}', 1)
ON CONFLICT(id) DO UPDATE SET heading=excluded.heading, sort_order=excluded.sort_order, updated_at=datetime('now');

-- Section Items

-- Hero items (1)
INSERT INTO section_items (id, section_id, title, body, image_url, link_url, link_text, sort_order, is_visible)
VALUES ('item_hero_1', 'sec_hero', 'Welcome to My Portfolio', 'I help startups build memorable brands and intuitive digital products. Based in San Francisco, working globally.', 'https://images.unsplash.com/photo-1498050108023-c5249f4df085?w=1200&auto=format&fit=crop', '/#calendar', 'Book a free call', 0, 1)
ON CONFLICT(id) DO UPDATE SET title=excluded.title, body=excluded.body, image_url=excluded.image_url, link_url=excluded.link_url, link_text=excluded.link_text, updated_at=datetime('now');

-- Services — 6 cards (2 rows x 3 cols)
INSERT INTO section_items (id, section_id, title, body, icon, link_url, link_text, sort_order, is_visible) VALUES
('item_svc_1', 'sec_services', 'Brand Strategy', 'Define your brand voice, positioning, and story', '🎯', '/#calendar', 'Book a free call', 0, 1),
('item_svc_2', 'sec_services', 'Logo Design', 'Memorable marks that stand the test of time', '✨', '/#calendar', 'Book a free call', 1, 1),
('item_svc_3', 'sec_services', 'Web Design', 'Clean, responsive websites that convert', '💻', '/#calendar', 'Book a free call', 2, 1),
('item_svc_4', 'sec_services', 'Illustration', 'Custom illustrations that tell your story', '🎨', '/#calendar', 'Book a free call', 3, 1),
('item_svc_5', 'sec_services', 'Art Direction', 'Creative direction for campaigns and launches', '📸', '/#calendar', 'Book a free call', 4, 1),
('item_svc_6', 'sec_services', 'Consulting', '1:1 sessions to level up your brand', '💡', '/#calendar', 'Book a free call', 5, 1)
ON CONFLICT(id) DO UPDATE SET title=excluded.title, body=excluded.body, icon=excluded.icon, sort_order=excluded.sort_order, updated_at=datetime('now');

-- About
INSERT INTO section_items (id, section_id, title, body, image_url, author, sort_order, is_visible)
VALUES ('item_about_1', 'sec_about', 'Jane Doe', 'I’m a brand designer and front-end developer with 10+ years helping startups from idea to Series B. My approach blends strategic thinking with hands-on craft — from research and moodboards to final pixels and code. Previously at Figma, Airbnb. Now independent, working with select clients globally.', 'https://images.unsplash.com/photo-1494790108377-be9c29b29330?w=400&auto=format&fit=crop', 'Senior Designer — 10 yrs — Figma, Airbnb, Independent', 0, 1)
ON CONFLICT(id) DO UPDATE SET title=excluded.title, body=excluded.body, image_url=excluded.image_url, author=excluded.author, updated_at=datetime('now');

-- Testimonials
INSERT INTO section_items (id, section_id, title, body, author, sort_order, is_visible) VALUES
('item_test_1', 'sec_testimonials', 'Startup Founder', 'Jane transformed our brand. The new identity helped us raise our seed round — investors immediately got who we are.', 'John Smith — CEO, BaseAI', 0, 1),
('item_test_2', 'sec_testimonials', 'Product Lead', 'Best collaboration ever. She shipped our entire design system in 3 weeks, with docs so good engineers loved it.', 'Alice Johnson — Product, Loom', 1, 1),
('item_test_3', 'sec_testimonials', 'Marketing Director', 'Our site conversion +40% after her redesign. Clean, fast, accessible — and still feels like us.', 'Mike Chen — Marketing, Linear', 2, 1)
ON CONFLICT(id) DO UPDATE SET title=excluded.title, body=excluded.body, author=excluded.author, sort_order=excluded.sort_order, updated_at=datetime('now');

-- CTA
INSERT INTO section_items (id, section_id, title, body, link_url, link_text, sort_order, is_visible)
VALUES ('item_cta_1', 'sec_cta', NULL, NULL, '/#calendar', 'Book a free call', 0, 1)
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

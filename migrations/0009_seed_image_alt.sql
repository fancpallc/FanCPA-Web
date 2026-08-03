-- Migration 0009 — describe the seeded images.
--
-- 0006 added section_items.image_alt but nothing ever populated it, so every seeded
-- image shipped with alt="" and a screen-reader visitor got silence for the largest
-- picture on the page (WCAG 1.1.1). Only fills rows the owner has not written their
-- own description for, and only where the image is still the seeded one — re-running
-- this must never overwrite real content.

UPDATE section_items SET image_alt = 'Designer at a desk working on a laptop'
  WHERE id = 'item_hero_1' AND (image_alt IS NULL OR image_alt = '');

UPDATE section_items SET image_alt = 'Portrait of Jane Doe, smiling'
  WHERE id = 'item_about_1' AND (image_alt IS NULL OR image_alt = '');

UPDATE section_items SET image_alt = 'Analytics dashboard screens from the BaseAI brand identity'
  WHERE id = 'item_gal_1' AND (image_alt IS NULL OR image_alt = '');
UPDATE section_items SET image_alt = 'Loom design system components laid out on a monitor'
  WHERE id = 'item_gal_2' AND (image_alt IS NULL OR image_alt = '');
UPDATE section_items SET image_alt = 'The redesigned Linear marketing site on a desktop screen'
  WHERE id = 'item_gal_3' AND (image_alt IS NULL OR image_alt = '');
UPDATE section_items SET image_alt = 'Workshop attendees sketching at a shared table'
  WHERE id = 'item_gal_4' AND (image_alt IS NULL OR image_alt = '');
UPDATE section_items SET image_alt = 'Onboarding illustrations open on a laptop'
  WHERE id = 'item_gal_5' AND (image_alt IS NULL OR image_alt = '');
UPDATE section_items SET image_alt = 'A printed brand guidelines book held open on a tablet'
  WHERE id = 'item_gal_6' AND (image_alt IS NULL OR image_alt = '');

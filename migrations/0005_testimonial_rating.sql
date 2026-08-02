-- Migration 0005: make the testimonial star rating real data instead of five hardcoded stars
-- Every testimonial rendered ★★★★★ whatever the client actually said, and the admin offered
-- no way to change it. `rating` is nullable so non-testimonial items are unaffected; the
-- renderer treats NULL as 5 to keep existing testimonials looking the same.
-- Free tier safe: one ALTER + one UPDATE over a handful of rows.

ALTER TABLE section_items ADD COLUMN rating INTEGER;

UPDATE section_items
SET rating = 5
WHERE section_id IN (SELECT id FROM sections WHERE type = 'testimonials');

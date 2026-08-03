-- Migration 0004: Simplify site to hero, about me, calendar only — hide extra sections per user request
-- Keep hero (landing top) and text-block (About Me) visible, hide cards-grid (services), testimonials, cta-banner, image-gallery for now to keep website simple
-- Calendar booking is separate component not a section, so stays visible regardless
-- Alpha and prod will both apply this migration via wrangler d1 migrations apply --remote --env preview/production
-- Free tier safe: single UPDATE, <1ms D1, no R2 ops

UPDATE sections SET is_visible = 0 WHERE type IN ('cards-grid', 'testimonials', 'cta-banner', 'image-gallery');

-- Verify: only hero and text-block remain visible (2 sections) + calendar
-- SELECT type, heading, is_visible FROM sections ORDER BY sort_order;
-- Expected: hero is_visible 1, text-block 1, others 0

-- Migration 0006: let the owner describe their own images
-- Hero and service-card images shipped with alt="" and the admin offered no way to set
-- it, so a screen-reader visitor got nothing for the largest image on the page. Nullable
-- because an empty alt is the correct markup for a purely decorative image, and the
-- renderers already fall back to a sensible description where one exists.
-- Free tier safe: one ALTER, no row rewrite.

ALTER TABLE section_items ADD COLUMN image_alt TEXT;

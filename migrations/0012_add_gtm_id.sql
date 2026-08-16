-- Migration 0012: Add Google Tag Manager ID
-- Free tier safe: one ALTER.

ALTER TABLE pages ADD COLUMN google_tag_manager_id TEXT;

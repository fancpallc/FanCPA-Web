-- Add calendar visibility column to pages
ALTER TABLE pages ADD COLUMN is_calendar_visible INTEGER DEFAULT 1;

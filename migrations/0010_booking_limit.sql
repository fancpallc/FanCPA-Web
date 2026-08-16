-- Add booking_max_per_week to pages
ALTER TABLE pages ADD COLUMN booking_max_per_week INTEGER DEFAULT 3;

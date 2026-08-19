-- Migration 0013: Add minimum notice days for bookings
-- Allows the owner to configure how many days of notice are required before a booking can be made.
-- 0 = same day, 1 = 1 day notice, etc.

ALTER TABLE pages ADD COLUMN booking_min_notice_days INTEGER DEFAULT 0;

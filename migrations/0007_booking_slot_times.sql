-- Migration 0007: store the meeting time on the booking
-- "Manage bookings" printed `created_at` — the moment the visitor filled in the form —
-- because the meeting time was never stored anywhere except Google Calendar. Someone who
-- booked Friday 4:30 PM saw their booking listed as "Saturday, 1 August, 12:25 PM", and
-- the cancel confirmation repeated that wrong time, so a visitor with two bookings could
-- only cancel by guesswork.
-- Nullable: rows created before this migration genuinely have no slot time to backfill,
-- and the lookup falls back to saying so rather than inventing one.
-- Free tier safe: two ALTERs plus one index, no row rewrite.

ALTER TABLE bookings ADD COLUMN slot_start TEXT;
ALTER TABLE bookings ADD COLUMN slot_end TEXT;

CREATE INDEX IF NOT EXISTS idx_bookings_slot_start ON bookings(slot_start);

-- Owner-controlled visibility for the on-page booking experience and shared CTAs.
ALTER TABLE pages ADD COLUMN calendar_visible INTEGER NOT NULL DEFAULT 1;
ALTER TABLE pages ADD COLUMN booking_cta_visible INTEGER NOT NULL DEFAULT 1;

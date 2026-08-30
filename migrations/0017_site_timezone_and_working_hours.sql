-- Rev 5 — T4 + T5: admin-selectable site timezone and working hours
-- Follows precedent of 0008 (site_name), 0010 (booking_max_per_week), 0012 (gtm), 0013 (min_notice_days)
-- Each ALTER is additive, no table rebuild, keeps CHECK constraints untouched

-- T4: site timezone governing slot generation and admin display
-- Precedence: per-booking time_zone (client) -> pages.site_time_zone -> env.TIMEZONE -> const America/New_York
ALTER TABLE pages ADD COLUMN site_time_zone TEXT;

-- T5: working hours start/end + working days on pages (was env-only WORKING_HOURS_START/END/WORKING_DAYS)
ALTER TABLE pages ADD COLUMN site_working_hours_start TEXT;
ALTER TABLE pages ADD COLUMN site_working_hours_end TEXT;
ALTER TABLE pages ADD COLUMN site_working_days TEXT;

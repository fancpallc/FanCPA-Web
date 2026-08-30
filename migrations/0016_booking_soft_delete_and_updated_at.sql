-- PR-11b + PR-11e prep — S7 + V7 + S8 scaffolding
-- S7: bookings had no updated_at, so cancel always threw and fell back to DELETE
-- V7: contacts had no updated_at, so returning client surname/phone update always threw and was swallowed
-- S8: soft delete + audit columns for admin Hide vs Cancel flow (no CHECK change, so no table rebuild)

-- Add updated_at to contacts (fixes V7)
ALTER TABLE contacts ADD COLUMN updated_at TEXT;

-- Add soft-delete / audit columns to bookings
-- Each ALTER is idempotent-safe-ish: SQLite ignores duplicate via IF NOT EXISTS? It doesn't support IF NOT EXISTS for ADD COLUMN,
-- so we wrap in a migration that runs once. Existing deployments without this file have not applied it yet.
ALTER TABLE bookings ADD COLUMN updated_at TEXT;
ALTER TABLE bookings ADD COLUMN deleted_at TEXT;
ALTER TABLE bookings ADD COLUMN deleted_reason TEXT;
ALTER TABLE bookings ADD COLUMN cancelled_at TEXT;
ALTER TABLE bookings ADD COLUMN cancelled_by TEXT;
ALTER TABLE bookings ADD COLUMN cancel_notified INTEGER DEFAULT 0;

CREATE INDEX IF NOT EXISTS idx_bookings_deleted_at ON bookings(deleted_at);
CREATE INDEX IF NOT EXISTS idx_bookings_updated_at ON bookings(updated_at);
CREATE INDEX IF NOT EXISTS idx_contacts_updated_at ON contacts(updated_at);

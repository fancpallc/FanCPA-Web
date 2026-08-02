-- Slice 3-14: Double opt-in — pending bookings until email confirmation click
-- Purpose in calendar invite already handled via description, but ensure purpose stored

-- Pending bookings — email ownership verification before creating Google Calendar event
CREATE TABLE IF NOT EXISTS pending_bookings (
  id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(8)))),
  confirm_token TEXT UNIQUE NOT NULL,
  first_name TEXT NOT NULL,
  last_name TEXT NOT NULL,
  email TEXT NOT NULL,
  phone TEXT,
  purpose TEXT,
  slot_date TEXT NOT NULL,
  slot_start TEXT NOT NULL,
  slot_end TEXT NOT NULL,
  contact_id TEXT REFERENCES contacts(id),
  status TEXT DEFAULT 'pending' CHECK (status IN ('pending','confirmed','expired')),
  created_at TEXT DEFAULT (datetime('now')),
  expires_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_pending_confirm_token ON pending_bookings(confirm_token);
CREATE INDEX IF NOT EXISTS idx_pending_email ON pending_bookings(email);
CREATE INDEX IF NOT EXISTS idx_pending_status ON pending_bookings(status);
CREATE INDEX IF NOT EXISTS idx_pending_expires ON pending_bookings(expires_at);

-- Alter bookings to allow nullable calendar_event_id for pending -> confirmed flow (existing rows already confirmed)
-- SQLite doesn't support ALTER CHECK easily, so recreate if needed, but for now ensure bookings can have pending status
-- Add confirm_token reference for audit (optional)
-- Since bookings already has status CHECK confirmed/cancelled, we need to allow pending as well via new table only, not altering old check to avoid breaking
-- For double opt-in we use pending_bookings table, and final bookings stays confirmed/cancelled as before

-- Update bookings status check to allow pending? Instead keep bookings only for confirmed, pending_bookings for pending
-- Ensure contacts email unique remains

-- Add columns to bookings for purpose already exists, ensure purpose not null for new flow is optional

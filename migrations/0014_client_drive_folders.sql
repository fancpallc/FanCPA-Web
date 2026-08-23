CREATE TABLE client_drive_folders (
id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(8)))),
contact_id TEXT NOT NULL REFERENCES contacts(id) ON DELETE CASCADE,
email TEXT NOT NULL,
year INTEGER NOT NULL CHECK (year >= 2000 AND year <= 2100),
folder_id TEXT NOT NULL,
folder_url TEXT NOT NULL,
parent_folder_id TEXT,
parent_folder_url TEXT,
is_manual INTEGER DEFAULT 0,
created_at TEXT DEFAULT (datetime('now')),
updated_at TEXT DEFAULT (datetime('now')),
UNIQUE(contact_id, year)
);
CREATE INDEX idx_cdf_email ON client_drive_folders(email);
CREATE INDEX idx_cdf_contact_year ON client_drive_folders(contact_id, year);
ALTER TABLE bookings ADD COLUMN meet_link TEXT;
ALTER TABLE bookings ADD COLUMN time_zone TEXT;
ALTER TABLE bookings ADD COLUMN drive_folder_url TEXT;

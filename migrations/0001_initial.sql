-- Portfolio Site Initial Schema
-- Implements 5 tables per design doc section 5

CREATE TABLE pages (
  id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(8)))),
  slug TEXT UNIQUE NOT NULL,
  title TEXT NOT NULL,
  meta_description TEXT,
  sort_order INTEGER DEFAULT 0,
  is_published INTEGER DEFAULT 1,
  updated_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE sections (
  id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(8)))),
  page_id TEXT NOT NULL REFERENCES pages(id) ON DELETE CASCADE,
  type TEXT NOT NULL CHECK (type IN ('hero','cards-grid','testimonials','text-block','cta-banner','image-gallery')),
  heading TEXT,
  subheading TEXT,
  sort_order INTEGER DEFAULT 0,
  config TEXT DEFAULT '{}',
  is_visible INTEGER DEFAULT 1,
  updated_at TEXT DEFAULT (datetime('now'))
);

CREATE INDEX idx_sections_page_id ON sections(page_id);
CREATE INDEX idx_sections_sort ON sections(sort_order);

CREATE TABLE section_items (
  id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(8)))),
  section_id TEXT NOT NULL REFERENCES sections(id) ON DELETE CASCADE,
  title TEXT,
  body TEXT,
  image_url TEXT,
  icon TEXT,
  link_url TEXT,
  link_text TEXT,
  author TEXT,
  sort_order INTEGER DEFAULT 0,
  is_visible INTEGER DEFAULT 1,
  updated_at TEXT DEFAULT (datetime('now'))
);

CREATE INDEX idx_section_items_section_id ON section_items(section_id);
CREATE INDEX idx_section_items_sort ON section_items(sort_order);

CREATE TABLE contacts (
  id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(8)))),
  first_name TEXT NOT NULL,
  last_name TEXT NOT NULL,
  email TEXT UNIQUE NOT NULL,
  phone TEXT,
  drive_folder_url TEXT,
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE INDEX idx_contacts_email ON contacts(email);

CREATE TABLE bookings (
  id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(8)))),
  contact_id TEXT NOT NULL REFERENCES contacts(id),
  calendar_event_id TEXT NOT NULL,
  purpose TEXT,
  cancel_token TEXT UNIQUE NOT NULL,
  status TEXT DEFAULT 'confirmed' CHECK (status IN ('confirmed','cancelled')),
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE INDEX idx_bookings_contact_id ON bookings(contact_id);
CREATE INDEX idx_bookings_cancel_token ON bookings(cancel_token);
CREATE INDEX idx_bookings_status ON bookings(status);

-- FanCPA initial schema (placeholder for Cloudflare D1 setup)

CREATE TABLE IF NOT EXISTS meta (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_at TEXT DEFAULT (datetime('now'))
);

INSERT OR IGNORE INTO meta (key, value) VALUES ('schema_version', '1');

-- Migration 0008: let the owner name their own site
-- The wordmark in the header, the footer brand, the footer blurb and the copyright line
-- all read the literal "Portfolio", hardcoded in App.tsx / Nav.tsx / Footer.tsx. A site
-- belonging to Jane Doe shipped with someone else's placeholder in five places and no
-- field anywhere in /admin to change any of them.
-- Free tier safe: two ALTERs plus one UPDATE of a single row.

ALTER TABLE pages ADD COLUMN site_name TEXT;
ALTER TABLE pages ADD COLUMN footer_tagline TEXT;

UPDATE pages
SET site_name = COALESCE(site_name, 'Jane Doe'),
    footer_tagline = COALESCE(footer_tagline, 'Strategic brand design and development for ambitious teams. Book a free intro call to start.')
WHERE slug = 'home';

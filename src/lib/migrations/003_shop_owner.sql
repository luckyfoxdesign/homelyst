-- Attach shops to owners and add metadata fields.

ALTER TABLE shops ADD COLUMN owner_id        TEXT REFERENCES users(id) ON DELETE SET NULL;
ALTER TABLE shops ADD COLUMN notify_email    TEXT;
ALTER TABLE shops ADD COLUMN notify_channels TEXT NOT NULL DEFAULT '["telegram"]';
ALTER TABLE shops ADD COLUMN status          TEXT NOT NULL DEFAULT 'active';
ALTER TABLE shops ADD COLUMN currency        TEXT NOT NULL DEFAULT 'EUR';

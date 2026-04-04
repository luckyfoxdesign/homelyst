-- Migrate product prices from REAL (float) to INTEGER (cents).
-- SQLite does not support DROP COLUMN reliably, so we recreate the table.

CREATE TABLE products_new (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  shop_id     TEXT NOT NULL,
  title       TEXT NOT NULL,
  price_cents INTEGER NOT NULL DEFAULT 0,
  description TEXT,
  address     TEXT,
  status      TEXT DEFAULT 'available',
  reserved_by TEXT,
  reserved_at INTEGER,
  confirmed   INTEGER DEFAULT 0,
  created_at  INTEGER DEFAULT (unixepoch()),
  FOREIGN KEY (shop_id) REFERENCES shops(id) ON DELETE CASCADE
);

-- ROUND before CAST: 9.99*100 = 998.999... → ROUND → 999, not 998
INSERT INTO products_new
  (id, shop_id, title, price_cents, description, address,
   status, reserved_by, reserved_at, confirmed, created_at)
SELECT
  id, shop_id, title,
  CAST(ROUND(price * 100) AS INTEGER),
  description, address, status, reserved_by, reserved_at, confirmed, created_at
FROM products;

DROP TABLE products;
ALTER TABLE products_new RENAME TO products;

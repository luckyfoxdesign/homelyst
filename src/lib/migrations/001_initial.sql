-- Baseline schema — captured for migration history.
-- Uses IF NOT EXISTS so running on an existing DB is safe.

CREATE TABLE IF NOT EXISTS shops (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  created_at INTEGER DEFAULT (unixepoch())
);

CREATE TABLE IF NOT EXISTS products (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  shop_id TEXT NOT NULL,
  title TEXT NOT NULL,
  price REAL NOT NULL DEFAULT 0,
  description TEXT,
  address TEXT,
  status TEXT DEFAULT 'available',
  reserved_by TEXT,
  reserved_at INTEGER,
  confirmed INTEGER DEFAULT 0,
  created_at INTEGER DEFAULT (unixepoch()),
  FOREIGN KEY (shop_id) REFERENCES shops(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS product_images (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  product_id INTEGER NOT NULL,
  filename TEXT NOT NULL,
  sort_order INTEGER DEFAULT 0,
  FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS sessions (
  token TEXT PRIMARY KEY,
  csrf_token TEXT,
  ip TEXT,
  created_at INTEGER DEFAULT (unixepoch())
);

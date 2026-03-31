import Database from 'better-sqlite3';
import fs from 'node:fs';
import path from 'node:path';

const DB_PATH = process.env.DATABASE_PATH ?? './data/db.sqlite';

// Ensure the directory exists
const dbDir = path.dirname(DB_PATH);
fs.mkdirSync(dbDir, { recursive: true });

const db = new Database(DB_PATH);

// Enable WAL for better concurrency
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

// Create tables
db.exec(`
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
    size TEXT,
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
`);

export interface Shop {
  id: string;
  name: string;
  created_at: number;
}

export interface Product {
  id: number;
  shop_id: string;
  title: string;
  price: number;
  description: string | null;
  size: string | null;
  status: string;
  reserved_by: string | null;
  reserved_at: number | null;
  confirmed: number;
  created_at: number;
}

export interface ProductImage {
  id: number;
  product_id: number;
  filename: string;
  sort_order: number;
}

export function getShop(id: string): Shop | undefined {
  return db.prepare('SELECT * FROM shops WHERE id = ?').get(id) as Shop | undefined;
}

export function getShops(): Shop[] {
  return db.prepare('SELECT * FROM shops ORDER BY created_at DESC').all() as Shop[];
}

export function createShop(id: string, name: string): Shop {
  db.prepare('INSERT INTO shops (id, name) VALUES (?, ?)').run(id, name);
  return getShop(id)!;
}

export function getProducts(shopId: string): Product[] {
  // Auto-expire stale reservations (older than 24 hours)
  db.prepare(`
    UPDATE products
    SET status = 'available', reserved_by = NULL, reserved_at = NULL, confirmed = 0
    WHERE shop_id = ?
      AND status = 'reserved'
      AND confirmed = 0
      AND reserved_at IS NOT NULL
      AND reserved_at + 86400 < unixepoch()
  `).run(shopId);

  return db.prepare('SELECT * FROM products WHERE shop_id = ? ORDER BY created_at DESC').all(shopId) as Product[];
}

export function getProduct(productId: number): Product | undefined {
  return db.prepare('SELECT * FROM products WHERE id = ?').get(productId) as Product | undefined;
}

export function createProduct(
  shopId: string,
  title: string,
  price: number,
  description: string | null,
  size: string | null
): Product {
  const result = db.prepare(
    'INSERT INTO products (shop_id, title, price, description, size) VALUES (?, ?, ?, ?, ?)'
  ).run(shopId, title, price, description, size);
  return getProduct(result.lastInsertRowid as number)!;
}

export function deleteProduct(productId: number): void {
  db.prepare('DELETE FROM products WHERE id = ?').run(productId);
}

export function getProductImages(productId: number): ProductImage[] {
  return db
    .prepare('SELECT * FROM product_images WHERE product_id = ? ORDER BY sort_order ASC')
    .all(productId) as ProductImage[];
}

export function addProductImage(productId: number, filename: string, sortOrder: number): ProductImage {
  const result = db
    .prepare('INSERT INTO product_images (product_id, filename, sort_order) VALUES (?, ?, ?)')
    .run(productId, filename, sortOrder);
  return db.prepare('SELECT * FROM product_images WHERE id = ?').get(result.lastInsertRowid as number) as ProductImage;
}

export function reserveProduct(productId: number, name: string): boolean {
  // Single atomic UPDATE: expire stale reservation if needed, then reserve only if status = 'available'.
  // The WHERE clause makes this race-condition-free — only one concurrent request will get changes = 1.
  const expireStmt = db.prepare(`
    UPDATE products
    SET status = 'available', reserved_by = NULL, reserved_at = NULL, confirmed = 0
    WHERE id = ?
      AND status = 'reserved'
      AND confirmed = 0
      AND reserved_at IS NOT NULL
      AND reserved_at + 86400 < unixepoch()
  `);

  const reserveStmt = db.prepare(
    "UPDATE products SET status = 'reserved', reserved_by = ?, reserved_at = unixepoch() WHERE id = ? AND status = 'available'"
  );

  const result = db.transaction(() => {
    expireStmt.run(productId);
    return reserveStmt.run(name, productId);
  })();

  return result.changes === 1;
}

export function confirmReservation(productId: number): void {
  db.prepare("UPDATE products SET confirmed = 1, status = 'reserved' WHERE id = ?").run(productId);
}

export function releaseReservation(productId: number): void {
  db.prepare(
    "UPDATE products SET status = 'available', reserved_by = NULL, reserved_at = NULL, confirmed = 0 WHERE id = ?"
  ).run(productId);
}

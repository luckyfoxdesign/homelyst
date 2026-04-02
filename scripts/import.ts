#!/usr/bin/env bun
/**
 * Import script for items.json
 *
 * Usage:
 *   cd /Users/maksimsovenkov/Documents/dev/shoper && bun scripts/import.ts
 *   cd /Users/maksimsovenkov/Documents/dev/shoper && bun scripts/import.ts --shopName "Custom Name"
 */

import { Database } from 'bun:sqlite';
import fs from 'node:fs';
import path from 'node:path';

// Parse CLI args
const args = process.argv.slice(2);
let shopName = 'Детские вещи';
for (let i = 0; i < args.length; i++) {
  if (args[i] === '--shopName' && args[i + 1]) {
    shopName = args[i + 1];
    i++;
  }
}

const ITEMS_JSON_PATH = path.resolve('./items.json');
const IMAGES_BASE = path.resolve('.');
const DB_PATH = process.env.DATABASE_PATH ?? './data/db.sqlite';
const UPLOADS_BASE = process.env.UPLOADS_PATH ?? './data/uploads';

// Ensure DB directory exists
const dbDir = path.dirname(DB_PATH);
fs.mkdirSync(dbDir, { recursive: true });

// Open DB
const db = new Database(DB_PATH);
db.exec('PRAGMA journal_mode = WAL');
db.exec('PRAGMA foreign_keys = ON');

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

// Create shop
const SHOP_ID = 'default';
const existingShop = db.prepare('SELECT id FROM shops WHERE id = ?').get(SHOP_ID);
if (!existingShop) {
  db.prepare('INSERT INTO shops (id, name) VALUES (?, ?)').run(SHOP_ID, shopName);
  console.log(`Created shop: ${SHOP_ID} / ${shopName}`);
} else {
  console.log(`Shop already exists: ${SHOP_ID}`);
}

// Read items
if (!fs.existsSync(ITEMS_JSON_PATH)) {
  console.error(`items.json not found at ${ITEMS_JSON_PATH}`);
  process.exit(1);
}

interface Item {
  slug: string;
  title: string;
  price: number | null;
  size: string | null;
  material: string | null;
  status: string;
  images: string[];
  description?: string | null;
}

const items: Item[] = JSON.parse(fs.readFileSync(ITEMS_JSON_PATH, 'utf-8'));
console.log(`Found ${items.length} items to import`);

let imported = 0;
let skipped = 0;
let imagesCopied = 0;

for (const item of items) {
  // Map status
  const status = item.status === 'available' ? 'available' : 'sold';

  // Insert product
  const result = db.prepare(
    'INSERT INTO products (shop_id, title, price, description, size, status) VALUES (?, ?, ?, ?, ?, ?)'
  ).run(
    SHOP_ID,
    item.title,
    item.price ?? 0,
    item.description ?? null,
    item.size ?? null,
    status
  );

  const productId = result.lastInsertRowid as number;

  // Copy images
  const uploadDir = path.join(UPLOADS_BASE, SHOP_ID, String(productId));
  fs.mkdirSync(uploadDir, { recursive: true });

  for (let i = 0; i < item.images.length; i++) {
    const imagePath = item.images[i];
    // imagePath is like "images/slug/1.jpg"
    const sourcePath = path.join(IMAGES_BASE, imagePath);
    const filename = path.basename(imagePath);
    const destPath = path.join(uploadDir, filename);

    if (fs.existsSync(sourcePath)) {
      fs.copyFileSync(sourcePath, destPath);
      imagesCopied++;

      // Insert image record
      db.prepare(
        'INSERT INTO product_images (product_id, filename, sort_order) VALUES (?, ?, ?)'
      ).run(productId, filename, i);
    } else {
      console.warn(`  Image not found: ${sourcePath}`);
      skipped++;
    }
  }

  console.log(`  [${productId}] ${item.title} (${status})`);
  imported++;
}

console.log(`\nDone!`);
console.log(`  Products imported: ${imported}`);
console.log(`  Images copied: ${imagesCopied}`);
console.log(`  Images skipped (not found): ${skipped}`);

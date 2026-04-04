import { Database } from 'bun:sqlite';
import fs from 'node:fs';
import path from 'node:path';

const DB_PATH = process.env.DATABASE_PATH ?? './data/db.sqlite';

const dbDir = path.dirname(DB_PATH);
fs.mkdirSync(dbDir, { recursive: true });

const db = new Database(DB_PATH);

db.exec('PRAGMA journal_mode = WAL');
db.exec('PRAGMA foreign_keys = ON');

// ─── Migration runner ──────────────────────────────────────────────────────────

const MIGRATIONS_DIR = new URL('./migrations', import.meta.url).pathname;

function runMigrations(): void {
  // Ensure _migrations table exists
  db.exec(`
    CREATE TABLE IF NOT EXISTS _migrations (
      id         INTEGER PRIMARY KEY,
      filename   TEXT NOT NULL UNIQUE,
      applied_at INTEGER NOT NULL DEFAULT (unixepoch())
    );
  `);

  const files = fs
    .readdirSync(MIGRATIONS_DIR)
    .filter((f) => f.endsWith('.sql'))
    .sort();

  const applied = new Set(
    (db.prepare('SELECT filename FROM _migrations').all() as { filename: string }[]).map(
      (r) => r.filename
    )
  );

  const pending = files.filter((f) => !applied.has(f));
  if (pending.length === 0) return;

  // Checkpoint WAL so the backup is a single self-contained file
  try {
    db.exec('PRAGMA wal_checkpoint(TRUNCATE)');
  } catch {}

  // Back up DB before running any migrations
  const backupPath = DB_PATH + '.bak';
  try {
    fs.copyFileSync(DB_PATH, backupPath);
  } catch {
    // DB may not exist yet on first run — that's fine
  }

  for (const filename of pending) {
    const sql = fs.readFileSync(path.join(MIGRATIONS_DIR, filename), 'utf-8');
    try {
      // No transaction wrapper: SQLite ALTER TABLE auto-commits and can't
      // be rolled back inside a transaction. We rely on the file-level
      // backup for safety instead.
      db.exec(sql);
      db.prepare('INSERT INTO _migrations (filename) VALUES (?)').run(filename);
      console.log(`[migration] applied: ${filename}`);
    } catch (err) {
      console.error(`[migration] FAILED: ${filename}`, err);
      // Restore from backup
      try {
        db.close();
        if (fs.existsSync(backupPath)) fs.copyFileSync(backupPath, DB_PATH);
        // Remove WAL/SHM files that may reference pre-restore state
        try { fs.unlinkSync(DB_PATH + '-wal'); } catch {}
        try { fs.unlinkSync(DB_PATH + '-shm'); } catch {}
      } catch {}
      process.exit(1);
    }
  }
}

// Handle legacy size→address rename before migrations run (no-op if already done)
try {
  db.exec('ALTER TABLE products RENAME COLUMN size TO address');
} catch {}

runMigrations();

// ─── Bootstrap first admin ─────────────────────────────────────────────────────

// 21-char URL-safe random ID using crypto
export function generateId(): string {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';
  const bytes = new Uint8Array(21);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => chars[b % 64]).join('');
}

function seedAdminIfNeeded(): void {
  const telegramId = process.env.SEED_ADMIN_TELEGRAM_ID?.trim() || null;
  const email = process.env.SEED_ADMIN_EMAIL?.trim().toLowerCase() || null;

  if (!telegramId && !email) return;

  const count = (db.prepare('SELECT COUNT(*) as n FROM users').get() as { n: number }).n;
  if (count > 0) return;

  const id = generateId();
  db.prepare(
    'INSERT INTO users (id, email, telegram_id, role) VALUES (?, ?, ?, ?)'
  ).run(id, email, telegramId, 'admin');

  console.log(
    `[seed] Created admin user: id=${id}` +
    (email ? ` email=${email}` : '') +
    (telegramId ? ` telegram_id=${telegramId}` : '')
  );
}

seedAdminIfNeeded();

// ─── Graceful shutdown ──────────────────────────────────────────────────────────

process.on('SIGTERM', () => {
  db.close();
  process.exit(0);
});

// ─── Periodic sweeps ───────────────────────────────────────────────────────────

setInterval(() => sweepExpiredReservations(), 5 * 60_000);
setInterval(() => cleanExpiredSessions(), 30 * 60_000);

export { db };

// ─── Types ─────────────────────────────────────────────────────────────────────

export interface User {
  id: string;
  email: string | null;
  display_name: string | null;
  telegram_id: string | null;
  role: 'owner' | 'admin';
  created_at: number;
}

export interface UserSession {
  token_hash: string;
  user_id: string;
  csrf_token: string;
  created_ip: string | null;
  expires_at: number;
  created_at: number;
}

export interface Shop {
  id: string;
  name: string;
  owner_id: string | null;
  notify_email: string | null;
  notify_channels: string;
  status: 'pending' | 'active' | 'suspended';
  currency: string;
  created_at: number;
}

export interface Product {
  id: number;
  shop_id: string;
  title: string;
  price_cents: number;
  description: string | null;
  address: string | null;
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

// ─── User functions ─────────────────────────────────────────────────────────────

export function getUserById(id: string): User | undefined {
  return db.prepare('SELECT * FROM users WHERE id = ?').get(id) as User | undefined;
}

export function getUserByEmail(email: string): User | undefined {
  return db
    .prepare('SELECT * FROM users WHERE email = LOWER(?)')
    .get(email) as User | undefined;
}

export function getUserByTelegramId(telegramId: string): User | undefined {
  return db
    .prepare('SELECT * FROM users WHERE telegram_id = ?')
    .get(telegramId) as User | undefined;
}

export function getFirstAdmin(): User | undefined {
  return db
    .prepare("SELECT * FROM users WHERE role = 'admin' ORDER BY created_at ASC LIMIT 1")
    .get() as User | undefined;
}

/** Find or create a user by telegram_id. Race-condition-safe via ON CONFLICT DO NOTHING. */
export function upsertTelegramUser(
  telegramId: string,
  displayName: string | null
): User {
  const id = generateId();
  db.prepare(
    'INSERT INTO users (id, telegram_id, display_name, role) VALUES (?, ?, ?, ?) ON CONFLICT(telegram_id) DO NOTHING'
  ).run(id, telegramId, displayName, 'owner');
  return db.prepare('SELECT * FROM users WHERE telegram_id = ?').get(telegramId) as User;
}

// ─── User session functions ─────────────────────────────────────────────────────

/** Create a new session for userId. Returns { rawToken, csrfToken }. */
export function createUserSession(
  userId: string,
  ip: string | null,
  ttlSeconds = 7 * 24 * 3600
): { rawToken: string; csrfToken: string } {
  const rawBytes = new Uint8Array(32);
  crypto.getRandomValues(rawBytes);
  const rawToken = Array.from(rawBytes, (b) => b.toString(16).padStart(2, '0')).join('');

  const csrfBytes = new Uint8Array(32);
  crypto.getRandomValues(csrfBytes);
  const csrfToken = Array.from(csrfBytes, (b) => b.toString(16).padStart(2, '0')).join('');

  const tokenHash = hashToken(rawToken);
  const expiresAt = Math.floor(Date.now() / 1000) + ttlSeconds;

  // Enforce max 10 concurrent sessions: delete oldest if limit exceeded
  const sessionCount = (
    db
      .prepare('SELECT COUNT(*) as n FROM user_sessions WHERE user_id = ?')
      .get(userId) as { n: number }
  ).n;

  if (sessionCount >= 10) {
    const oldest = db
      .prepare(
        'SELECT token_hash FROM user_sessions WHERE user_id = ? ORDER BY created_at ASC LIMIT 1'
      )
      .get(userId) as { token_hash: string } | undefined;
    if (oldest) {
      db.prepare('DELETE FROM user_sessions WHERE token_hash = ?').run(oldest.token_hash);
    }
  }

  db.prepare(
    'INSERT INTO user_sessions (token_hash, user_id, csrf_token, created_ip, expires_at) VALUES (?, ?, ?, ?, ?)'
  ).run(tokenHash, userId, csrfToken, ip, expiresAt);

  return { rawToken, csrfToken };
}

export function getUserSessionByTokenHash(tokenHash: string): UserSession | undefined {
  return db
    .prepare('SELECT * FROM user_sessions WHERE token_hash = ? AND expires_at > unixepoch()')
    .get(tokenHash) as UserSession | undefined;
}

export function deleteUserSession(tokenHash: string): void {
  db.prepare('DELETE FROM user_sessions WHERE token_hash = ?').run(tokenHash);
}

export function deleteAllUserSessions(userId: string): void {
  db.prepare('DELETE FROM user_sessions WHERE user_id = ?').run(userId);
}

export function cleanExpiredSessions(): void {
  db.prepare('DELETE FROM user_sessions WHERE expires_at <= unixepoch()').run();
}

/** SHA-256 hex of a raw token string. */
export function hashToken(rawToken: string): string {
  // Bun exposes SubtleCrypto synchronously via the standard crypto global,
  // but digest() is async. We use a synchronous approach via Bun.CryptoHasher.
  const hasher = new Bun.CryptoHasher('sha256');
  hasher.update(rawToken);
  return hasher.digest('hex');
}

// ─── Shop functions ─────────────────────────────────────────────────────────────

export function getShop(id: string): Shop | undefined {
  return db.prepare('SELECT * FROM shops WHERE id = ?').get(id) as Shop | undefined;
}

export function getShops(): Shop[] {
  return db.prepare('SELECT * FROM shops ORDER BY created_at DESC').all() as Shop[];
}

export function createShop(id: string, name: string, ownerId?: string | null): Shop {
  db.prepare('INSERT INTO shops (id, name, owner_id) VALUES (?, ?, ?)').run(
    id,
    name,
    ownerId ?? null
  );
  return getShop(id)!;
}

export function getShopCount(): number {
  return (db.prepare('SELECT COUNT(*) as count FROM shops').get() as { count: number }).count;
}

// ─── Product functions ──────────────────────────────────────────────────────────

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

  return db
    .prepare('SELECT * FROM products WHERE shop_id = ? ORDER BY created_at DESC')
    .all(shopId) as Product[];
}

export function getProduct(productId: number): Product | undefined {
  return db.prepare('SELECT * FROM products WHERE id = ?').get(productId) as Product | undefined;
}

export function createProduct(
  shopId: string,
  title: string,
  priceCents: number,
  description: string | null,
  address: string | null
): Product {
  const result = db
    .prepare(
      'INSERT INTO products (shop_id, title, price_cents, description, address) VALUES (?, ?, ?, ?, ?)'
    )
    .run(shopId, title, priceCents, description, address);
  return getProduct(result.lastInsertRowid as number)!;
}

export function getProductCount(shopId: string): number {
  return (
    db
      .prepare('SELECT COUNT(*) as count FROM products WHERE shop_id = ?')
      .get(shopId) as { count: number }
  ).count;
}

export function deleteProduct(productId: number): void {
  db.prepare('DELETE FROM products WHERE id = ?').run(productId);
}

export function deleteShop(shopId: string): void {
  db.prepare('DELETE FROM shops WHERE id = ?').run(shopId);
}

export function getProductImages(productId: number): ProductImage[] {
  return db
    .prepare('SELECT * FROM product_images WHERE product_id = ? ORDER BY sort_order ASC')
    .all(productId) as ProductImage[];
}

export function addProductImage(
  productId: number,
  filename: string,
  sortOrder: number
): ProductImage {
  const result = db
    .prepare('INSERT INTO product_images (product_id, filename, sort_order) VALUES (?, ?, ?)')
    .run(productId, filename, sortOrder);
  return db
    .prepare('SELECT * FROM product_images WHERE id = ?')
    .get(result.lastInsertRowid as number) as ProductImage;
}

export function reserveProduct(productId: number, name: string): boolean {
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

export function confirmReservation(productId: number): boolean {
  const result = db
    .prepare(
      "UPDATE products SET confirmed = 1 WHERE id = ? AND status = 'reserved' AND confirmed = 0"
    )
    .run(productId);
  return result.changes === 1;
}

export function releaseReservation(productId: number): boolean {
  const result = db
    .prepare(
      "UPDATE products SET status = 'available', reserved_by = NULL, reserved_at = NULL, confirmed = 0 WHERE id = ? AND status = 'reserved'"
    )
    .run(productId);
  return result.changes === 1;
}

export function markProductSold(productId: number): boolean {
  const result = db
    .prepare(
      "UPDATE products SET status = 'sold' WHERE id = ? AND status = 'reserved' AND confirmed = 1"
    )
    .run(productId);
  return result.changes === 1;
}

export function sweepExpiredReservations(): void {
  db.prepare(`
    UPDATE products SET status = 'available', reserved_by = NULL, reserved_at = NULL, confirmed = 0
    WHERE status = 'reserved' AND confirmed = 0
      AND reserved_at IS NOT NULL
      AND reserved_at + 86400 < unixepoch()
  `).run();
}

export function checkDb(): void {
  db.prepare('SELECT 1').get();
}

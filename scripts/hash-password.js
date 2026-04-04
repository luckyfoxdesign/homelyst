#!/usr/bin/env node

// Generate a scrypt hash for ADMIN_PASSWORD_HASH.
// Usage: node scripts/hash-password.js <password>
//        docker compose exec app node scripts/hash-password.js <password>

import { scrypt, randomBytes } from 'node:crypto';

const password = process.argv[2];
if (!password) {
  console.error('Usage: node scripts/hash-password.js <password>');
  process.exit(1);
}

const salt = randomBytes(16);
scrypt(password, salt, 64, { N: 16384, r: 8, p: 1 }, (err, key) => {
  if (err) { console.error(err); process.exit(1); }
  const hash = `${salt.toString('hex')}:${key.toString('hex')}`;
  console.log(hash);
  console.error('\nSet this as ADMIN_PASSWORD_HASH in your .env file.');
});

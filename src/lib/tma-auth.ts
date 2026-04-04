/**
 * Telegram Mini App (TMA) initData validation.
 *
 * Flow: client sends `Authorization: TMA <initData>` header.
 * Server validates HMAC-SHA256 and issues a short-lived Bearer session.
 *
 * Spec: https://core.telegram.org/bots/webapps#validating-data-received-via-the-mini-app
 */

// ─── Replay protection ──────────────────────────────────────────────────────────
// In-memory Map of hash → unix timestamp when it was first seen.
// TTL = 5 minutes. Cleaned every 60 seconds.

const usedHashes = new Map<string, number>();

setInterval(() => {
  const cutoff = Math.floor(Date.now() / 1000) - 300;
  for (const [hash, ts] of usedHashes) {
    if (ts < cutoff) usedHashes.delete(hash);
  }
}, 60_000);

// ─── HMAC helpers ───────────────────────────────────────────────────────────────

async function hmacSHA256(key: BufferSource | CryptoKey, data: string): Promise<ArrayBuffer> {
  const cryptoKey =
    key instanceof CryptoKey
      ? key
      : await crypto.subtle.importKey(
          'raw',
          key,
          { name: 'HMAC', hash: 'SHA-256' },
          false,
          ['sign']
        );
  return crypto.subtle.sign('HMAC', cryptoKey, new TextEncoder().encode(data));
}

function bufToHex(buf: ArrayBuffer): string {
  return Array.from(new Uint8Array(buf), (b) => b.toString(16).padStart(2, '0')).join('');
}

function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) {
    diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return diff === 0;
}

// ─── Validation ─────────────────────────────────────────────────────────────────

export interface TMAUser {
  id: number;
  first_name: string;
  last_name?: string;
  username?: string;
  language_code?: string;
}

export type TMAValidationResult = {
  ok: true;
  user: TMAUser;
  hash: string;
} | {
  ok: false;
  error: string;
}

/**
 * Validate Telegram initData string.
 * Returns { ok: true, user, hash } or { ok: false, error }.
 *
 * @param initData - Raw initData string from Telegram WebApp
 * @param botToken - BOT_TOKEN env var value
 * @param maxAgeSeconds - Max age of initData (default 300s)
 */
export async function validateTMAInitData(
  initData: string,
  botToken: string,
  maxAgeSeconds = 300
): Promise<TMAValidationResult> {
  // Parse key=value pairs
  const params = new URLSearchParams(initData);
  const receivedHash = params.get('hash');
  if (!receivedHash) {
    return { ok: false, error: 'Missing hash' };
  }

  // auth_date check
  const authDateStr = params.get('auth_date');
  if (!authDateStr) {
    return { ok: false, error: 'Missing auth_date' };
  }
  const authDate = parseInt(authDateStr, 10);
  const now = Math.floor(Date.now() / 1000);
  if (now - authDate > maxAgeSeconds) {
    return { ok: false, error: 'initData expired' };
  }

  // Replay protection
  if (usedHashes.has(receivedHash)) {
    return { ok: false, error: 'Replay detected' };
  }

  // Build data_check_string: sorted key=value pairs except hash, joined by \n
  const entries: string[] = [];
  for (const [key, value] of params.entries()) {
    if (key !== 'hash') entries.push(`${key}=${value}`);
  }
  entries.sort();
  const dataCheckString = entries.join('\n');

  // secret = HMAC-SHA256(key="WebAppData", data=BOT_TOKEN)
  const webAppDataBytes = new TextEncoder().encode('WebAppData');
  const secretKeyBuf = await hmacSHA256(webAppDataBytes, botToken);
  const secretKey = await crypto.subtle.importKey(
    'raw',
    secretKeyBuf,
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );

  const computedHashBuf = await hmacSHA256(secretKey, dataCheckString);
  const computedHash = bufToHex(computedHashBuf);

  if (!timingSafeEqual(computedHash, receivedHash)) {
    return { ok: false, error: 'Invalid signature' };
  }

  // Parse user JSON
  const userStr = params.get('user');
  if (!userStr) {
    return { ok: false, error: 'Missing user field' };
  }
  let user: TMAUser;
  try {
    user = JSON.parse(userStr) as TMAUser;
  } catch {
    return { ok: false, error: 'Invalid user JSON' };
  }
  if (!user.id || !user.first_name) {
    return { ok: false, error: 'Incomplete user data' };
  }

  // Mark hash as used (replay protection)
  usedHashes.set(receivedHash, now);

  return { ok: true, user, hash: receivedHash };
}

/**
 * Extract initData from `Authorization: TMA <initData>` header.
 * Returns null if header is absent or malformed.
 */
export function extractTMAInitData(request: Request): string | null {
  const authHeader = request.headers.get('authorization') ?? '';
  if (!authHeader.startsWith('TMA ')) return null;
  const data = authHeader.slice(4).trim();
  return data || null;
}

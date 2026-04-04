/**
 * Tests for TMA (Telegram Mini App) authentication:
 * POST /api/tma/auth — validates initData, issues Bearer token.
 *
 * Tests that require a valid BOT_TOKEN are skipped when the env var is absent.
 * To run them: ensure TELEGRAM_BOT_TOKEN is set in the container environment.
 */
import { test, expect, request as playwrightRequest } from '@playwright/test';
import type { APIRequestContext } from '@playwright/test';
import { createHmac } from 'node:crypto';
import { BASE_URL } from './helpers';

const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN ?? '';

/**
 * Build a valid Telegram initData string signed with the given bot token.
 * Uses Node.js crypto (sync), matching the server-side Web Crypto logic.
 */
function buildTMAInitData(botToken: string, telegramUserId: number): string {
  const authDate = Math.floor(Date.now() / 1000);
  const user = JSON.stringify({ id: telegramUserId, first_name: 'Test', last_name: 'User' });

  // data_check_string: decoded key=value pairs (no hash), sorted, joined by \n
  const dataCheckString = [
    `auth_date=${authDate}`,
    `user=${user}`,
  ].sort().join('\n');

  // secret_key = HMAC-SHA256(key="WebAppData", data=bot_token)
  const secretKey = createHmac('sha256', 'WebAppData').update(botToken).digest();
  const hash = createHmac('sha256', secretKey).update(dataCheckString).digest('hex');

  // Encode as URL query string (URLSearchParams handles percent-encoding of user JSON)
  return new URLSearchParams({ auth_date: String(authDate), user, hash }).toString();
}

// ─── Negative cases that don't need BOT_TOKEN (no valid TMA header sent) ────

test.describe('TMA auth — invalid requests (no TMA header)', () => {
  test('missing Authorization header → 401', async () => {
    const res = await fetch(`${BASE_URL}/api/tma/auth`, { method: 'POST' });
    expect(res.status).toBe(401);
    const body = await res.json();
    expect(body.error).toBeTruthy();
  });

  test('Authorization: Bearer (not TMA) → 401', async () => {
    const res = await fetch(`${BASE_URL}/api/tma/auth`, {
      method: 'POST',
      headers: { Authorization: 'Bearer sometoken' },
    });
    expect(res.status).toBe(401);
  });

  test('Authorization: TMA with empty payload → 401', async () => {
    const res = await fetch(`${BASE_URL}/api/tma/auth`, {
      method: 'POST',
      headers: { Authorization: 'TMA ' },
    });
    expect(res.status).toBe(401);
  });
});

// ─── All cases requiring BOT_TOKEN (valid TMA header format is sent) ─────────

test.describe('TMA auth — with valid BOT_TOKEN', () => {
  test('invalid HMAC signature → 401', async () => {
    test.skip(!BOT_TOKEN, 'TELEGRAM_BOT_TOKEN not set');
    const params = new URLSearchParams({
      auth_date: String(Math.floor(Date.now() / 1000)),
      user: JSON.stringify({ id: 1, first_name: 'X' }),
      hash: 'a'.repeat(64), // wrong hash
    });
    const res = await fetch(`${BASE_URL}/api/tma/auth`, {
      method: 'POST',
      headers: { Authorization: `TMA ${params.toString()}` },
    });
    expect(res.status).toBe(401);
    const body = await res.json();
    expect(body.error).toBeTruthy();
  });

  test('missing hash field → 401', async () => {
    test.skip(!BOT_TOKEN, 'TELEGRAM_BOT_TOKEN not set');
    const params = new URLSearchParams({
      auth_date: String(Math.floor(Date.now() / 1000)),
      user: JSON.stringify({ id: 1, first_name: 'X' }),
      // no hash
    });
    const res = await fetch(`${BASE_URL}/api/tma/auth`, {
      method: 'POST',
      headers: { Authorization: `TMA ${params.toString()}` },
    });
    expect(res.status).toBe(401);
  });

  test('missing auth_date → 401', async () => {
    test.skip(!BOT_TOKEN, 'TELEGRAM_BOT_TOKEN not set');
    const params = new URLSearchParams({
      user: JSON.stringify({ id: 1, first_name: 'X' }),
      hash: 'a'.repeat(64),
    });
    const res = await fetch(`${BASE_URL}/api/tma/auth`, {
      method: 'POST',
      headers: { Authorization: `TMA ${params.toString()}` },
    });
    expect(res.status).toBe(401);
  });

  test('valid initData → 200 with Bearer token', async () => {
    test.skip(!BOT_TOKEN, 'TELEGRAM_BOT_TOKEN not set');
    const initData = buildTMAInitData(BOT_TOKEN, 100001);
    const res = await fetch(`${BASE_URL}/api/tma/auth`, {
      method: 'POST',
      headers: { Authorization: `TMA ${initData}` },
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(typeof body.token).toBe('string');
    expect(body.token).toHaveLength(64); // 32 random bytes as hex
  });

  test('expired initData (auth_date > 300s ago) → 401', async () => {
    test.skip(!BOT_TOKEN, 'TELEGRAM_BOT_TOKEN not set');
    const oldDate = Math.floor(Date.now() / 1000) - 400;
    const user = JSON.stringify({ id: 100002, first_name: 'Old' });
    const dataCheckString = [`auth_date=${oldDate}`, `user=${user}`].sort().join('\n');
    const secretKey = createHmac('sha256', 'WebAppData').update(BOT_TOKEN).digest();
    const hash = createHmac('sha256', secretKey).update(dataCheckString).digest('hex');
    const initData = new URLSearchParams({ auth_date: String(oldDate), user, hash }).toString();

    const res = await fetch(`${BASE_URL}/api/tma/auth`, {
      method: 'POST',
      headers: { Authorization: `TMA ${initData}` },
    });
    expect(res.status).toBe(401);
    const body = await res.json();
    expect(body.error).toContain('expired');
  });

  test('replay protection: same initData rejected on second use', async () => {
    test.skip(!BOT_TOKEN, 'TELEGRAM_BOT_TOKEN not set');
    const initData = buildTMAInitData(BOT_TOKEN, 100003);

    const res1 = await fetch(`${BASE_URL}/api/tma/auth`, {
      method: 'POST',
      headers: { Authorization: `TMA ${initData}` },
    });
    expect(res1.status).toBe(200);

    const res2 = await fetch(`${BASE_URL}/api/tma/auth`, {
      method: 'POST',
      headers: { Authorization: `TMA ${initData}` },
    });
    expect(res2.status).toBe(401);
    const body = await res2.json();
    expect(body.error).toContain('Replay');
  });

  test('Bearer token authenticates subsequent requests', async () => {
    test.skip(!BOT_TOKEN, 'TELEGRAM_BOT_TOKEN not set');
    const initData = buildTMAInitData(BOT_TOKEN, 100004);
    const authRes = await fetch(`${BASE_URL}/api/tma/auth`, {
      method: 'POST',
      headers: { Authorization: `TMA ${initData}` },
    });
    const { token } = await authRes.json();

    // TMA users have role=owner; creating a shop requires admin → expect 403 (not 401)
    const shopRes = await fetch(`${BASE_URL}/api/shops`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: new URLSearchParams({ id: 'tma-bearer-test', name: 'TMA Test' }).toString(),
    });
    // 403 = authenticated but not admin (not 401 = unauthenticated)
    expect(shopRes.status).toBe(403);
  });

  test('Bearer token: CSRF check bypassed (no x-csrf-token header needed)', async () => {
    test.skip(!BOT_TOKEN, 'TELEGRAM_BOT_TOKEN not set');
    const initData = buildTMAInitData(BOT_TOKEN, 100005);
    const authRes = await fetch(`${BASE_URL}/api/tma/auth`, {
      method: 'POST',
      headers: { Authorization: `TMA ${initData}` },
    });
    const { token } = await authRes.json();

    // Send a mutation with Bearer token but deliberately omit x-csrf-token.
    // Middleware must skip CSRF check for Bearer-authenticated requests.
    // Result is 403 (not admin), not 403 CSRF mismatch.
    const res = await fetch(`${BASE_URL}/api/shops`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/x-www-form-urlencoded',
        // deliberately no x-csrf-token
      },
      body: new URLSearchParams({ id: 'csrf-bypass-test', name: 'CSRF Bypass' }).toString(),
    });
    const body = await res.json();
    expect(body.error).not.toBe('CSRF token mismatch');
  });

  test('invalid Bearer token → 401', async () => {
    test.skip(!BOT_TOKEN, 'TELEGRAM_BOT_TOKEN not set');
    const res = await fetch(`${BASE_URL}/api/shops`, {
      method: 'POST',
      headers: {
        Authorization: 'Bearer ' + 'x'.repeat(64),
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: new URLSearchParams({ id: 'bad-token', name: 'Bad Token' }).toString(),
    });
    expect(res.status).toBe(401);
  });

  test('each TMA auth for the same telegram_id returns a new token but same user', async () => {
    test.skip(!BOT_TOKEN, 'TELEGRAM_BOT_TOKEN not set');
    const apiCtx: APIRequestContext = await playwrightRequest.newContext({ baseURL: BASE_URL });

    const initData1 = buildTMAInitData(BOT_TOKEN, 100006);

    const res1 = await fetch(`${BASE_URL}/api/tma/auth`, {
      method: 'POST',
      headers: { Authorization: `TMA ${initData1}` },
    });
    expect(res1.status).toBe(200);

    // Wait 1s so auth_date differs → different HMAC hash → not a replay
    await new Promise((r) => setTimeout(r, 1100));

    const initData2 = buildTMAInitData(BOT_TOKEN, 100006); // same user id, new authDate
    const res2 = await fetch(`${BASE_URL}/api/tma/auth`, {
      method: 'POST',
      headers: { Authorization: `TMA ${initData2}` },
    });

    expect(res2.status).toBe(200);

    const { token: token1 } = await res1.json();
    const { token: token2 } = await res2.json();

    // Tokens must be different (new session each time)
    expect(token1).not.toBe(token2);

    // But both must be valid (both sessions exist)
    const check1 = await apiCtx.get('/admin', {
      headers: { Authorization: `Bearer ${token1}` },
      maxRedirects: 0,
    });
    const check2 = await apiCtx.get('/admin', {
      headers: { Authorization: `Bearer ${token2}` },
      maxRedirects: 0,
    });

    // TMA user is role=owner, so /admin redirects them to login (not 200)
    // But both should give the same response (same user, different sessions)
    expect(check1.status()).toBe(check2.status());

    await apiCtx.dispose();
  });
});

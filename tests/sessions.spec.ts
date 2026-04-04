/**
 * Tests for user session management:
 * - Max 10 concurrent sessions per user (11th evicts the oldest)
 * - Auto-bootstrap: first successful password login creates admin user
 * - Session is user-linked (tied to users table, not anonymous)
 */
import { test, expect, request as playwrightRequest } from '@playwright/test';
import { ADMIN_PASSWORD, BASE_URL } from './helpers';

async function rawLogin(): Promise<string | null> {
  const res = await fetch(`${BASE_URL}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ password: ADMIN_PASSWORD, redirect: '/admin' }).toString(),
    redirect: 'manual',
  });
  const setCookie = res.headers.get('set-cookie') ?? '';
  const match = setCookie.match(/admin_token=([^;]+)/);
  return match ? match[1] : null;
}

async function isSessionValid(token: string): Promise<boolean> {
  const res = await fetch(`${BASE_URL}/admin`, {
    headers: { cookie: `admin_token=${token}` },
    redirect: 'manual',
  });
  return res.status === 200;
}

test.describe('Session management', () => {
  test('login creates a valid session linked to admin user', async () => {
    const token = await rawLogin();
    expect(token).toBeTruthy();
    expect(await isSessionValid(token!)).toBe(true);
  });

  test('invalid token is rejected', async () => {
    expect(await isSessionValid('x'.repeat(64))).toBe(false);
  });

  test('session is destroyed on logout', async () => {
    const token = await rawLogin();
    expect(token).toBeTruthy();

    // Get CSRF token first (needed for logout form POST)
    const apiCtx = await playwrightRequest.newContext({ baseURL: BASE_URL });
    const page = await apiCtx.get('/admin', {
      headers: { cookie: `admin_token=${token}` },
    });
    const html = await page.text();
    const csrfMatch = html.match(/name="csrf-token"\s+content="([^"]+)"/);
    expect(csrfMatch).toBeTruthy();
    const csrfToken = csrfMatch![1];

    const logoutRes = await fetch(`${BASE_URL}/api/auth/logout`, {
      method: 'POST',
      headers: {
        cookie: `admin_token=${token}`,
        'x-csrf-token': csrfToken,
      },
      redirect: 'manual',
    });
    expect(logoutRes.status).toBe(302);

    // Session must no longer be valid
    expect(await isSessionValid(token!)).toBe(false);

    await apiCtx.dispose();
  });

  test('max 10 concurrent sessions: 11th login evicts one old session', async () => {
    // Collect 11 tokens. Rate limiter resets on each successful login, so
    // we can do this without hitting the 5-attempts-per-15-min limit.
    const tokens: string[] = [];
    for (let i = 0; i < 11; i++) {
      const token = await rawLogin();
      expect(token).toBeTruthy();
      tokens.push(token!);
    }
    expect(tokens.length).toBe(11);

    // The 11th token (most recently created) must always be valid
    expect(await isSessionValid(tokens[10])).toBe(true);

    // Across all 11, exactly 10 should be valid (one was evicted)
    const results = await Promise.all(tokens.map(isSessionValid));
    const validCount = results.filter(Boolean).length;
    expect(validCount).toBe(10);
  });

  test('auto-bootstrap: password login works even without SEED env vars', async () => {
    // The first successful password login creates an admin user automatically
    // (ensureAdminUser in login.ts). We verify this indirectly: login succeeds
    // and the resulting session can access /admin.
    const token = await rawLogin();
    expect(token).toBeTruthy();
    expect(await isSessionValid(token!)).toBe(true);
  });

  test('Bearer token from cookie: same session cookie works with Authorization: Bearer', async () => {
    // Sessions are transport-agnostic: the raw token works in both cookie and Bearer header
    const token = await rawLogin();
    expect(token).toBeTruthy();

    const apiCtx = await playwrightRequest.newContext({ baseURL: BASE_URL });

    // Access /admin via Bearer header (not cookie)
    const res = await apiCtx.get('/admin', {
      headers: { Authorization: `Bearer ${token}` },
      maxRedirects: 0,
    });
    // Admin user has role=admin → 200
    expect(res.status()).toBe(200);

    await apiCtx.dispose();
  });
});

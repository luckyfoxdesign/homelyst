import { test, expect, request as playwrightRequest } from '@playwright/test';
import type { APIRequestContext } from '@playwright/test';
import { adminLogin, ADMIN_PASSWORD, BASE_URL } from './helpers';

/**
 * Native fetch login helper for auth tests that need to inspect
 * the raw 302 + Set-Cookie response (Playwright crashes on Set-Cookie
 * with Node 24 + Playwright 1.59).
 */
async function rawLogin(params: Record<string, string> = {}) {
  const body = new URLSearchParams({
    password: ADMIN_PASSWORD,
    redirect: '/admin',
    ...params,
  });
  return fetch(`${BASE_URL}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: body.toString(),
    redirect: 'manual',
  });
}

test.describe('Authentication', () => {
  let req: APIRequestContext;

  test.beforeEach(async () => {
    req = await playwrightRequest.newContext({ baseURL: BASE_URL });
  });

  test.afterEach(async () => {
    await req.dispose();
  });

  test('login with correct password sets admin_token cookie', async () => {
    const res = await rawLogin();
    expect(res.status).toBe(302);
    expect(res.headers.get('location')).toBe('/admin');
    const setCookie = res.headers.get('set-cookie') ?? '';
    expect(setCookie).toMatch(/admin_token=/);
    expect(setCookie).toMatch(/HttpOnly/i);
    expect(setCookie).toMatch(/SameSite=Lax/i);
  });

  test('login with wrong password redirects with error=1', async () => {
    const res = await rawLogin({ password: 'wrongpassword' });
    expect(res.status).toBe(302);
    expect(res.headers.get('location')).toContain('error=1');
    expect(res.headers.get('set-cookie') ?? '').not.toContain('admin_token=');
  });

  test('/admin redirects to login when unauthenticated', async () => {
    const res = await req.get('/admin', { maxRedirects: 0 });
    expect(res.status()).toBe(302);
    expect(res.headers()['location']).toContain('/admin/login');
  });

  test('/admin is accessible when authenticated', async () => {
    const { cookie } = await adminLogin(req);
    const res = await req.get('/admin', {
      headers: { cookie: `admin_token=${cookie}` },
    });
    expect(res.status()).toBe(200);
  });

  test('logout clears the session cookie', async () => {
    const { cookie, csrfToken } = await adminLogin(req);

    // Logout via native fetch (response has Set-Cookie with Max-Age=0)
    const logoutRes = await fetch(`${BASE_URL}/api/auth/logout`, {
      method: 'POST',
      headers: { cookie: `admin_token=${cookie}`, 'x-csrf-token': csrfToken },
      redirect: 'manual',
    });
    expect(logoutRes.status).toBe(302);
    expect(logoutRes.headers.get('set-cookie')).toMatch(/Max-Age=0/);

    // Invalidated session no longer grants access
    const adminRes = await req.get('/admin', {
      headers: { cookie: `admin_token=${cookie}` },
      maxRedirects: 0,
    });
    expect(adminRes.status()).toBe(302);
    expect(adminRes.headers()['location']).toContain('/admin/login');
  });

  test('redirect validation: open redirect is rejected', async () => {
    const res = await rawLogin({ redirect: 'https://evil.com' });
    expect(res.status).toBe(302);
    expect(res.headers.get('location')).toBe('/admin');
  });

  test('redirect validation: protocol-relative redirect is rejected', async () => {
    const res = await rawLogin({ redirect: '//evil.com' });
    expect(res.status).toBe(302);
    expect(res.headers.get('location')).toBe('/admin');
  });

  test('csrf-token meta tag is present on admin page', async () => {
    const { cookie, csrfToken } = await adminLogin(req);
    expect(csrfToken).toHaveLength(64); // 32 bytes hex
    const page = await req.get('/admin', {
      headers: { cookie: `admin_token=${cookie}` },
    });
    const html = await page.text();
    expect(html).toContain(`content="${csrfToken}"`);
  });
});

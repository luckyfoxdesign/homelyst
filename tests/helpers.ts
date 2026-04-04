import { type APIRequestContext } from '@playwright/test';

export const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD ?? 'changeme';
export const BASE_URL = process.env.BASE_URL ?? 'http://localhost:4321';

/**
 * Log in via native fetch (bypasses Playwright's Set-Cookie handling
 * which crashes on Node 24 + Playwright 1.59). Then extract CSRF token
 * via the Playwright context (GET /admin has no Set-Cookie, so it's safe).
 */
export async function adminLogin(request: APIRequestContext): Promise<{ cookie: string; csrfToken: string }> {
  const body = new URLSearchParams({ password: ADMIN_PASSWORD, redirect: '/admin' });
  const res = await fetch(`${BASE_URL}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: body.toString(),
    redirect: 'manual',
  });

  const raw = res.headers.get('set-cookie') ?? '';
  const match = raw.match(/admin_token=([^;]+)/);
  if (!match) throw new Error(`Login failed — status ${res.status}, set-cookie: ${raw}`);
  const cookie = match[1];

  // Fetch admin page to extract CSRF meta tag (no Set-Cookie in response — safe for Playwright)
  const page = await request.get('/admin', {
    headers: { cookie: `admin_token=${cookie}` },
  });
  const html = await page.text();
  const csrfMatch = html.match(/name="csrf-token"\s+content="([^"]+)"/);
  if (!csrfMatch) throw new Error('Could not extract CSRF token from admin page');

  return { cookie, csrfToken: csrfMatch[1] };
}

/** Generate a unique shop ID safe for test isolation. */
export function uniqueShopId(): string {
  return `test-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
}

/** Delete a shop (best-effort cleanup, won't throw). */
export async function deleteShop(
  request: APIRequestContext,
  shopId: string,
  cookie: string,
  csrfToken: string,
): Promise<void> {
  await request.delete(`/api/shops/${shopId}`, {
    headers: { cookie: `admin_token=${cookie}`, 'x-csrf-token': csrfToken },
  }).catch(() => {});
}

/** Create a shop. */
export async function createShop(
  request: APIRequestContext,
  id: string,
  name: string,
  cookie: string,
): Promise<void> {
  await request.post('/api/shops', {
    form: { id, name },
    headers: { cookie: `admin_token=${cookie}` },
  });
}

/** Create a product in a shop and return its id. */
export async function createProduct(
  request: APIRequestContext,
  shopId: string,
  title: string,
  cookie: string,
): Promise<number> {
  const res = await request.post(`/api/shops/${shopId}/products`, {
    multipart: { title, price: '10', description: 'Test product' },
    headers: { cookie: `admin_token=${cookie}` },
  });
  const body = await res.json();
  return body.product.id as number;
}

/** Reserve a product as a public user. */
export async function reserveProduct(
  request: APIRequestContext,
  shopId: string,
  productId: number,
  name = 'Test Buyer',
): Promise<void> {
  await request.post(`/api/shops/${shopId}/products/${productId}/reserve`, {
    data: { name },
  });
}

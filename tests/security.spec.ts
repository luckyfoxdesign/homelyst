import { test, expect, request as playwrightRequest } from '@playwright/test';
import type { APIRequestContext } from '@playwright/test';
import { adminLogin, uniqueShopId, deleteShop, createShop, createProduct, BASE_URL } from './helpers';

test.describe('Security', () => {
  let apiCtx: APIRequestContext;
  let cookie: string;
  let csrfToken: string;
  let shopId: string;
  let productId: number;

  test.beforeAll(async () => {
    apiCtx = await playwrightRequest.newContext({ baseURL: BASE_URL });
    ({ cookie, csrfToken } = await adminLogin(apiCtx));
    shopId = uniqueShopId();
    await createShop(apiCtx, shopId, 'Security Test Shop', cookie);
    productId = await createProduct(apiCtx, shopId, 'Security Product', cookie);
  });

  test.afterAll(async () => {
    await deleteShop(apiCtx, shopId, cookie, csrfToken);
    await apiCtx.dispose();
  });

  test.describe('CSRF protection', () => {
    test('DELETE /api/shops/:id without CSRF token returns 403', async () => {
      const res = await apiCtx.delete(`/api/shops/${shopId}`, {
        headers: { cookie: `admin_token=${cookie}` },
      });
      expect(res.status()).toBe(403);
      expect((await res.json()).error).toContain('CSRF');
    });

    test('DELETE /api/shops/:id with wrong CSRF token returns 403', async () => {
      const res = await apiCtx.delete(`/api/shops/${shopId}`, {
        headers: { cookie: `admin_token=${cookie}`, 'x-csrf-token': 'deadbeef'.repeat(8) },
      });
      expect(res.status()).toBe(403);
    });

    test('DELETE /api/shops/:id with correct CSRF token passes (404 = shop not found, not 403)', async () => {
      const res = await apiCtx.delete('/api/shops/does-not-exist', {
        headers: { cookie: `admin_token=${cookie}`, 'x-csrf-token': csrfToken },
      });
      expect(res.status()).toBe(404); // CSRF passed, got 404 from handler
    });

    test('POST confirm without CSRF token returns 403', async () => {
      const res = await apiCtx.post(`/api/shops/${shopId}/products/${productId}/confirm`, {
        headers: { cookie: `admin_token=${cookie}` },
      });
      expect(res.status()).toBe(403);
    });

    test('POST release without CSRF token returns 403', async () => {
      const res = await apiCtx.post(`/api/shops/${shopId}/products/${productId}/release`, {
        headers: { cookie: `admin_token=${cookie}` },
      });
      expect(res.status()).toBe(403);
    });

    test('POST sold without CSRF token returns 403', async () => {
      const res = await apiCtx.post(`/api/shops/${shopId}/products/${productId}/sold`, {
        headers: { cookie: `admin_token=${cookie}` },
      });
      expect(res.status()).toBe(403);
    });

    test('DELETE product without CSRF token returns 403', async () => {
      const res = await apiCtx.delete(`/api/shops/${shopId}/products/${productId}`, {
        headers: { cookie: `admin_token=${cookie}` },
      });
      expect(res.status()).toBe(403);
    });

    test('form POST (shop creation) bypasses CSRF check — protected by SameSite=Lax', async () => {
      // multipart/form-data submission must NOT be blocked, even without X-CSRF-Token
      const id = uniqueShopId();
      const res = await apiCtx.post('/api/shops', {
        form: { id, name: 'Form Shop' },
        headers: { cookie: `admin_token=${cookie}` },
        // deliberately no x-csrf-token header
        maxRedirects: 0,
      });
      expect(res.status()).toBe(302); // succeeded
      await deleteShop(apiCtx, id, cookie, csrfToken);
    });
  });

  test.describe('CSRF does not block public endpoints', () => {
    test('POST /reserve with admin cookie but no CSRF token is allowed', async () => {
      // Reserve endpoint is public — should never be blocked by CSRF
      // even if the admin cookie is incidentally present
      const tempProductId = await createProduct(apiCtx, shopId, 'Public Reserve Test', cookie);

      const res = await apiCtx.post(`/api/shops/${shopId}/products/${tempProductId}/reserve`, {
        data: { name: 'Public User' },
        headers: { cookie: `admin_token=${cookie}` }, // admin cookie present, no CSRF
      });
      // Should not be blocked (200 = reserved, or 409 if already reserved)
      expect([200, 409]).toContain(res.status());
    });
  });

  test.describe('Unauthenticated access to admin API', () => {
    const adminEndpoints: Array<{ method: string; path: string }> = [
      { method: 'POST', path: '/api/shops' },
      { method: 'DELETE', path: '/api/shops/any' },
      { method: 'POST', path: '/api/shops/any/products' },
      { method: 'DELETE', path: '/api/shops/any/products/1' },
      { method: 'POST', path: '/api/shops/any/products/1/confirm' },
      { method: 'POST', path: '/api/shops/any/products/1/release' },
      { method: 'POST', path: '/api/shops/any/products/1/sold' },
    ];

    for (const { method, path } of adminEndpoints) {
      test(`${method} ${path} returns 401 without auth`, async () => {
        const res = await apiCtx.fetch(path, {
          method,
          headers: { 'content-type': 'application/json', 'x-csrf-token': csrfToken },
        });
        expect(res.status()).toBe(401);
      });
    }
  });

  test.describe('Security headers', () => {
    test('admin page includes required security headers', async () => {
      const res = await apiCtx.get('/admin', {
        headers: { cookie: `admin_token=${cookie}` },
      });
      expect(res.headers()['x-content-type-options']).toBe('nosniff');
      expect(res.headers()['x-frame-options']).toBe('DENY');
      expect(res.headers()['referrer-policy']).toBe('strict-origin-when-cross-origin');
      expect(res.headers()['content-security-policy']).toContain("default-src 'self'");
      expect(res.headers()['content-security-policy']).toContain("frame-ancestors 'none'");
    });

    test('shop page includes Telegram-specific CSP', async () => {
      const res = await apiCtx.get(`/shop/${shopId}`);
      expect(res.headers()['content-security-policy']).toContain('https://api.telegram.org');
      expect(res.headers()['content-security-policy']).toContain('https://web.telegram.org');
    });
  });

  test.describe('Input validation', () => {
    test('productId with non-numeric characters returns 404 (not 500)', async () => {
      const res = await apiCtx.post(`/api/shops/${shopId}/products/abc/confirm`, {
        headers: { cookie: `admin_token=${cookie}`, 'x-csrf-token': csrfToken },
      });
      // parseInt('abc') = NaN → getProduct(NaN) returns undefined → 404
      expect(res.status()).toBe(404);
    });

    test('shopId with special characters returns 404', async () => {
      const res = await apiCtx.get('/shop/../../etc/passwd');
      expect([404, 500]).toContain(res.status());
      // Must not expose any real file or admin content
      const body = await res.text();
      expect(body).not.toContain('root:');
    });
  });

  test.describe('Reserve — public endpoint safety', () => {
    test('reserve returns 404 for non-existent product', async () => {
      const res = await apiCtx.post(`/api/shops/${shopId}/products/999999/reserve`, {
        data: { name: 'Ghost Buyer' },
      });
      expect(res.status()).toBe(404);
    });

    test('reserve returns 404 for product in wrong shop', async () => {
      const otherId = uniqueShopId();
      await createShop(apiCtx, otherId, 'Other', cookie);
      const otherProduct = await createProduct(apiCtx, otherId, 'Other Product', cookie);

      // Try to reserve otherProduct via shopId — cross-shop
      const res = await apiCtx.post(`/api/shops/${shopId}/products/${otherProduct}/reserve`, {
        data: { name: 'Cross Buyer' },
      });
      expect(res.status()).toBe(404);

      await deleteShop(apiCtx, otherId, cookie, csrfToken);
    });
  });
});

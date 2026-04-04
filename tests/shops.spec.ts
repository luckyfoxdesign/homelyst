import { test, expect, request as playwrightRequest } from '@playwright/test';
import type { APIRequestContext } from '@playwright/test';
import { adminLogin, uniqueShopId, deleteShop, createShop, BASE_URL } from './helpers';

test.describe('Shops', () => {
  let apiCtx: APIRequestContext;
  let cookie: string;
  let csrfToken: string;

  test.beforeAll(async () => {
    apiCtx = await playwrightRequest.newContext({ baseURL: BASE_URL });
    ({ cookie, csrfToken } = await adminLogin(apiCtx));
  });

  test.afterAll(async () => {
    await apiCtx.dispose();
  });

  test.describe('Create shop', () => {
    test('creates shop and redirects to /admin/:id', async () => {
      const id = uniqueShopId();
      const res = await apiCtx.post('/api/shops', {
        form: { id, name: 'Test Shop' },
        headers: { cookie: `admin_token=${cookie}` },
        maxRedirects: 0,
      });
      expect(res.status()).toBe(302);
      expect(res.headers()['location']).toBe(`/admin/${id}`);

      await deleteShop(apiCtx, id, cookie, csrfToken);
    });

    test('rejects duplicate shop ID with 409', async () => {
      const id = uniqueShopId();
      await createShop(apiCtx, id, 'Shop A', cookie);

      const res = await apiCtx.post('/api/shops', {
        form: { id, name: 'Shop B' },
        headers: { cookie: `admin_token=${cookie}` },
        maxRedirects: 0,
      });
      expect(res.status()).toBe(409);

      await deleteShop(apiCtx, id, cookie, csrfToken);
    });

    test('rejects shop ID with invalid characters', async () => {
      const res = await apiCtx.post('/api/shops', {
        form: { id: 'My Shop!', name: 'Bad ID' },
        headers: { cookie: `admin_token=${cookie}` },
        maxRedirects: 0,
      });
      expect(res.status()).toBe(400);
    });

    test('rejects shop ID longer than 50 characters', async () => {
      const res = await apiCtx.post('/api/shops', {
        form: { id: 'a'.repeat(51), name: 'Too Long' },
        headers: { cookie: `admin_token=${cookie}` },
        maxRedirects: 0,
      });
      expect(res.status()).toBe(400);
    });

    test.describe('Reserved slugs', () => {
      for (const slug of ['admin', 'api', 'tma', 'dashboard', 'login', 'auth', 'shop']) {
        test(`rejects reserved slug "${slug}"`, async () => {
          const res = await apiCtx.post('/api/shops', {
            form: { id: slug, name: 'Reserved' },
            headers: { cookie: `admin_token=${cookie}` },
            maxRedirects: 0,
          });
          expect(res.status()).toBe(400);
          const body = await res.json();
          expect(body.error).toContain('зарезервирован');
        });
      }
    });

    test('requires authentication', async () => {
      const res = await apiCtx.post('/api/shops', {
        form: { id: uniqueShopId(), name: 'Unauthorized' },
        maxRedirects: 0,
      });
      expect(res.status()).toBe(401);
    });
  });

  test.describe('Delete shop', () => {
    test('deletes shop and returns success', async () => {
      const id = uniqueShopId();
      await createShop(apiCtx, id, 'To Delete', cookie);

      const res = await apiCtx.delete(`/api/shops/${id}`, {
        headers: { cookie: `admin_token=${cookie}`, 'x-csrf-token': csrfToken },
      });
      expect(res.status()).toBe(200);
      const body = await res.json();
      expect(body.success).toBe(true);
    });

    test('returns 404 for non-existent shop', async () => {
      const res = await apiCtx.delete('/api/shops/does-not-exist-xyz', {
        headers: { cookie: `admin_token=${cookie}`, 'x-csrf-token': csrfToken },
      });
      expect(res.status()).toBe(404);
    });

    test('requires authentication', async () => {
      const res = await apiCtx.delete('/api/shops/any-shop', {
        headers: { 'x-csrf-token': csrfToken },
      });
      expect(res.status()).toBe(401);
    });
  });

  test.describe('Shop page', () => {
    test('public shop page returns 200', async () => {
      const id = uniqueShopId();
      await createShop(apiCtx, id, 'Public Shop', cookie);

      const res = await apiCtx.get(`/shop/${id}`);
      expect(res.status()).toBe(200);

      await deleteShop(apiCtx, id, cookie, csrfToken);
    });

    test('unknown shop returns 404', async () => {
      const res = await apiCtx.get('/shop/this-shop-does-not-exist-xyz');
      expect(res.status()).toBe(404);
    });
  });
});

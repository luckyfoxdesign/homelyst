import { test, expect, request as playwrightRequest } from '@playwright/test';
import type { APIRequestContext } from '@playwright/test';
import { adminLogin, uniqueShopId, deleteShop, createShop, createProduct, reserveProduct, BASE_URL } from './helpers';

test.describe('Products', () => {
  let apiCtx: APIRequestContext;
  let cookie: string;
  let csrfToken: string;
  let shopId: string;

  test.beforeAll(async () => {
    apiCtx = await playwrightRequest.newContext({ baseURL: BASE_URL });
    ({ cookie, csrfToken } = await adminLogin(apiCtx));
    shopId = uniqueShopId();
    await createShop(apiCtx, shopId, 'Products Test Shop', cookie);
  });

  test.afterAll(async () => {
    await deleteShop(apiCtx, shopId, cookie, csrfToken);
    await apiCtx.dispose();
  });

  test.describe('Create product', () => {
    test('creates product and returns it', async () => {
      const res = await apiCtx.post(`/api/shops/${shopId}/products`, {
        multipart: { title: 'Test Item', price: '25.50', description: 'A test item' },
        headers: { cookie: `admin_token=${cookie}` },
      });
      expect(res.status()).toBe(200);
      const body = await res.json();
      expect(body.success).toBe(true);
      expect(body.product.title).toBe('Test Item');
      expect(body.product.price).toBe(25.50);
      expect(body.product.status).toBe('available');
    });

    test('rejects missing title', async () => {
      const res = await apiCtx.post(`/api/shops/${shopId}/products`, {
        multipart: { price: '10' },
        headers: { cookie: `admin_token=${cookie}` },
      });
      expect(res.status()).toBe(400);
    });

    test('rejects title longer than 200 characters', async () => {
      const res = await apiCtx.post(`/api/shops/${shopId}/products`, {
        multipart: { title: 'x'.repeat(201), price: '10' },
        headers: { cookie: `admin_token=${cookie}` },
      });
      expect(res.status()).toBe(400);
    });

    test('requires authentication', async () => {
      const ctx = await playwrightRequest.newContext({ baseURL: BASE_URL });
      const res = await ctx.post(`/api/shops/${shopId}/products`, {
        multipart: { title: 'Unauth', price: '0' },
      });
      expect(res.status()).toBe(401);
      await ctx.dispose();
    });
  });

  test.describe('Delete product', () => {
    test('deletes product successfully', async () => {
      const productId = await createProduct(apiCtx, shopId, 'To Delete', cookie);

      const res = await apiCtx.delete(`/api/shops/${shopId}/products/${productId}`, {
        headers: { cookie: `admin_token=${cookie}`, 'x-csrf-token': csrfToken },
      });
      expect(res.status()).toBe(200);
      const body = await res.json();
      expect(body.success).toBe(true);
    });

    test('returns 404 for non-existent product', async () => {
      const res = await apiCtx.delete(`/api/shops/${shopId}/products/999999`, {
        headers: { cookie: `admin_token=${cookie}`, 'x-csrf-token': csrfToken },
      });
      expect(res.status()).toBe(404);
    });

    test('cannot delete product from another shop', async () => {
      const otherId = uniqueShopId();
      await createShop(apiCtx, otherId, 'Other Shop', cookie);
      const productId = await createProduct(apiCtx, otherId, 'Other Product', cookie);

      const res = await apiCtx.delete(`/api/shops/${shopId}/products/${productId}`, {
        headers: { cookie: `admin_token=${cookie}`, 'x-csrf-token': csrfToken },
      });
      expect(res.status()).toBe(404);

      await deleteShop(apiCtx, otherId, cookie, csrfToken);
    });
  });

  test.describe('Status machine: reserve → confirm → sold', () => {
    test('full lifecycle: available → reserved → confirmed → sold', async () => {
      const productId = await createProduct(apiCtx, shopId, 'Lifecycle Product', cookie);

      // 1. Reserve (public endpoint)
      const reserveRes = await apiCtx.post(`/api/shops/${shopId}/products/${productId}/reserve`, {
        data: { name: 'Test Buyer' },
      });
      expect(reserveRes.status()).toBe(200);

      // 2. Confirm (admin)
      const confirmRes = await apiCtx.post(
        `/api/shops/${shopId}/products/${productId}/confirm`,
        { headers: { cookie: `admin_token=${cookie}`, 'x-csrf-token': csrfToken } },
      );
      expect(confirmRes.status()).toBe(200);
      expect((await confirmRes.json()).success).toBe(true);

      // 3. Mark sold (admin)
      const soldRes = await apiCtx.post(
        `/api/shops/${shopId}/products/${productId}/sold`,
        { headers: { cookie: `admin_token=${cookie}`, 'x-csrf-token': csrfToken } },
      );
      expect(soldRes.status()).toBe(200);
      expect((await soldRes.json()).success).toBe(true);
    });

    test('full lifecycle: available → reserved → released → available again', async () => {
      const productId = await createProduct(apiCtx, shopId, 'Release Product', cookie);

      await reserveProduct(apiCtx, shopId, productId);

      const releaseRes = await apiCtx.post(
        `/api/shops/${shopId}/products/${productId}/release`,
        { headers: { cookie: `admin_token=${cookie}`, 'x-csrf-token': csrfToken } },
      );
      expect(releaseRes.status()).toBe(200);

      // Can be reserved again after release
      const reserveAgain = await apiCtx.post(
        `/api/shops/${shopId}/products/${productId}/reserve`,
        { data: { name: 'Second Buyer' } },
      );
      expect(reserveAgain.status()).toBe(200);
    });

    test('cannot confirm an already-confirmed reservation', async () => {
      const productId = await createProduct(apiCtx, shopId, 'Double Confirm', cookie);
      await reserveProduct(apiCtx, shopId, productId);

      await apiCtx.post(`/api/shops/${shopId}/products/${productId}/confirm`, {
        headers: { cookie: `admin_token=${cookie}`, 'x-csrf-token': csrfToken },
      });

      // Second confirm must fail with 409
      const res = await apiCtx.post(`/api/shops/${shopId}/products/${productId}/confirm`, {
        headers: { cookie: `admin_token=${cookie}`, 'x-csrf-token': csrfToken },
      });
      expect(res.status()).toBe(409);
    });

    test('cannot release an available product', async () => {
      const productId = await createProduct(apiCtx, shopId, 'No Release Available', cookie);

      const res = await apiCtx.post(`/api/shops/${shopId}/products/${productId}/release`, {
        headers: { cookie: `admin_token=${cookie}`, 'x-csrf-token': csrfToken },
      });
      expect(res.status()).toBe(409);
    });

    test('cannot mark sold an unconfirmed reservation', async () => {
      const productId = await createProduct(apiCtx, shopId, 'Sold Unconfirmed', cookie);
      await reserveProduct(apiCtx, shopId, productId);

      const res = await apiCtx.post(`/api/shops/${shopId}/products/${productId}/sold`, {
        headers: { cookie: `admin_token=${cookie}`, 'x-csrf-token': csrfToken },
      });
      expect(res.status()).toBe(409);
    });

    test('cannot mark sold an available product', async () => {
      const productId = await createProduct(apiCtx, shopId, 'Sold Available', cookie);

      const res = await apiCtx.post(`/api/shops/${shopId}/products/${productId}/sold`, {
        headers: { cookie: `admin_token=${cookie}`, 'x-csrf-token': csrfToken },
      });
      expect(res.status()).toBe(409);
    });

    test('cannot reserve an already-reserved product', async () => {
      const productId = await createProduct(apiCtx, shopId, 'Double Reserve', cookie);
      await reserveProduct(apiCtx, shopId, productId, 'First Buyer');

      const res = await apiCtx.post(`/api/shops/${shopId}/products/${productId}/reserve`, {
        data: { name: 'Second Buyer' },
      });
      expect(res.status()).toBe(409);
      const body = await res.json();
      expect(body.error).toContain('reserved');
    });
  });

  test.describe('Reserve (public endpoint)', () => {
    test('requires a name', async () => {
      const productId = await createProduct(apiCtx, shopId, 'Nameless Reserve', cookie);

      const res = await apiCtx.post(`/api/shops/${shopId}/products/${productId}/reserve`, {
        data: { name: '' },
      });
      expect(res.status()).toBe(400);
    });

    test('name cannot exceed 100 characters', async () => {
      const productId = await createProduct(apiCtx, shopId, 'Long Name', cookie);

      const res = await apiCtx.post(`/api/shops/${shopId}/products/${productId}/reserve`, {
        data: { name: 'x'.repeat(101) },
      });
      expect(res.status()).toBe(400);
    });
  });
});

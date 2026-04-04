import type { APIRoute } from 'astro';
import { isAuthenticated } from '../../../../../../lib/auth';
import { getProduct, releaseReservation } from '../../../../../../lib/db';

export const POST: APIRoute = async ({ request, params }) => {
  if (!isAuthenticated(request)) {
    return new Response(JSON.stringify({ error: 'Unauthorized' }), {
      status: 401,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const { shopId, productId } = params;
  if (!shopId || !productId) {
    return new Response(JSON.stringify({ error: 'Missing parameters' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const product = getProduct(parseInt(productId, 10));
  if (!product || product.shop_id !== shopId) {
    return new Response(JSON.stringify({ error: 'Product not found' }), {
      status: 404,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  if (product.status !== 'reserved') {
    return new Response(JSON.stringify({ error: 'Товар не забронирован' }), {
      status: 409,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  try {
    const changed = releaseReservation(product.id);
    if (!changed) {
      return new Response(JSON.stringify({ error: 'Статус товара изменился, обновите страницу' }), {
        status: 409,
        headers: { 'Content-Type': 'application/json' },
      });
    }
    return new Response(JSON.stringify({ success: true }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (err) {
    console.error('Error releasing reservation:', err);
    return new Response(JSON.stringify({ error: 'Internal server error' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
};

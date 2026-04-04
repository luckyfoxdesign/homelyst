import type { APIRoute } from 'astro';
import { requireOwner } from '../../../../../../lib/auth';
import { getProduct, confirmReservation } from '../../../../../../lib/db';

export const POST: APIRoute = async ({ request, params }) => {
  const { shopId, productId } = params;
  if (!shopId || !productId) {
    return new Response(JSON.stringify({ error: 'Missing parameters' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  try {
    requireOwner(request, shopId);
  } catch (err) {
    return err as Response;
  }

  const product = getProduct(parseInt(productId, 10));
  if (!product || product.shop_id !== shopId) {
    return new Response(JSON.stringify({ error: 'Product not found' }), {
      status: 404,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  if (product.status !== 'reserved' || product.confirmed !== 0) {
    return new Response(JSON.stringify({ error: 'Товар не в статусе ожидания подтверждения' }), {
      status: 409,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  try {
    const changed = confirmReservation(product.id);
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
    console.error('Error confirming reservation:', err);
    return new Response(JSON.stringify({ error: 'Internal server error' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
};

import type { APIRoute } from 'astro';
import { reserveProduct } from '../../../../../../lib/db';
import { checkReserveLimit, getClientIp } from '../../../../../../lib/rateLimit';

export const POST: APIRoute = async ({ request, params }) => {
  const ip = getClientIp(request);

  if (!checkReserveLimit(ip)) {
    return new Response(JSON.stringify({ error: 'Too many requests. Try again later.' }), {
      status: 429,
      headers: { 'Content-Type': 'application/json', 'Retry-After': '300' },
    });
  }

  const { shopId, productId } = params;
  if (!shopId || !productId) {
    return new Response(JSON.stringify({ error: 'Missing parameters' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  try {
    const body = await request.json();
    const name = (body?.name ?? '').toString().trim();

    if (!name) {
      return new Response(JSON.stringify({ error: 'Имя обязательно' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    if (name.length > 100) {
      return new Response(JSON.stringify({ error: 'Имя не может быть длиннее 100 символов' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    const success = reserveProduct(parseInt(productId, 10), name);

    if (!success) {
      return new Response(JSON.stringify({ error: 'already reserved' }), {
        status: 409,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    return new Response(JSON.stringify({ success: true }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (err) {
    console.error('Error reserving product:', err);
    return new Response(JSON.stringify({ error: 'Internal server error' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
};

import type { APIRoute } from 'astro';
import { reserveProduct, getProduct, getShop } from '../../../../../../lib/db';
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

    // Notify owner via Telegram bot (non-blocking)
    const botToken = process.env.BOT_TOKEN;
    const ownerChatId = process.env.OWNER_CHAT_ID;
    if (botToken && ownerChatId) {
      const product = getProduct(parseInt(productId, 10));
      const shop = shopId ? getShop(shopId) : undefined;
      if (product && shop) {
        const text =
          `Новая бронь в «${shop.name}»\n` +
          `Что: ${product.title}\n` +
          `Кто: ${name}`;
        fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ chat_id: ownerChatId, text }),
        }).catch(() => {});
      }
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

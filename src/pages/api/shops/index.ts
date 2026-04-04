import type { APIRoute } from 'astro';
import { requireAdmin } from '../../../lib/auth';
import { createShop, getShop, getShopCount } from '../../../lib/db';
import { RESERVED_SLUGS } from '../../../lib/validate';
import { audit } from '../../../lib/audit';

const MAX_SHOPS = 10;

export const POST: APIRoute = async ({ request }) => {
  let user;
  try {
    user = requireAdmin(request);
  } catch (err) {
    return err as Response;
  }

  try {
    const formData = await request.formData();
    const id = formData.get('id')?.toString().trim() ?? '';
    const name = formData.get('name')?.toString().trim() ?? '';

    if (!id || !name) {
      return new Response(JSON.stringify({ error: 'ID и название обязательны' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    if (id.length > 50) {
      return new Response(JSON.stringify({ error: 'ID не может быть длиннее 50 символов' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    if (name.length > 200) {
      return new Response(JSON.stringify({ error: 'Название не может быть длиннее 200 символов' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    if (!/^[a-z0-9-]+$/.test(id)) {
      return new Response(JSON.stringify({ error: 'ID должен содержать только строчные буквы, цифры и дефисы' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    if (RESERVED_SLUGS.has(id)) {
      return new Response(JSON.stringify({ error: 'Этот ID зарезервирован системой' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    const shopCount = getShopCount();
    if (shopCount >= MAX_SHOPS) {
      return new Response(JSON.stringify({ error: `Достигнут лимит магазинов (${MAX_SHOPS})` }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    const existing = getShop(id);
    if (existing) {
      return new Response(JSON.stringify({ error: 'Магазин с таким ID уже существует' }), {
        status: 409,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    const shop = createShop(id, name, user.id);
    audit('shop_created', { shop_id: id, owner_id: user.id });

    return new Response(null, {
      status: 302,
      headers: { Location: `/admin/${shop.id}` },
    });
  } catch (err) {
    console.error('Error creating shop:', err);
    return new Response(JSON.stringify({ error: 'Internal server error' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
};

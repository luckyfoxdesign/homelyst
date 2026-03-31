import type { APIRoute } from 'astro';
import { isAuthenticated } from '../../../lib/auth';
import { createShop, getShop } from '../../../lib/db';

export const POST: APIRoute = async ({ request }) => {
  if (!isAuthenticated(request)) {
    return new Response(JSON.stringify({ error: 'Unauthorized' }), {
      status: 401,
      headers: { 'Content-Type': 'application/json' },
    });
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

    const existing = getShop(id);
    if (existing) {
      return new Response(JSON.stringify({ error: 'Магазин с таким ID уже существует' }), {
        status: 409,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    const shop = createShop(id, name);

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

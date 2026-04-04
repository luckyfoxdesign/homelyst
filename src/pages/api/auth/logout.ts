import type { APIRoute } from 'astro';
import { clearAuthCookie, destroySession } from '../../../lib/auth';

export const POST: APIRoute = async ({ request }) => {
  destroySession(request);

  return new Response(null, {
    status: 302,
    headers: {
      'Set-Cookie': clearAuthCookie(),
      Location: '/admin/login',
    },
  });
};

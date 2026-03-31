import type { APIRoute } from 'astro';
import { clearAuthCookie, invalidateToken, getTokenFromRequest } from '../../../lib/auth';

export const POST: APIRoute = async ({ request }) => {
  const token = getTokenFromRequest(request);
  if (token) {
    invalidateToken(token);
  }

  return new Response(null, {
    status: 302,
    headers: {
      'Set-Cookie': clearAuthCookie(),
      Location: '/admin/login',
    },
  });
};

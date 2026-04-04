import type { APIRoute } from 'astro';
import { createToken, setAuthCookie } from '../../../lib/auth';
import { checkLoginLimit, resetLoginLimit, getClientIp } from '../../../lib/rateLimit';
import { verifyPassword, safeEqual } from '../../../lib/password';

export const POST: APIRoute = async ({ request }) => {
  const ip = getClientIp(request);

  if (!checkLoginLimit(ip)) {
    return new Response(JSON.stringify({ error: 'Too many attempts. Try again later.' }), {
      status: 429,
      headers: { 'Content-Type': 'application/json', 'Retry-After': '900' },
    });
  }

  const formData = await request.formData();
  const password = formData.get('password')?.toString() ?? '';

  // Validate redirect: must be an internal path (starts with / but not //)
  const rawRedirect = formData.get('redirect')?.toString() ?? '';
  const redirect =
    rawRedirect.startsWith('/') && !rawRedirect.startsWith('//') && !rawRedirect.includes(':')
      ? rawRedirect
      : '/admin';

  // Prefer ADMIN_PASSWORD_HASH (scrypt); fall back to plain ADMIN_PASSWORD with timing-safe compare
  const passwordHash = process.env.ADMIN_PASSWORD_HASH;
  const adminPassword = process.env.ADMIN_PASSWORD ?? 'changeme';

  const valid = passwordHash
    ? await verifyPassword(password, passwordHash)
    : safeEqual(password, adminPassword);

  if (!valid) {
    return new Response(null, {
      status: 302,
      headers: {
        Location: `/admin/login?error=1&redirect=${encodeURIComponent(redirect)}`,
      },
    });
  }

  // Successful login — reset rate limit counter
  resetLoginLimit(ip);

  const token = createToken();
  const cookieValue = setAuthCookie(token);

  return new Response(null, {
    status: 302,
    headers: {
      'Set-Cookie': cookieValue,
      Location: redirect,
    },
  });
};

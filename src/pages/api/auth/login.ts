import type { APIRoute } from 'astro';
import { createSession, setAuthCookie } from '../../../lib/auth';
import { getFirstAdmin, db, generateId } from '../../../lib/db';
import { checkLoginLimit, resetLoginLimit, getClientIp } from '../../../lib/rateLimit';
import { verifyPassword, safeEqual } from '../../../lib/password';
import { safeRedirect } from '../../../lib/validate';
import { audit } from '../../../lib/audit';

/** Ensure an admin user exists; create one if the table is empty (password-bootstrap). */
function ensureAdminUser(): import('../../../lib/db').User {
  const existing = getFirstAdmin();
  if (existing) return existing;

  const id = generateId();
  db.prepare('INSERT INTO users (id, role) VALUES (?, ?)').run(id, 'admin');
  audit('admin_auto_bootstrapped', { id });
  return getFirstAdmin()!;
}

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

  const rawRedirect = formData.get('redirect')?.toString() ?? '';
  const redirect = safeRedirect(rawRedirect);

  // Prefer ADMIN_PASSWORD_HASH (scrypt); fall back to plain ADMIN_PASSWORD with timing-safe compare
  const passwordHash = process.env.ADMIN_PASSWORD_HASH;
  const adminPassword = process.env.ADMIN_PASSWORD ?? 'changeme';

  const valid = passwordHash
    ? await verifyPassword(password, passwordHash)
    : safeEqual(password, adminPassword);

  if (!valid) {
    audit('login_failed', { ip });
    return new Response(null, {
      status: 302,
      headers: {
        Location: `/admin/login?error=1&redirect=${encodeURIComponent(redirect)}`,
      },
    });
  }

  // Look up (or auto-create) the admin user to link the session
  const adminUser = ensureAdminUser();

  audit('login_success', { ip, user_id: adminUser.id });
  resetLoginLimit(ip);

  const { rawToken } = createSession(adminUser.id, ip);
  const cookieValue = setAuthCookie(rawToken);

  return new Response(null, {
    status: 302,
    headers: {
      'Set-Cookie': cookieValue,
      Location: redirect,
    },
  });
};

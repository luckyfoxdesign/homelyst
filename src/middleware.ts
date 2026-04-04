import { defineMiddleware } from 'astro:middleware';
import { getUserFromRequest, getCsrfToken } from './lib/auth';
import { audit } from './lib/audit';

// Strict headers for admin and all other routes
const STRICT_HEADERS: Record<string, string> = {
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'DENY',
  'Referrer-Policy': 'strict-origin-when-cross-origin',
  'Permissions-Policy': 'camera=(), microphone=(), geolocation=()',
  // unsafe-inline required for Astro inline scripts and Tailwind utility classes
  'Content-Security-Policy': [
    "default-src 'self'",
    "script-src 'self' 'unsafe-inline' https://telegram.org",
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob:",
    "font-src 'self'",
    "connect-src 'self'",
    "frame-ancestors 'none'",
  ].join('; '),
};

// Relaxed headers for /shop/* — Telegram Mini App opens pages in a WebView
const SHOP_HEADERS: Record<string, string> = {
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'strict-origin-when-cross-origin',
  'Permissions-Policy': 'camera=(), microphone=(), geolocation=()',
  'Content-Security-Policy': [
    "default-src 'self'",
    "script-src 'self' 'unsafe-inline' https://telegram.org",
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob:",
    "font-src 'self'",
    "connect-src 'self' https://api.telegram.org",
    "frame-ancestors https://web.telegram.org",
  ].join('; '),
};

const MUTATION_METHODS = new Set(['POST', 'PUT', 'DELETE', 'PATCH']);

export const onRequest = defineMiddleware(async (context, next) => {
  const { request } = context;
  const url = new URL(request.url);
  const pathname = url.pathname;

  // ── /admin/* — requires authenticated user with role=admin ──────────────────
  if (pathname.startsWith('/admin') && pathname !== '/admin/login') {
    const user = getUserFromRequest(request);
    if (!user) {
      const redirectUrl = `/admin/login?redirect=${encodeURIComponent(pathname)}`;
      return context.redirect(redirectUrl);
    }
    if (user.role !== 'admin') {
      // Authenticated but not an admin — redirect to login (not a 403, to avoid leaking info)
      return context.redirect('/admin/login?error=forbidden');
    }
  }

  // ── /tma/owner/* — auth is handled per-request via TMA Bearer token,
  //    not in middleware (so that API can return proper JSON errors)
  // ── /api/tma/* — public endpoints (TMA auth happens inside the handler)

  // ── CSRF check for authenticated mutations via fetch/XHR ────────────────────
  // Skip public endpoints where admin cookie may be incidentally present
  const isPublicEndpoint =
    pathname.endsWith('/reserve') ||
    pathname === '/api/contact' ||
    pathname.startsWith('/api/tma/');

  if (MUTATION_METHODS.has(request.method) && !isPublicEndpoint) {
    const user = getUserFromRequest(request);
    if (user) {
      const contentType = request.headers.get('content-type') ?? '';
      const isFormSubmission =
        contentType.includes('multipart/form-data') ||
        contentType.includes('application/x-www-form-urlencoded');

      // Bearer-authenticated requests (TMA) are inherently CSRF-safe
      // (browsers can't send custom headers cross-origin without CORS preflight)
      const isBearerAuth =
        (request.headers.get('authorization') ?? '').startsWith('Bearer ');

      if (!isFormSubmission && !isBearerAuth) {
        const sessionCsrf = getCsrfToken(request);
        const requestCsrf = request.headers.get('x-csrf-token');
        if (!sessionCsrf || sessionCsrf !== requestCsrf) {
          audit('csrf_mismatch', { path: pathname, method: request.method });
          return new Response(JSON.stringify({ error: 'CSRF token mismatch' }), {
            status: 403,
            headers: { 'Content-Type': 'application/json' },
          });
        }
      }
    }
  }

  const response = await next();

  const headers = pathname.startsWith('/shop/') ? SHOP_HEADERS : STRICT_HEADERS;
  for (const [header, value] of Object.entries(headers)) {
    response.headers.set(header, value);
  }

  return response;
});

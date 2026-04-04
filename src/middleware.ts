import { defineMiddleware } from 'astro:middleware';
import { isAuthenticated, getCsrfToken } from './lib/auth';
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

  // Protect /admin/* routes except /admin/login
  if (pathname.startsWith('/admin') && pathname !== '/admin/login') {
    if (!isAuthenticated(request)) {
      const redirectUrl = `/admin/login?redirect=${encodeURIComponent(pathname)}`;
      return context.redirect(redirectUrl);
    }
  }

  // CSRF check for authenticated admin mutations via fetch/XHR (not form submissions)
  // Skip public endpoints where admin cookie may be incidentally present
  const isPublicEndpoint = pathname.endsWith('/reserve') || pathname === '/api/contact';
  if (MUTATION_METHODS.has(request.method) && !isPublicEndpoint && isAuthenticated(request)) {
    const contentType = request.headers.get('content-type') ?? '';
    const isFormSubmission =
      contentType.includes('multipart/form-data') ||
      contentType.includes('application/x-www-form-urlencoded');

    if (!isFormSubmission) {
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

  const response = await next();

  const headers = pathname.startsWith('/shop/') ? SHOP_HEADERS : STRICT_HEADERS;
  for (const [header, value] of Object.entries(headers)) {
    response.headers.set(header, value);
  }

  return response;
});

import { defineMiddleware } from 'astro:middleware';
import { isAuthenticated } from './lib/auth';

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

export const onRequest = defineMiddleware(async (context, next) => {
  const url = new URL(context.request.url);
  const pathname = url.pathname;

  // Protect /admin/* routes except /admin/login
  if (pathname.startsWith('/admin') && pathname !== '/admin/login') {
    if (!isAuthenticated(context.request)) {
      const redirectUrl = `/admin/login?redirect=${encodeURIComponent(pathname)}`;
      return context.redirect(redirectUrl);
    }
  }

  const response = await next();

  const headers = pathname.startsWith('/shop/') ? SHOP_HEADERS : STRICT_HEADERS;
  for (const [header, value] of Object.entries(headers)) {
    response.headers.set(header, value);
  }

  return response;
});

export const RESERVED_SLUGS = new Set([
  'admin', 'api', 'tma', 'dashboard', 'login', 'register',
  'auth', 'shop', 'public', 'assets', 'favicon.ico',
]);

export function validateShopId(id: string): boolean {
  return /^[a-z0-9-]{1,50}$/.test(id);
}

export function validateProductId(id: string): boolean {
  return /^\d+$/.test(id);
}

export function safeRedirect(raw: string, fallback = '/admin'): string {
  try {
    const url = new URL(raw, 'http://localhost');
    return url.origin === 'http://localhost' ? url.pathname : fallback;
  } catch {
    return fallback;
  }
}

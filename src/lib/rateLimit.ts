interface RateLimitRecord {
  count: number;
  resetAt: number;
}

const stores = new Map<string, Map<string, RateLimitRecord>>();

function getStore(name: string): Map<string, RateLimitRecord> {
  let store = stores.get(name);
  if (!store) {
    store = new Map();
    stores.set(name, store);
  }
  return store;
}

function check(storeName: string, key: string, limit: number, windowMs: number): boolean {
  const store = getStore(storeName);
  const now = Date.now();
  const record = store.get(key);

  if (!record || record.resetAt < now) {
    store.set(key, { count: 1, resetAt: now + windowMs });
    return true;
  }

  if (record.count >= limit) {
    return false;
  }

  record.count++;
  return true;
}

export function getClientIp(request: Request): string {
  return (
    request.headers.get('x-real-ip') ??
    request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ??
    'unknown'
  );
}

// 5 login attempts per 15 minutes per IP
export function checkLoginLimit(ip: string): boolean {
  return check('login', ip, 5, 15 * 60 * 1000);
}

export function resetLoginLimit(ip: string): void {
  getStore('login').delete(ip);
}

// 15 reserve attempts per 5 minutes per IP
export function checkReserveLimit(ip: string): boolean {
  if (ip === 'unknown') return true;
  return check('reserve', ip, 15, 5 * 60 * 1000);
}

// 3 contact form submissions per 10 minutes per IP
export function checkContactLimit(ip: string): boolean {
  if (ip === 'unknown') return true;
  return check('contact', ip, 3, 10 * 60 * 1000);
}

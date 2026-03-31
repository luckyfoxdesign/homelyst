import { randomBytes } from 'node:crypto';

if (!process.env.ADMIN_PASSWORD || process.env.ADMIN_PASSWORD === 'changeme') {
  console.warn('[WARNING] ADMIN_PASSWORD is not set or uses the insecure default "changeme". Set a strong password in your .env file.');
}

const activeSessions = new Set<string>();

export function createToken(): string {
  const token = randomBytes(32).toString('hex');
  activeSessions.add(token);
  return token;
}

export function invalidateToken(token: string): void {
  activeSessions.delete(token);
}

export function isAuthenticated(request: Request): boolean {
  const cookieHeader = request.headers.get('cookie') ?? '';
  const cookies = cookieHeader.split(';').reduce<Record<string, string>>((acc, part) => {
    const [key, ...rest] = part.trim().split('=');
    if (key) acc[key.trim()] = rest.join('=').trim();
    return acc;
  }, {});

  const token = cookies['admin_token'];
  if (!token) return false;

  return activeSessions.has(token);
}

export function getTokenFromRequest(request: Request): string | null {
  const cookieHeader = request.headers.get('cookie') ?? '';
  const cookies = cookieHeader.split(';').reduce<Record<string, string>>((acc, part) => {
    const [key, ...rest] = part.trim().split('=');
    if (key) acc[key.trim()] = rest.join('=').trim();
    return acc;
  }, {});
  return cookies['admin_token'] ?? null;
}

export function setAuthCookie(token: string): string {
  return `admin_token=${token}; HttpOnly; SameSite=Lax; Path=/; Max-Age=86400`;
}

export function clearAuthCookie(): string {
  return `admin_token=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0`;
}

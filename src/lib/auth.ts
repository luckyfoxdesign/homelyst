import { randomBytes } from 'node:crypto';
import { createSession, hasSession, deleteSession, cleanExpiredSessions } from './db';

if (!process.env.ADMIN_PASSWORD || process.env.ADMIN_PASSWORD === 'changeme') {
  console.warn('[WARNING] ADMIN_PASSWORD is not set or uses the insecure default "changeme". Set a strong password in your .env file.');
}

export function createToken(): string {
  const token = randomBytes(32).toString('hex');
  cleanExpiredSessions();
  createSession(token);
  return token;
}

export function invalidateToken(token: string): void {
  deleteSession(token);
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

  return hasSession(token);
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

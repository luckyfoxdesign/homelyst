import { randomBytes } from 'node:crypto';
import { createSession, getSession, deleteSession, cleanExpiredSessions } from './db';
import { audit } from './audit';

if (!process.env.ADMIN_PASSWORD_HASH) {
  if (!process.env.ADMIN_PASSWORD || process.env.ADMIN_PASSWORD === 'changeme') {
    console.warn('[WARNING] ADMIN_PASSWORD is not set or uses the insecure default "changeme". Set a strong password in your .env file.');
  }
  console.warn('[WARNING] ADMIN_PASSWORD_HASH is not set. Using plain-text password comparison. Run "node scripts/hash-password.js <password>" to generate a hash.');
}

export function createToken(ip: string): string {
  const token = randomBytes(32).toString('hex');
  const csrfToken = randomBytes(32).toString('hex');
  cleanExpiredSessions();
  createSession(token, csrfToken, ip);
  return token;
}

export function invalidateToken(token: string): void {
  deleteSession(token);
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

export function isAuthenticated(request: Request): boolean {
  const token = getTokenFromRequest(request);
  if (!token) return false;

  const session = getSession(token);
  if (!session) return false;

  // Soft IP check — log mismatch but don't block (users behind NAT/VPN may change IP)
  const currentIp = request.headers.get('x-real-ip') ??
    (process.env.TRUST_LOCAL === 'true' ? '127.0.0.1' : 'unknown');
  if (session.ip && session.ip !== currentIp) {
    audit('session_ip_mismatch', { stored_ip: session.ip, current_ip: currentIp });
  }

  return true;
}

export function getCsrfToken(request: Request): string | null {
  const token = getTokenFromRequest(request);
  if (!token) return null;
  const session = getSession(token);
  return session?.csrf_token ?? null;
}

export function setAuthCookie(token: string): string {
  const secure = process.env.TRUST_LOCAL !== 'true' ? '; Secure' : '';
  return `admin_token=${token}; HttpOnly${secure}; SameSite=Lax; Path=/; Max-Age=86400`;
}

export function clearAuthCookie(): string {
  return `admin_token=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0`;
}

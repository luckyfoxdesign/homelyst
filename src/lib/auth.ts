import {
  createUserSession,
  getUserSessionByTokenHash,
  getUserById,
  getShop,
  deleteUserSession,
  deleteAllUserSessions,
  hashToken,
  type User,
  type UserSession,
} from './db';
import { audit } from './audit';

export type { User, UserSession };

// ─── Token extraction ───────────────────────────────────────────────────────────

/** Extract raw session token from cookie or Authorization: Bearer header. */
export function getRawTokenFromRequest(request: Request): string | null {
  // 1. Authorization: Bearer <token>
  const authHeader = request.headers.get('authorization') ?? '';
  if (authHeader.startsWith('Bearer ')) {
    const token = authHeader.slice(7).trim();
    if (token) return token;
  }

  // 2. Cookie: admin_token=<token>
  const cookieHeader = request.headers.get('cookie') ?? '';
  const cookies = cookieHeader.split(';').reduce<Record<string, string>>((acc, part) => {
    const [key, ...rest] = part.trim().split('=');
    if (key) acc[key.trim()] = rest.join('=').trim();
    return acc;
  }, {});
  return cookies['admin_token'] ?? null;
}

// ─── Session lifecycle ──────────────────────────────────────────────────────────

/** Create a session for userId and return raw token + csrf token. */
export function createSession(
  userId: string,
  ip: string | null,
  ttlSeconds?: number
): { rawToken: string; csrfToken: string } {
  return createUserSession(userId, ip, ttlSeconds);
}

/** Destroy the session corresponding to the raw token in the request cookie/header. */
export function destroySession(request: Request): void {
  const raw = getRawTokenFromRequest(request);
  if (!raw) return;
  deleteUserSession(hashToken(raw));
}

/** Destroy all sessions for a user (logout everywhere). */
export { deleteAllUserSessions as destroyAllSessions };

// ─── Auth helpers ───────────────────────────────────────────────────────────────

/**
 * Returns the authenticated User for the request, or null.
 * Cleans up expired sessions for the user as a side-effect.
 */
export function getUserFromRequest(request: Request): User | null {
  const raw = getRawTokenFromRequest(request);
  if (!raw) return null;

  const tokenHash = hashToken(raw);
  const session = getUserSessionByTokenHash(tokenHash);
  if (!session) return null;

  const user = getUserById(session.user_id);
  if (!user) return null;

  // Soft IP check — log mismatch but don't block
  const currentIp =
    request.headers.get('x-real-ip') ??
    (process.env.TRUST_LOCAL === 'true' ? '127.0.0.1' : 'unknown');
  if (session.created_ip && session.created_ip !== currentIp) {
    audit('session_ip_mismatch', { user_id: user.id, stored_ip: session.created_ip, current_ip: currentIp });
  }

  return user;
}

/** Returns User or throws a 401 Response. */
export function requireUser(request: Request): User {
  const user = getUserFromRequest(request);
  if (!user) {
    throw new Response(JSON.stringify({ error: 'Unauthorized' }), {
      status: 401,
      headers: { 'Content-Type': 'application/json' },
    });
  }
  return user;
}

/** Returns User (role=admin) or throws 401/403 Response. */
export function requireAdmin(request: Request): User {
  const user = requireUser(request);
  if (user.role !== 'admin') {
    throw new Response(JSON.stringify({ error: 'Forbidden' }), {
      status: 403,
      headers: { 'Content-Type': 'application/json' },
    });
  }
  return user;
}

/**
 * Returns User if they own the shop or are admin.
 * Throws 401/403/404 Response otherwise.
 */
export function requireOwner(request: Request, shopId: string): User {
  const user = requireUser(request);
  if (user.role === 'admin') return user;

  const shop = getShop(shopId);
  if (!shop) {
    throw new Response(JSON.stringify({ error: 'Shop not found' }), {
      status: 404,
      headers: { 'Content-Type': 'application/json' },
    });
  }
  if (shop.owner_id !== user.id) {
    throw new Response(JSON.stringify({ error: 'Forbidden' }), {
      status: 403,
      headers: { 'Content-Type': 'application/json' },
    });
  }
  return user;
}

// ─── CSRF ───────────────────────────────────────────────────────────────────────

/** Returns the CSRF token for the current session, or null. */
export function getCsrfToken(request: Request): string | null {
  const raw = getRawTokenFromRequest(request);
  if (!raw) return null;
  const session = getUserSessionByTokenHash(hashToken(raw));
  return session?.csrf_token ?? null;
}

// ─── Cookie helpers ─────────────────────────────────────────────────────────────

export function setAuthCookie(rawToken: string): string {
  const secure = process.env.TRUST_LOCAL !== 'true' ? '; Secure' : '';
  // 7-day sliding window matches createUserSession default TTL
  return `admin_token=${rawToken}; HttpOnly${secure}; SameSite=Lax; Path=/; Max-Age=604800`;
}

export function clearAuthCookie(): string {
  return `admin_token=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0`;
}

// ─── Back-compat shims (used by existing code during migration) ─────────────────

/** @deprecated Use getUserFromRequest instead. */
export function isAuthenticated(request: Request): boolean {
  return getUserFromRequest(request) !== null;
}

/** @deprecated Use getRawTokenFromRequest instead. */
export function getTokenFromRequest(request: Request): string | null {
  return getRawTokenFromRequest(request);
}

/** @deprecated Use destroySession instead. */
export function invalidateToken(rawToken: string): void {
  deleteUserSession(hashToken(rawToken));
}

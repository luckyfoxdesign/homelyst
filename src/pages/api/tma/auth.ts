/**
 * POST /api/tma/auth
 *
 * Authenticates a Telegram Mini App user via initData.
 * Header: Authorization: TMA <initData>
 * Returns: { token: string } — Bearer token for subsequent requests.
 *
 * The token is short-lived (1 hour). Client stores in memory and retries
 * with fresh initData on 401 (silent refresh).
 */
import type { APIRoute } from 'astro';
import { validateTMAInitData, extractTMAInitData } from '../../../lib/tma-auth';
import { upsertTelegramUser } from '../../../lib/db';
import { createSession } from '../../../lib/auth';
import { getClientIp } from '../../../lib/rateLimit';
import { audit } from '../../../lib/audit';

const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN ?? '';

export const POST: APIRoute = async ({ request }) => {
  const initData = extractTMAInitData(request);
  if (!initData) {
    return new Response(JSON.stringify({ error: 'Missing Authorization: TMA header' }), {
      status: 401,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  if (!BOT_TOKEN) {
    return new Response(JSON.stringify({ error: 'TMA auth not configured' }), {
      status: 503,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const result = await validateTMAInitData(initData, BOT_TOKEN);
  if (!result.ok) {
    audit('tma_auth_failed', { error: result.error });
    return new Response(JSON.stringify({ error: result.error }), {
      status: 401,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const { user: tmaUser } = result;
  const displayName =
    tmaUser.first_name + (tmaUser.last_name ? ' ' + tmaUser.last_name : '');

  // Find or create user (ON CONFLICT DO NOTHING handles race conditions)
  const user = upsertTelegramUser(String(tmaUser.id), displayName);

  const ip = getClientIp(request);
  // Short-lived session: 1 hour
  const { rawToken } = createSession(user.id, ip, 3600);

  audit('tma_auth_success', { user_id: user.id, telegram_id: tmaUser.id });

  return new Response(JSON.stringify({ token: rawToken }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
};

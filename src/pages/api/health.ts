import type { APIRoute } from 'astro';
import { checkDb } from '../../lib/db';

export const GET: APIRoute = async () => {
  try {
    checkDb();
    return new Response(JSON.stringify({ status: 'ok', timestamp: new Date().toISOString() }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  } catch {
    return new Response(JSON.stringify({ status: 'error' }), {
      status: 503,
      headers: { 'Content-Type': 'application/json' },
    });
  }
};

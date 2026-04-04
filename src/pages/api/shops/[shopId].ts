import type { APIRoute } from 'astro';
import fs from 'node:fs';
import path from 'node:path';
import { requireOwner } from '../../../lib/auth';
import { getShop, deleteShop } from '../../../lib/db';
import { audit } from '../../../lib/audit';

const UPLOADS_BASE = process.env.UPLOADS_PATH ?? '/app/data/uploads';

export const DELETE: APIRoute = async ({ request, params }) => {
  const { shopId } = params;
  if (!shopId) {
    return new Response(JSON.stringify({ error: 'Missing shop ID' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  try {
    requireOwner(request, shopId);
  } catch (err) {
    return err as Response;
  }

  const shop = getShop(shopId);
  if (!shop) {
    return new Response(JSON.stringify({ error: 'Shop not found' }), {
      status: 404,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  try {
    // Delete from DB (CASCADE handles products and product_images)
    deleteShop(shopId);
    audit('shop_deleted', { shop_id: shopId });

    // Delete shop uploads directory
    const shopUploadDir = path.join(UPLOADS_BASE, shopId);
    if (fs.existsSync(shopUploadDir)) {
      fs.rmSync(shopUploadDir, { recursive: true, force: true });
    }

    return new Response(JSON.stringify({ success: true }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (err) {
    console.error('Error deleting shop:', err);
    return new Response(JSON.stringify({ error: 'Internal server error' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
};

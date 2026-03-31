import type { APIRoute } from 'astro';
import fs from 'node:fs';
import path from 'node:path';

const UPLOADS_BASE = process.env.UPLOADS_PATH ?? '/app/data/uploads';

const CONTENT_TYPES: Record<string, string> = {
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
};

export const GET: APIRoute = async ({ params }) => {
  const filePath = params.path ?? '';

  if (!filePath) {
    return new Response(null, { status: 404 });
  }

  // Prevent path traversal attacks
  const resolvedBase = path.resolve(UPLOADS_BASE);
  const resolvedFile = path.resolve(path.join(UPLOADS_BASE, filePath));

  if (!resolvedFile.startsWith(resolvedBase)) {
    return new Response(null, { status: 403 });
  }

  if (!fs.existsSync(resolvedFile)) {
    return new Response(null, { status: 404 });
  }

  try {
    const fileBuffer = fs.readFileSync(resolvedFile);
    const ext = path.extname(resolvedFile).toLowerCase();
    const contentType = CONTENT_TYPES[ext] ?? 'application/octet-stream';

    return new Response(fileBuffer, {
      status: 200,
      headers: {
        'Content-Type': contentType,
        'Cache-Control': 'public, max-age=31536000, immutable',
      },
    });
  } catch (err) {
    console.error('Error serving file:', err);
    return new Response(null, { status: 500 });
  }
};

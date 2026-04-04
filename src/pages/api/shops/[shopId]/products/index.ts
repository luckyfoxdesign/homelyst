import type { APIRoute } from 'astro';
import fs from 'node:fs';
import path from 'node:path';
import { isAuthenticated } from '../../../../../lib/auth';
import { getShop, createProduct, addProductImage, getProductCount } from '../../../../../lib/db';

const MAX_PRODUCTS = 200;

const UPLOADS_BASE = process.env.UPLOADS_PATH ?? '/app/data/uploads';

const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10 MB
const MAX_IMAGES = 1;
const ALLOWED_EXTENSIONS = new Set(['.jpg', '.jpeg', '.png', '.webp', '.gif']);

function isValidImageMagicBytes(buf: Buffer): boolean {
  if (buf.length < 12) return false;
  // JPEG: FF D8 FF
  if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return true;
  // PNG: 89 50 4E 47
  if (buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47) return true;
  // GIF: 47 49 46 38
  if (buf[0] === 0x47 && buf[1] === 0x49 && buf[2] === 0x46 && buf[3] === 0x38) return true;
  // WebP: RIFF????WEBP
  if (
    buf[0] === 0x52 && buf[1] === 0x49 && buf[2] === 0x46 && buf[3] === 0x46 &&
    buf[8] === 0x57 && buf[9] === 0x45 && buf[10] === 0x42 && buf[11] === 0x50
  ) return true;
  return false;
}

export const POST: APIRoute = async ({ request, params }) => {
  if (!isAuthenticated(request)) {
    return new Response(JSON.stringify({ error: 'Unauthorized' }), {
      status: 401,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const { shopId } = params;
  if (!shopId) {
    return new Response(JSON.stringify({ error: 'Missing shopId' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const shop = getShop(shopId);
  if (!shop) {
    return new Response(JSON.stringify({ error: 'Shop not found' }), {
      status: 404,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const productCount = getProductCount(shopId);
  if (productCount >= MAX_PRODUCTS) {
    return new Response(JSON.stringify({ error: `Достигнут лимит товаров (${MAX_PRODUCTS})` }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  try {
    const formData = await request.formData();
    const title = formData.get('title')?.toString().trim() ?? '';
    const priceRaw = formData.get('price')?.toString() ?? '0';
    const address = formData.get('address')?.toString().trim() || null;
    const description = formData.get('description')?.toString().trim() || null;

    if (!title) {
      return new Response(JSON.stringify({ error: 'Название обязательно' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    if (title.length > 200) {
      return new Response(JSON.stringify({ error: 'Название не может быть длиннее 200 символов' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    if (description && description.length > 2000) {
      return new Response(JSON.stringify({ error: 'Описание не может быть длиннее 2000 символов' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    if (address && address.length > 200) {
      return new Response(JSON.stringify({ error: 'Адрес не может быть длиннее 200 символов' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    const price = parseFloat(priceRaw) || 0;

    // Create product
    const product = createProduct(shopId, title, price, description, address);

    // Handle image uploads
    const imageFiles = formData.getAll('images') as File[];
    const validImages = imageFiles.filter(
      (f) => f instanceof File && f.size > 0 && f.name !== ''
    ).slice(0, MAX_IMAGES);

    if (validImages.length > 0) {
      const uploadDir = path.join(UPLOADS_BASE, shopId, String(product.id));
      fs.mkdirSync(uploadDir, { recursive: true });

      let savedCount = 0;
      for (let i = 0; i < validImages.length; i++) {
        const file = validImages[i];

        if (file.size > MAX_FILE_SIZE) {
          continue; // skip oversized files silently
        }

        const ext = path.extname(file.name).toLowerCase();
        if (!ALLOWED_EXTENSIONS.has(ext)) {
          continue; // skip disallowed extensions
        }

        const buffer = Buffer.from(await file.arrayBuffer());

        if (!isValidImageMagicBytes(buffer)) {
          continue; // file content doesn't match an image signature
        }

        const filename = `${savedCount + 1}${ext}`;
        const filePath = path.join(uploadDir, filename);
        fs.writeFileSync(filePath, buffer);
        addProductImage(product.id, filename, savedCount);
        savedCount++;
      }
    }

    return new Response(JSON.stringify({ success: true, product }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (err) {
    console.error('Error creating product:', err);
    return new Response(JSON.stringify({ error: 'Internal server error' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
};

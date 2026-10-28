// Image helpers for the AI worker (OffscreenCanvas + createImageBitmap; both exist in workers on
// iPhone Safari 17+ and Chrome). The pixel maths lives in mask.ts and colours.ts.
import { fitWithin, maskBBox, padBox, resampleAlpha } from './mask';

export async function toBitmap(blob: Blob): Promise<ImageBitmap> {
  try {
    return await createImageBitmap(blob, { imageOrientation: 'from-image' });
  } catch {
    return createImageBitmap(blob);
  }
}

function canvas(w: number, h: number) {
  const c = new OffscreenCanvas(w, h);
  const ctx = c.getContext('2d', { willReadFrequently: true }) as OffscreenCanvasRenderingContext2D | null;
  if (!ctx) throw new Error('No 2D canvas in this browser');
  return { c, ctx };
}

/** The bitmap scaled so its longest side is at most `maxSide`, as RGBA pixels. */
export function pixels(bitmap: ImageBitmap, maxSide: number): ImageData {
  const { w, h } = fitWithin(bitmap.width, bitmap.height, maxSide);
  const { ctx } = canvas(w, h);
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(bitmap, 0, 0, w, h);
  return ctx.getImageData(0, 0, w, h);
}

/**
 * Cuts the garment out of the original bitmap (crop = the rectangle of the original it covers, in
 * original pixels after EXIF orientation) with a mask computed at a smaller size: crops to the
 * mask plus a small margin, scales so the longest side is at most `maxOut`, and writes a PNG.
 */
export async function composeCutout(bitmap: ImageBitmap, alpha: Uint8ClampedArray, aw: number, ah: number, maxOut = 1024): Promise<{ blob: Blob; width: number; height: number; crop: { x: number; y: number; w: number; h: number } } | null> {
  const bbox = maskBBox(alpha, aw, ah);
  if (!bbox) return null;
  const box = padBox(bbox, aw, ah);
  const sx = bitmap.width / aw, sy = bitmap.height / ah;
  const src = { x: box.x * sx, y: box.y * sy, w: box.w * sx, h: box.h * sy };
  const out = fitWithin(src.w, src.h, maxOut);
  const { c, ctx } = canvas(out.w, out.h);
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(bitmap, src.x, src.y, src.w, src.h, 0, 0, out.w, out.h);
  const img = ctx.getImageData(0, 0, out.w, out.h);
  const a = resampleAlpha(alpha, aw, ah, box, out.w, out.h);
  for (let i = 0; i < a.length; i++) img.data[i * 4 + 3] = a[i];
  ctx.putImageData(img, 0, 0);
  const blob = await c.convertToBlob({ type: 'image/png' });
  const crop = { x: Math.round(src.x), y: Math.round(src.y), w: Math.round(src.w), h: Math.round(src.h) };
  return { blob, width: out.w, height: out.h, crop };
}

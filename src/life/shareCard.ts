// The share card (F12, board SharePreview.dc.html): black paper, the outfit on the mannequin, its name in Caveat and
// a small wordmark. Drawn on a canvas so the preview is exactly the image that gets shared.
import { renderOutfitImage } from '../tryon';
import type { OutfitDraft } from '../domain/types';

export const CARD_W = 1080;
export const CARD_H = 1350;

async function loadFonts(): Promise<void> {
  try {
    await Promise.all([
      document.fonts.load('600 84px Caveat'),
      document.fonts.load('400 48px Prata'),
      document.fonts.load('400 36px Onest'),
    ]);
  } catch { /* system fonts are fine */ }
}

async function blobToImage(blob: Blob): Promise<HTMLImageElement> {
  const url = URL.createObjectURL(blob);
  try {
    const img = new Image();
    img.src = url;
    await img.decode();
    return img;
  } finally {
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
}

/** The part of an image that isn't transparent (the whole image if it can't be read). */
function opaqueBounds(img: HTMLImageElement): { x: number; y: number; w: number; h: number } {
  const W = img.naturalWidth;
  const H = img.naturalHeight;
  const c = document.createElement('canvas');
  c.width = W;
  c.height = H;
  const g = c.getContext('2d', { willReadFrequently: true })!;
  g.drawImage(img, 0, 0);
  const a = g.getImageData(0, 0, W, H).data;
  let x0 = W, y0 = H, x1 = -1, y1 = -1;
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      if (a[(y * W + x) * 4 + 3] > 8) {
        if (x < x0) x0 = x;
        if (x > x1) x1 = x;
        if (y < y0) y0 = y;
        if (y > y1) y1 = y;
      }
    }
  }
  if (x1 < 0) return { x: 0, y: 0, w: W, h: H };
  return { x: x0, y: y0, w: x1 - x0 + 1, h: y1 - y0 + 1 };
}

/**
 * Draws the card. The mannequin comes from the try-on module; if it can't be drawn the card is still made, so the
 * caller can tell the user. Returns the PNG and whether the mannequin made it in.
 */
export async function drawShareCard(p: { draft: OutfitDraft; mode: 'photo' | 'outline'; name?: string; dateLabel: string }): Promise<{ blob: Blob; mannequin: boolean }> {
  await loadFonts();
  const canvas = document.createElement('canvas');
  canvas.width = CARD_W;
  canvas.height = CARD_H;
  const ctx = canvas.getContext('2d')!;
  ctx.fillStyle = '#0D0D0D';
  ctx.fillRect(0, 0, CARD_W, CARD_H);

  let mannequin = false;
  try {
    const doll = await blobToImage(await renderOutfitImage(p.draft, { height: 1100, mode: p.mode }));
    // Fit the drawn figure (not its transparent margins) into the space between the name and the wordmark.
    const box = opaqueBounds(doll);
    const top = 170;
    const maxH = CARD_H - 150 - top;
    const scale = Math.min(maxH / box.h, (CARD_W - 160) / box.w);
    const w = box.w * scale;
    const h = box.h * scale;
    ctx.save();
    ctx.shadowColor = 'rgba(0,0,0,0.5)';
    ctx.shadowBlur = 18;
    ctx.shadowOffsetX = 4;
    ctx.shadowOffsetY = 8;
    ctx.drawImage(doll, box.x, box.y, box.w, box.h, (CARD_W - w) / 2, top + (maxH - h) / 2, w, h);
    ctx.restore();
    mannequin = true;
  } catch {
    mannequin = false;
  }

  if (p.name) {
    ctx.save();
    ctx.translate(64, 120);
    ctx.rotate((-2 * Math.PI) / 180);
    ctx.fillStyle = '#FFFFFF';
    ctx.font = '600 104px Caveat, cursive';
    ctx.textBaseline = 'alphabetic';
    let size = 104;
    while (ctx.measureText(p.name).width > CARD_W - 140 && size > 56) {
      size -= 4;
      ctx.font = `600 ${size}px Caveat, cursive`;
    }
    ctx.fillText(p.name, 0, 0);
    ctx.restore();
  }

  ctx.fillStyle = '#FFFFFF';
  ctx.font = '400 60px Prata, Georgia, serif';
  ctx.textBaseline = 'alphabetic';
  ctx.fillText('iMannequin', 64, CARD_H - 56);
  ctx.fillStyle = '#B9B4AA';
  ctx.font = '400 44px Onest, system-ui, sans-serif';
  ctx.textAlign = 'right';
  ctx.fillText(p.dateLabel, CARD_W - 64, CARD_H - 58);

  const blob = await new Promise<Blob>((resolve, reject) => canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('toBlob'))), 'image/png'));
  return { blob, mannequin };
}

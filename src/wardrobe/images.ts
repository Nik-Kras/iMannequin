// Canvas helpers for photos: downscaling originals, thumbnails, capture from the camera (architecture §3).

export function canvasToBlob(canvas: HTMLCanvasElement, type = 'image/png', quality?: number): Promise<Blob> {
  return new Promise((resolve, reject) => canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('toBlob failed'))), type, quality));
}

function fit(w: number, h: number, maxEdge: number): { w: number; h: number } {
  const s = Math.min(1, maxEdge / Math.max(w, h));
  return { w: Math.max(1, Math.round(w * s)), h: Math.max(1, Math.round(h * s)) };
}

/** Draws any image source onto a new canvas, scaled so the long edge is at most `maxEdge`. */
export function drawScaled(src: CanvasImageSource, sw: number, sh: number, maxEdge: number): HTMLCanvasElement {
  const { w, h } = fit(sw, sh, maxEdge);
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const ctx = c.getContext('2d')!;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(src, 0, 0, w, h);
  return c;
}

/** Originals are kept as JPEG with a 2048 px long edge. Falls back to the file itself if it can't be decoded. */
export async function downscaleToJpeg(blob: Blob, maxEdge = 2048, quality = 0.9): Promise<Blob> {
  try {
    const bmp = await createImageBitmap(blob);
    if (Math.max(bmp.width, bmp.height) <= maxEdge && blob.type === 'image/jpeg') { bmp.close(); return blob; }
    const c = drawScaled(bmp, bmp.width, bmp.height, maxEdge);
    bmp.close();
    return await canvasToBlob(c, 'image/jpeg', quality);
  } catch {
    return blob;
  }
}

/** A 256 px PNG (keeps transparency) for grids and lists. */
export async function makeThumb(blob: Blob, size = 256): Promise<Blob | undefined> {
  try {
    const bmp = await createImageBitmap(blob);
    const c = drawScaled(bmp, bmp.width, bmp.height, size);
    bmp.close();
    return await canvasToBlob(c, 'image/png');
  } catch {
    return undefined;
  }
}

/** Grabs the current camera frame as a JPEG original. */
export async function captureFrame(video: HTMLVideoElement, maxEdge = 2048): Promise<Blob> {
  const c = drawScaled(video, video.videoWidth, video.videoHeight, maxEdge);
  return canvasToBlob(c, 'image/jpeg', 0.9);
}

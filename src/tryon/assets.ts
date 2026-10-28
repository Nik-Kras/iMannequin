// Loading what the compositor draws: decoded cut-outs, garment anchors (cached on Photo.anchors) and the body.
import { useEffect, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '../data/db';
import type { AnchorGroup, BodyRecord, GarmentAnchors, Photo } from '../domain/types';
import { anchorsValid, findAnchors, scaleAnchors } from './anchors';
import { bodyMetrics, metricsFromRecord } from './body';
import { defaultBody } from './defaultBody';
import type { BodyModel } from './fit';
import type { Mask } from './raster';

export type Drawable = ImageBitmap | HTMLCanvasElement | OffscreenCanvas;

/** Creates a 2D canvas, offscreen when the browser has it. */
export function makeCanvas(w: number, h: number): HTMLCanvasElement | OffscreenCanvas {
  const W = Math.max(1, Math.ceil(w));
  const H = Math.max(1, Math.ceil(h));
  if (typeof OffscreenCanvas !== 'undefined') return new OffscreenCanvas(W, H);
  const c = document.createElement('canvas');
  c.width = W;
  c.height = H;
  return c;
}

export function ctx2d(c: HTMLCanvasElement | OffscreenCanvas): CanvasRenderingContext2D {
  return c.getContext('2d') as CanvasRenderingContext2D;
}

const bitmaps = new WeakMap<Blob, Promise<ImageBitmap>>();

/** Decodes a blob once (cached per Blob object). */
export function decode(blob: Blob): Promise<ImageBitmap> {
  let p = bitmaps.get(blob);
  if (!p) {
    p = createImageBitmap(blob);
    bitmaps.set(blob, p);
    p.catch(() => bitmaps.delete(blob));
  }
  return p;
}

/** Alpha (or, for opaque images, red-channel intensity) of an image as a mask, at most `maxSide` px on the long side. */
export function imageMask(img: Drawable, maxSide = 0): Mask {
  const k = maxSide > 0 ? Math.min(1, maxSide / Math.max(img.width, img.height)) : 1;
  const w = Math.max(1, Math.round(img.width * k));
  const h = Math.max(1, Math.round(img.height * k));
  const c = makeCanvas(w, h);
  const g = ctx2d(c);
  g.drawImage(img as CanvasImageSource, 0, 0, w, h);
  return maskFromImageData(g.getImageData(0, 0, w, h));
}

/** ImageData → mask. Uses alpha when the image has transparency, otherwise the red channel (white = inside). */
export function maskFromImageData(d: ImageData): Mask {
  const n = d.width * d.height;
  const src = d.data;
  let hasAlpha = false;
  for (let i = 3; i < src.length; i += 4) if (src[i] < 255) { hasAlpha = true; break; }
  const out = new Uint8Array(n);
  for (let i = 0; i < n; i++) out[i] = hasAlpha ? src[i * 4 + 3] : src[i * 4];
  return { width: d.width, height: d.height, data: out };
}

const anchorMemo = new Map<string, GarmentAnchors>();

/** Anchors for a garment photo: the cached copy on Photo.anchors, or detected now and cached (try-on §3). */
export async function garmentAnchors(photo: Photo, group: AnchorGroup, bitmap: ImageBitmap): Promise<GarmentAnchors> {
  const stamp = photo.cutout?.size ?? 0;
  const key = `${photo.id}:${group}:${stamp}`;
  const memo = anchorMemo.get(key);
  if (memo) return memo;
  const cached = (await db.anchors.get(photo.id).catch(() => undefined))?.anchors ?? photo.anchors;
  if (anchorsValid(cached, group, bitmap.width, bitmap.height, stamp)) {
    anchorMemo.set(key, cached);
    return cached;
  }
  const small = imageMask(bitmap, 480);
  const found = scaleAnchors(findAnchors(small, group), bitmap.width, bitmap.height);
  found.points._v = { x: found.points._v.x, y: stamp };
  anchorMemo.set(key, found);
  // Cache so the next launch skips detection (own table, see db.ts). Best effort: a failed write only costs a recompute.
  void db.anchors.put({ photoId: photo.id, anchors: found }).catch(() => undefined);
  return found;
}

export interface LoadedBody extends BodyModel {
  kind: 'default' | 'photo';
  /** Changes whenever the body changes (cache key). */
  key: string;
  cutout?: ImageBitmap;
  mask?: ImageBitmap;
}

let defaultLoaded: LoadedBody | undefined;
export function defaultLoadedBody(): LoadedBody {
  if (!defaultLoaded) {
    const d = defaultBody();
    defaultLoaded = { kind: 'default', key: 'default', landmarks: d.landmarks, metrics: d.metrics };
  }
  return defaultLoaded;
}

const bodyMemo = new Map<string, Promise<LoadedBody>>();

/** Decodes a saved body record into what the compositor needs (metrics recomputed if missing). */
export function loadBody(rec?: BodyRecord): Promise<LoadedBody> {
  if (!rec?.cutout || !rec.mask || !rec.landmarks?.length) return Promise.resolve(defaultLoadedBody());
  const key = `photo:${rec.createdAt}:${rec.cutout.size}`;
  let p = bodyMemo.get(key);
  if (!p) {
    p = (async () => {
      const [cutout, mask] = await Promise.all([decode(rec.cutout), decode(rec.mask)]);
      const metrics = metricsFromRecord(rec.metrics) ?? bodyMetrics(imageMask(mask), rec.landmarks);
      return { kind: 'photo' as const, key, landmarks: rec.landmarks, metrics, cutout, mask };
    })();
    p.catch(() => bodyMemo.delete(key));
    bodyMemo.set(key, p);
  }
  return p;
}

/** The current body (the photo once taken, otherwise the default outline). Undefined while loading. */
export function useBody(): LoadedBody | undefined {
  const rec = useLiveQuery(async () => (await db.body.get('current')) ?? null, []);
  const [body, setBody] = useState<LoadedBody>();
  useEffect(() => {
    if (rec === undefined) return;
    let live = true;
    loadBody(rec ?? undefined).then((b) => { if (live) setBody(b); }, () => { if (live) setBody(defaultLoadedBody()); });
    return () => { live = false; };
  }, [rec]);
  return body;
}

/** Reads the current body without React (for renderOutfitImage). */
export async function currentBody(): Promise<LoadedBody> {
  try {
    return await loadBody(await db.body.get('current'));
  } catch {
    return defaultLoadedBody();
  }
}

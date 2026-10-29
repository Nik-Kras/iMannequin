// Body photo → canonical body record (try-on §2.2): key points and person mask from the AI module, the pose check,
// then the photo straightened and scaled onto the 1000 × 2000 canvas, cut out, measured and stored.
import { cutOutBody, detectPose, PoseError, releaseAiWhenIdle } from '../ai';
import { db, inMemory, withReopen } from '../data/db';
import { describeError, record } from '../diag/diagnostics';
import type { BodyRecord, Landmark } from '../domain/types';
import { canonicalLandmarks, canonicalTransform, checkPose, bodyMetrics, metricsToRecord, CANON, LM, type PoseIssue } from './body';
import { ctx2d, makeCanvas, maskFromImageData } from './assets';
import { keepNear, maskArea, maskBounds, resampleMask, type Mask } from './raster';
import { downscaleToJpeg } from '../wardrobe/images';

const toBlob = async (c: HTMLCanvasElement | OffscreenCanvas, type = 'image/png'): Promise<Blob> =>
  'convertToBlob' in c ? c.convertToBlob({ type }) : new Promise<Blob>((res, rej) => (c as HTMLCanvasElement).toBlob((b) => (b ? res(b) : rej(new Error('toBlob'))), type));

/** Points the canonical canvas can't be built without. */
const CORE = [LM.shoulderL, LM.shoulderR, LM.ankleL, LM.ankleR, LM.heelL, LM.heelR];

/**
 * The body photo as kept from the moment it's picked or shot: a JPEG with a 2048 px long edge, copied into memory
 * (architecture §3). A 24–48 MP original decoded at full size took 0.8–1.6 GB, and iOS can revoke a picked file
 * once the picker is gone (bug-audit #9).
 */
export async function prepareBodyPhoto(file: Blob): Promise<Blob> {
  return inMemory(await downscaleToJpeg(file, 2048));
}

export async function processBodyPhoto(photo: Blob): Promise<{ body?: BodyRecord; issues: PoseIssue[] }> {
  // The 2048 px photo is decoded once, for the pose and for the cut-out (bug-audit #9).
  const bitmap = await createImageBitmap(photo, { imageOrientation: 'from-image' }).catch(() => createImageBitmap(photo));
  try {
    return await processDecoded(photo, bitmap);
  } finally {
    bitmap.close?.();
  }
}

async function processDecoded(photo: Blob, bitmap: ImageBitmap): Promise<{ body?: BodyRecord; issues: PoseIssue[] }> {
  let pose: Awaited<ReturnType<typeof detectPose>>;
  try {
    pose = await detectPose(photo, bitmap);
  } catch (err) {
    // No person found is a pose problem the user can fix; anything else (model failed to load) is thrown.
    if (err instanceof PoseError && err.code === 'no-person') return { issues: [{ code: 'visibility', detail: 'body' }] };
    throw err;
  }
  const lms: Landmark[] = pose.landmarks ?? [];
  const W = pose.width;
  const H = pose.height;
  // The check uses MediaPipe's coarse person mask; the sharp one is made only for a photo that passes (D61).
  const coarseMask = maskFromImageData(pose.mask);
  const mb = maskBounds(coarseMask);
  const sx = W / coarseMask.width;
  const sy = H / coarseMask.height;
  const bounds = mb ? { x0: mb.x0 * sx, y0: mb.y0 * sy, x1: (mb.x1 + 1) * sx - 1, y1: (mb.y1 + 1) * sy - 1 } : undefined;
  const issues = lms.length < 33 || !mb ? [{ code: 'visibility' as const, detail: 'body' }] : checkPose(lms, { width: W, height: H }, bounds);
  if (lms.length < 33 || !mb || CORE.some((i) => (lms[i].visibility ?? 1) < 0.3)) return { issues };

  const photoMask = await personMask(photo, coarseMask, W, H);

  const m = canonicalTransform(lms, W, H, photoMask);
  const landmarks = canonicalLandmarks(lms, W, H, m);

  // The person mask as an alpha image (soft edges from the mask's confidence).
  const maskImg = makeCanvas(photoMask.width, photoMask.height);
  const mctx = ctx2d(maskImg);
  const md = mctx.createImageData(photoMask.width, photoMask.height);
  for (let i = 0; i < photoMask.data.length; i++) {
    md.data[i * 4] = 255;
    md.data[i * 4 + 1] = 255;
    md.data[i * 4 + 2] = 255;
    md.data[i * 4 + 3] = photoMask.data[i];
  }
  mctx.putImageData(md, 0, 0);

  // Mask on the canonical canvas (white = body).
  const maskCanon = makeCanvas(CANON.width, CANON.height);
  const mc = ctx2d(maskCanon);
  mc.setTransform(...m);
  mc.imageSmoothingQuality = 'high';
  mc.drawImage(maskImg as CanvasImageSource, 0, 0, W, H);

  // Cut-out: the straightened photo, kept only inside the mask.
  const cut = makeCanvas(CANON.width, CANON.height);
  const cc = ctx2d(cut);
  cc.imageSmoothingQuality = 'high';
  cc.setTransform(...m);
  cc.drawImage(bitmap, 0, 0, W, H);
  cc.setTransform(1, 0, 0, 1, 0, 0);
  cc.globalCompositeOperation = 'destination-in';
  cc.drawImage(maskCanon as CanvasImageSource, 0, 0);

  const canonMask = maskFromImageData(mc.getImageData(0, 0, CANON.width, CANON.height));
  const metrics = bodyMetrics(canonMask, landmarks);
  const [cutout, mask] = await Promise.all([toBlob(cut), toBlob(maskCanon)]);
  const body: BodyRecord = {
    id: 'current',
    photo,
    cutout,
    mask,
    landmarks,
    canonical: { width: CANON.width, height: CANON.height },
    metrics: metricsToRecord(metrics),
    createdAt: Date.now(),
  };
  return { body, issues };
}

/**
 * The person mask (D61): the cut-out model's sharp edges, kept only near MediaPipe's coarse person mask so other
 * objects in the room drop out. MediaPipe's own mask when the model isn't on the phone, fails, or misses part of
 * the person (less than 70 % of MediaPipe's area).
 */
async function personMask(photo: Blob, coarse: Mask, W: number, H: number): Promise<Mask> {
  const cut = await cutOutBody(photo).catch((err) => { record('body.cutout.failed', describeError(err)); return null; });
  void releaseAiWhenIdle();
  if (!cut?.crop) return coarse;
  const s = Math.min(1, 1024 / Math.max(W, H));
  const c = makeCanvas(Math.round(W * s), Math.round(H * s));
  const g = ctx2d(c);
  const bitmap = await createImageBitmap(cut.cutout);
  g.drawImage(bitmap, cut.crop.x * s, cut.crop.y * s, cut.crop.w * s, cut.crop.h * s);
  bitmap.close?.();
  const sharp = keepNear(maskFromImageData(g.getImageData(0, 0, c.width, c.height)), coarse, Math.round(coarse.height * 0.04));
  const used = maskArea(sharp) >= 0.7 * maskArea(resampleMask(coarse, c.width, c.height));
  record('body.cutout', { model: cut.model, used, ms: cut.ms });
  return used ? sharp : coarse;
}

/** Stores the body record (the user accepted it on the Check screen). Garment fits refit automatically (try-on §5). */
export async function saveBodyRecord(body: BodyRecord): Promise<void> {
  const [photo, cutout, mask] = await Promise.all([inMemory(body.photo), inMemory(body.cutout), inMemory(body.mask)]);
  record('body.save', { photoKb: Math.round(photo.size / 1024), cutoutKb: Math.round(cutout.size / 1024), maskKb: Math.round(mask.size / 1024) });
  const rec: BodyRecord = { ...body, photo, cutout, mask };
  await withReopen(() => db.body.put(rec), (err) => record('body.save.retry', describeError(err)));
}

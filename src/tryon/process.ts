// Body photo → canonical body record (try-on §2.2): key points and person mask from the AI module, the pose check,
// then the photo straightened and scaled onto the 1000 × 2000 canvas, cut out, measured and stored.
import { detectPose, PoseError } from '../ai';
import { db, inMemory, withReopen } from '../data/db';
import { describeError, record } from '../diag/diagnostics';
import type { BodyRecord, Landmark } from '../domain/types';
import { canonicalLandmarks, canonicalTransform, checkPose, bodyMetrics, metricsToRecord, CANON, LM, type PoseIssue } from './body';
import { ctx2d, makeCanvas, maskFromImageData } from './assets';
import { maskBounds } from './raster';

const toBlob = async (c: HTMLCanvasElement | OffscreenCanvas, type = 'image/png'): Promise<Blob> =>
  'convertToBlob' in c ? c.convertToBlob({ type }) : new Promise<Blob>((res, rej) => (c as HTMLCanvasElement).toBlob((b) => (b ? res(b) : rej(new Error('toBlob'))), type));

/** Points the canonical canvas can't be built without. */
const CORE = [LM.shoulderL, LM.shoulderR, LM.ankleL, LM.ankleR, LM.heelL, LM.heelR];

export async function processBodyPhoto(photo: Blob): Promise<{ body?: BodyRecord; issues: PoseIssue[] }> {
  let pose: Awaited<ReturnType<typeof detectPose>>;
  try {
    pose = await detectPose(photo);
  } catch (err) {
    // No person found is a pose problem the user can fix; anything else (model failed to load) is thrown.
    if (err instanceof PoseError && err.code === 'no-person') return { issues: [{ code: 'visibility', detail: 'body' }] };
    throw err;
  }
  const lms: Landmark[] = pose.landmarks ?? [];
  const W = pose.width;
  const H = pose.height;
  const photoMask = maskFromImageData(pose.mask);
  const mb = maskBounds(photoMask);
  const sx = W / photoMask.width;
  const sy = H / photoMask.height;
  const bounds = mb ? { x0: mb.x0 * sx, y0: mb.y0 * sy, x1: (mb.x1 + 1) * sx - 1, y1: (mb.y1 + 1) * sy - 1 } : undefined;
  const issues = lms.length < 33 || !mb ? [{ code: 'visibility' as const, detail: 'body' }] : checkPose(lms, { width: W, height: H }, bounds);
  if (lms.length < 33 || !mb || CORE.some((i) => (lms[i].visibility ?? 1) < 0.3)) return { issues };

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
  const bitmap = await createImageBitmap(photo);
  const cut = makeCanvas(CANON.width, CANON.height);
  const cc = ctx2d(cut);
  cc.imageSmoothingQuality = 'high';
  cc.setTransform(...m);
  cc.drawImage(bitmap, 0, 0, W, H);
  cc.setTransform(1, 0, 0, 1, 0, 0);
  cc.globalCompositeOperation = 'destination-in';
  cc.drawImage(maskCanon as CanvasImageSource, 0, 0);
  bitmap.close?.();

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

/** Stores the body record (the user accepted it on the Check screen). Garment fits refit automatically (try-on §5). */
export async function saveBodyRecord(body: BodyRecord): Promise<void> {
  const [photo, cutout, mask] = await Promise.all([inMemory(body.photo), inMemory(body.cutout), inMemory(body.mask)]);
  record('body.save', { photoKb: Math.round(photo.size / 1024), cutoutKb: Math.round(cutout.size / 1024), maskKb: Math.round(mask.size / 1024) });
  const rec: BodyRecord = { ...body, photo, cutout, mask };
  await withReopen(() => db.body.put(rec), (err) => record('body.save.retry', describeError(err)));
}

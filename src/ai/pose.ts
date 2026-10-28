// Body key points and person mask with MediaPipe Pose Landmarker (try-on §2). Runs on the main thread:
// the self-hosted runtime is the classic loader, which module workers can't import. Detection in IMAGE
// mode takes a fraction of a second, and the landmarker is closed right after to free its memory.
import type { Landmark } from '../domain/types';

export interface PoseOutput {
  landmarks: Landmark[];
  mask: ImageData;
  width: number;
  height: number;
}

export class PoseError extends Error {
  constructor(public code: 'no-person' | 'load-failed', message?: string) {
    super(message ?? code);
  }
}

/** Pose model file served from our own origin (R1). */
export const poseModelUrl = (file: string) => `${import.meta.env.BASE_URL}${file}`;

/**
 * MediaPipe Tasks 1.2.0 starts a usage logger with every task. It posts to Google every minute and when the task
 * closes, and has no switch. R1 allows no such request, so it is answered here without the network; the logger
 * takes the failure as final and stops (bug-audit #52).
 */
const MEDIAPIPE_LOG = 'https://odml.pa.googleapis.com/';
let logBlocked = false;
function blockMediapipeLogging() {
  if (logBlocked) return;
  logBlocked = true;
  const real = globalThis.fetch;
  globalThis.fetch = ((input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    return url.startsWith(MEDIAPIPE_LOG) ? Promise.resolve(new Response(null, { status: 204 })) : real.call(globalThis, input, init);
  }) as typeof fetch;
}

export async function runPose(photo: Blob, modelPath: string): Promise<PoseOutput> {
  blockMediapipeLogging();
  const vision = await import('@mediapipe/tasks-vision');
  const fileset = await vision.FilesetResolver.forVisionTasks(`${import.meta.env.BASE_URL}vendor/mediapipe`);
  const bitmap = await (async () => {
    try { return await createImageBitmap(photo, { imageOrientation: 'from-image' }); } catch { return createImageBitmap(photo); }
  })();
  const make = (delegate: 'GPU' | 'CPU') => vision.PoseLandmarker.createFromOptions(fileset, {
    baseOptions: { modelAssetPath: poseModelUrl(modelPath), delegate },
    runningMode: 'IMAGE',
    numPoses: 1,
    outputSegmentationMasks: true,
  });
  let landmarker: Awaited<ReturnType<typeof make>> | null = null;
  try {
    try {
      landmarker = await make('GPU');
    } catch {
      landmarker = await make('CPU');
    }
    const result = landmarker.detect(bitmap);
    const points = result.landmarks?.[0];
    const seg = result.segmentationMasks?.[0];
    if (!points?.length || !seg) {
      seg?.close();
      throw new PoseError('no-person');
    }
    const values = seg.getAsFloat32Array();
    const mw = seg.width, mh = seg.height;
    seg.close();
    // The mask stays at the model's resolution; the body photo code scales it when drawing (bug-audit #9).
    const mask = maskToImageData(values, mw, mh);
    return {
      landmarks: points.map((p) => ({ x: p.x, y: p.y, z: p.z, visibility: p.visibility ?? 0 })),
      mask,
      width: bitmap.width,
      height: bitmap.height,
    };
  } catch (err) {
    if (err instanceof PoseError) throw err;
    throw new PoseError('load-failed', String((err as Error)?.message ?? err));
  } finally {
    landmarker?.close();
    bitmap.close();
  }
}

/** Confidence (0–1) mask to grey ImageData at the mask's own size: r = g = b = a = confidence × 255. */
export function maskToImageData(values: Float32Array, mw: number, mh: number): ImageData {
  const out = new ImageData(mw, mh);
  const d = out.data;
  for (let i = 0; i < mw * mh; i++) {
    const v = Math.round(Math.min(1, Math.max(0, values[i])) * 255);
    d[i * 4] = d[i * 4 + 1] = d[i * 4 + 2] = d[i * 4 + 3] = v;
  }
  return out;
}

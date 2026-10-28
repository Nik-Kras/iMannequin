// The default outline body, used before the user has taken a body photo. It is the A-pose figure from the design
// (Mannequin board: 200 × 400 space, head ellipse cx 100 cy 33 rx 15 ry 19) placed on the canonical canvas exactly as a
// perfect body photo would be: mid-shoulders → mid-ankles vertical, 1800 units from the top of the head to the heels.
import type { Landmark } from '../domain/types';
import { bodyMetrics, CANON, LM, type BodyMetrics } from './body';
import type { Mat, Pt } from './geom';
import { ellipsePoly, emptyMask, fillPolys, flattenPath, mapPolys, type Mask } from './raster';

export const DESIGN_BODY_PATH =
  'M93 50L93 62C86 66 74 66 69 71C64 75 62 80 61 84L38 126L16 172L10 188L16 196L24 192L27 175L49 131L73 98L80 140L74 178L77 270L80 352L74 366L72 374L93 376L92 362L90 352L95 272L100 205L105 272L110 352L108 362L107 376L128 374L126 366L120 352L123 270L126 178L120 140L127 98L151 131L173 175L176 192L184 196L190 188L184 172L162 126L139 84C138 80 136 75 131 71C126 66 114 66 107 62L107 50Z';
export const DESIGN_HEAD = { cx: 100, cy: 33, rx: 15, ry: 19 } as const;

/** Top of the head and the heels in the design space. */
const DESIGN_TOP = DESIGN_HEAD.cy - DESIGN_HEAD.ry; // 14
const DESIGN_HEEL = 368;
/** Design units → canonical units. */
export const DESIGN_K = CANON.bodyHeight / (DESIGN_HEEL - DESIGN_TOP);
/** Design space (200 × 400) → canonical canvas. */
export const DESIGN_TO_CANON: Mat = [DESIGN_K, 0, 0, DESIGN_K, CANON.centreX - 100 * DESIGN_K, CANON.top - DESIGN_TOP * DESIGN_K];
export const toCanon = (p: Pt): Pt => ({ x: (p.x - 100) * DESIGN_K + CANON.centreX, y: (p.y - DESIGN_TOP) * DESIGN_K + CANON.top });

/** Key points of the design figure (the BodyGuide board's skeleton), as MediaPipe indexes. */
const DESIGN_POINTS: Record<number, [number, number]> = {
  0: [100, 36], 1: [103, 30], 2: [106, 30], 3: [109, 30], 4: [97, 30], 5: [94, 30], 6: [91, 30],
  7: [114, 32], 8: [86, 32], 9: [103, 43], 10: [97, 43],
  11: [127, 74], 12: [73, 74], 13: [156, 128], 14: [44, 128], 15: [179, 175], 16: [21, 175],
  17: [183, 194], 18: [17, 194], 19: [186, 192], 20: [14, 192], 21: [176, 188], 22: [24, 188],
  23: [114, 182], 24: [86, 182], 25: [113, 270], 26: [87, 270], 27: [115, 352], 28: [85, 352],
  29: [116, 368], 30: [84, 368], 31: [120, 374], 32: [80, 374],
};

export function defaultLandmarks(): Landmark[] {
  const out: Landmark[] = [];
  for (let i = 0; i < 33; i++) {
    const [x, y] = DESIGN_POINTS[i];
    const p = toCanon({ x, y });
    out.push({ x: p.x, y: p.y, z: 0, visibility: 1 });
  }
  return out;
}

/** The outline as polygons on the canonical canvas (body + head). */
export function defaultBodyPolys(): Pt[][] {
  const polys = [...flattenPath(DESIGN_BODY_PATH, 10), ellipsePoly(DESIGN_HEAD.cx, DESIGN_HEAD.cy, DESIGN_HEAD.rx, DESIGN_HEAD.ry, 64)];
  return mapPolys(polys, toCanon);
}

let cached: { mask: Mask; landmarks: Landmark[]; metrics: BodyMetrics } | undefined;

/** The default body's mask, landmarks and metrics on the canonical canvas (computed once). */
export function defaultBody(): { mask: Mask; landmarks: Landmark[]; metrics: BodyMetrics } {
  if (cached) return cached;
  const mask = fillPolys(emptyMask(CANON.width, CANON.height), defaultBodyPolys());
  const landmarks = defaultLandmarks();
  const metrics = bodyMetrics(mask, landmarks);
  cached = { mask, landmarks, metrics };
  return cached;
}

export { LM };

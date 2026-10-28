// The body (try-on §2): pose checks, the canonical canvas and body widths from the mask. Pure functions; the
// canvas work that uses them lives in process.ts.
import type { Landmark } from '../domain/types';
import { about, apply, compose, dist, mid, pt, rotate, scale, translate, type Mat, type Pt } from './geom';
import { rowRuns, runAt, type Mask } from './raster';

/** Canonical canvas (try-on §2.2): the body is 1800 units from the top of the mask to the heels, centred on 1000 × 2000. */
export const CANON = { width: 1000, height: 2000, bodyHeight: 1800, top: 100, centreX: 500 } as const;

/** MediaPipe Pose landmark indexes (try-on §2.2). "Left" is the person's left, which is on the right of a front photo. */
export const LM = {
  nose: 0, eyeL: 2, eyeR: 5, earL: 7, earR: 8,
  shoulderL: 11, shoulderR: 12, elbowL: 13, elbowR: 14, wristL: 15, wristR: 16,
  hipL: 23, hipR: 24, kneeL: 25, kneeR: 26, ankleL: 27, ankleR: 28, heelL: 29, heelR: 30, toeL: 31, toeR: 32,
} as const;

export interface PoseIssue { code: 'visibility' | 'armAngle' | 'facing' | 'framing'; detail?: string }

const PARTS: Record<string, number[]> = {
  face: [LM.nose, LM.eyeL, LM.eyeR, LM.earL, LM.earR],
  shoulders: [LM.shoulderL, LM.shoulderR],
  elbows: [LM.elbowL, LM.elbowR],
  hands: [LM.wristL, LM.wristR],
  hips: [LM.hipL, LM.hipR],
  knees: [LM.kneeL, LM.kneeR],
  feet: [LM.ankleL, LM.ankleR, LM.heelL, LM.heelR, LM.toeL, LM.toeR],
};

export const POSE_LIMITS = {
  minVisibility: 0.5,
  /** Shoulder → wrist angle from the body's vertical, degrees (try-on §2.2 ⚑). */
  armMin: 25,
  armMax: 65,
  /** Shoulder width (joints) to hip width (joints); a body turned sideways shows narrow shoulders. */
  minShoulderHipRatio: 0.9,
  /** Shoulder width (joints) to nose → ankle height; about 0.2 when facing the camera. */
  minShoulderToHeight: 0.11,
  /** Depth difference between the shoulders over their width (tan of the turn angle). */
  maxShoulderDepthSlope: 0.75,
  /** Ear → shoulder horizontal distances, smaller over larger. */
  minEarSymmetry: 0.4,
} as const;

/** Photo-space pixel position of a normalised landmark. */
const px = (l: Landmark, w: number, h: number): Pt => ({ x: l.x * w, y: l.y * h });

/** Angle between two vectors in degrees. */
function angleBetween(u: Pt, v: Pt): number {
  const c = (u.x * v.x + u.y * v.y) / (Math.hypot(u.x, u.y) * Math.hypot(v.x, v.y) || 1);
  return (Math.acos(Math.max(-1, Math.min(1, c))) * 180) / Math.PI;
}

/** Arm angles (left, right) from the body's vertical, in degrees. Landmarks are normalised to a w × h photo. */
export function armAngles(lms: Landmark[], w = 1, h = 1): [number, number] {
  const P = (i: number) => px(lms[i], w, h);
  const axis = { x: mid(P(LM.ankleL), P(LM.ankleR)).x - mid(P(LM.shoulderL), P(LM.shoulderR)).x, y: mid(P(LM.ankleL), P(LM.ankleR)).y - mid(P(LM.shoulderL), P(LM.shoulderR)).y };
  const arm = (s: number, wr: number) => angleBetween({ x: P(wr).x - P(s).x, y: P(wr).y - P(s).y }, axis);
  return [arm(LM.shoulderL, LM.wristL), arm(LM.shoulderR, LM.wristR)];
}

/**
 * Pose check (try-on §2.2 ⚑). Landmarks are normalised 0–1 to the photo; `bounds` is the person mask's bounding box in
 * photo pixels, used to spot a head or feet cut off by the frame.
 */
export function checkPose(lms: Landmark[], size: { width: number; height: number }, bounds?: { x0: number; y0: number; x1: number; y1: number }): PoseIssue[] {
  const issues: PoseIssue[] = [];
  const { width: w, height: h } = size;
  if (lms.length < 33) return [{ code: 'visibility', detail: 'body' }];

  // Framing: required points outside the photo, or the mask touching the top or bottom edge.
  const cut = new Set<string>();
  const out = (l: Landmark) => l.x < -0.005 || l.x > 1.005 || l.y < -0.005 || l.y > 1.005;
  for (const [part, idx] of Object.entries(PARTS)) {
    if (idx.some((i) => out(lms[i]))) cut.add(part === 'face' ? 'head' : part === 'feet' || part === 'knees' ? 'feet' : 'sides');
  }
  if (bounds) {
    if (bounds.y0 <= 1) cut.add('head');
    if (bounds.y1 >= h - 2) cut.add('feet');
  }
  if (cut.size) issues.push({ code: 'framing', detail: [...cut].join(',') });

  // Visibility: parts that are in the frame but not seen clearly.
  const hidden: string[] = [];
  for (const [part, idx] of Object.entries(PARTS)) {
    if (idx.some((i) => !out(lms[i]) && (lms[i].visibility ?? 1) < POSE_LIMITS.minVisibility)) hidden.push(part);
  }
  if (hidden.length) issues.push({ code: 'visibility', detail: hidden.join(',') });

  const P = (i: number) => px(lms[i], w, h);
  const visible = (...idx: number[]) => idx.every((i) => (lms[i].visibility ?? 1) >= POSE_LIMITS.minVisibility && !out(lms[i]));

  // Arm angle, measured against the body's own vertical so a slightly tilted photo still passes.
  if (visible(LM.shoulderL, LM.shoulderR, LM.wristL, LM.wristR, LM.ankleL, LM.ankleR)) {
    const [l, r] = armAngles(lms, w, h);
    const lo = Math.min(l, r);
    const hi = Math.max(l, r);
    if (lo < POSE_LIMITS.armMin) issues.push({ code: 'armAngle', detail: `low:${Math.round(lo)}` });
    else if (hi > POSE_LIMITS.armMax) issues.push({ code: 'armAngle', detail: `high:${Math.round(hi)}` });
  }

  // Facing the camera.
  if (visible(LM.shoulderL, LM.shoulderR, LM.hipL, LM.hipR)) {
    const sL = P(LM.shoulderL);
    const sR = P(LM.shoulderR);
    const sw = dist(sL, sR);
    const hw = dist(P(LM.hipL), P(LM.hipR));
    const reasons: string[] = [];
    if (sR.x - sL.x > 0.3 * sw) reasons.push('back');
    if (hw > 0 && sw / hw < POSE_LIMITS.minShoulderHipRatio) reasons.push('sideways');
    const tall = mid(P(LM.ankleL), P(LM.ankleR)).y - P(LM.nose).y;
    if (tall > 0 && sw / tall < POSE_LIMITS.minShoulderToHeight && !reasons.includes('sideways')) reasons.push('sideways');
    const dz = Math.abs((lms[LM.shoulderL].z ?? 0) - (lms[LM.shoulderR].z ?? 0));
    const dxn = Math.abs(lms[LM.shoulderL].x - lms[LM.shoulderR].x);
    if (dxn > 0 && dz / dxn > POSE_LIMITS.maxShoulderDepthSlope && !reasons.includes('sideways')) reasons.push('sideways');
    if (visible(LM.earL, LM.earR)) {
      const dL = Math.abs(P(LM.earL).x - sL.x);
      const dR = Math.abs(P(LM.earR).x - sR.x);
      if (Math.max(dL, dR) > 0 && Math.min(dL, dR) / Math.max(dL, dR) < POSE_LIMITS.minEarSymmetry) reasons.push('turned');
    }
    if (reasons.length) issues.push({ code: 'facing', detail: reasons.join(',') });
  }
  return issues;
}

/**
 * The photo → canonical canvas transform (try-on §2.2): rotate about the mid-shoulders so mid-shoulders → mid-ankles is
 * vertical, scale so the top of the mask to the heels is 1800 units, and centre it on 1000 × 2000.
 * `topOf` returns the topmost body y after a given transform (scans the mask).
 */
export function canonicalTransform(lms: Landmark[], w: number, h: number, mask: Mask): Mat {
  const P = (i: number) => px(lms[i], w, h);
  const S = mid(P(LM.shoulderL), P(LM.shoulderR));
  const A = mid(P(LM.ankleL), P(LM.ankleR));
  const deg = (Math.atan2(A.x - S.x, A.y - S.y) * 180) / Math.PI;
  const R = about(S, rotate(deg));
  const top = maskTopAfter(mask, R, w / mask.width, h / mask.height);
  const heel = Math.max(apply(R, P(LM.heelL)).y, apply(R, P(LM.heelR)).y);
  const k = CANON.bodyHeight / Math.max(1, heel - top);
  return compose(translate(CANON.centreX, CANON.top), compose(scale(k), compose(translate(-S.x, -top), R)));
}

/** Smallest y of the inside pixels after transform `m` (mask pixels scaled to photo pixels by sx, sy). */
function maskTopAfter(mask: Mask, m: Mat, sx: number, sy: number): number {
  let top = Infinity;
  const { width, height, data } = mask;
  for (let y = 0; y < height; y++) {
    const row = y * width;
    const yy = (y + 0.5) * sy;
    for (let x = 0; x < width; x++) {
      if (data[row + x] > 127) {
        const ty = m[1] * (x + 0.5) * sx + m[3] * yy + m[5];
        if (ty < top) top = ty;
      }
    }
  }
  return Number.isFinite(top) ? top : 0;
}

/** Landmarks normalised to a w × h photo → canonical canvas coordinates (z scaled the same way). */
export function canonicalLandmarks(lms: Landmark[], w: number, h: number, m: Mat): Landmark[] {
  const k = Math.hypot(m[0], m[1]);
  return lms.map((l) => {
    const p = apply(m, pt(l.x * w, l.y * h));
    return { x: p.x, y: p.y, z: (l.z ?? 0) * w * k, visibility: l.visibility ?? 1 };
  });
}

/** Body widths and heights on the canonical canvas (try-on §2.2 step 5). Widths come from the mask, not the joints. */
export interface BodyMetrics {
  top: number;
  bottom: number;
  heelY: number;
  height: number;
  axisX: number;
  shoulderY: number; shoulderW: number; shoulderL: number; shoulderR: number;
  waistY: number; waistW: number; waistL: number; waistR: number;
  hipY: number; hipW: number; hipL: number; hipR: number;
  headY: number; headW: number; headL: number; headR: number;
}

/** Mask width at row y around x, falling back to `fallbackW` when the row is empty or implausibly wide. */
function widthAt(mask: Mask, y: number, x: number, fallbackW: number, maxW: number): { l: number; r: number; w: number } {
  const runs = rowRuns(mask, Math.round(y), 2);
  const run = runAt(runs, Math.round(x), Math.max(4, fallbackW * 0.3));
  if (!run || run[1] - run[0] + 1 > maxW) return { l: x - fallbackW / 2, r: x + fallbackW / 2, w: fallbackW };
  return { l: run[0], r: run[1] + 1, w: run[1] - run[0] + 1 };
}

export function bodyMetrics(mask: Mask, lms: Landmark[]): BodyMetrics {
  const L = (i: number) => lms[i];
  const sL = L(LM.shoulderL);
  const sR = L(LM.shoulderR);
  const hL = L(LM.hipL);
  const hR = L(LM.hipR);
  const sJoint = Math.abs(sL.x - sR.x);
  const hJoint = Math.abs(hL.x - hR.x);
  const axisX = (sL.x + sR.x + hL.x + hR.x) / 4;

  // Top and bottom of the body column.
  let top = 0;
  let bottom = mask.height - 1;
  const { width, height, data } = mask;
  outer: for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) if (data[y * width + x] > 127) { top = y; break outer; }
  outer2: for (let y = height - 1; y >= 0; y--) for (let x = 0; x < width; x++) if (data[y * width + x] > 127) { bottom = y + 1; break outer2; }
  const heelY = Math.max(L(LM.heelL).y, L(LM.heelR).y);

  const shoulderY = (sL.y + sR.y) / 2;
  const sh = widthAt(mask, shoulderY, (sL.x + sR.x) / 2, sJoint * 1.3, sJoint * 2.2);
  const hipY = (hL.y + hR.y) / 2;
  const hp = widthAt(mask, hipY, (hL.x + hR.x) / 2, hJoint * 1.85, hJoint * 2.6);

  // Waist: the narrowest row between the shoulders and the hips (the band just below the armpits to just above the hips).
  let waist = { l: 0, r: 0, w: Infinity };
  let waistY = shoulderY + (hipY - shoulderY) * 0.6;
  const y0 = Math.round(shoulderY + (hipY - shoulderY) * 0.35);
  const y1 = Math.round(hipY - (hipY - shoulderY) * 0.1);
  for (let y = y0; y <= y1; y++) {
    const cx = lerpX(sL.x + sR.x, hL.x + hR.x, (y - shoulderY) / Math.max(1, hipY - shoulderY)) / 2;
    const wd = widthAt(mask, y, cx, Infinity, hJoint * 2.6);
    if (Number.isFinite(wd.w) && wd.w < waist.w) { waist = wd; waistY = y; }
  }
  if (!Number.isFinite(waist.w)) waist = { l: axisX - hp.w * 0.4, r: axisX + hp.w * 0.4, w: hp.w * 0.8 };

  const eL = L(LM.earL);
  const eR = L(LM.earR);
  const headY = (eL.y + eR.y) / 2;
  const earDist = Math.abs(eL.x - eR.x);
  const hd = widthAt(mask, headY, L(LM.nose).x, earDist * 1.1, earDist * 2.2);

  return {
    top, bottom, heelY, height: heelY - top, axisX,
    shoulderY, shoulderW: sh.w, shoulderL: sh.l, shoulderR: sh.r,
    waistY, waistW: waist.w, waistL: waist.l, waistR: waist.r,
    hipY, hipW: hp.w, hipL: hp.l, hipR: hp.r,
    headY, headW: hd.w, headL: hd.l, headR: hd.r,
  };
}

const lerpX = (a: number, b: number, t: number) => a + (b - a) * Math.max(0, Math.min(1, t));

export function metricsToRecord(m: BodyMetrics): Record<string, number> {
  return { ...m };
}

const METRIC_KEYS: (keyof BodyMetrics)[] = ['top', 'bottom', 'heelY', 'height', 'axisX', 'shoulderY', 'shoulderW', 'shoulderL', 'shoulderR', 'waistY', 'waistW', 'waistL', 'waistR', 'hipY', 'hipW', 'hipL', 'hipR', 'headY', 'headW', 'headL', 'headR'];

export function metricsFromRecord(r?: Record<string, number>): BodyMetrics | undefined {
  if (!r) return undefined;
  for (const k of METRIC_KEYS) if (typeof r[k] !== 'number' || !Number.isFinite(r[k])) return undefined;
  return r as unknown as BodyMetrics;
}

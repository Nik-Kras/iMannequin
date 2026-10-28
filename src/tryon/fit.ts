// Automatic fit (try-on §4, D16) and remembered adjustments (try-on §5, D15). Pure maths on the canonical canvas.
// A garment's main pair of anchors goes onto body targets with a similarity transform (scale + rotation + move), so
// its width matches the body and its proportions are kept. Item.fit offsets are added on top, measured in the
// garment's reference length so they survive a retaken body photo.
import type { AnchorGroup, CategoryId, FitAdjustment, GarmentAnchors, Landmark, Point } from '../domain/types';
import { CATEGORY } from '../domain/taxonomy';
import { LM, type BodyMetrics } from './body';
import { ellipsePoly } from './raster';
import {
  about, add, affine3, angleFromDown, apply, clamp, compose, dist, IDENTITY, lerp, matAngle, mid, mul, rotate, scale, similarity, sub, translate, type Mat, type Pt,
} from './geom';

export interface BodyModel { landmarks: Landmark[]; metrics: BodyMetrics }

/**
 * Calibration constants ⚑. Tuned so the design's paper garments land where the designer drew them on the default body;
 * to be re-tuned on real flat-lay photos (try-on §4, D12).
 */
export const FIT = {
  /** Top: shoulder corners span this share of the body's shoulder width (mask at shoulder height). */
  shoulderSpan: 0.94,
  /** Top: shoulder corners sit this many shoulder widths above the shoulder joints. */
  shoulderLift: 0.086,
  /** Bottoms: the waistband line, as a share of the way from the waist row to the hip row. */
  rise: 0.76,
  /** Bottoms: waistband span over the body's width on that line. */
  waistSpan: 1.027,
  /** Belt: span over the waistband width, and how far its middle sits below the waistband line. */
  beltSpan: 1.04,
  beltDrop: 0.08,
  /** Shoes: each shoe's width as a share of body height; the sole sits this far below the lowest foot point. */
  shoeShare: 0.0734,
  soleDrop: 0.0085,
  /** Gloves: each glove's length as a share of body height. */
  gloveShare: 0.076,
  /** Hats: brim span = head width × 1.15 (try-on §4); the brim sits this many head widths above the ears. */
  hatSpan: 1.15,
  hatLift: 0.067,
  /** Glasses: span = distance between the ears × 0.9 (try-on §4). */
  glassesSpan: 0.9,
  glassesDrop: 0.03,
  /** Scarves and ties: top span over shoulder width, and how far above the shoulder joints the top sits. */
  scarfSpan: 0.457,
  scarfRaise: 0.157,
  tieSpan: 0.12,
  tieRaise: 0.12,
  /** Bags: bag height as a share of torso height, hung from beside the hand. */
  bagShare: 0.48,
  /** Jewellery: size over shoulder width, at the neck. */
  jewelShare: 0.3,
  jewelRaise: 0.05,
} as const;

/** Layer ease (try-on §4 ⚑): a coat sits a little wider than the sweater under it. */
export function layerEase(category: CategoryId): number {
  if (category === 'leggings') return 0.97;
  const def = CATEGORY[category];
  if (def.slot === 'mid') return 1.05;
  if (def.slot === 'outer') return 1.1;
  return 1;
}

/**
 * A drawable piece of a garment: the cut-out under a transform to the canvas, optionally clipped to a rectangle or to
 * polygons (image pixels; even-odd lets the body piece leave out the sleeves and legs drawn as their own pieces).
 */
export interface Piece {
  m: Mat;
  clip?: { x0: number; y0: number; x1: number; y1: number };
  polys?: { pts: Pt[][]; evenOdd?: boolean };
  /** A second clip (intersected with the first): keeps the fill pieces of a turned limb near its pivot. */
  within?: Pt[];
}

/** Sleeves and trouser legs follow the body's arms and legs (try-on §4 ⚑): the largest automatic turn, in degrees. */
export const LIMB_MAX_TURN = 30;
/** Turns smaller than this are left alone, so a garment that already matches stays one piece. */
export const LIMB_MIN_TURN = 3;
/**
 * Only long sleeves and full-length legs turn automatically (their axis is clear and a mismatch shows); short sleeves
 * and shorts stay as laid out. Measured as the limb's length over the body limb's.
 */
export const LIMB_MIN_LENGTH = 0.55;

export interface Handle {
  name: string;
  /** Canonical position after the whole fit. */
  at: Pt;
  /** 'point' moves that anchor; 'move' moves the whole garment. */
  kind: 'point' | 'move';
}

export interface Placement {
  pieces: Piece[];
  /** Reference length on this body (canonical units): offsets in Item.fit are multiples of it. */
  ref: number;
  /** Whole-garment pivot (canonical), used for scale and rotate. */
  pivot: Pt;
  handles: Handle[];
  /** Automatic target of every adjustable anchor, before point offsets (canonical). */
  targets: Record<string, Pt>;
  /** The whole-garment adjustment that was applied after the anchor fit. */
  whole: Mat;
}

interface Targets {
  main?: [string, string];
  length?: string;
  move?: string;
  /** Per-piece fits (shoes, gloves): each piece's anchor, target and clip; one shared scale. */
  pair?: { names: [string, string]; boxes: [string, string]; scale: number };
  ref: number;
  at: Record<string, Pt>;
}

const P = (lms: Landmark[], i: number): Pt => ({ x: lms[i].x, y: lms[i].y });

/** Body targets for each anchor group on this body (try-on §4 table). */
export function bodyTargets(group: AnchorGroup, category: CategoryId, a: GarmentAnchors, body: BodyModel): Targets {
  const m = body.metrics;
  const lms = body.landmarks;
  const ease = layerEase(category);
  const axis = (m.shoulderL + m.shoulderR) / 2;
  const pts = a.points;
  const t: Record<string, Pt> = {};
  // The trousers' waistband line, between the waist and the hips.
  const wbY = lerp(m.waistY, m.hipY, FIT.rise);
  const wbW = lerp(m.waistW, m.hipW, FIT.rise);
  const wbX = lerp((m.waistL + m.waistR) / 2, (m.hipL + m.hipR) / 2, FIT.rise);

  switch (group) {
    case 'top': {
      const w = m.shoulderW * FIT.shoulderSpan * ease;
      const y = m.shoulderY - FIT.shoulderLift * m.shoulderW;
      t.shoulderL = { x: axis - w / 2, y };
      t.shoulderR = { x: axis + w / 2, y };
      return { main: ['shoulderL', 'shoulderR'], length: 'hemC', move: 'collar', ref: m.shoulderW, at: t };
    }
    case 'bottom':
    case 'skirt': {
      const w = wbW * FIT.waistSpan * ease;
      t.waistL = { x: wbX - w / 2, y: wbY };
      t.waistR = { x: wbX + w / 2, y: wbY };
      return { main: ['waistL', 'waistR'], length: 'hemC', ref: wbW, at: t };
    }
    case 'belt': {
      const w = wbW * FIT.beltSpan;
      const y = wbY + FIT.beltDrop * wbW;
      t.endL = { x: wbX - w / 2, y };
      t.endR = { x: wbX + w / 2, y };
      return { main: ['endL', 'endR'], ref: wbW, at: t };
    }
    case 'hat': {
      const w = m.headW * FIT.hatSpan;
      const cx = (m.headL + m.headR) / 2;
      const y = m.headY - FIT.hatLift * m.headW;
      t.brimL = { x: cx - w / 2, y };
      t.brimR = { x: cx + w / 2, y };
      return { main: ['brimL', 'brimR'], ref: m.headW, at: t };
    }
    case 'glasses': {
      const ears = dist(P(lms, LM.earL), P(lms, LM.earR));
      const eyes = mid(P(lms, LM.eyeL), P(lms, LM.eyeR));
      const w = ears * FIT.glassesSpan;
      const y = eyes.y + FIT.glassesDrop * ears;
      t.left = { x: eyes.x - w / 2, y };
      t.right = { x: eyes.x + w / 2, y };
      return { main: ['left', 'right'], ref: ears, at: t };
    }
    case 'scarf':
    case 'tie': {
      const span = group === 'tie' ? FIT.tieSpan : FIT.scarfSpan;
      const raise = group === 'tie' ? FIT.tieRaise : FIT.scarfRaise;
      const w = m.shoulderW * span;
      const y = m.shoulderY - raise * m.shoulderW;
      t.topL = { x: axis - w / 2, y };
      t.topR = { x: axis + w / 2, y };
      return { main: ['topL', 'topR'], length: 'bottom', ref: m.shoulderW, at: t };
    }
    case 'bag': {
      const torso = m.hipY - m.shoulderY;
      // Beside the hand on the right of the picture (the person's left hand).
      const wrist = P(lms, LM.wristL);
      const h = torso * FIT.bagShare;
      t.handle = { x: wrist.x + torso * 0.03, y: wrist.y + torso * 0.02 };
      t.bottom = { x: t.handle.x, y: t.handle.y + h };
      return { main: ['handle', 'bottom'], ref: torso, at: t };
    }
    case 'shoes':
    case 'gloves': {
      const shoes = group === 'shoes';
      const boxW = (k: 'L' | 'R') => (shoes ? pts[`box${k}1`].x - pts[`box${k}0`].x : pts[`box${k}1`].y - pts[`box${k}0`].y);
      const size = (boxW('L') + boxW('R')) / 2;
      const want = m.height * (shoes ? FIT.shoeShare : FIT.gloveShare);
      if (shoes) {
        // Image-left foot is the person's right foot.
        const foot = (heel: number, toe: number, ankle: number): Pt => {
          const h = P(lms, heel);
          const to = P(lms, toe);
          const y = Math.max(h.y, to.y, P(lms, ankle).y) + FIT.soleDrop * m.height;
          return { x: (h.x + to.x) / 2, y };
        };
        t.soleL = foot(LM.heelR, LM.toeR, LM.ankleR);
        t.soleR = foot(LM.heelL, LM.toeL, LM.ankleL);
        return { pair: { names: ['soleL', 'soleR'], boxes: ['boxL', 'boxR'], scale: want / Math.max(1, size) }, ref: want, at: t };
      }
      t.cuffL = P(lms, LM.wristR);
      t.cuffR = P(lms, LM.wristL);
      return { pair: { names: ['cuffL', 'cuffR'], boxes: ['boxL', 'boxR'], scale: want / Math.max(1, size) }, ref: want, at: t };
    }
    case 'jewellery':
    default: {
      const w = m.shoulderW * FIT.jewelShare;
      const y = m.shoulderY - FIT.jewelRaise * m.shoulderW;
      t.left = { x: axis - w / 2, y };
      t.right = { x: axis + w / 2, y };
      return { main: ['left', 'right'], ref: m.shoulderW, at: t };
    }
  }
}

const off = (fit: FitAdjustment | undefined, name: string, ref: number): Pt => {
  const o = fit?.points?.[name];
  return o ? { x: o.dx * ref, y: o.dy * ref } : { x: 0, y: 0 };
};

/** The whole-garment adjustment: move by (dx, dy)·ref, then scale and rotate about the pivot. */
export function wholeMatrix(fit: FitAdjustment | undefined, ref: number, pivot: Pt): Mat {
  if (!fit) return IDENTITY;
  const sr = compose(rotate(fit.rotate || 0), scale(fit.scale || 1));
  return compose(translate((fit.dx || 0) * ref, (fit.dy || 0) * ref), about(pivot, sr));
}

interface Limb {
  /** The anchor at the limb's end; also its Adjust fit handle. */
  name: string;
  /** Turning point (the shoulder corner, or the top of the leg). */
  pivot: Pt;
  /** The limb's axis runs from `from` to the end anchor. */
  from: Pt;
  /** Pixels drawn with the limb (overlapping the body a little, so no seam shows). */
  region: Pt[];
  /** Pixels left out of the body piece. */
  cut: Pt[];
  bodyFrom: Pt;
  bodyTo: Pt;
}

/** Sleeves of tops and legs of trousers, as regions of the cut-out with the body limb each one should follow. */
function limbsOf(group: AnchorGroup, a: Record<string, Pt>, body: BodyModel, w: number, h: number): Limb[] {
  const L = body.landmarks;
  const P = (i: number): Pt => ({ x: L[i].x, y: L[i].y });
  const out: Limb[] = [];
  if (group === 'top') {
    // Image-left sleeve is on the person's right arm.
    for (const [s, sh, wr] of [['L', LM.shoulderR, LM.wristR], ['R', LM.shoulderL, LM.wristL]] as const) {
      const C = a[`shoulder${s}`];
      const A = a[`armpit${s}`];
      const E = a[`sleeve${s}`];
      if (!C || !A || !E) continue;
      const yBot = Math.min(h + 1, Math.max(A.y, E.y) + 0.25 * dist(C, E));
      const d = sub(A, C);
      const n = Math.hypot(d.x, d.y) || 1;
      const far = { x: C.x - (d.x / n) * h, y: C.y - (d.y / n) * h };
      const edge = s === 'L' ? -1 : w + 1;
      // `ov` pushes the shoulder → armpit seam into the body a little (overlap, so no hairline); below the armpit
      // the boundary steps just outside the body's side, so none of the body turns with the sleeve.
      const ov = (s === 'L' ? 1 : -1) * Math.max(1, w * 0.008);
      const poly = (seam: number): Pt[] => [
        { x: far.x + seam, y: far.y }, { x: C.x + seam, y: C.y }, { x: A.x + seam, y: A.y }, { x: A.x - ov, y: A.y + Math.abs(ov) },
        { x: A.x - ov, y: yBot }, { x: edge, y: yBot }, { x: edge, y: far.y },
      ];
      out.push({ name: `sleeve${s}`, pivot: C, from: mid(C, A), region: poly(ov), cut: poly(0), bodyFrom: P(sh), bodyTo: P(wr) });
    }
  }
  if (group === 'bottom' && a.crotch) {
    const cr = a.crotch;
    for (const [s, hip, ankle] of [['L', LM.hipR, LM.ankleR], ['R', LM.hipL, LM.ankleL]] as const) {
      const H = a[`hem${s}`];
      const wx = a[`waist${s}`];
      if (!H || !wx || H.y <= cr.y + 2) continue;
      const pv = { x: (wx.x + cr.x) / 2, y: cr.y };
      const [x0, x1] = s === 'L' ? [-1, cr.x] : [cr.x, w + 1];
      const poly = (top: number): Pt[] => [{ x: x0, y: top }, { x: x1, y: top }, { x: x1, y: h + 1 }, { x: x0, y: h + 1 }];
      out.push({ name: `hem${s}`, pivot: pv, from: pv, region: poly(cr.y - Math.max(1, (H.y - cr.y) * 0.04)), cut: poly(cr.y), bodyFrom: P(hip), bodyTo: P(ankle) });
    }
  }
  return out.length === 2 ? out : [];
}

/** Fits one garment to the body (try-on §4) and applies its remembered adjustment (try-on §5). */
export function fitGarment(category: CategoryId, anchors: GarmentAnchors, body: BodyModel, fit?: FitAdjustment): Placement {
  const group = CATEGORY[category].group;
  const a = anchors.points;
  const T = bodyTargets(group, category, anchors, body);
  const pieces: Piece[] = [];
  const handles: Handle[] = [];
  let pivot: Pt;

  if (T.pair) {
    const { names, boxes, scale: k } = T.pair;
    const centres: Pt[] = [];
    const ms: Mat[] = [];
    names.forEach((name, i) => {
      const src = a[name];
      const target = add(T.at[name], off(fit, name, T.ref));
      const m = compose(translate(target.x - src.x * k, target.y - src.y * k), scale(k));
      ms.push(m);
      const b0 = a[`${boxes[i]}0`];
      const b1 = a[`${boxes[i]}1`];
      // Each shoe or glove is clipped to its own half of the cut-out (split between the two shapes).
      const split = a.split?.x ?? (b0.x + b1.x) / 2;
      const clip = i === 0 ? { x0: 0, y0: 0, x1: split, y1: anchors.height } : { x0: split, y0: 0, x1: anchors.width, y1: anchors.height };
      pieces.push({ m, clip });
      centres.push(apply(m, mid(b0, b1)));
    });
    pivot = mid(centres[0], centres[1]);
    const W = wholeMatrix(fit, T.ref, pivot);
    pieces.forEach((p) => { p.m = compose(W, p.m); });
    names.forEach((name, i) => handles.push({ name, at: apply(compose(W, ms[i]), a[name]), kind: 'point' }));
    return { pieces, ref: T.ref, pivot, handles, targets: T.at, whole: W };
  }

  const [n1, n2] = T.main!;
  const q1 = add(T.at[n1], off(fit, n1, T.ref));
  const q2 = add(T.at[n2], off(fit, n2, T.ref));
  let m = similarity(a[n1], a[n2], q1, q2);
  const limbs = limbsOf(group, a, body, anchors.width, anchors.height);
  // Trouser legs carry their own length; the whole-garment hem stretch is for tops, skirts and scarves.
  if (group === 'bottom' && limbs.length) T.length = undefined;
  if (T.length && a[T.length]) {
    // The length anchor follows the similarity unless the user moved it; then a 3-point affine stretches the garment.
    const auto = apply(m, a[T.length]);
    T.at[T.length] = auto;
    const o = off(fit, T.length, T.ref);
    if (o.x !== 0 || o.y !== 0) m = affine3([a[n1], a[n2], a[T.length]], [q1, q2, add(auto, o)]);
  }
  const box0 = a.box0 ?? { x: 0, y: 0 };
  const box1 = a.box1 ?? { x: anchors.width, y: anchors.height };
  pivot = apply(m, mid(box0, box1));
  const W = wholeMatrix(fit, T.ref, pivot);
  const full = compose(W, m);

  // Sleeves turn about the shoulder and legs about the hip to follow the body; a dragged end turns and stretches them.
  const limbPieces: Piece[] = [];
  const limbHandles: Handle[] = [];
  let split = false;
  for (const l of limbs) {
    const pv = apply(m, l.pivot);
    const gAng = angleFromDown(sub(apply(m, a[l.name]), apply(m, l.from)));
    const bAng = angleFromDown(sub(l.bodyTo, l.bodyFrom));
    let turn = clamp(bAng - gAng, -LIMB_MAX_TURN, LIMB_MAX_TURN);
    const long = dist(apply(m, l.from), apply(m, a[l.name])) >= LIMB_MIN_LENGTH * dist(l.bodyFrom, l.bodyTo);
    if (Math.abs(turn) < LIMB_MIN_TURN || !long) turn = 0;
    let R = about(pv, rotate(-turn));
    const autoEnd = apply(compose(R, m), a[l.name]);
    T.at[l.name] = autoEnd;
    const o = off(fit, l.name, T.ref);
    if (o.x !== 0 || o.y !== 0) R = compose(similarity(pv, autoEnd, pv, add(autoEnd, o)), R);
    if (turn !== 0 || o.x !== 0 || o.y !== 0) split = true;
    const lm = compose(W, compose(R, m));
    // Soft blend: the same fabric at in-between angles, only near the pivot, fills the wedge a turn opens at the
    // armpit or crotch.
    const ang = matAngle(R);
    if (Math.abs(ang) >= LIMB_MIN_TURN) {
      const near = ellipsePoly(l.pivot.x, l.pivot.y, 0.45 * dist(l.pivot, a[l.name]), 0.45 * dist(l.pivot, a[l.name]), 24);
      for (const f of [0, 0.25, 0.5, 0.75]) {
        limbPieces.push({ m: compose(W, compose(about(pv, rotate(ang * f)), m)), polys: { pts: [l.region] }, within: near });
      }
    }
    limbPieces.push({ m: lm, polys: { pts: [l.region] } });
    limbHandles.push({ name: l.name, at: apply(lm, a[l.name]), kind: 'point' });
  }
  if (split) {
    const frame = [{ x: -2, y: -2 }, { x: anchors.width + 2, y: -2 }, { x: anchors.width + 2, y: anchors.height + 2 }, { x: -2, y: anchors.height + 2 }];
    pieces.push({ m: full, polys: { pts: [frame, ...limbs.map((l) => l.cut)], evenOdd: true } }, ...limbPieces);
  } else {
    pieces.push({ m: full });
  }
  handles.push({ name: n1, at: apply(full, a[n1]), kind: 'point' }, { name: n2, at: apply(full, a[n2]), kind: 'point' });
  handles.push(...limbHandles);
  if (T.length && a[T.length]) handles.push({ name: T.length, at: apply(full, a[T.length]), kind: 'point' });
  if (T.move && a[T.move]) handles.push({ name: T.move, at: apply(full, a[T.move]), kind: 'move' });
  return { pieces, ref: T.ref, pivot, handles, targets: T.at, whole: W };
}

/**
 * The point offset (in reference lengths) that puts anchor `name` at canonical position `to`, given the current
 * placement. Used by Adjust fit's drag handles.
 */
export function offsetForHandle(pl: Placement, name: string, to: Pt): { dx: number; dy: number } {
  const target = pl.targets[name];
  if (!target) return { dx: 0, dy: 0 };
  // Undo the whole-garment adjustment, then measure from the automatic target.
  const inv = invertMat(pl.whole);
  const local = apply(inv, to);
  const d = mul(sub(local, target), 1 / pl.ref);
  return { dx: d.x, dy: d.y };
}

function invertMat(m: Mat): Mat {
  const [a, b, c, d, e, f] = m;
  const det = a * d - b * c || 1;
  return [d / det, -b / det, -c / det, a / det, (c * f - d * e) / det, (b * e - a * f) / det];
}

/** True when an adjustment changes nothing (stored as undefined). */
export function isNeutralFit(fit?: FitAdjustment): boolean {
  if (!fit) return true;
  const pts = Object.values(fit.points ?? {}).some((p) => Math.abs(p.dx) > 1e-4 || Math.abs(p.dy) > 1e-4);
  return !pts && Math.abs(fit.dx) < 1e-4 && Math.abs(fit.dy) < 1e-4 && Math.abs(fit.scale - 1) < 1e-4 && Math.abs(fit.rotate) < 1e-3;
}

export const NEUTRAL_FIT: FitAdjustment = { dx: 0, dy: 0, scale: 1, rotate: 0 };

export type { Point };

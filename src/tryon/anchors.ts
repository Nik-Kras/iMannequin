// Garment anchors from the cut-out's shape (try-on §3 ⚑). Plain geometry on the alpha mask: this works because the
// capture guide fixes how garments are laid out (sleeves at about 45°, trouser legs slightly apart).
// Points are in the mask's pixel coordinates; "L" and "R" are the left and right of the image.
import type { AnchorGroup, GarmentAnchors, Point } from '../domain/types';
import { maskBounds, rowRuns, runAt, type Mask } from './raster';

/** Bumped when the detection changes, so anchors cached on photos are recomputed. */
export const ANCHORS_VERSION = 5;

type Pts = Record<string, Point>;
type Box = { x0: number; y0: number; x1: number; y1: number };

const median = (xs: number[]): number => {
  if (!xs.length) return NaN;
  const s = [...xs].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};

/** First inside row of column x, scanning from y0 to y1 (or -1). */
function topOf(mask: Mask, x: number, y0: number, y1: number): number {
  const { width, data } = mask;
  for (let y = y0; y <= y1; y++) if (data[y * width + x] > 127) return y;
  return -1;
}

/** Inside pixels of a sub-rectangle, for centroids. */
function* insideIn(mask: Mask, b: Box, step = 1): Generator<[number, number]> {
  const { width, data } = mask;
  for (let y = b.y0; y <= b.y1; y += step) for (let x = b.x0; x <= b.x1; x += step) if (data[y * width + x] > 127) yield [x, y];
}

/** Bounds of the inside pixels within a sub-rectangle. */
function boundsIn(mask: Mask, b: Box): Box | undefined {
  let x0 = Infinity;
  let y0 = Infinity;
  let x1 = -1;
  let y1 = -1;
  for (const [x, y] of insideIn(mask, b)) {
    if (x < x0) x0 = x;
    if (x > x1) x1 = x;
    if (y < y0) y0 = y;
    if (y > y1) y1 = y;
  }
  return x1 < 0 ? undefined : { x0, y0, x1, y1 };
}

/** Extents (first start, last end) of a row's inside pixels within [xa, xb]. */
function rowSpan(mask: Mask, y: number, xa = 0, xb = mask.width - 1): [number, number] | undefined {
  const { width, data } = mask;
  let a = -1;
  let b = -1;
  for (let x = xa; x <= xb; x++) if (data[y * width + x] > 127) { if (a < 0) a = x; b = x; }
  return a < 0 ? undefined : [a, b + 1];
}

/** The widest row in [ya, yb] and its extents. */
function widestRow(mask: Mask, ya: number, yb: number): { y: number; l: number; r: number } {
  let best = { y: ya, l: 0, r: 0 };
  for (let y = ya; y <= yb; y++) {
    const s = rowSpan(mask, y);
    if (s && s[1] - s[0] > best.r - best.l) best = { y, l: s[0], r: s[1] };
  }
  return best;
}

/** Splits a pair (shoes, gloves) at the widest empty column gap near the middle. */
function splitPair(mask: Mask, b: Box): number {
  const { width, data } = mask;
  const occupied = (x: number) => {
    for (let y = b.y0; y <= b.y1; y++) if (data[y * width + x] > 127) return true;
    return false;
  };
  const w = b.x1 - b.x0 + 1;
  const xa = Math.round(b.x0 + w * 0.2);
  const xb = Math.round(b.x1 - w * 0.2);
  let best = { len: 0, at: (b.x0 + b.x1 + 1) / 2 };
  let start = -1;
  for (let x = xa; x <= xb + 1; x++) {
    const empty = x <= xb && !occupied(x);
    if (empty && start < 0) start = x;
    if (!empty && start >= 0) {
      if (x - start > best.len) best = { len: x - start, at: (start + x) / 2 };
      start = -1;
    }
  }
  if (best.len > 0) return best.at;
  // Touching pair: split at the narrowest column count near the middle.
  let min = Infinity;
  let at = best.at;
  for (let x = xa; x <= xb; x++) {
    let n = 0;
    for (let y = b.y0; y <= b.y1; y++) if (data[y * width + x] > 127) n++;
    if (n < min) { min = n; at = x + 0.5; }
  }
  return at;
}

function boxPts(p: Pts, prefix: string, b: Box) {
  p[`${prefix}0`] = { x: b.x0, y: b.y0 };
  p[`${prefix}1`] = { x: b.x1 + 1, y: b.y1 + 1 };
}

/** Tops, outerwear, dresses, jumpsuits (try-on §3, first row). */
function topAnchors(mask: Mask, b: Box, p: Pts) {
  const W = b.x1 - b.x0 + 1;
  const H = b.y1 - b.y0 + 1;
  const cx = (b.x0 + b.x1 + 1) / 2;
  const gap = Math.max(1, Math.round(W * 0.015));
  // The body of the garment in each row: every run that reaches the middle fifth, joined (so an open front or a
  // V-neck still counts as one piece), and leaving out sleeves that hang apart from it.
  const band = [cx - W * 0.2, cx + W * 0.2];
  const centre: ([number, number] | undefined)[] = [];
  for (let y = 0; y < mask.height; y++) {
    if (y < b.y0 || y > b.y1) { centre.push(undefined); continue; }
    let span: [number, number] | undefined;
    for (const r of rowRuns(mask, y, gap)) {
      if (r[1] < band[0] || r[0] > band[1]) continue;
      span = span ? [Math.min(span[0], r[0]), Math.max(span[1], r[1])] : [r[0], r[1]];
    }
    centre.push(span);
  }

  // Hem: the lowest row whose middle is still garment (long sleeves can hang lower than a cropped hem).
  let hemY = b.y1;
  while (hemY > b.y0 && !centre[hemY]) hemY--;
  const nearHem = centre[Math.max(b.y0, Math.round(hemY - H * 0.02))] ?? centre[hemY]!;
  p.hemL = { x: nearHem[0], y: hemY + 1 };
  p.hemR = { x: nearHem[1] + 1, y: hemY + 1 };
  p.hemC = { x: cx, y: hemY + 1 };

  // Armpits: going up from the hem, where the side edge jumps outwards onto a sleeve.
  const J = Math.max(2, W * 0.04);
  const armpit = (side: -1 | 1): Point | undefined => {
    let prev = side < 0 ? nearHem[0] : nearHem[1];
    for (let y = hemY - 1; y > b.y0 + H * 0.08; y--) {
      const run = centre[y];
      if (!run) continue;
      const edge = side < 0 ? run[0] : run[1];
      if ((side < 0 ? prev - edge : edge - prev) > J) return { x: side < 0 ? prev : prev + 1, y: y + 1 };
      prev = edge;
    }
    return undefined;
  };
  const aL = armpit(-1);
  const aR = armpit(1);
  const fallbackY = b.y0 + H * 0.33;

  // Torso: the stable width just below the armpits.
  const ay = Math.max(aL?.y ?? fallbackY, aR?.y ?? fallbackY);
  const edges: { l: number[]; r: number[] } = { l: [], r: [] };
  for (let y = Math.round(ay); y <= Math.round(ay + (hemY - ay) * 0.25); y++) {
    const run = centre[y];
    if (run) { edges.l.push(run[0]); edges.r.push(run[1] + 1); }
  }
  const torsoL = edges.l.length ? median(edges.l) : b.x0 + W * 0.2;
  const torsoR = edges.r.length ? median(edges.r) : b.x1 + 1 - W * 0.2;
  p.armpitL = aL ?? { x: torsoL, y: fallbackY };
  p.armpitR = aR ?? { x: torsoR, y: fallbackY };
  p.torsoL = { x: torsoL, y: ay };
  p.torsoR = { x: torsoR, y: ay };

  // Shoulders: the top corners. On each side, the point of the top contour farthest outside the chord from the
  // neck (highest point) to the outermost point (a sleeve end, or the hem corner without sleeves).
  const tops: number[] = [];
  for (let x = 0; x < mask.width; x++) tops.push(x >= b.x0 && x <= b.x1 ? topOf(mask, x, b.y0, b.y1) : -1);
  const corner = (side: -1 | 1): Point => {
    const xs: number[] = [];
    if (side < 0) for (let x = b.x0; x <= cx - W * 0.02; x++) xs.push(x);
    else for (let x = b.x1; x >= cx + W * 0.02; x--) xs.push(x);
    let N = { x: cx, y: Infinity };
    for (const x of xs) if (tops[x] >= 0 && tops[x] < N.y) N = { x, y: tops[x] };
    const E = { x: xs[0], y: tops[xs[0]] };
    let best = { x: side < 0 ? torsoL : torsoR, y: tops[Math.round(side < 0 ? torsoL : torsoR)] ?? b.y0, d: -Infinity };
    for (const x of xs) {
      const t = tops[x];
      if (t < 0) continue;
      if (side < 0 ? x > N.x : x < N.x) continue;
      const cross = (E.x - N.x) * (t - N.y) - (E.y - N.y) * (x - N.x);
      const d = side < 0 ? cross : -cross;
      if (d > best.d) best = { x, y: t, d };
    }
    // No corner sticks out (a sleeveless top: the contour drops inside the chord): the shoulder is the outer end of
    // the flat top, the strap's corner.
    if (best.d < W * 0.015) {
      let x = N.x;
      while ((side < 0 ? x - 1 >= xs[0] : x + 1 <= xs[0]) && tops[x + side] >= 0 && tops[x + side] - N.y <= Math.max(1, H * 0.02)) x += side;
      return { x: x + 0.5, y: tops[x] };
    }
    // A rounded shoulder (knits, jackets) bends gradually; the seam is where the contour starts to leave the
    // straight shoulder line, so walk out from the neck until it drops below that line.
    const at = (f: number) => {
      const x = Math.round(N.x + (best.x - N.x) * f);
      return { x, y: tops[x] };
    };
    const p1 = at(0.25);
    const p2 = at(0.6);
    if (p1.y >= 0 && p2.y >= 0 && p1.x !== p2.x) {
      const slope = (p2.y - p1.y) / (p2.x - p1.x);
      const tol = Math.max(1, W * 0.012);
      const dir = side;
      for (let x = p2.x; dir < 0 ? x >= best.x : x <= best.x; x += dir) {
        const t = tops[x];
        if (t >= 0 && t - (p1.y + slope * (x - p1.x)) > tol) return { x: x - dir + 0.5, y: tops[x - dir] };
      }
    }
    return { x: best.x + 0.5, y: best.y };
  };
  p.shoulderL = corner(-1);
  p.shoulderR = corner(1);

  // Neckline centre: the first row whose run covers the middle column (the bottom of a V or the front of a crew neck).
  let ny = b.y0;
  while (ny < hemY && !runAt(rowRuns(mask, ny, gap), Math.floor(cx), 0)) ny++;
  p.neck = { x: cx, y: ny };
  // The collar's top centre: the handle that moves the whole garment in Adjust fit.
  p.collar = { x: cx, y: b.y0 };

  // Sleeve ends: centre of the cuff band of the pixels outside the shoulder → armpit line.
  const sleeve = (side: -1 | 1) => {
    const C = side < 0 ? p.shoulderL : p.shoulderR;
    const A = side < 0 ? p.armpitL : p.armpitR;
    const outside = (x: number, y: number) => {
      const cross = (A.x - C.x) * (y - C.y) - (A.y - C.y) * (x - C.x);
      return side < 0 ? cross > 0 : cross < 0;
    };
    const step = Math.max(1, Math.round(W / 160));
    const pix: [number, number][] = [];
    // Above the armpit the sleeve is joined to the body, so the shoulder → armpit line separates them; below it the
    // sleeve is whatever lies outside the body's run in that row.
    for (const [x, y] of insideIn(mask, b, step)) {
      if (y <= C.y) continue;
      const run = centre[y];
      const out = y < A.y ? outside(x + 0.5, y + 0.5) : !run || (side < 0 ? x < run[0] : x > run[1]);
      if (out) pix.push([x + 0.5, y + 0.5]);
    }
    if (pix.length < 8) return undefined;
    const O = { x: (C.x + A.x) / 2, y: (C.y + A.y) / 2 };
    let gx = 0;
    let gy = 0;
    for (const [x, y] of pix) { gx += x; gy += y; }
    const dx = gx / pix.length - O.x;
    const dy = gy / pix.length - O.y;
    const n = Math.hypot(dx, dy) || 1;
    const proj = pix.map(([x, y]) => ((x - O.x) * dx + (y - O.y) * dy) / n);
    const maxP = Math.max(...proj);
    let sx = 0;
    let sy = 0;
    let k = 0;
    pix.forEach(([x, y], i) => { if (proj[i] >= maxP - W * 0.05) { sx += x; sy += y; k++; } });
    // Too short to be a sleeve (a sleeveless top's armhole edge).
    if (maxP < W * 0.08) return undefined;
    return { x: sx / k, y: sy / k };
  };
  const sL = sleeve(-1);
  const sR = sleeve(1);
  if (sL) p.sleeveL = sL;
  if (sR) p.sleeveR = sR;
}

/** Trousers, jeans, shorts, leggings. */
function bottomAnchors(mask: Mask, b: Box, p: Pts) {
  const W = b.x1 - b.x0 + 1;
  const H = b.y1 - b.y0 + 1;
  const cx = (b.x0 + b.x1 + 1) / 2;
  const wy = Math.round(b.y0 + H * 0.015);
  const top = rowSpan(mask, wy) ?? [b.x0, b.x1 + 1];
  p.waistL = { x: top[0], y: b.y0 };
  p.waistR = { x: top[1], y: b.y0 };

  // Crotch: the top of the gap between the legs (a gap in the middle third of the width).
  let crotch: Point | undefined;
  for (let y = Math.round(b.y0 + H * 0.05); y <= b.y1; y++) {
    const runs = rowRuns(mask, y, 0);
    for (let k = 0; k + 1 < runs.length; k++) {
      const g0 = runs[k][1] + 1;
      const g1 = runs[k + 1][0];
      const gc = (g0 + g1) / 2;
      if (g1 - g0 >= 1 && Math.abs(gc - cx) < W * 0.17) { crotch = { x: gc, y }; break; }
    }
    if (crotch) break;
  }
  p.crotch = crotch ?? { x: cx, y: b.y0 + H * 0.3 };

  // Hems: the bottom of each leg.
  const hem = (xa: number, xb: number): Point => {
    const lb = boundsIn(mask, { x0: Math.max(b.x0, Math.round(xa)), y0: Math.round(p.crotch.y), x1: Math.min(b.x1, Math.round(xb)), y1: b.y1 });
    if (!lb) return { x: (xa + xb) / 2, y: b.y1 + 1 };
    // The middle of the leg just above its lowest point (a slanted hem still gives the leg's centre).
    const yy = Math.max(lb.y0, Math.round(lb.y1 - (lb.y1 - p.crotch.y) * 0.05 - H * 0.01));
    const s = rowSpan(mask, yy, lb.x0, lb.x1) ?? [lb.x0, lb.x1 + 1];
    return { x: (s[0] + s[1]) / 2, y: lb.y1 + 1 };
  };
  p.hemL = hem(b.x0, p.crotch.x - 0.5);
  p.hemR = hem(p.crotch.x + 0.5, b.x1);
  p.hemC = { x: (p.hemL.x + p.hemR.x) / 2, y: Math.max(p.hemL.y, p.hemR.y) };
}

function skirtAnchors(mask: Mask, b: Box, p: Pts) {
  const H = b.y1 - b.y0 + 1;
  const top = rowSpan(mask, Math.round(b.y0 + H * 0.015)) ?? [b.x0, b.x1 + 1];
  p.waistL = { x: top[0], y: b.y0 };
  p.waistR = { x: top[1], y: b.y0 };
  // A curved hem: its corners are the widest row near the bottom.
  const bot = widestRow(mask, Math.round(b.y1 - H * 0.1), b.y1);
  p.hemL = { x: bot.l, y: bot.y + 0.5 };
  p.hemR = { x: bot.r, y: bot.y + 0.5 };
  p.hemC = { x: (bot.l + bot.r) / 2, y: b.y1 + 1 };
}

/** Shoes (the pair from the front, D39) and gloves: two shapes. */
function pairAnchors(mask: Mask, b: Box, p: Pts, group: 'shoes' | 'gloves') {
  const split = splitPair(mask, b);
  const left = boundsIn(mask, { x0: b.x0, y0: b.y0, x1: Math.floor(split - 0.5), y1: b.y1 }) ?? b;
  const right = boundsIn(mask, { x0: Math.ceil(split - 0.5), y0: b.y0, x1: b.x1, y1: b.y1 }) ?? b;
  boxPts(p, 'boxL', left);
  boxPts(p, 'boxR', right);
  p.split = { x: split, y: (b.y0 + b.y1) / 2 };
  const H = b.y1 - b.y0 + 1;
  if (group === 'shoes') {
    const sole = (c: Box): Point => {
      const s = rowSpan(mask, Math.max(c.y0, Math.round(c.y1 - H * 0.04)), c.x0, c.x1) ?? [c.x0, c.x1 + 1];
      return { x: (s[0] + s[1]) / 2, y: c.y1 + 1 };
    };
    p.soleL = sole(left);
    p.soleR = sole(right);
  } else {
    const cuff = (c: Box): Point => {
      const s = rowSpan(mask, Math.min(c.y1, Math.round(c.y0 + (c.y1 - c.y0) * 0.12)), c.x0, c.x1) ?? [c.x0, c.x1 + 1];
      return { x: (s[0] + s[1]) / 2, y: c.y0 };
    };
    p.cuffL = cuff(left);
    p.cuffR = cuff(right);
  }
}

/** Anchors for one garment cut-out mask (alpha > 127 = garment). */
export function findAnchors(mask: Mask, group: AnchorGroup): GarmentAnchors {
  const p: Pts = {};
  const b = maskBounds(mask) ?? { x0: 0, y0: 0, x1: mask.width - 1, y1: mask.height - 1 };
  boxPts(p, 'box', b);
  const H = b.y1 - b.y0 + 1;
  const cx = (b.x0 + b.x1 + 1) / 2;
  const cy = (b.y0 + b.y1 + 1) / 2;
  switch (group) {
    case 'top': topAnchors(mask, b, p); break;
    case 'bottom': bottomAnchors(mask, b, p); break;
    case 'skirt': skirtAnchors(mask, b, p); break;
    case 'shoes':
    case 'gloves': pairAnchors(mask, b, p, group); break;
    case 'hat': {
      const r = widestRow(mask, Math.round(b.y0 + H * 0.5), b.y1);
      p.brimL = { x: r.l, y: r.y + 0.5 };
      p.brimR = { x: r.r, y: r.y + 0.5 };
      p.top = { x: cx, y: b.y0 };
      break;
    }
    case 'scarf':
    case 'tie': {
      const r = widestRow(mask, b.y0, Math.round(b.y0 + H * (group === 'tie' ? 0.15 : 0.2)));
      p.topL = { x: r.l, y: r.y + 0.5 };
      p.topR = { x: r.r, y: r.y + 0.5 };
      p.bottom = { x: cx, y: b.y1 + 1 };
      break;
    }
    case 'belt': {
      const mid = (x: number): number => {
        let a = -1;
        let z = -1;
        for (let y = b.y0; y <= b.y1; y++) if (mask.data[y * mask.width + x] > 127) { if (a < 0) a = y; z = y; }
        return a < 0 ? cy : (a + z + 1) / 2;
      };
      p.endL = { x: b.x0, y: mid(b.x0) };
      p.endR = { x: b.x1 + 1, y: mid(b.x1) };
      break;
    }
    case 'bag': {
      const s = rowSpan(mask, b.y0) ?? [b.x0, b.x1 + 1];
      p.handle = { x: (s[0] + s[1]) / 2, y: b.y0 };
      p.bottom = { x: (s[0] + s[1]) / 2, y: b.y1 + 1 };
      break;
    }
    case 'glasses':
    case 'jewellery':
    default:
      p.centre = { x: cx, y: cy };
      p.left = { x: b.x0, y: cy };
      p.right = { x: b.x1 + 1, y: cy };
      break;
  }
  // Version and size stamp, so a cached copy can be checked (see assets.ts).
  p._v = { x: ANCHORS_VERSION, y: 0 };
  return { group, points: p, width: mask.width, height: mask.height };
}

/** Scales anchors found on a downscaled mask to the cut-out's real size. */
export function scaleAnchors(a: GarmentAnchors, width: number, height: number): GarmentAnchors {
  const sx = width / a.width;
  const sy = height / a.height;
  const points: Pts = {};
  for (const [k, v] of Object.entries(a.points)) points[k] = k === '_v' ? v : { x: v.x * sx, y: v.y * sy };
  return { ...a, points, width, height };
}

/** Whether cached anchors match the current detector and the cut-out. */
export function anchorsValid(a: GarmentAnchors | undefined, group: AnchorGroup, width: number, height: number, stamp = 0): a is GarmentAnchors {
  return !!a && a.group === group && a.width === width && a.height === height && a.points._v?.x === ANCHORS_VERSION && (a.points._v?.y ?? 0) === stamp;
}

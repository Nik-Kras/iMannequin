// Pure raster helpers: flatten an SVG path into polygons and fill them into a mask. Used for the default outline body
// (so its metrics come from the same code as a photo's) and for synthetic masks in unit tests.
import type { Pt } from './geom';

/** A binary mask: 1 byte per pixel, > 127 = inside. */
export interface Mask { width: number; height: number; data: Uint8Array }

export function emptyMask(width: number, height: number): Mask {
  return { width, height, data: new Uint8Array(width * height) };
}

/** Flattens an SVG path (M L H V Q C A Z, absolute or relative) into closed polygons. */
export function flattenPath(d: string, steps = 12): Pt[][] {
  const tokens = d.match(/[a-zA-Z]|-?(?:\d+\.?\d*|\.\d+)(?:e[-+]?\d+)?/g) ?? [];
  const polys: Pt[][] = [];
  let cur: Pt[] = [];
  let x = 0;
  let y = 0;
  let sx = 0;
  let sy = 0;
  let i = 0;
  let cmd = '';
  const num = () => Number(tokens[i++]);
  const isNum = () => i < tokens.length && !/^[a-zA-Z]$/.test(tokens[i]);
  const close = () => {
    if (cur.length > 2) polys.push(cur);
    cur = [];
  };
  while (i < tokens.length) {
    if (/^[a-zA-Z]$/.test(tokens[i])) cmd = tokens[i++];
    const rel = cmd === cmd.toLowerCase();
    const C = cmd.toUpperCase();
    const ox = rel ? x : 0;
    const oy = rel ? y : 0;
    if (C === 'Z') {
      x = sx;
      y = sy;
      close();
      continue;
    }
    if (!isNum()) { i++; continue; }
    if (C === 'M') {
      close();
      x = ox + num();
      y = oy + num();
      sx = x;
      sy = y;
      cur.push({ x, y });
      cmd = rel ? 'l' : 'L';
    } else if (C === 'L') {
      x = ox + num();
      y = oy + num();
      cur.push({ x, y });
    } else if (C === 'H') {
      x = ox + num();
      cur.push({ x, y });
    } else if (C === 'V') {
      y = oy + num();
      cur.push({ x, y });
    } else if (C === 'Q') {
      const cx = ox + num();
      const cy = oy + num();
      const ex = ox + num();
      const ey = oy + num();
      for (let s = 1; s <= steps; s++) {
        const t = s / steps;
        const u = 1 - t;
        cur.push({ x: u * u * x + 2 * u * t * cx + t * t * ex, y: u * u * y + 2 * u * t * cy + t * t * ey });
      }
      x = ex;
      y = ey;
    } else if (C === 'C') {
      const c1x = ox + num();
      const c1y = oy + num();
      const c2x = ox + num();
      const c2y = oy + num();
      const ex = ox + num();
      const ey = oy + num();
      for (let s = 1; s <= steps; s++) {
        const t = s / steps;
        const u = 1 - t;
        cur.push({
          x: u * u * u * x + 3 * u * u * t * c1x + 3 * u * t * t * c2x + t * t * t * ex,
          y: u * u * u * y + 3 * u * u * t * c1y + 3 * u * t * t * c2y + t * t * t * ey,
        });
      }
      x = ex;
      y = ey;
    } else if (C === 'A') {
      const rx = Math.abs(num());
      const ry = Math.abs(num());
      const phi = (num() * Math.PI) / 180;
      const large = num() !== 0;
      const sweep = num() !== 0;
      const ex = ox + num();
      const ey = oy + num();
      cur.push(...arcPoints(x, y, rx, ry, phi, large, sweep, ex, ey, steps * 2));
      x = ex;
      y = ey;
    } else {
      i++;
    }
  }
  close();
  return polys;
}

/** SVG elliptical arc → points (endpoint parameterisation, SVG spec F.6.5). */
function arcPoints(x1: number, y1: number, rx: number, ry: number, phi: number, large: boolean, sweep: boolean, x2: number, y2: number, steps: number): Pt[] {
  if (rx === 0 || ry === 0) return [{ x: x2, y: y2 }];
  const cos = Math.cos(phi);
  const sin = Math.sin(phi);
  const dx = (x1 - x2) / 2;
  const dy = (y1 - y2) / 2;
  const x1p = cos * dx + sin * dy;
  const y1p = -sin * dx + cos * dy;
  const lambda = (x1p * x1p) / (rx * rx) + (y1p * y1p) / (ry * ry);
  if (lambda > 1) {
    rx *= Math.sqrt(lambda);
    ry *= Math.sqrt(lambda);
  }
  const num = rx * rx * ry * ry - rx * rx * y1p * y1p - ry * ry * x1p * x1p;
  const den = rx * rx * y1p * y1p + ry * ry * x1p * x1p;
  let k = Math.sqrt(Math.max(0, num / den));
  if (large === sweep) k = -k;
  const cxp = (k * rx * y1p) / ry;
  const cyp = (-k * ry * x1p) / rx;
  const cx = cos * cxp - sin * cyp + (x1 + x2) / 2;
  const cy = sin * cxp + cos * cyp + (y1 + y2) / 2;
  const ang = (ux: number, uy: number, vx: number, vy: number) => {
    const a = Math.atan2(ux * vy - uy * vx, ux * vx + uy * vy);
    return a;
  };
  const t1 = ang(1, 0, (x1p - cxp) / rx, (y1p - cyp) / ry);
  let dt = ang((x1p - cxp) / rx, (y1p - cyp) / ry, (-x1p - cxp) / rx, (-y1p - cyp) / ry);
  if (!sweep && dt > 0) dt -= 2 * Math.PI;
  if (sweep && dt < 0) dt += 2 * Math.PI;
  const out: Pt[] = [];
  for (let s = 1; s <= steps; s++) {
    const t = t1 + (dt * s) / steps;
    out.push({ x: cx + rx * Math.cos(t) * cos - ry * Math.sin(t) * sin, y: cy + rx * Math.cos(t) * sin + ry * Math.sin(t) * cos });
  }
  return out;
}

/** An ellipse as a polygon. */
export function ellipsePoly(cx: number, cy: number, rx: number, ry: number, n = 48): Pt[] {
  const out: Pt[] = [];
  for (let i = 0; i < n; i++) {
    const t = (i / n) * Math.PI * 2;
    out.push({ x: cx + rx * Math.cos(t), y: cy + ry * Math.sin(t) });
  }
  return out;
}

export function mapPolys(polys: Pt[][], f: (p: Pt) => Pt): Pt[][] {
  return polys.map((poly) => poly.map(f));
}

/**
 * Fills polygons into a mask (scanline, pixel centres). Each polygon is filled on its own with the even-odd rule and
 * OR-ed in, so overlapping shapes (head over neck) stay solid. `evenOdd: true` fills the whole set with one even-odd
 * pass instead (shapes with holes, like glasses).
 */
export function fillPolys(mask: Mask, polys: Pt[][], opts: { evenOdd?: boolean; value?: number } = {}): Mask {
  const { width, height, data } = mask;
  const value = opts.value ?? 255;
  const groups = opts.evenOdd ? [polys] : polys.map((p) => [p]);
  for (const group of groups) {
    let minY = Infinity;
    let maxY = -Infinity;
    for (const poly of group) for (const p of poly) { minY = Math.min(minY, p.y); maxY = Math.max(maxY, p.y); }
    const y0 = Math.max(0, Math.floor(minY));
    const y1 = Math.min(height - 1, Math.ceil(maxY));
    const xs: number[] = [];
    for (let y = y0; y <= y1; y++) {
      const sy = y + 0.5;
      xs.length = 0;
      for (const poly of group) {
        for (let k = 0, n = poly.length; k < n; k++) {
          const a = poly[k];
          const b = poly[(k + 1) % n];
          if ((a.y <= sy && b.y > sy) || (b.y <= sy && a.y > sy)) {
            xs.push(a.x + ((sy - a.y) / (b.y - a.y)) * (b.x - a.x));
          }
        }
      }
      xs.sort((p, q) => p - q);
      for (let k = 0; k + 1 < xs.length; k += 2) {
        const xa = Math.max(0, Math.ceil(xs[k] - 0.5));
        const xb = Math.min(width - 1, Math.floor(xs[k + 1] - 0.5));
        const row = y * width;
        for (let x = xa; x <= xb; x++) data[row + x] = value;
      }
    }
  }
  return mask;
}

/** Runs of inside pixels in one row, as [start, end] inclusive, with gaps up to `mergeGap` px closed. */
export function rowRuns(mask: Mask, y: number, mergeGap = 0): [number, number][] {
  const { width, data } = mask;
  const runs: [number, number][] = [];
  if (y < 0 || y >= mask.height) return runs;
  const row = y * width;
  let start = -1;
  for (let x = 0; x < width; x++) {
    const on = data[row + x] > 127;
    if (on && start < 0) start = x;
    if (!on && start >= 0) {
      runs.push([start, x - 1]);
      start = -1;
    }
  }
  if (start >= 0) runs.push([start, width - 1]);
  if (mergeGap <= 0 || runs.length < 2) return runs;
  const merged: [number, number][] = [runs[0]];
  for (let k = 1; k < runs.length; k++) {
    const last = merged[merged.length - 1];
    if (runs[k][0] - last[1] - 1 <= mergeGap) last[1] = runs[k][1];
    else merged.push(runs[k]);
  }
  return merged;
}

/** The run that contains x, or the nearest run within `reach` px. */
export function runAt(runs: [number, number][], x: number, reach = 0): [number, number] | undefined {
  let best: [number, number] | undefined;
  let bestD = Infinity;
  for (const r of runs) {
    const d = x < r[0] ? r[0] - x : x > r[1] ? x - r[1] : 0;
    if (d < bestD) { bestD = d; best = r; }
  }
  return bestD <= reach ? best : undefined;
}

/** Bounding box of the inside pixels, or undefined for an empty mask. */
export function maskBounds(mask: Mask): { x0: number; y0: number; x1: number; y1: number } | undefined {
  const { width, height, data } = mask;
  let x0 = width;
  let y0 = height;
  let x1 = -1;
  let y1 = -1;
  for (let y = 0; y < height; y++) {
    const row = y * width;
    for (let x = 0; x < width; x++) {
      if (data[row + x] > 127) {
        if (x < x0) x0 = x;
        if (x > x1) x1 = x;
        if (y < y0) y0 = y;
        y1 = y;
      }
    }
  }
  return x1 < 0 ? undefined : { x0, y0, x1, y1 };
}

/** Downscales a mask by an integer-free factor (nearest sample), for fast analysis of big cut-outs. */
export function resampleMask(mask: Mask, width: number, height: number): Mask {
  const out = emptyMask(width, height);
  const sx = mask.width / width;
  const sy = mask.height / height;
  for (let y = 0; y < height; y++) {
    const srow = Math.min(mask.height - 1, Math.floor((y + 0.5) * sy)) * mask.width;
    const row = y * width;
    for (let x = 0; x < width; x++) out.data[row + x] = mask.data[srow + Math.min(mask.width - 1, Math.floor((x + 0.5) * sx))];
  }
  return out;
}

/** Grows the set pixels (> 127) by `r` pixels in every direction: a square max filter, one pass per axis. */
export function dilateMask(mask: Mask, r: number): Mask {
  const { width: w, height: h } = mask;
  // Along one line of `n` cells: set every cell within r of a set cell, sweeping forwards then backwards.
  const grow = (n: number, at: (i: number) => number, set: (i: number) => void) => {
    for (let i = 0, seen = -Infinity; i < n; i++) { if (at(i) > 127) seen = i; if (i - seen <= r) set(i); }
    for (let i = n - 1, seen = Infinity; i >= 0; i--) { if (at(i) > 127) seen = i; if (seen - i <= r) set(i); }
  };
  const rows = emptyMask(w, h);
  for (let y = 0; y < h; y++) grow(w, (x) => mask.data[y * w + x], (x) => { rows.data[y * w + x] = 255; });
  const out = emptyMask(w, h);
  for (let x = 0; x < w; x++) grow(h, (y) => rows.data[y * w + x], (y) => { out.data[y * w + x] = 255; });
  return out;
}

/**
 * A sharp mask from a cut-out model, kept only near a coarse mask of the same subject (any size): the cut-out model
 * draws the edges, the coarse mask says which object is the person, so a towel or a door it also found is dropped.
 * `reach` is in coarse-mask pixels.
 */
export function keepNear(fine: Mask, coarse: Mask, reach: number): Mask {
  const near = resampleMask(dilateMask(coarse, reach), fine.width, fine.height);
  const out = emptyMask(fine.width, fine.height);
  for (let i = 0; i < out.data.length; i++) out.data[i] = near.data[i] > 127 ? fine.data[i] : 0;
  return out;
}

/** Pixels set (> 127). */
export function maskArea(mask: Mask): number {
  let n = 0;
  for (let i = 0; i < mask.data.length; i++) if (mask.data[i] > 127) n++;
  return n;
}

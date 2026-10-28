// Garment masks in plain code: the plain-background cut-out (architecture §4) and the clean-up
// applied to every model's mask. Pure functions over typed arrays, so they run in a worker and in
// node unit tests alike. Alpha is 0–255, one byte per pixel, row-major.
import { rgbToLab } from './colours';

export interface Box { x: number; y: number; w: number; h: number }

export interface PlainCutout {
  alpha: Uint8ClampedArray;
  width: number;
  height: number;
  bbox: Box | null;
  /** 0–1: how sure the plain path is that the background was clean and the garment came out whole. */
  confidence: number;
  /** The checks that pulled the confidence down (for the Model lab and debugging). */
  reasons: string[];
}

/** Confidence at or above this means the plain path's cut-out is used without a model. */
export const PLAIN_CLEAN = 0.6;

const smooth = (a: number, b: number, x: number) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

function median(values: number[]): number {
  if (!values.length) return 0;
  const s = [...values].sort((a, b) => a - b);
  return s[Math.floor(s.length / 2)];
}

/** Least-squares plane v = c0 + c1·x + c2·y through the samples (x, y normalised 0–1). */
function fitPlane(xs: number[], ys: number[], vs: number[], use: boolean[]): [number, number, number] {
  let n = 0, sx = 0, sy = 0, sv = 0, sxx = 0, syy = 0, sxy = 0, sxv = 0, syv = 0;
  for (let i = 0; i < vs.length; i++) {
    if (!use[i]) continue;
    const x = xs[i], y = ys[i], v = vs[i];
    n++; sx += x; sy += y; sv += v; sxx += x * x; syy += y * y; sxy += x * y; sxv += x * v; syv += y * v;
  }
  if (n < 3) return [median(vs), 0, 0];
  // Solve the 3×3 normal equations by Cramer's rule.
  const A = [[n, sx, sy], [sx, sxx, sxy], [sy, sxy, syy]];
  const B = [sv, sxv, syv];
  const det = (m: number[][]) =>
    m[0][0] * (m[1][1] * m[2][2] - m[1][2] * m[2][1]) - m[0][1] * (m[1][0] * m[2][2] - m[1][2] * m[2][0]) + m[0][2] * (m[1][0] * m[2][1] - m[1][1] * m[2][0]);
  const D = det(A);
  if (Math.abs(D) < 1e-9) return [sv / n, 0, 0];
  const col = (k: number) => A.map((row, r) => row.map((v, c) => (c === k ? B[r] : v)));
  return [det(col(0)) / D, det(col(1)) / D, det(col(2)) / D];
}

/**
 * The plain-background fast path. Models the background colour from the image border (a plane per
 * Lab channel, so a soft light gradient is fine), flood-fills the background from the edges, keeps
 * the garment's main pieces, fills their holes, trims a 1 px fringe and feathers the edge.
 */
export function plainBackgroundCutout(rgba: Uint8ClampedArray | Uint8Array, width: number, height: number): PlainCutout {
  const N = width * height;
  const L = new Float32Array(N), A = new Float32Array(N), B = new Float32Array(N);
  for (let i = 0; i < N; i++) {
    const lab = rgbToLab(rgba[i * 4], rgba[i * 4 + 1], rgba[i * 4 + 2]);
    L[i] = lab[0]; A[i] = lab[1]; B[i] = lab[2];
  }

  // 1. Border samples.
  const band = Math.max(2, Math.round(Math.min(width, height) * 0.012));
  const inBand = (x: number, y: number) => x < band || y < band || x >= width - band || y >= height - band;
  const stride = Math.max(1, Math.floor((2 * band * (width + height)) / 5000));
  const xs: number[] = [], ys: number[] = [], ls: number[] = [], as: number[] = [], bs: number[] = [];
  let k = 0;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (!inBand(x, y)) { if (x === band && y >= band && y < height - band) x = width - band - 1; continue; }
      if (k++ % stride) continue;
      const i = y * width + x;
      xs.push(x / width); ys.push(y / height); ls.push(L[i]); as.push(A[i]); bs.push(B[i]);
    }
  }

  // 2. Robust background model: fit, drop outliers (garment touching the edge, a stray object), refit.
  let use = ls.map(() => true);
  let pl = fitPlane(xs, ys, ls, use), pa = fitPlane(xs, ys, as, use), pb = fitPlane(xs, ys, bs, use);
  const resid = () => ls.map((_, i) => Math.hypot(
    ls[i] - (pl[0] + pl[1] * xs[i] + pl[2] * ys[i]),
    as[i] - (pa[0] + pa[1] * xs[i] + pa[2] * ys[i]),
    bs[i] - (pb[0] + pb[1] * xs[i] + pb[2] * ys[i]),
  ));
  for (let pass = 0; pass < 2; pass++) {
    const r = resid();
    const cut = Math.max(6, median(r) * 3);
    use = r.map((v) => v < cut);
    pl = fitPlane(xs, ys, ls, use); pa = fitPlane(xs, ys, as, use); pb = fitPlane(xs, ys, bs, use);
  }
  const r = resid();
  const noise = median(r.filter((_, i) => use[i]));
  const T = Math.min(30, Math.max(14, noise * 4 + 12));
  const borderClean = r.filter((v) => v < T).length / Math.max(1, r.length);

  // 3. Distance of every pixel from the modelled background.
  const dist = new Float32Array(N);
  for (let y = 0; y < height; y++) {
    const ny = y / height;
    for (let x = 0; x < width; x++) {
      const nx = x / width, i = y * width + x;
      dist[i] = Math.hypot(L[i] - (pl[0] + pl[1] * nx + pl[2] * ny), A[i] - (pa[0] + pa[1] * nx + pa[2] * ny), B[i] - (pb[0] + pb[1] * nx + pb[2] * ny));
    }
  }

  // 4. Flood-fill the background from the edges.
  const bg = new Uint8Array(N);
  const stack = new Int32Array(N);
  let sp = 0;
  const seed = (i: number) => { if (!bg[i] && dist[i] < T) { bg[i] = 1; stack[sp++] = i; } };
  for (let x = 0; x < width; x++) { seed(x); seed((height - 1) * width + x); }
  for (let y = 0; y < height; y++) { seed(y * width); seed(y * width + width - 1); }
  while (sp) {
    const i = stack[--sp];
    const x = i % width, y = (i / width) | 0;
    if (x > 0) seed(i - 1);
    if (x < width - 1) seed(i + 1);
    if (y > 0) seed(i - width);
    if (y < height - 1) seed(i + width);
  }

  // 5. Garment = the main pieces that aren't background (a pair of shoes is two). Everything they
  //    enclose counts as garment (holes filled).
  const fg = new Uint8Array(N);
  let totalFg = 0;
  for (let i = 0; i < N; i++) if (!bg[i]) { fg[i] = 1; totalFg++; }
  const { mask: kept, size: keptSize } = mainComponents(fg, width, height);
  const filled = fillHoles(kept, width, height);
  let area = 0;
  for (let i = 0; i < N; i++) area += filled[i];

  // 6. Checks.
  const reasons: string[] = [];
  const score = (name: string, v: number) => { if (v < 0.75) reasons.push(`${name}:${v.toFixed(2)}`); return v; };
  let enclosedBgLike = 0, boundary = 0, boundaryDist = 0, touch = 0, bandPx = 0;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = y * width + x;
      if (inBand(x, y)) { bandPx++; if (filled[i]) touch++; }
      if (!filled[i]) continue;
      if (dist[i] < T) enclosedBgLike++; // background-coloured but enclosed by the garment
      const edge = (x > 0 && !filled[i - 1]) || (x < width - 1 && !filled[i + 1]) || (y > 0 && !filled[i - width]) || (y < height - 1 && !filled[i + width]);
      if (edge) {
        boundary++;
        // Contrast just inside the edge: look two pixels further in, where the colour is the garment's own.
        let d = dist[i];
        for (const o of [-2, 2]) {
          const xi = x + o, yi = y + o;
          if (xi >= 0 && xi < width && filled[y * width + xi]) d = Math.max(d, dist[y * width + xi]);
          if (yi >= 0 && yi < height && filled[yi * width + x]) d = Math.max(d, dist[yi * width + x]);
        }
        boundaryDist += d;
      }
    }
  }
  const areaShare = area / N;
  const meanEdge = boundary ? boundaryDist / boundary : 0;
  const ragged = area ? boundary / Math.sqrt(area) : Infinity;
  const conf =
    score('border', smooth(0.7, 0.92, borderClean)) *
    score('area', smooth(0.025, 0.06, areaShare) * (1 - smooth(0.82, 0.92, areaShare))) *
    score('pieces', smooth(0.8, 0.95, totalFg ? keptSize / totalFg : 0)) *
    score('contrast', smooth(T * 1.05, T * 1.8, meanEdge)) *
    score('touch', 1 - smooth(0.03, 0.12, bandPx ? touch / bandPx : 0)) *
    score('noise', 1 - smooth(5, 10, noise)) *
    score('ragged', 1 - smooth(16, 28, ragged)) *
    score('inner-bg', 1 - smooth(0.04, 0.12, area ? enclosedBgLike / area : 0));

  // 7. Trim the 1 px fringe that still carries background colour, then feather 1–2 px.
  const trimmed = erode(filled, width, height);
  const alpha = new Uint8ClampedArray(N);
  for (let i = 0; i < N; i++) alpha[i] = trimmed[i] ? 255 : 0;
  const soft = boxBlur(alpha, width, height, 1);
  return { alpha: soft, width, height, bbox: maskBBox(soft, width, height), confidence: area ? conf : 0, reasons };
}

/** The largest 4-connected component of a 0/1 mask. */
export function largestComponent(mask: Uint8Array, width: number, height: number): { mask: Uint8Array; size: number } {
  const N = width * height;
  const label = new Int32Array(N);
  const stack = new Int32Array(N);
  let best = 0, bestSize = 0, next = 0;
  for (let s = 0; s < N; s++) {
    if (!mask[s] || label[s]) continue;
    next++;
    let size = 0, sp = 0;
    label[s] = next; stack[sp++] = s;
    while (sp) {
      const i = stack[--sp];
      size++;
      const x = i % width;
      const push = (j: number) => { if (mask[j] && !label[j]) { label[j] = next; stack[sp++] = j; } };
      if (x > 0) push(i - 1);
      if (x < width - 1) push(i + 1);
      if (i >= width) push(i - width);
      if (i < N - width) push(i + width);
    }
    if (size > bestSize) { bestSize = size; best = next; }
  }
  const out = new Uint8Array(N);
  if (best) for (let i = 0; i < N; i++) out[i] = label[i] === best ? 1 : 0;
  return { mask: out, size: bestSize };
}

/**
 * The garment's pieces: every 4-connected component at least `share` of the largest one. A pair of
 * shoes or gloves, or an open jacket's two fronts, stay together; specks and stray objects go.
 */
export function mainComponents(mask: Uint8Array, width: number, height: number, share = 0.15): { mask: Uint8Array; size: number } {
  const N = width * height;
  const label = new Int32Array(N);
  const stack = new Int32Array(N);
  const sizes: number[] = [0];
  for (let s = 0; s < N; s++) {
    if (!mask[s] || label[s]) continue;
    const id = sizes.length;
    let size = 0, sp = 0;
    label[s] = id; stack[sp++] = s;
    while (sp) {
      const i = stack[--sp];
      size++;
      const x = i % width;
      const push = (j: number) => { if (mask[j] && !label[j]) { label[j] = id; stack[sp++] = j; } };
      if (x > 0) push(i - 1);
      if (x < width - 1) push(i + 1);
      if (i >= width) push(i - width);
      if (i < N - width) push(i + width);
    }
    sizes.push(size);
  }
  const largest = Math.max(0, ...sizes);
  const keep = sizes.map((n) => n > 0 && n >= largest * share);
  const out = new Uint8Array(N);
  let size = 0;
  for (let i = 0; i < N; i++) if (label[i] && keep[label[i]]) { out[i] = 1; size++; }
  return { mask: out, size };
}

/**
 * Fills enclosed holes of a 0/1 mask. With `maxHole` (a pixel count), only holes up to that size are
 * filled, so a bag's handle loop stays open while specks inside a print are closed.
 */
export function fillHoles(mask: Uint8Array, width: number, height: number, maxHole = Infinity): Uint8Array {
  const N = width * height;
  const outside = new Uint8Array(N);
  const stack = new Int32Array(N);
  let sp = 0;
  const seed = (i: number) => { if (!mask[i] && !outside[i]) { outside[i] = 1; stack[sp++] = i; } };
  for (let x = 0; x < width; x++) { seed(x); seed((height - 1) * width + x); }
  for (let y = 0; y < height; y++) { seed(y * width); seed(y * width + width - 1); }
  while (sp) {
    const i = stack[--sp];
    const x = i % width;
    if (x > 0) seed(i - 1);
    if (x < width - 1) seed(i + 1);
    if (i >= width) seed(i - width);
    if (i < N - width) seed(i + width);
  }
  const out = mask.slice();
  if (maxHole === Infinity) {
    for (let i = 0; i < N; i++) if (!mask[i] && !outside[i]) out[i] = 1;
    return out;
  }
  // Size each hole and fill only the small ones.
  const seen = new Uint8Array(N);
  const members: number[] = [];
  for (let s = 0; s < N; s++) {
    if (mask[s] || outside[s] || seen[s]) continue;
    members.length = 0;
    seen[s] = 1; stack[sp++] = s;
    while (sp) {
      const i = stack[--sp];
      members.push(i);
      const x = i % width;
      const push = (j: number) => { if (!mask[j] && !outside[j] && !seen[j]) { seen[j] = 1; stack[sp++] = j; } };
      if (x > 0) push(i - 1);
      if (x < width - 1) push(i + 1);
      if (i >= width) push(i - width);
      if (i < N - width) push(i + width);
    }
    if (members.length <= maxHole) for (const i of members) out[i] = 1;
  }
  return out;
}

/** One-pixel erosion (4-neighbourhood). */
export function erode(mask: Uint8Array, width: number, height: number): Uint8Array {
  const out = new Uint8Array(mask.length);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = y * width + x;
      out[i] = mask[i] && x > 0 && x < width - 1 && y > 0 && y < height - 1 && mask[i - 1] && mask[i + 1] && mask[i - width] && mask[i + width] ? 1 : 0;
    }
  }
  return out;
}

/** Separable box blur of an alpha channel, `r` pixels each side, run twice (close to a small Gaussian). */
export function boxBlur(alpha: Uint8ClampedArray, width: number, height: number, r: number): Uint8ClampedArray {
  let src = Float32Array.from(alpha);
  const tmp = new Float32Array(src.length);
  const win = 2 * r + 1;
  for (let pass = 0; pass < 2; pass++) {
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        let s = 0;
        for (let d = -r; d <= r; d++) s += src[y * width + Math.min(width - 1, Math.max(0, x + d))];
        tmp[y * width + x] = s / win;
      }
    }
    const out = new Float32Array(src.length);
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        let s = 0;
        for (let d = -r; d <= r; d++) s += tmp[Math.min(height - 1, Math.max(0, y + d)) * width + x];
        out[y * width + x] = s / win;
      }
    }
    src = out;
  }
  return Uint8ClampedArray.from(src, (v) => Math.round(v));
}

/** Bounding box of the pixels with alpha ≥ threshold, or null when there are none. */
export function maskBBox(alpha: ArrayLike<number>, width: number, height: number, threshold = 24): Box | null {
  let x0 = width, y0 = height, x1 = -1, y1 = -1;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (alpha[y * width + x] < threshold) continue;
      if (x < x0) x0 = x;
      if (x > x1) x1 = x;
      if (y < y0) y0 = y;
      if (y > y1) y1 = y;
    }
  }
  return x1 < 0 ? null : { x: x0, y: y0, w: x1 - x0 + 1, h: y1 - y0 + 1 };
}

/** Grows a box by a margin (a share of its longest side) and clamps it to the image. */
export function padBox(b: Box, width: number, height: number, share = 0.04, min = 6): Box {
  const m = Math.max(min, Math.round(Math.max(b.w, b.h) * share));
  const x = Math.max(0, b.x - m), y = Math.max(0, b.y - m);
  return { x, y, w: Math.min(width, b.x + b.w + m) - x, h: Math.min(height, b.y + b.h + m) - y };
}

/**
 * Cleans a model's soft mask: the main pieces only (stray blobs go), small holes closed, larger
 * holes (a bag's handle loop) kept, soft edges preserved.
 */
export function cleanModelMask(alpha: Uint8ClampedArray | Uint8Array, width: number, height: number): Uint8ClampedArray {
  const N = width * height;
  const bin = new Uint8Array(N);
  for (let i = 0; i < N; i++) bin[i] = alpha[i] >= 128 ? 1 : 0;
  const { mask: kept, size } = mainComponents(bin, width, height);
  const filled = fillHoles(kept, width, height, Math.max(16, size * 0.002));
  // Keep soft edge values within 3 px of the kept piece; zero everything else.
  const near = dilate(filled, width, height, 3);
  const out = new Uint8ClampedArray(N);
  for (let i = 0; i < N; i++) out[i] = filled[i] ? Math.max(alpha[i], filled[i] && !bin[i] ? 255 : 0) : near[i] ? alpha[i] : 0;
  return out;
}

function dilate(mask: Uint8Array, width: number, height: number, r: number): Uint8Array {
  let src = mask;
  for (let k = 0; k < r; k++) {
    const out = new Uint8Array(src.length);
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const i = y * width + x;
        out[i] = src[i] || (x > 0 && src[i - 1]) || (x < width - 1 && src[i + 1]) || (y > 0 && src[i - width]) || (y < height - 1 && src[i + width]) ? 1 : 0;
      }
    }
    src = out;
  }
  return src;
}

/** Bilinear resample of a region of an alpha channel to a new size. */
export function resampleAlpha(src: ArrayLike<number>, sw: number, sh: number, region: Box, ow: number, oh: number): Uint8ClampedArray {
  const out = new Uint8ClampedArray(ow * oh);
  const sx = region.w / ow, sy = region.h / oh;
  for (let y = 0; y < oh; y++) {
    const fy = Math.min(sh - 1, Math.max(0, region.y + (y + 0.5) * sy - 0.5));
    const y0 = Math.floor(fy), y1 = Math.min(sh - 1, y0 + 1), ty = fy - y0;
    for (let x = 0; x < ow; x++) {
      const fx = Math.min(sw - 1, Math.max(0, region.x + (x + 0.5) * sx - 0.5));
      const x0 = Math.floor(fx), x1 = Math.min(sw - 1, x0 + 1), tx = fx - x0;
      const a = src[y0 * sw + x0] * (1 - tx) + src[y0 * sw + x1] * tx;
      const b = src[y1 * sw + x0] * (1 - tx) + src[y1 * sw + x1] * tx;
      out[y * ow + x] = Math.round(a * (1 - ty) + b * ty);
    }
  }
  return out;
}

/** Output size for a crop so its longest side is at most `max`. */
export function fitWithin(w: number, h: number, max: number): { w: number; h: number } {
  const k = Math.min(1, max / Math.max(w, h));
  return { w: Math.max(1, Math.round(w * k)), h: Math.max(1, Math.round(h * k)) };
}

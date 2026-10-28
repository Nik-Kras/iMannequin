// Colour suggestions in plain code (architecture §4): k-means over the cut-out's opaque pixels,
// then each cluster is named from the ColourName palette. No model, no DOM: unit-tested in node.
import type { ColourName } from '../domain/types';

export type RGB = [number, number, number];
export type Lab = [number, number, number];

/**
 * Reference swatches per name. Several per name cover light and dark shades; the sample wardrobe's
 * colours (src/dev/samples.ts) are included so the drawn garments name the way the samples say.
 */
const REFS: Record<Exclude<ColourName, 'multi'>, string[]> = {
  black: ['#111111', '#1e1e1e', '#232323', '#2b2b2b'],
  white: ['#ffffff', '#f5f5f2', '#f2f1ec', '#ecebe6'],
  grey: ['#4d4d4d', '#6b6b6b', '#8c8c8c', '#a9a9a9', '#c4c4c4', '#d5d5d3'],
  cream: ['#efe6d2', '#f3ead8', '#ede3c8', '#f5efdf'],
  beige: ['#d8c8a8', '#c9b48e', '#c8b08a', '#d6c4a0'],
  brown: ['#3d2b1f', '#5a3e2b', '#6b4a2f', '#7b5537'],
  tan: ['#b08a5a', '#a87c4f', '#c19a6b', '#9c7448'],
  red: ['#a8323a', '#b8282e', '#d0312d', '#c0392b'],
  burgundy: ['#6d1f2c', '#5e1a26', '#7b2434', '#4a1520'],
  pink: ['#e8a0b4', '#f4c2cf', '#d6407a', '#e36f95'],
  orange: ['#e8792b', '#f08a30', '#ff9a3c', '#d9682a'],
  rust: ['#b5562f', '#a64b2a', '#9c4a2c', '#c0612f'],
  yellow: ['#f2d23c', '#f5dc5a', '#ffe14d', '#e8c92e'],
  mustard: ['#c9962f', '#c99a2e', '#b8892a', '#d4a63a'],
  green: ['#3f8f4a', '#2e6b3a', '#24432c', '#9aa88a', '#5fa35f', '#7da37a'],
  olive: ['#6b6b3a', '#5c5c30', '#707a3a', '#808046'],
  khaki: ['#a59a6a', '#b0a374', '#9b9065', '#bdb17f'],
  teal: ['#2a7f7f', '#1f6f73', '#3a9a98', '#226666'],
  blue: ['#3a6fc4', '#2f5fb3', '#9cc3e6', '#6a9fd8', '#1f4fa0'],
  navy: ['#23304f', '#2f3e5c', '#1b2540', '#283656'],
  denim: ['#4a6a8f', '#3e5b85', '#7f9cc0', '#56739a', '#5b7aa6'],
  purple: ['#6a3d8f', '#7b4fa0', '#b7a3d3', '#4b2a66', '#9b72c4'],
};

export function hexToRgb(hex: string): RGB {
  const n = parseInt(hex.replace('#', ''), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

const LIN = new Float32Array(256).map((_, c) => {
  const v = c / 255;
  return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
});
const lin = (c: number) => LIN[Math.max(0, Math.min(255, Math.round(c)))];
const f = (t: number) => (t > 216 / 24389 ? Math.cbrt(t) : (24389 / 27 * t + 16) / 116);

/** sRGB (0–255) to CIE L*a*b* (D65). */
export function rgbToLab(r: number, g: number, b: number): Lab {
  const R = lin(r), G = lin(g), B = lin(b);
  const x = (R * 0.4124 + G * 0.3576 + B * 0.1805) / 0.95047;
  const y = R * 0.2126 + G * 0.7152 + B * 0.0722;
  const z = (R * 0.0193 + G * 0.1192 + B * 0.9505) / 1.08883;
  const fx = f(x), fy = f(y), fz = f(z);
  return [116 * fy - 16, 500 * (fx - fy), 200 * (fy - fz)];
}

export const deltaE = (a: Lab, b: Lab) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);

const REF_LAB: { name: ColourName; lab: Lab }[] = Object.entries(REFS).flatMap(([name, hexes]) =>
  hexes.map((h) => ({ name: name as ColourName, lab: rgbToLab(...hexToRgb(h)) })),
);

/** The palette name closest to an sRGB colour. */
export function nameColour(rgb: RGB): ColourName {
  const lab = rgbToLab(...rgb);
  let best: ColourName = 'grey';
  let bestD = Infinity;
  for (const r of REF_LAB) {
    const d = deltaE(lab, r.lab);
    if (d < bestD) { bestD = d; best = r.name; }
  }
  return best;
}

/** Small deterministic PRNG so the same cut-out always gets the same colours. */
function mulberry32(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export interface ColourCluster { lab: Lab; rgb: RGB; share: number }

/** Opaque pixels of an RGBA buffer, subsampled to at most `max` points, in Lab. */
export function opaqueSamples(rgba: Uint8ClampedArray | Uint8Array, minAlpha = 200, max = 6000): { lab: Lab[]; rgb: RGB[] } {
  const n = rgba.length / 4;
  let opaque = 0;
  for (let i = 0; i < n; i++) if (rgba[i * 4 + 3] >= minAlpha) opaque++;
  const step = Math.max(1, Math.floor(opaque / max));
  const lab: Lab[] = [];
  const rgb: RGB[] = [];
  let k = 0;
  for (let i = 0; i < n; i++) {
    if (rgba[i * 4 + 3] < minAlpha) continue;
    if (k++ % step !== 0) continue;
    const c: RGB = [rgba[i * 4], rgba[i * 4 + 1], rgba[i * 4 + 2]];
    rgb.push(c);
    lab.push(rgbToLab(...c));
  }
  return { lab, rgb };
}

/** k-means (k-means++ seeding, fixed seed) in Lab. Returns clusters sorted by share. */
export function kmeans(points: Lab[], k = 4, iterations = 12, seed = 7): ColourCluster[] {
  if (!points.length) return [];
  const rand = mulberry32(seed);
  const K = Math.min(k, points.length);
  const centres: Lab[] = [points[Math.floor(rand() * points.length)]];
  const d2 = new Float64Array(points.length);
  while (centres.length < K) {
    let sum = 0;
    for (let i = 0; i < points.length; i++) {
      let m = Infinity;
      for (const c of centres) m = Math.min(m, deltaE(points[i], c) ** 2);
      d2[i] = m;
      sum += m;
    }
    if (sum === 0) break;
    let r = rand() * sum;
    let idx = 0;
    for (; idx < points.length - 1; idx++) { r -= d2[idx]; if (r <= 0) break; }
    centres.push(points[idx]);
  }
  const assign = new Int32Array(points.length);
  for (let it = 0; it < iterations; it++) {
    for (let i = 0; i < points.length; i++) {
      let best = 0, bd = Infinity;
      for (let c = 0; c < centres.length; c++) {
        const d = deltaE(points[i], centres[c]);
        if (d < bd) { bd = d; best = c; }
      }
      assign[i] = best;
    }
    const acc = centres.map(() => [0, 0, 0, 0]);
    for (let i = 0; i < points.length; i++) {
      const a = acc[assign[i]];
      a[0] += points[i][0]; a[1] += points[i][1]; a[2] += points[i][2]; a[3]++;
    }
    for (let c = 0; c < centres.length; c++) if (acc[c][3]) centres[c] = [acc[c][0] / acc[c][3], acc[c][1] / acc[c][3], acc[c][2] / acc[c][3]];
  }
  const counts = centres.map(() => 0);
  for (let i = 0; i < points.length; i++) counts[assign[i]]++;
  return centres
    .map((lab, c) => ({ lab, rgb: labToRgb(lab), share: counts[c] / points.length }))
    .filter((c) => c.share > 0)
    .sort((a, b) => b.share - a.share);
}

export function labToRgb([L, a, b]: Lab): RGB {
  const fy = (L + 16) / 116, fx = fy + a / 500, fz = fy - b / 200;
  const inv = (t: number) => (t ** 3 > 216 / 24389 ? t ** 3 : (116 * t - 16) / (24389 / 27));
  const x = inv(fx) * 0.95047, y = inv(fy), z = inv(fz) * 1.08883;
  const R = x * 3.2406 + y * -1.5372 + z * -0.4986;
  const G = x * -0.9689 + y * 1.8758 + z * 0.0415;
  const B = x * 0.0557 + y * -0.204 + z * 1.057;
  const g = (v: number) => Math.round(255 * Math.min(1, Math.max(0, v <= 0.0031308 ? 12.92 * v : 1.055 * v ** (1 / 2.4) - 0.055)));
  return [g(R), g(G), g(B)];
}

/**
 * Names the main colours of a cut-out (RGBA, transparent background): up to three names with a share
 * of at least 15%, the biggest first. Four or more clearly different colours make it 'multi'.
 * Shadows and folds of one fabric are merged first, so a navy sweater doesn't come back as navy + black.
 */
export function garmentColours(rgba: Uint8ClampedArray | Uint8Array): ColourName[] {
  const { lab } = opaqueSamples(rgba);
  if (lab.length < 20) return [];
  return namesFromClusters(kmeans(lab, 5));
}

export function namesFromClusters(clusters: ColourCluster[]): ColourName[] {
  // Merge clusters that differ mostly in lightness (shade of the same fabric).
  const merged: ColourCluster[] = [];
  for (const c of clusters) {
    const near = merged.find((m) => {
      const dl = (m.lab[0] - c.lab[0]) * 0.35;
      return Math.hypot(dl, m.lab[1] - c.lab[1], m.lab[2] - c.lab[2]) < 9 && nameColour(m.rgb) !== 'white' && nameColour(c.rgb) !== 'white';
    });
    if (near) near.share += c.share; // keep the bigger cluster's colour
    else merged.push({ ...c });
  }
  const shares = new Map<ColourName, number>();
  for (const c of merged) {
    const n = nameColour(c.rgb);
    shares.set(n, (shares.get(n) ?? 0) + c.share);
  }
  const ranked = [...shares.entries()].sort((a, b) => b[1] - a[1]);
  if (ranked.filter(([, s]) => s >= 0.12).length >= 4) return ['multi'];
  const out = ranked.filter(([, s], i) => i === 0 || s >= 0.15).slice(0, 3).map(([n]) => n);
  return out;
}

/** Colours that read as one family for the same-item check (a denim jacket may name as blue or denim). */
const FAMILY: Record<ColourName, string> = {
  black: 'dark', navy: 'blue', white: 'light', cream: 'light', grey: 'grey', beige: 'sand', tan: 'sand', khaki: 'sand',
  brown: 'brown', red: 'red', burgundy: 'red', pink: 'pink', orange: 'orange', rust: 'orange', yellow: 'yellow', mustard: 'yellow',
  green: 'green', olive: 'green', teal: 'teal', blue: 'blue', denim: 'blue', purple: 'purple', multi: 'multi',
};

export const colourFamily = (c: ColourName) => FAMILY[c];

/** True when two colour lists share their main colour family (used by the same-item check, D9). */
export function coloursAgree(a: ColourName[], b: ColourName[]): boolean {
  if (!a.length || !b.length) return true; // nothing to compare: don't block on colour
  const fa = new Set(a.slice(0, 2).map(colourFamily));
  return b.slice(0, 2).some((c) => fa.has(colourFamily(c)));
}

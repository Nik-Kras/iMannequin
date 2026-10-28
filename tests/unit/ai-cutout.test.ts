import { describe, expect, it } from 'vitest';
import { cleanModelMask, fillHoles, largestComponent, mainComponents, maskBBox, padBox, plainBackgroundCutout, PLAIN_CLEAN, resampleAlpha } from '../../src/ai/mask';

type Pt = [number, number];

function inside(poly: Pt[], x: number, y: number): boolean {
  let c = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i], [xj, yj] = poly[j];
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) c = !c;
  }
  return c;
}

/** Deterministic noise in [-1, 1]. */
function noise(seed: number) {
  let s = seed;
  return () => { s = (s * 1103515245 + 12345) & 0x7fffffff; return (s / 0x7fffffff) * 2 - 1; };
}

/**
 * A synthetic flat-lay photo: background colour with a light gradient and sensor noise, and garment
 * polygons (a hole polygon is drawn back in the background colour).
 */
function photo(opts: { w?: number; h?: number; bg: Pt3; garment: Pt3; polys: Pt[][]; holes?: Pt[][]; noiseAmp?: number; gradient?: number; texture?: number }) {
  const { w = 200, h = 160, bg, garment, polys, holes = [], noiseAmp = 3, gradient = 10, texture = 0 } = opts;
  const rnd = noise(42);
  const px = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const inG = polys.some((p) => inside(p, x + 0.5, y + 0.5)) && !holes.some((p) => inside(p, x + 0.5, y + 0.5));
      const base = inG ? garment : bg;
      const shade = inG ? 0 : gradient * (x / w - 0.5);
      const tex = inG ? 0 : texture * rnd();
      const i = (y * w + x) * 4;
      for (let c = 0; c < 3; c++) px[i + c] = base[c] + shade + tex + noiseAmp * rnd();
      px[i + 3] = 255;
    }
  }
  return { px, w, h };
}
type Pt3 = [number, number, number];

// A T-shirt in a 200 × 160 frame (sleeves out at an angle, like the capture guide asks).
const TEE: Pt[] = [[80, 30], [100, 38], [120, 30], [150, 45], [140, 70], [128, 62], [128, 130], [72, 130], [72, 62], [60, 70], [50, 45]];
const WHITE: Pt3 = [238, 236, 232];
const NAVY: Pt3 = [47, 62, 92];

describe('plain-background cut-out', () => {
  it('cuts a navy T-shirt off a white background confidently', () => {
    const { px, w, h } = photo({ bg: WHITE, garment: NAVY, polys: [TEE] });
    const r = plainBackgroundCutout(px, w, h);
    expect(r.confidence, r.reasons.join(' ')).toBeGreaterThanOrEqual(PLAIN_CLEAN);
    expect(r.bbox).not.toBeNull();
    const b = r.bbox!;
    expect(b.x).toBeGreaterThanOrEqual(48);
    expect(b.x).toBeLessThanOrEqual(53);
    expect(b.x + b.w).toBeGreaterThanOrEqual(147);
    expect(b.x + b.w).toBeLessThanOrEqual(152);
    expect(b.y).toBeLessThanOrEqual(32);
    expect(b.y + b.h).toBeGreaterThanOrEqual(128);
    // Solid inside, clear outside, soft at the edge.
    expect(r.alpha[90 * w + 100]).toBe(255);
    expect(r.alpha[10 * w + 10]).toBe(0);
    expect(r.alpha[150 * w + 190]).toBe(0);
  });

  it('copes with a background light gradient', () => {
    const { px, w, h } = photo({ bg: WHITE, garment: NAVY, polys: [TEE], gradient: 26 });
    const r = plainBackgroundCutout(px, w, h);
    expect(r.confidence, r.reasons.join(' ')).toBeGreaterThanOrEqual(PLAIN_CLEAN);
    expect(r.alpha[5 * w + 5]).toBe(0);
    expect(r.alpha[5 * w + w - 6]).toBe(0);
  });

  it('fills small holes inside the garment (a print in the background colour)', () => {
    const print: Pt[] = [[96, 80], [104, 80], [104, 88], [96, 88]];
    const { px, w, h } = photo({ bg: WHITE, garment: NAVY, polys: [TEE], holes: [print] });
    const r = plainBackgroundCutout(px, w, h);
    expect(r.alpha[84 * w + 100]).toBe(255);
  });

  it('keeps only the largest piece (a stray sock in the corner goes)', () => {
    const sock: Pt[] = [[170, 130], [180, 130], [180, 140], [170, 140]];
    const { px, w, h } = photo({ bg: WHITE, garment: NAVY, polys: [TEE, sock] });
    const r = plainBackgroundCutout(px, w, h);
    expect(r.alpha[135 * w + 175]).toBe(0);
    expect(r.alpha[90 * w + 100]).toBe(255);
  });

  it('keeps both shoes of a pair and both fronts of an open jacket', () => {
    const left: Pt[] = [[60, 60], [95, 60], [95, 120], [60, 120]];
    const right: Pt[] = [[105, 60], [140, 60], [140, 120], [105, 120]];
    const { px, w, h } = photo({ bg: WHITE, garment: [30, 30, 30], polys: [left, right] });
    const r = plainBackgroundCutout(px, w, h);
    expect(r.confidence, r.reasons.join(' ')).toBeGreaterThanOrEqual(PLAIN_CLEAN);
    expect(r.alpha[90 * w + 77]).toBe(255);
    expect(r.alpha[90 * w + 122]).toBe(255);
    expect(r.alpha[90 * w + 100]).toBe(0); // the gap between them stays open
  });

  it('is not confident on a busy, textured background', () => {
    const { px, w, h } = photo({ bg: [150, 120, 90], garment: NAVY, polys: [TEE], texture: 45 });
    const r = plainBackgroundCutout(px, w, h);
    expect(r.confidence).toBeLessThan(PLAIN_CLEAN);
  });

  it('is not confident when the garment is close to the background colour', () => {
    const { px, w, h } = photo({ bg: [236, 230, 214], garment: [228, 220, 200], polys: [TEE] });
    const r = plainBackgroundCutout(px, w, h);
    expect(r.confidence).toBeLessThan(PLAIN_CLEAN);
  });

  it('is not confident when the garment runs off the edge of the photo', () => {
    const coat: Pt[] = [[-10, -10], [150, -10], [150, 170], [-10, 170]];
    const { px, w, h } = photo({ bg: WHITE, garment: NAVY, polys: [coat] });
    const r = plainBackgroundCutout(px, w, h);
    expect(r.confidence).toBeLessThan(PLAIN_CLEAN);
  });

  it('finds nothing in an empty photo', () => {
    const { px, w, h } = photo({ bg: WHITE, garment: NAVY, polys: [] });
    const r = plainBackgroundCutout(px, w, h);
    expect(r.confidence).toBe(0);
    expect(r.bbox).toBeNull();
  });
});

describe('mask helpers', () => {
  const W = 8, H = 6;
  const grid = (rows: string[]) => Uint8Array.from(rows.join('').split(''), (c) => (c === '#' ? 1 : 0));

  it('largestComponent keeps the biggest blob', () => {
    const m = grid(['##......', '##......', '........', '....###.', '....###.', '........']);
    const { mask, size } = largestComponent(m, W, H);
    expect(size).toBe(6);
    expect(mask[0]).toBe(0);
    expect(mask[3 * W + 5]).toBe(1);
  });

  it('fillHoles closes enclosed gaps, optionally only small ones', () => {
    const ring = grid(['........', '.#####..', '.#...#..', '.#####..', '........', '........']);
    expect(fillHoles(ring, W, H)[2 * W + 3]).toBe(1);
    expect(fillHoles(ring, W, H, 2)[2 * W + 3]).toBe(0); // the 3-pixel hole is bigger than allowed
  });

  it('padBox adds a margin (at least 6 px) and stays inside the image', () => {
    expect(padBox({ x: 2, y: 2, w: 100, h: 50 }, 110, 60, 0.04)).toEqual({ x: 0, y: 0, w: 108, h: 58 });
    expect(padBox({ x: 100, y: 100, w: 400, h: 200 }, 1000, 1000, 0.04)).toEqual({ x: 84, y: 84, w: 432, h: 232 });
  });

  it('maskBBox ignores faint pixels', () => {
    const a = new Uint8ClampedArray(W * H);
    a[1 * W + 2] = 10;
    a[3 * W + 4] = 255;
    expect(maskBBox(a, W, H)).toEqual({ x: 4, y: 3, w: 1, h: 1 });
  });

  it('resampleAlpha scales a region bilinearly', () => {
    const a = new Uint8ClampedArray([0, 255, 0, 255]);
    const out = resampleAlpha(a, 2, 2, { x: 0, y: 0, w: 2, h: 2 }, 4, 4);
    expect(out.length).toBe(16);
    expect(out[0]).toBe(0);
    expect(out[3]).toBe(255);
  });

  it('mainComponents keeps pieces of similar size and drops specks', () => {
    const m = grid(['###.###.', '###.###.', '###.###.', '........', '.......#', '........']);
    const { mask, size } = mainComponents(m, W, H);
    expect(size).toBe(18);
    expect(mask[4 * W + 7]).toBe(0);
  });

  it('cleanModelMask drops stray blobs and closes pin-holes but keeps a handle loop', () => {
    const S = 40;
    const a = new Uint8ClampedArray(S * S);
    for (let y = 5; y < 35; y++) for (let x = 5; x < 35; x++) a[y * S + x] = 255;
    for (let y = 10; y < 22; y++) for (let x = 12; x < 28; x++) a[y * S + x] = 0; // the handle loop: 192 px
    a[30 * S + 30] = 0; // a pin-hole
    a[1 * S + 38] = 255; // stray blob
    const out = cleanModelMask(a, S, S);
    expect(out[1 * S + 38]).toBe(0);
    expect(out[30 * S + 30]).toBe(255);
    expect(out[15 * S + 20]).toBe(0);
  });
});

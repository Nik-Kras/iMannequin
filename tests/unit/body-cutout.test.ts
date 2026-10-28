// D61: the body silhouette from the cut-out model, kept near MediaPipe's coarse person mask.
import { describe, expect, it } from 'vitest';
import { dilateMask, emptyMask, keepNear, maskArea, type Mask } from '../../src/tryon/raster';

const rect = (m: Mask, x0: number, y0: number, x1: number, y1: number) => {
  for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) m.data[y * m.width + x] = 255;
  return m;
};

describe('body silhouette (D61)', () => {
  it('dilation grows a pixel into a square, clipped at the edges', () => {
    const one = rect(emptyMask(9, 9), 4, 4, 4, 4);
    expect(maskArea(dilateMask(one, 2))).toBe(25);
    const corner = rect(emptyMask(9, 9), 0, 0, 0, 0);
    expect(maskArea(dilateMask(corner, 2))).toBe(9);
    expect(maskArea(dilateMask(emptyMask(9, 9), 3))).toBe(0);
  });

  it('keeps the sharp mask near the person and drops another object it found', () => {
    // Coarse (MediaPipe-like, 20 × 40): the person in the middle columns.
    const coarse = rect(emptyMask(20, 40), 8, 4, 11, 36);
    // Sharp (cut-out model, 100 × 200): the person a little wider than the coarse mask, plus a towel on the right.
    const sharp = rect(rect(emptyMask(100, 200), 38, 18, 61, 184), 85, 120, 98, 190);
    const kept = keepNear(sharp, coarse, 1);
    expect(kept.data[100 * 100 + 50]).toBe(255); // the body
    expect(kept.data[100 * 100 + 39]).toBe(255); // its edge, outside the coarse mask but within reach
    expect(kept.data[150 * 100 + 90]).toBe(0); // the towel
    expect(maskArea(kept)).toBe((61 - 38 + 1) * (184 - 18 + 1));
  });
});

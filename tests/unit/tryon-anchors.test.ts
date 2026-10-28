import { describe, expect, it } from 'vitest';
import { anchorsValid, findAnchors, scaleAnchors } from '../../src/tryon/anchors';
import { emptyMask, fillPolys } from '../../src/tryon/raster';
import { garmentMask } from './tryon-shapes';

const near = (p: { x: number; y: number }, x: number, y: number, tol = 2.5) => {
  expect(Math.abs(p.x - x), `x ${p.x.toFixed(1)} vs ${x}`).toBeLessThanOrEqual(tol);
  expect(Math.abs(p.y - y), `y ${p.y.toFixed(1)} vs ${y}`).toBeLessThanOrEqual(tol);
};

/** Anchors of a design garment, in design units (so expectations read like the drawing). */
function anchorsOf(kind: string, group: Parameters<typeof findAnchors>[1]) {
  const { mask, toDesign } = garmentMask(kind);
  const a = findAnchors(mask, group);
  return Object.fromEntries(Object.entries(a.points).map(([k, v]) => [k, k === '_v' ? v : toDesign(v)]));
}

describe('garment anchors (try-on §3)', () => {
  it('finds a T-shirt’s shoulders, armpits, hem and sleeve ends', () => {
    const a = anchorsOf('tee', 'top');
    near(a.shoulderL, 68, 68);
    near(a.shoulderR, 132, 68);
    near(a.armpitL, 73, 101, 4);
    near(a.armpitR, 127, 101, 4);
    near(a.hemC, 100, 170.5, 2);
    near(a.neck, 100, 65, 1.5);
    // Sleeve ends: the middle of each cuff edge (45,108)–(63,119) and (155,108)–(137,119).
    near(a.sleeveL, 54, 113.5, 3);
    near(a.sleeveR, 146, 113.5, 3);
  });

  it('puts a rounded (knitted) shoulder at the seam, not halfway down the sleeve', () => {
    const a = anchorsOf('sweater', 'top');
    expect(a.shoulderL.x).toBeGreaterThan(59);
    expect(a.shoulderL.x).toBeLessThan(67);
    near(a.sleeveL, 18, 175, 5);
  });

  it('treats an open jacket front and a V-neck as one garment', () => {
    const a = anchorsOf('jacket', 'top');
    near(a.shoulderL, 60, 68, 3);
    near(a.shoulderR, 140, 68, 3);
    near(a.hemC, 100, 197, 2);
    expect(a.neck.y).toBeGreaterThan(100); // the bottom of the V
    near(a.collar, 100, 56, 1.5);
  });

  it('keeps a flared dress hem out of the sleeves', () => {
    const a = anchorsOf('dress', 'top');
    near(a.shoulderL, 70, 67, 2);
    near(a.sleeveL, 58, 93, 4);
    expect(a.sleeveR.y).toBeLessThan(110);
  });

  it('falls back sensibly for a sleeveless top', () => {
    const a = anchorsOf('tank', 'top');
    expect(a.sleeveL).toBeUndefined();
    expect(a.shoulderL.x).toBeGreaterThan(84);
    expect(a.shoulderL.x).toBeLessThan(90);
    near(a.hemC, 100, 168, 2);
  });

  it('finds trousers’ waistband, crotch and hems', () => {
    const a = anchorsOf('jeans', 'bottom');
    near(a.waistL, 75, 172);
    near(a.waistR, 125, 172);
    near(a.crotch, 100, 214, 2);
    near(a.hemL, 85, 353, 2);
    near(a.hemR, 115, 353, 2);
    const s = anchorsOf('shorts', 'bottom');
    near(s.crotch, 100, 212, 2);
    near(s.hemL, 84, 229, 3.5);
  });

  it('finds a skirt’s waistband and hem', () => {
    const a = anchorsOf('skirt', 'skirt');
    near(a.waistL, 77, 170);
    near(a.hemR, 136, 263, 3);
  });

  it('splits a pair of shoes and gloves into two shapes', () => {
    const s = anchorsOf('sneakers', 'shoes');
    near(s.soleL, 82, 377);
    near(s.soleR, 118, 377);
    near(s.split, 100, s.split.y, 1);
    const g = anchorsOf('gloves', 'gloves');
    near(g.cuffL, 19, 176.5, 3);
    near(g.cuffR, 181, 176.5, 3);
  });

  it('finds a hat brim, a scarf top, belt ends and glasses', () => {
    const h = anchorsOf('beanie', 'hat');
    near(h.brimL, 82, 30);
    near(h.brimR, 118, 30);
    const sc = anchorsOf('scarf', 'scarf');
    near(sc.topL, 84, 63);
    near(sc.topR, 116, 63);
    const b = anchorsOf('belt', 'belt');
    near(b.endL, 74, 176);
    near(b.endR, 126, 176);
    const gl = anchorsOf('glasses', 'glasses');
    near(gl.left, 86.5, 31, 1);
    near(gl.right, 113.5, 31, 1);
  });

  it('scales anchors from a downscaled mask and validates the cache stamp', () => {
    const m = fillPolys(emptyMask(100, 50), [[{ x: 10, y: 10 }, { x: 90, y: 10 }, { x: 90, y: 40 }, { x: 10, y: 40 }]]);
    const a = findAnchors(m, 'belt');
    const big = scaleAnchors(a, 400, 200);
    expect(big.points.endL.x).toBeCloseTo(a.points.endL.x * 4);
    expect(big.points._v).toEqual(a.points._v);
    expect(anchorsValid(big, 'belt', 400, 200, 0)).toBe(true);
    expect(anchorsValid(big, 'belt', 401, 200, 0)).toBe(false);
    expect(anchorsValid(big, 'hat', 400, 200, 0)).toBe(false);
    expect(anchorsValid({ ...big, points: { ...big.points, _v: { x: 1, y: 0 } } }, 'belt', 400, 200, 0)).toBe(false);
  });
});

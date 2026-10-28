import { describe, expect, it } from 'vitest';
import type { CategoryId } from '../../src/domain/types';
import { CATEGORY } from '../../src/domain/taxonomy';
import { findAnchors } from '../../src/tryon/anchors';
import { defaultBody, DESIGN_K } from '../../src/tryon/defaultBody';
import { fitGarment, isNeutralFit, layerEase, offsetForHandle, type BodyModel } from '../../src/tryon/fit';
import { affine3, apply, compose, dist, invert, matScale, rotate, similarity, translate } from '../../src/tryon/geom';
import { garmentMask } from './tryon-shapes';

const body = defaultBody();
const prep = (kind: string, cat: CategoryId) => {
  const { mask, toDesign } = garmentMask(kind);
  return { anchors: findAnchors(mask, CATEGORY[cat].group), toDesign };
};
/** Where the fitted garment puts a point of its cut-out, in design units. */
const fittedD = (m: Parameters<typeof apply>[0], p: { x: number; y: number }) => {
  const c = apply(m, p);
  return { x: (c.x - 500) / DESIGN_K + 100, y: (c.y - 100) / DESIGN_K + 14 };
};

describe('geometry', () => {
  it('solves similarities and 3-point affines exactly', () => {
    const m = similarity({ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 5, y: 5 }, { x: 5, y: 25 });
    expect(apply(m, { x: 10, y: 0 })).toMatchObject({ x: expect.closeTo(5), y: expect.closeTo(25) });
    expect(matScale(m)).toBeCloseTo(2);
    const a = affine3([{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 0, y: 1 }], [{ x: 3, y: 4 }, { x: 5, y: 4 }, { x: 3, y: 7 }]);
    expect(apply(a, { x: 1, y: 1 })).toMatchObject({ x: expect.closeTo(5), y: expect.closeTo(7) });
    const r = compose(translate(3, 4), rotate(30));
    const back = apply(invert(r), apply(r, { x: 7, y: -2 }));
    expect(back.x).toBeCloseTo(7);
    expect(back.y).toBeCloseTo(-2);
  });
});

describe('automatic fit (try-on §4)', () => {
  // The design's garments were drawn on the default figure; a good fit puts them back where they were drawn.
  const cases: [string, CategoryId, string[], number][] = [
    ['tee', 'tshirt', ['shoulderL', 'shoulderR', 'hemC'], 2.5],
    ['dress', 'dress', ['shoulderL', 'shoulderR'], 2.5],
    ['jeans', 'jeans', ['waistL', 'waistR', 'hemC', 'crotch'], 2],
    ['shorts', 'shorts', ['waistL', 'waistR', 'hemC'], 2],
    ['beanie', 'hat', ['brimL', 'brimR'], 1.5],
    ['scarf', 'scarf', ['topL', 'topR', 'bottom'], 2],
    ['belt', 'belt', ['endL', 'endR'], 1.5],
    ['glasses', 'glasses', ['left', 'right'], 1.5],
  ];
  for (const [kind, cat, names, tol] of cases) {
    it(`puts the design ${kind} where it was drawn (±${tol} design units)`, () => {
      const { anchors, toDesign } = prep(kind, cat);
      const pl = fitGarment(cat, anchors, body);
      for (const n of names) {
        const got = fittedD(pl.pieces[0].m, anchors.points[n]);
        const want = toDesign(anchors.points[n]);
        expect(dist(got, want), `${kind}.${n}: ${JSON.stringify(got)} vs ${JSON.stringify(want)}`).toBeLessThanOrEqual(tol);
      }
    });
  }

  it('places each shoe and glove on its own foot or wrist, with one shared size', () => {
    const { anchors, toDesign } = prep('sneakers', 'sneakers');
    const pl = fitGarment('sneakers', anchors, body);
    expect(pl.pieces).toHaveLength(2);
    expect(dist(fittedD(pl.pieces[0].m, anchors.points.soleL), toDesign(anchors.points.soleL))).toBeLessThan(1.5);
    expect(dist(fittedD(pl.pieces[1].m, anchors.points.soleR), toDesign(anchors.points.soleR))).toBeLessThan(1.5);
    expect(matScale(pl.pieces[0].m)).toBeCloseTo(matScale(pl.pieces[1].m));
    const g = prep('gloves', 'gloves');
    const gp = fitGarment('gloves', g.anchors, body);
    const wristR = body.landmarks[16];
    const c = apply(gp.pieces[0].m, g.anchors.points.cuffL);
    expect(dist(c, wristR)).toBeLessThan(1);
  });

  it('matches width and keeps proportions (similarity, no stretch)', () => {
    const { anchors } = prep('tee', 'tshirt');
    const m = fitGarment('tshirt', anchors, body).pieces[0].m;
    // No shear: the two axes keep their length ratio and stay perpendicular.
    expect(Math.hypot(m[0], m[1])).toBeCloseTo(Math.hypot(m[2], m[3]), 6);
    expect(m[0] * m[2] + m[1] * m[3]).toBeCloseTo(0, 6);
  });

  it('applies layer ease: middle × 1.05, outer × 1.10, leggings × 0.97', () => {
    expect(layerEase('tshirt')).toBe(1);
    expect(layerEase('dress')).toBe(1);
    expect(layerEase('sweater')).toBe(1.05);
    expect(layerEase('coat')).toBe(1.1);
    expect(layerEase('leggings')).toBe(0.97);
    expect(layerEase('jeans')).toBe(1);
    // The same cut-out as a jacket sits 10% wider at the shoulders than as a T-shirt.
    const { anchors } = prep('tee', 'tshirt');
    const w = (cat: CategoryId) => {
      const h = fitGarment(cat, anchors, body).handles;
      return dist(h.find((x) => x.name === 'shoulderL')!.at, h.find((x) => x.name === 'shoulderR')!.at);
    };
    expect(w('jacket') / w('tshirt')).toBeCloseTo(1.1, 5);
    expect(w('sweater') / w('tshirt')).toBeCloseTo(1.05, 5);
  });
});

describe('remembered adjustments (try-on §5)', () => {
  const { anchors } = prep('tee', 'tshirt');

  it('moves a dragged handle exactly where it was dropped, in reference lengths', () => {
    const auto = fitGarment('tshirt', anchors, body);
    const from = auto.handles.find((h) => h.name === 'shoulderR')!.at;
    const to = { x: from.x + 30, y: from.y - 12 };
    const o = offsetForHandle(auto, 'shoulderR', to);
    expect(o.dx).toBeCloseTo(30 / auto.ref);
    expect(o.dy).toBeCloseTo(-12 / auto.ref);
    const moved = fitGarment('tshirt', anchors, body, { dx: 0, dy: 0, scale: 1, rotate: 0, points: { shoulderR: o } });
    const at = moved.handles.find((h) => h.name === 'shoulderR')!.at;
    expect(at.x).toBeCloseTo(to.x, 6);
    expect(at.y).toBeCloseTo(to.y, 6);
    // The other shoulder stays put.
    expect(dist(moved.handles.find((h) => h.name === 'shoulderL')!.at, auto.handles.find((h) => h.name === 'shoulderL')!.at)).toBeLessThan(1e-6);
  });

  it('stretches the length when the hem is moved, without moving the shoulders', () => {
    const auto = fitGarment('tshirt', anchors, body);
    const hem = auto.handles.find((h) => h.name === 'hemC')!.at;
    const o = offsetForHandle(auto, 'hemC', { x: hem.x, y: hem.y + 60 });
    const moved = fitGarment('tshirt', anchors, body, { dx: 0, dy: 0, scale: 1, rotate: 0, points: { hemC: o } });
    expect(moved.handles.find((h) => h.name === 'hemC')!.at.y).toBeCloseTo(hem.y + 60, 6);
    expect(moved.handles.find((h) => h.name === 'shoulderL')!.at.y).toBeCloseTo(auto.handles.find((h) => h.name === 'shoulderL')!.at.y, 6);
  });

  it('applies whole-garment move, scale and turn about the garment’s centre', () => {
    const auto = fitGarment('tshirt', anchors, body);
    const fit = { dx: 0.1, dy: -0.05, scale: 1.2, rotate: 5 };
    const adj = fitGarment('tshirt', anchors, body, fit);
    expect(matScale(adj.pieces[0].m) / matScale(auto.pieces[0].m)).toBeCloseTo(1.2, 6);
    const c2 = apply(adj.pieces[0].m, { x: (anchors.points.box0.x + anchors.points.box1.x) / 2, y: (anchors.points.box0.y + anchors.points.box1.y) / 2 });
    const c1 = apply(auto.pieces[0].m, { x: (anchors.points.box0.x + anchors.points.box1.x) / 2, y: (anchors.points.box0.y + anchors.points.box1.y) / 2 });
    expect(c2.x - c1.x).toBeCloseTo(0.1 * auto.ref, 6);
    expect(c2.y - c1.y).toBeCloseTo(-0.05 * auto.ref, 6);
    expect(isNeutralFit(fit)).toBe(false);
    expect(isNeutralFit({ dx: 0, dy: 0, scale: 1, rotate: 0, points: { hemC: { dx: 0, dy: 0 } } })).toBe(true);
    expect(isNeutralFit(undefined)).toBe(true);
  });

  it('survives a retaken body photo: the same offsets scale with the new body', () => {
    // A body 15% bigger and moved: every landmark and metric scaled about the canvas centre.
    const k = 1.15;
    const big: BodyModel = {
      landmarks: body.landmarks.map((l) => ({ ...l, x: 500 + (l.x - 500) * k, y: 100 + (l.y - 100) * k })),
      metrics: Object.fromEntries(Object.entries(body.metrics).map(([n, v]) => [n, n.endsWith('W') || n === 'height' ? v * k : n.endsWith('X') || n.endsWith('L') || n.endsWith('R') ? 500 + (v - 500) * k : 100 + (v - 100) * k])) as unknown as BodyModel['metrics'],
    };
    const fit = { dx: 0.05, dy: 0.02, scale: 1.1, rotate: 3, points: { shoulderR: { dx: 0.04, dy: -0.03 } } };
    const a = fitGarment('tshirt', anchors, body, fit);
    const b = fitGarment('tshirt', anchors, big, fit);
    const pa = apply(a.pieces[0].m, anchors.points.hemC);
    const pb = apply(b.pieces[0].m, anchors.points.hemC);
    expect(pb.x).toBeCloseTo(500 + (pa.x - 500) * k, 4);
    expect(pb.y).toBeCloseTo(100 + (pa.y - 100) * k, 4);
  });
});

describe('sleeves and legs follow the body (try-on §4 ⚑)', () => {
  const tee = prep('sweater', 'sweater');
  const jeans = prep('jeans', 'jeans');
  /** The default body with its arms or legs moved: wrists/ankles swung about the shoulders/hips by `deg`. */
  const swing = (pairs: [number, number][], deg: number): BodyModel => {
    const l = body.landmarks.map((p) => ({ ...p }));
    for (const [from, to] of pairs) {
      const o = l[from];
      const v = { x: l[to].x - o.x, y: l[to].y - o.y };
      const sgn = l[to].x < 500 ? 1 : -1; // swing outwards on both sides
      const r = (sgn * deg * Math.PI) / 180;
      l[to] = { ...l[to], x: o.x + v.x * Math.cos(r) - v.y * Math.sin(r) * -1 * 1, y: o.y + v.x * Math.sin(r) * -1 + v.y * Math.cos(r) };
    }
    return { landmarks: l, metrics: body.metrics };
  };
  /** Piece 0 is the body; 1 and 2 are the left and right limbs (the in-between "blend" pieces are skipped). */
  const main = (pl: ReturnType<typeof fitGarment>) => pl.pieces.filter((p) => !p.within);
  const axis = (pl: ReturnType<typeof fitGarment>, piece: number, from: { x: number; y: number }, to: { x: number; y: number }) => {
    const a = apply(main(pl)[piece].m, from);
    const b = apply(main(pl)[piece].m, to);
    return (Math.atan2(b.x - a.x, b.y - a.y) * 180) / Math.PI;
  };
  const armAngle = (b: BodyModel, s: number, w: number) => (Math.atan2(b.landmarks[w].x - b.landmarks[s].x, b.landmarks[w].y - b.landmarks[s].y) * 180) / Math.PI;

  it('keeps a garment that already matches as one piece', () => {
    expect(fitGarment('sweater', tee.anchors, body).pieces).toHaveLength(1);
    expect(fitGarment('jeans', jeans.anchors, body).pieces).toHaveLength(1);
  });

  it('turns each sleeve about its shoulder to the arm’s angle', () => {
    const wide = swing([[12, 16], [11, 15]], 12);
    const pl = fitGarment('sweater', tee.anchors, wide);
    expect(main(pl)).toHaveLength(3);
    // In-between pieces near each shoulder fill the wedge the turn opens.
    expect(pl.pieces.filter((p) => p.within).length).toBeGreaterThan(0);
    const p = tee.anchors.points;
    const left = axis(pl, 1, { x: (p.shoulderL.x + p.armpitL.x) / 2, y: (p.shoulderL.y + p.armpitL.y) / 2 }, p.sleeveL);
    expect(left).toBeCloseTo(armAngle(wide, 12, 16), 0);
    const right = axis(pl, 2, { x: (p.shoulderR.x + p.armpitR.x) / 2, y: (p.shoulderR.y + p.armpitR.y) / 2 }, p.sleeveR);
    expect(right).toBeCloseTo(armAngle(wide, 11, 15), 0);
    // The shoulder corner stays on the body piece's shoulder.
    expect(dist(apply(main(pl)[1].m, p.shoulderL), apply(main(pl)[0].m, p.shoulderL))).toBeLessThan(1e-6);
  });

  it('turns trouser legs to the leg angle and lets a dragged hem land exactly', () => {
    const apart = swing([[24, 28], [23, 27]], 6);
    const pl = fitGarment('jeans', jeans.anchors, apart);
    expect(main(pl)).toHaveLength(3);
    const hemL = pl.handles.find((h) => h.name === 'hemL')!.at;
    const to = { x: hemL.x - 25, y: hemL.y + 15 };
    const o = offsetForHandle(pl, 'hemL', to);
    const moved = fitGarment('jeans', jeans.anchors, apart, { dx: 0, dy: 0, scale: 1, rotate: 0, points: { hemL: o } });
    const at = moved.handles.find((h) => h.name === 'hemL')!.at;
    expect(at.x).toBeCloseTo(to.x, 6);
    expect(at.y).toBeCloseTo(to.y, 6);
  });

  it('caps the automatic turn', () => {
    const wild = swing([[12, 16], [11, 15]], 70);
    const pl = fitGarment('sweater', tee.anchors, wild);
    const p = tee.anchors.points;
    const before = axis(fitGarment('sweater', tee.anchors, body), 0, { x: (p.shoulderL.x + p.armpitL.x) / 2, y: (p.shoulderL.y + p.armpitL.y) / 2 }, p.sleeveL);
    const after = axis(pl, 1, { x: (p.shoulderL.x + p.armpitL.x) / 2, y: (p.shoulderL.y + p.armpitL.y) / 2 }, p.sleeveL);
    expect(Math.abs(after - before)).toBeLessThanOrEqual(30.001);
  });
});

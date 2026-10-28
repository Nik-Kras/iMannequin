import { describe, expect, it } from 'vitest';
import type { Landmark } from '../../src/domain/types';
import { bodyMetrics, canonicalLandmarks, canonicalTransform, checkPose, LM, metricsFromRecord, metricsToRecord } from '../../src/tryon/body';
import { defaultBody, defaultBodyPolys } from '../../src/tryon/defaultBody';
import { apply, compose, dist, rotate, scale, translate } from '../../src/tryon/geom';
import { emptyMask, fillPolys, mapPolys, maskBounds } from '../../src/tryon/raster';
import { zoneAt } from '../../src/tryon/zones';

const body = defaultBody();
/** The default body as a "photo": canonical → photo transform (tilted, scaled, moved), with a mask and normalised points. */
function photoOf(m: Parameters<typeof apply>[0], W: number, H: number, tweak?: (l: Landmark[]) => void) {
  const mask = fillPolys(emptyMask(W, H), mapPolys(defaultBodyPolys(), (p) => apply(m, p)));
  const lms = body.landmarks.map((l) => {
    const p = apply(m, l);
    return { x: p.x / W, y: p.y / H, z: 0, visibility: 0.95 };
  });
  tweak?.(lms);
  return { mask, lms };
}
const PHOTO = compose(translate(380, 640), compose(rotate(6), compose(scale(0.55), translate(-500, -1000))));

describe('canonical canvas (try-on §2.2)', () => {
  it('straightens, scales and centres a tilted photo back onto the 1000 × 2000 canvas', () => {
    const W = 760, H = 1300;
    const { mask, lms } = photoOf(PHOTO, W, H);
    const m = canonicalTransform(lms, W, H, mask);
    const canon = canonicalLandmarks(lms, W, H, m);
    for (const i of [LM.nose, LM.shoulderL, LM.shoulderR, LM.wristR, LM.hipL, LM.ankleL, LM.heelR]) {
      expect(dist(canon[i], body.landmarks[i]), `landmark ${i}`).toBeLessThan(5);
    }
    // Mid-shoulders → mid-ankles is vertical; heels at 1900, the top of the head at ~100.
    const ms = (canon[LM.shoulderL].x + canon[LM.shoulderR].x) / 2;
    const ma = (canon[LM.ankleL].x + canon[LM.ankleR].x) / 2;
    expect(Math.abs(ms - ma)).toBeLessThan(0.5);
    expect(Math.max(canon[LM.heelL].y, canon[LM.heelR].y)).toBeCloseTo(1900, 0);
  });

  it('measures body widths from the mask, which survive the round trip', () => {
    const W = 760, H = 1300;
    const { mask, lms } = photoOf(PHOTO, W, H);
    const m = canonicalTransform(lms, W, H, mask);
    const canon = canonicalLandmarks(lms, W, H, m);
    const back = compose(m, PHOTO);
    const canonMask = fillPolys(emptyMask(1000, 2000), mapPolys(defaultBodyPolys(), (p) => apply(back, p)));
    const got = bodyMetrics(canonMask, canon);
    const want = body.metrics;
    for (const k of ['shoulderW', 'waistW', 'hipW', 'headW'] as const) expect(Math.abs(got[k] - want[k]), k).toBeLessThan(want[k] * 0.04);
    // Widths come from the outside of the body, not from the joints.
    expect(want.shoulderW).toBeGreaterThan(Math.abs(body.landmarks[LM.shoulderL].x - body.landmarks[LM.shoulderR].x));
    expect(want.waistW).toBeLessThan(want.hipW);
    expect(want.waistY).toBeGreaterThan(want.shoulderY);
    expect(want.waistY).toBeLessThan(want.hipY);
    expect(metricsFromRecord(metricsToRecord(want))).toEqual(want);
    expect(metricsFromRecord({ top: 1 })).toBeUndefined();
  });
});

describe('pose check (try-on §2.2)', () => {
  const W = 760, H = 1300;
  const good = photoOf(PHOTO, W, H);
  const bounds = maskBounds(good.mask);

  it('passes a good A-pose', () => {
    expect(checkPose(good.lms, { width: W, height: H }, bounds)).toEqual([]);
  });

  it('flags arms held too close or too high', () => {
    const down = good.lms.map((l) => ({ ...l }));
    const s = down[LM.shoulderR];
    down[LM.wristR] = { ...down[LM.wristR], x: s.x + 0.01, y: s.y + 0.25 };
    expect(checkPose(down, { width: W, height: H }, bounds).find((i) => i.code === 'armAngle')?.detail).toMatch(/^low:/);
    const up = good.lms.map((l) => ({ ...l }));
    const sl = up[LM.shoulderL];
    up[LM.wristL] = { ...up[LM.wristL], x: sl.x + 0.3, y: sl.y + 0.05 };
    expect(checkPose(up, { width: W, height: H }, bounds).find((i) => i.code === 'armAngle')?.detail).toMatch(/^high:/);
  });

  it('flags a body turned to the side or away from the camera', () => {
    const side = good.lms.map((l) => ({ ...l }));
    const mx = (side[LM.shoulderL].x + side[LM.shoulderR].x) / 2;
    side[LM.shoulderL] = { ...side[LM.shoulderL], x: mx + 0.02 };
    side[LM.shoulderR] = { ...side[LM.shoulderR], x: mx - 0.02 };
    expect(checkPose(side, { width: W, height: H }, bounds).find((i) => i.code === 'facing')?.detail).toContain('sideways');
    const back = good.lms.map((l) => ({ ...l }));
    [back[LM.shoulderL], back[LM.shoulderR]] = [back[LM.shoulderR], back[LM.shoulderL]];
    expect(checkPose(back, { width: W, height: H }, bounds).find((i) => i.code === 'facing')?.detail).toContain('back');
  });

  it('flags feet or head cut off by the frame', () => {
    const cut = good.lms.map((l, i) => ([LM.heelL, LM.heelR, LM.toeL, LM.toeR].includes(i as 29) ? { ...l, y: 1.02, visibility: 0.2 } : l));
    const issues = checkPose(cut, { width: W, height: H }, bounds);
    expect(issues.find((i) => i.code === 'framing')?.detail).toContain('feet');
    expect(issues.find((i) => i.code === 'visibility')).toBeUndefined(); // out of frame is framing, not visibility
    const top = checkPose(good.lms, { width: W, height: H }, { ...bounds!, y0: 0 });
    expect(top.find((i) => i.code === 'framing')?.detail).toContain('head');
  });

  it('flags points that are in the frame but not seen clearly', () => {
    const blur = good.lms.map((l, i) => (i === LM.kneeL ? { ...l, visibility: 0.2 } : l));
    expect(checkPose(blur, { width: W, height: H }, bounds).find((i) => i.code === 'visibility')?.detail).toBe('knees');
    expect(checkPose([], { width: W, height: H })).toEqual([{ code: 'visibility', detail: 'body' }]);
  });
});

describe('body zones', () => {
  it('maps taps on the default body to its zones', () => {
    const l = body.landmarks;
    expect(zoneAt(l[LM.nose], body)).toBe('head');
    expect(zoneAt({ x: 500, y: (l[LM.shoulderL].y + l[LM.hipL].y) / 2 }, body)).toBe('torso');
    expect(zoneAt(l[LM.wristR], body)).toBe('hands');
    expect(zoneAt(l[LM.kneeL], body)).toBe('legs');
    expect(zoneAt(l[LM.heelL], body)).toBe('feet');
    expect(zoneAt({ x: 500, y: (l[LM.earL].y + l[LM.shoulderL].y) / 2 + 30 }, body)).toBe('neck');
    expect(zoneAt({ x: 5, y: 5 }, body)).toBeUndefined();
  });
});

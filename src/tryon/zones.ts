// Body zones for tapping the mannequin (Dress-up, D21/D31), from the body's key points. Pure.
import { LM } from './body';
import type { BodyModel } from './fit';
import type { Pt } from './geom';
import { lerp } from './geom';
import { FIT } from './fit';

export type MannequinZone = 'head' | 'neck' | 'torso' | 'hands' | 'legs' | 'feet';
export interface ZoneRect { zone: MannequinZone; x: number; y: number; w: number; h: number }

/** Tappable rectangles on the canonical canvas, in hit-test order (hands before the torso and legs they sit beside). */
export function zoneRects(body: BodyModel): ZoneRect[] {
  const m = body.metrics;
  const l = body.landmarks;
  const sw = m.shoulderW;
  const headBottom = m.headY + 0.52 * (m.shoulderY - m.headY);
  const neckBottom = m.shoulderY - 0.03 * sw;
  const wbY = lerp(m.waistY, m.hipY, FIT.rise);
  const ankleY = Math.max(l[LM.ankleL].y, l[LM.ankleR].y);
  const legsBottom = ankleY - 0.006 * m.height;
  const R = (zone: MannequinZone, x0: number, y0: number, x1: number, y1: number): ZoneRect => ({ zone, x: x0, y: y0, w: x1 - x0, h: y1 - y0 });
  const hand = (wrist: number, elbow: number) => {
    const w = l[wrist];
    const e = l[elbow];
    const c = { x: w.x + (w.x - e.x) * 0.25, y: w.y + (w.y - e.y) * 0.25 };
    const r = 0.27 * sw;
    return R('hands', c.x - r, c.y - r, c.x + r, c.y + r);
  };
  const hw = m.headW;
  const feetPad = 0.24 * sw;
  return [
    R('head', m.headL - 0.35 * hw, m.top - 0.25 * hw, m.headR + 0.35 * hw, headBottom),
    R('neck', m.headL - 0.1 * hw, headBottom, m.headR + 0.1 * hw, neckBottom),
    hand(LM.wristR, LM.elbowR),
    hand(LM.wristL, LM.elbowL),
    R('torso', m.shoulderL - 0.1 * sw, neckBottom, m.shoulderR + 0.1 * sw, wbY),
    R('legs', m.hipL - 0.1 * m.hipW, wbY, m.hipR + 0.1 * m.hipW, legsBottom),
    R('feet', Math.min(l[LM.toeR].x, l[LM.heelR].x) - feetPad, legsBottom, Math.max(l[LM.toeL].x, l[LM.heelL].x) + feetPad, m.bottom + 0.05 * sw),
  ];
}

export function zoneAt(p: Pt, body: BodyModel): MannequinZone | undefined {
  for (const r of zoneRects(body)) if (p.x >= r.x && p.x <= r.x + r.w && p.y >= r.y && p.y <= r.y + r.h) return r.zone;
  return undefined;
}

/** Where each Dress-up slot's callout line meets the body (D31), on the canonical canvas. */
export function calloutPoints(body: BodyModel): Record<'head' | 'neck' | 'top' | 'hands' | 'legs' | 'feet', Pt> {
  const m = body.metrics;
  const l = body.landmarks;
  const wbY = lerp(m.waistY, m.hipY, FIT.rise);
  const ankleY = Math.max(l[LM.ankleL].y, l[LM.ankleR].y);
  const wrist = l[LM.wristL];
  const elbow = l[LM.elbowL];
  return {
    head: { x: m.headR, y: m.headY },
    neck: { x: (m.shoulderL + m.shoulderR) / 2 + m.headW * 0.23, y: lerp(m.headY, m.shoulderY, 0.6) },
    top: { x: lerp(m.shoulderL, m.shoulderR, 0.886), y: lerp(m.shoulderY, m.waistY, 0.576) },
    hands: { x: wrist.x + (wrist.x - elbow.x) * 0.25, y: wrist.y + (wrist.y - elbow.y) * 0.36 },
    legs: { x: (m.hipL + m.hipR) / 2 + m.hipW * 0.35, y: lerp(wbY, ankleY, 0.61) },
    feet: { x: l[LM.heelL].x, y: Math.max(l[LM.heelL].y, l[LM.toeL].y) - m.height * 0.017 },
  };
}

// 2D maths for the paper doll: points and affine matrices in canvas order (a, b, c, d, e, f):
//   x' = a·x + c·y + e,  y' = b·x + d·y + f   (y points down, like images and <canvas>).
import type { Point } from '../domain/types';

export type Pt = Point;
export type Mat = [number, number, number, number, number, number];

export const IDENTITY: Mat = [1, 0, 0, 1, 0, 0];

export const pt = (x: number, y: number): Pt => ({ x, y });
export const add = (p: Pt, q: Pt): Pt => ({ x: p.x + q.x, y: p.y + q.y });
export const sub = (p: Pt, q: Pt): Pt => ({ x: p.x - q.x, y: p.y - q.y });
export const mul = (p: Pt, k: number): Pt => ({ x: p.x * k, y: p.y * k });
export const mid = (p: Pt, q: Pt): Pt => ({ x: (p.x + q.x) / 2, y: (p.y + q.y) / 2 });
export const lerp = (a: number, b: number, t: number): number => a + (b - a) * t;
export const dist = (p: Pt, q: Pt): number => Math.hypot(p.x - q.x, p.y - q.y);

export function apply(m: Mat, p: Pt): Pt {
  return { x: m[0] * p.x + m[2] * p.y + m[4], y: m[1] * p.x + m[3] * p.y + m[5] };
}

/** m1 ∘ m2: first m2, then m1. */
export function compose(m1: Mat, m2: Mat): Mat {
  const [a1, b1, c1, d1, e1, f1] = m1;
  const [a2, b2, c2, d2, e2, f2] = m2;
  return [
    a1 * a2 + c1 * b2,
    b1 * a2 + d1 * b2,
    a1 * c2 + c1 * d2,
    b1 * c2 + d1 * d2,
    a1 * e2 + c1 * f2 + e1,
    b1 * e2 + d1 * f2 + f1,
  ];
}

export function invert(m: Mat): Mat {
  const [a, b, c, d, e, f] = m;
  const det = a * d - b * c;
  if (Math.abs(det) < 1e-12) return IDENTITY;
  return [d / det, -b / det, -c / det, a / det, (c * f - d * e) / det, (b * e - a * f) / det];
}

export const translate = (x: number, y: number): Mat => [1, 0, 0, 1, x, y];
export const scale = (k: number, ky = k): Mat => [k, 0, 0, ky, 0, 0];
/** Rotation by `deg` degrees, clockwise on screen (y down). */
export function rotate(deg: number): Mat {
  const r = (deg * Math.PI) / 180;
  const c = Math.cos(r);
  const s = Math.sin(r);
  return [c, s, -s, c, 0, 0];
}
/** Scale and rotate about a pivot. */
export function about(pivot: Pt, m: Mat): Mat {
  return compose(translate(pivot.x, pivot.y), compose(m, translate(-pivot.x, -pivot.y)));
}

/** Uniform scale of a matrix (geometric mean of its axes). */
export const matScale = (m: Mat): number => Math.sqrt(Math.abs(m[0] * m[3] - m[1] * m[2]));
/** Rotation of a matrix in degrees (clockwise on screen). */
export const matAngle = (m: Mat): number => (Math.atan2(m[1], m[0]) * 180) / Math.PI;

/**
 * The similarity (scale + rotation + move, no shear) that maps p1→q1 and p2→q2 exactly.
 * Complex-number form: z = (q2 − q1) / (p2 − p1), q = z·p + t.
 */
export function similarity(p1: Pt, p2: Pt, q1: Pt, q2: Pt): Mat {
  const px = p2.x - p1.x;
  const py = p2.y - p1.y;
  const qx = q2.x - q1.x;
  const qy = q2.y - q1.y;
  const den = px * px + py * py;
  if (den < 1e-12) return translate(q1.x - p1.x, q1.y - p1.y);
  const zr = (qx * px + qy * py) / den;
  const zi = (qy * px - qx * py) / den;
  const e = q1.x - (zr * p1.x - zi * p1.y);
  const f = q1.y - (zi * p1.x + zr * p1.y);
  return [zr, zi, -zi, zr, e, f];
}

/** The affine map that sends three points onto three points exactly (falls back to a similarity if they're collinear). */
export function affine3(p: [Pt, Pt, Pt], q: [Pt, Pt, Pt]): Mat {
  const [p1, p2, p3] = p;
  const det = (p2.x - p1.x) * (p3.y - p1.y) - (p3.x - p1.x) * (p2.y - p1.y);
  if (Math.abs(det) < 1e-9) return similarity(p1, p2, q[0], q[1]);
  // Solve [x y 1]·[a c e; b d f]ᵀ for each output coordinate with Cramer's rule.
  const solve = (v1: number, v2: number, v3: number): [number, number, number] => {
    const A = ((v2 - v1) * (p3.y - p1.y) - (v3 - v1) * (p2.y - p1.y)) / det;
    const B = ((p2.x - p1.x) * (v3 - v1) - (p3.x - p1.x) * (v2 - v1)) / det;
    const C = v1 - A * p1.x - B * p1.y;
    return [A, B, C];
  };
  const [a, c, e] = solve(q[0].x, q[1].x, q[2].x);
  const [b, d, f] = solve(q[0].y, q[1].y, q[2].y);
  return [a, b, c, d, e, f];
}

/** Axis-aligned bounds of a rectangle after a transform. */
export function transformRect(m: Mat, x: number, y: number, w: number, h: number): { x: number; y: number; w: number; h: number } {
  const ps = [apply(m, pt(x, y)), apply(m, pt(x + w, y)), apply(m, pt(x, y + h)), apply(m, pt(x + w, y + h))];
  const xs = ps.map((p) => p.x);
  const ys = ps.map((p) => p.y);
  const x0 = Math.min(...xs);
  const y0 = Math.min(...ys);
  return { x: x0, y: y0, w: Math.max(...xs) - x0, h: Math.max(...ys) - y0 };
}

/** Angle of a vector from straight down, in degrees (positive = towards +x). */
export const angleFromDown = (v: Pt): number => (Math.atan2(v.x, v.y) * 180) / Math.PI;

export const clamp = (v: number, lo: number, hi: number): number => Math.max(lo, Math.min(hi, v));

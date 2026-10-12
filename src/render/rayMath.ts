import { dot } from './linalg';
import type { Vec3 } from './linalg';

/** Slab test against the axis-aligned box [-half[k], half[k]]^3; entry clamped at 0. */
export function rayBox(ro: Vec3, rd: Vec3, half: Vec3): [number, number] | null {
  let t0 = -Infinity;
  let t1 = Infinity;
  for (let i = 0; i < 3; i++) {
    if (Math.abs(rd[i]) < 1e-9) {
      if (ro[i] < -half[i] || ro[i] > half[i]) return null;
      continue;
    }
    let a = (-half[i] - ro[i]) / rd[i];
    let b = (half[i] - ro[i]) / rd[i];
    if (a > b) [a, b] = [b, a];
    t0 = Math.max(t0, a);
    t1 = Math.min(t1, b);
  }
  return t1 > Math.max(t0, 0) ? [Math.max(t0, 0), t1] : null;
}

/**
 * Intersect the march interval with { p : dot(p, n) >= d } when keepPositive,
 * else { p : dot(p, n) <= d }. Plane normal must be unit length.
 */
export function clipRayToHalfSpace(
  ro: Vec3,
  rd: Vec3,
  n: Vec3,
  d: number,
  keepPositive: boolean,
  iv: [number, number],
): [number, number] | null {
  let [t0, t1] = iv;
  const dn = dot(rd, n);
  if (Math.abs(dn) < 1e-9) {
    return (dot(ro, n) - d >= 0) === keepPositive ? [t0, t1] : null;
  }
  const tc = (d - dot(ro, n)) / dn;
  if (dn > 0 === keepPositive) t0 = Math.max(t0, tc);
  else t1 = Math.min(t1, tc);
  return t1 > t0 ? [t0, t1] : null;
}

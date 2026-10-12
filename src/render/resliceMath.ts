import { dot, cross, normalize, sub } from './linalg';
import type { Vec3 } from './linalg';

/** Orthonormal in-plane axes for sampling the reslice image. */
export function resliceBasis(n: Vec3): { u: Vec3; v: Vec3 } {
  const z: Vec3 = [0, 0, 1];
  if (Math.abs(dot(n, z)) > 0.999) return { u: [1, 0, 0], v: [0, 1, 0] };
  const u = normalize(cross(z, n));
  const v = normalize(cross(n, u));
  return { u, v };
}

/** Slice-plane normal from azimuth/elevation in radians. */
export function normalFromAngles(azimuth: number, elevation: number): Vec3 {
  const ce = Math.cos(elevation);
  return [ce * Math.sin(azimuth), ce * Math.cos(azimuth), Math.sin(elevation)];
}

/**
 * World-space half extents of the volume box: x/y keep the video aspect with
 * the larger side at 0.5; the time axis scales with the spacing control.
 */
export function volumeHalfExtents(dims: [number, number, number], spacing: number): Vec3 {
  const m = Math.max(dims[0], dims[1]);
  return [(dims[0] / m) * 0.5, (dims[1] / m) * 0.5, 0.5 * spacing];
}

/**
 * Cross-section of the box prod(half) by the plane dot(p, n) = d,
 * vertices ordered by angle around the section centroid.
 */
export function planeCubePolygon(n: Vec3, d: number, half: Vec3): Vec3[] {
  const corners: Vec3[] = [];
  for (const x of [-half[0], half[0]])
    for (const y of [-half[1], half[1]])
      for (const z of [-half[2], half[2]]) corners.push([x, y, z]);
  const pts: Vec3[] = [];
  for (let i = 0; i < 8; i++) {
    for (let j = i + 1; j < 8; j++) {
      let axisDiff = 0;
      for (let k = 0; k < 3; k++) if (corners[i][k] !== corners[j][k]) axisDiff++;
      if (axisDiff !== 1) continue; // cube edges only
      const f1 = dot(corners[i], n) - d;
      const f2 = dot(corners[j], n) - d;
      if (f1 < 0 === f2 < 0) continue;
      const t = f1 / (f1 - f2);
      pts.push([
        corners[i][0] + t * (corners[j][0] - corners[i][0]),
        corners[i][1] + t * (corners[j][1] - corners[i][1]),
        corners[i][2] + t * (corners[j][2] - corners[i][2]),
      ]);
    }
  }
  if (pts.length < 3) return [];
  const c: Vec3 = [0, 0, 0];
  for (const p of pts) {
    c[0] += p[0];
    c[1] += p[1];
    c[2] += p[2];
  }
  const { u, v } = resliceBasis(n);
  const angle = (p: Vec3) => {
    const r = sub(p, [c[0] / pts.length, c[1] / pts.length, c[2] / pts.length]);
    return Math.atan2(dot(r, v), dot(r, u));
  };
  return pts.sort((a, b) => angle(a) - angle(b));
}

import { describe, it, expect } from 'vitest';
import {
  resliceBasis,
  normalFromAngles,
  planeCubePolygon,
  volumeHalfExtents,
} from '../src/render/resliceMath';
import { dot } from '../src/render/linalg';

describe('resliceBasis', () => {
  it('orthonormal for arbitrary normal', () => {
    const { u, v } = resliceBasis([0.3, -0.5, 0.8]);
    expect(dot(u, v)).toBeCloseTo(0);
    expect(Math.hypot(...u)).toBeCloseTo(1);
    expect(Math.hypot(...v)).toBeCloseTo(1);
    expect(dot(u, [0.3, -0.5, 0.8])).toBeCloseTo(0);
    expect(dot(v, [0.3, -0.5, 0.8])).toBeCloseTo(0);
  });

  it('falls back for time-aligned normal', () => {
    const { u, v } = resliceBasis([0, 0, 1]);
    expect(u).toEqual([1, 0, 0]);
    expect(v).toEqual([0, 1, 0]);
  });
});

describe('normalFromAngles', () => {
  it('unit length and matches spherical definition', () => {
    const n = normalFromAngles(Math.PI / 2, 0);
    expect(n[0]).toBeCloseTo(1);
    expect(n[2]).toBeCloseTo(0);
    const m = normalFromAngles(0.7, -0.3);
    expect(Math.hypot(...m)).toBeCloseTo(1);
  });
});

describe('planeCubePolygon', () => {
  const H: [number, number, number] = [0.5, 0.5, 0.5];
  it('center plane through x gives 4-gon', () => {
    const poly = planeCubePolygon([1, 0, 0], 0, H);
    expect(poly).toHaveLength(4);
  });

  it('vertices lie on plane and inside box', () => {
    const n = normalFromAngles(0.9, 0.4);
    const poly = planeCubePolygon(n, 0.2, H);
    expect(poly.length).toBeGreaterThanOrEqual(3);
    for (const p of poly) {
      expect(dot(p, n)).toBeCloseTo(0.2);
      for (let k = 0; k < 3; k++) expect(Math.abs(p[k])).toBeLessThanOrEqual(H[k] + 1e-9);
    }
  });

  it('respects per-axis extents', () => {
    // thin time axis: offset 0.45 along z is outside a 0.3-deep box
    const poly = planeCubePolygon([0, 0, 1], 0.45, [0.5, 0.5, 0.3]);
    expect(poly).toEqual([]);
    expect(planeCubePolygon([0, 0, 1], 0.25, [0.5, 0.5, 0.3])).toHaveLength(4);
  });

  it('empty when plane misses box', () => {
    expect(planeCubePolygon([1, 0, 0], 2, H)).toEqual([]);
  });
});

describe('volumeHalfExtents', () => {
  it('preserves video aspect on x/y', () => {
    expect(volumeHalfExtents([1920, 1080, 96], 1)).toEqual([0.5, 0.28125, 0.5]);
  });

  it('scales time axis with spacing', () => {
    const h = volumeHalfExtents([1920, 1080, 96], 2.5);
    expect(h[2]).toBeCloseTo(1.25);
    expect(h[0]).toBeCloseTo(0.5);
  });

  it('square input stays cubic at spacing 1', () => {
    expect(volumeHalfExtents([64, 64, 64], 1)).toEqual([0.5, 0.5, 0.5]);
  });
});

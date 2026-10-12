import { describe, it, expect } from 'vitest';
import { rayBox, clipRayToHalfSpace } from '../src/render/rayMath';
import { normalize } from '../src/render/linalg';
import type { Vec3 } from '../src/render/linalg';

const H: Vec3 = [0.5, 0.5, 0.5];

describe('rayBox', () => {
  it('hits centered cube from outside', () => {
    const iv = rayBox([2, 0, 0], [-1, 0, 0], H);
    expect(iv).toEqual([1.5, 2.5]);
  });

  it('misses when parallel and off-axis', () => {
    expect(rayBox([2, 2, 0], [-1, 0, 0], H)).toBeNull();
  });

  it('starts at 0 when origin inside', () => {
    const iv = rayBox([0, 0, 0], [1, 0, 0], H);
    expect(iv).toEqual([0, 0.5]);
  });

  it('honors per-axis extents', () => {
    const iv = rayBox([2, 0, 0], [-1, 0, 0], [1, 0.25, 0.1]);
    expect(iv).toEqual([1, 3]);
  });
});

describe('clipRayToHalfSpace', () => {
  const iv: [number, number] = [0, 10];

  it('keeps positive side: ray below enters at plane', () => {
    // keep x>=2; ray from x=1 going +x reaches the kept side at t=1
    const out = clipRayToHalfSpace([1, 0, 0], [1, 0, 0], [1, 0, 0], 2, true, iv);
    expect(out).toEqual([1, 10]);
  });

  it('keeps positive side: ray above exits at plane', () => {
    const out = clipRayToHalfSpace([4, 0, 0], [-1, 0, 0], [1, 0, 0], 2, true, iv);
    expect(out).toEqual([0, 2]);
  });

  it('keeps negative side: ray above enters at plane', () => {
    const out = clipRayToHalfSpace([4, 0, 0], [-1, 0, 0], [1, 0, 0], 2, false, iv);
    expect(out).toEqual([2, 10]);
  });

  it('keeps negative side: null when ray fully in positive side', () => {
    const out = clipRayToHalfSpace([4, 0, 0], [1, 0, 0], [1, 0, 0], 2, false, iv);
    expect(out).toBeNull();
  });

  it('parallel ray: kept or discarded by side', () => {
    // origin x=0 is on the kept (negative) side
    expect(clipRayToHalfSpace([0, 0, 0], [0, 1, 0], [1, 0, 0], 2, false, iv)).toEqual([0, 10]);
    expect(clipRayToHalfSpace([0, 0, 0], [0, 1, 0], [1, 0, 0], 2, true, iv)).toBeNull();
  });
});

describe('normalize', () => {
  it('unit length', () => {
    const n: Vec3 = normalize([3, 0, 4]);
    expect(n[0]).toBeCloseTo(0.6);
    expect(n[2]).toBeCloseTo(0.8);
  });
});

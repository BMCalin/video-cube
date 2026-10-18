import { describe, it, expect } from 'vitest';
import {
  DEFAULT_ANIMATION,
  ease,
  fitCenter,
  fitPivotTime,
  offsetAboutPivot,
  pivotPoint,
  pivotSegment2D,
  pivotSegment3D,
  frameProgress,
  keyframeFromPlane,
  planeFromKeyframe,
  sliceAt,
  sliceTimeRange,
  sourceFrameRange,
  tiltDegrees,
  wrapDegrees,
} from '../src/export/timeSlice';
import type { SliceAnimation } from '../src/export/timeSlice';
import { volumeHalfExtents } from '../src/render/resliceMath';

const half = volumeHalfExtents([1920, 1080, 120], 1.3);

describe('ease', () => {
  it('maps endpoints to 0 and 1 for every curve', () => {
    for (const k of ['linear', 'easeIn', 'easeOut', 'easeInOut'] as const) {
      expect(ease(k, 0)).toBeCloseTo(0);
      expect(ease(k, 1)).toBeCloseTo(1);
    }
    expect(ease('easeInOut', 0.5)).toBeCloseTo(0.5);
  });
});

describe('fitCenter', () => {
  it('keeps the slice inside the clip', () => {
    for (const span of [0, 0.1, -0.3, 0.8]) {
      for (const t of [0, 0.25, 1]) {
        const c = fitCenter(t, span);
        expect(c - Math.abs(span) / 2).toBeGreaterThanOrEqual(-1e-12);
        expect(c + Math.abs(span) / 2).toBeLessThanOrEqual(1 + 1e-12);
      }
    }
  });

  it('is the identity for an ordinary frame', () => {
    expect(fitCenter(0.37, 0)).toBeCloseTo(0.37);
  });
});

describe('sliceAt', () => {
  const anim: SliceAnimation = {
    start: { time: 0, span: 0, azimuth: 0 },
    end: { time: 1, span: 0.2, azimuth: 40 },
    easing: 'linear',
    fit: false,
    pivot: 0.5,
  };

  it('hits the keyframes at both ends', () => {
    expect(sliceAt(anim, 0)).toEqual({ time: 0, span: 0, azimuth: 0 });
    expect(sliceAt(anim, 1)).toEqual({ time: 1, span: 0.2, azimuth: 40 });
  });

  it('moves time linearly even when the shape is eased', () => {
    const s = sliceAt({ ...anim, easing: 'easeIn' }, 0.5);
    expect(s.time).toBeCloseTo(0.5);
    expect(s.span).toBeLessThan(0.1);
  });

  it('default animation replays the source clip', () => {
    expect(sliceAt(DEFAULT_ANIMATION, 0.25)).toEqual({ time: 0.25, span: 0, azimuth: 0 });
  });
});

describe('sourceFrameRange', () => {
  it('covers every frame of a plain replay', () => {
    expect(sourceFrameRange(DEFAULT_ANIMATION, [0, 99], 100, 50)).toEqual([0, 49]);
  });

  it('only needs the neighbourhood of a single still', () => {
    const [a, b] = sourceFrameRange(DEFAULT_ANIMATION, [50], 101, 1000);
    expect(b - a).toBeLessThanOrEqual(2);
    expect(a).toBeGreaterThanOrEqual(497);
  });

  it('widens with the span', () => {
    const anim: SliceAnimation = { ...DEFAULT_ANIMATION, start: { time: 0.5, span: 0.2, azimuth: 0 }, end: { time: 0.5, span: 0.2, azimuth: 0 } };
    const [a, b] = sourceFrameRange(anim, [0], 1, 100);
    const [lo, hi] = sliceTimeRange(sliceAt(anim, 0));
    expect(a).toBe(Math.floor(lo * 100 - 0.5));
    expect(b).toBe(Math.ceil(hi * 100 - 0.5));
  });
});

describe('plane <-> keyframe', () => {
  it('round-trips a tilted viewer plane', () => {
    const plane = { azimuth: 30, elevation: 80, offset: 0.1 };
    const kf = keyframeFromPlane(plane, half)!;
    const back = planeFromKeyframe(kf, half);
    expect(back.azimuth).toBeCloseTo(30);
    expect(back.elevation).toBeCloseTo(80);
    expect(back.offset).toBeCloseTo(0.1);
  });

  it('a frame-aligned plane is an ordinary frame at the right time', () => {
    // offset 0 is the middle of the stack
    const kf = keyframeFromPlane({ azimuth: 0, elevation: 90, offset: 0 }, half)!;
    expect(kf.span).toBeCloseTo(0);
    expect(kf.time).toBeCloseTo(0.5);
  });

  it('negative elevation flips the span sign but describes the same slice', () => {
    const a = keyframeFromPlane({ azimuth: 10, elevation: 70, offset: 0.05 }, half)!;
    const b = keyframeFromPlane({ azimuth: -170, elevation: -70, offset: -0.05 }, half)!;
    expect(b.time).toBeCloseTo(a.time);
    expect(b.span).toBeCloseTo(-a.span);
    // -span at azimuth+180 is the same gradient
    const pa = planeFromKeyframe(a, half);
    const pb = planeFromKeyframe(b, half);
    expect(pb.elevation).toBeCloseTo(pa.elevation);
    expect(wrapDegrees(pb.azimuth - pa.azimuth)).toBeCloseTo(0);
  });

  it('rejects planes along the time axis', () => {
    expect(keyframeFromPlane({ azimuth: 0, elevation: 0, offset: 0 }, half)).toBeNull();
  });

  it('reports tilt in degrees', () => {
    const kf = keyframeFromPlane({ azimuth: 0, elevation: 85, offset: 0 }, half)!;
    expect(tiltDegrees(kf, half)).toBeCloseTo(5);
  });
});

describe('helpers', () => {
  it('wraps degrees', () => {
    expect(wrapDegrees(190)).toBeCloseTo(-170);
    expect(wrapDegrees(-190)).toBeCloseTo(170);
    expect(wrapDegrees(180)).toBe(180);
  });

  it('spreads progress across frames', () => {
    expect(frameProgress(0, 1)).toBe(0);
    expect(frameProgress(4, 5)).toBe(1);
    expect(frameProgress(2, 5)).toBeCloseTo(0.5);
  });
});

describe('tilt pivot', () => {
  const tilted = (pivot: number, fit = false): SliceAnimation => ({
    start: { time: 0.5, span: 0.4, azimuth: 0 },
    end: { time: 0.5, span: 0.4, azimuth: 0 },
    easing: 'linear',
    fit,
    pivot,
  });

  it('centre pivot keeps the time at the frame centre', () => {
    expect(sliceAt(tilted(0.5), 0).time).toBeCloseTo(0.5);
  });

  it('bottom pivot keeps the pivot time on the bottom edge', () => {
    // azimuth 0: the past is at the top, so the centre is half a span earlier
    const s = sliceAt(tilted(1), 0);
    expect(s.time).toBeCloseTo(0.3);
    const [lo, hi] = sliceTimeRange(s);
    expect(hi).toBeCloseTo(0.5); // bottom edge shows the pivot moment
    expect(lo).toBeCloseTo(0.1);
  });

  it('top pivot mirrors the bottom pivot', () => {
    expect(sliceAt(tilted(0), 0).time).toBeCloseTo(0.7);
  });

  it('fit keeps the slice inside the clip for any pivot', () => {
    for (const pivot of [0, 0.25, 0.5, 1]) {
      for (const t of [0, 0.5, 1]) {
        const pt = fitPivotTime(t, 0.4, pivot);
        const centre = pt + 0.4 * (0.5 - pivot);
        expect(centre - 0.2).toBeGreaterThanOrEqual(-1e-12);
        expect(centre + 0.2).toBeLessThanOrEqual(1 + 1e-12);
      }
    }
    expect(fitPivotTime(0.3, 0.2, 0.5)).toBeCloseTo(fitCenter(0.3, 0.2));
  });

  it('captures plane keyframes at the pivot', () => {
    const plane = { azimuth: 0, elevation: 80, offset: 0.1 };
    const mid = keyframeFromPlane(plane, half, 0.5)!;
    const bottom = keyframeFromPlane(plane, half, 1)!;
    expect(bottom.span).toBeCloseTo(mid.span);
    expect(bottom.time).toBeCloseTo(mid.time + mid.span / 2);
  });

  it('tilting keeps the pivot line on the plane', () => {
    const prev = { azimuth: 20, elevation: 85, offset: 0.12 };
    for (const pivot of [0, 0.5, 1]) {
      const offset = offsetAboutPivot(prev, { azimuth: 20, elevation: 70 }, half, pivot);
      const before = pivotPoint(prev, half, pivot)!;
      const after = pivotPoint({ azimuth: 20, elevation: 70, offset }, half, pivot)!;
      for (let k = 0; k < 3; k++) expect(after[k]).toBeCloseTo(before[k]);
    }
  });

  it('centre pivot keeps the centre time while tilting', () => {
    const prev = { azimuth: 0, elevation: 90, offset: 0.2 };
    const offset = offsetAboutPivot(prev, { azimuth: 0, elevation: 75 }, half, 0.5);
    const a = keyframeFromPlane(prev, half)!;
    const b = keyframeFromPlane({ azimuth: 0, elevation: 75, offset }, half)!;
    expect(b.time).toBeCloseTo(a.time);
  });
});

describe('pivot line', () => {
  it('runs along the bottom edge at 100% and azimuth 0', () => {
    const seg = pivotSegment2D(0, 1, 0.5, 0.3)!;
    expect(seg[0][1]).toBeCloseTo(-0.3);
    expect(seg[1][1]).toBeCloseTo(-0.3);
    expect(Math.abs(seg[1][0] - seg[0][0])).toBeCloseTo(1);
  });

  it('is vertical through the centre at azimuth 90 and 50%', () => {
    const seg = pivotSegment2D(90, 0.5, 0.5, 0.3)!;
    expect(seg[0][0]).toBeCloseTo(0);
    expect(Math.abs(seg[1][1] - seg[0][1])).toBeCloseTo(0.6);
  });

  it('shrinks to a corner point at 100% for a diagonal direction', () => {
    const seg = pivotSegment2D(30, 1, 0.5, 0.3)!;
    expect(seg[0][0]).toBeCloseTo(seg[1][0]);
    expect(seg[0][1]).toBeCloseTo(seg[1][1]);
  });

  it('sits on the 3D plane at a single moment', () => {
    const plane = { azimuth: 15, elevation: 70, offset: 0.05 };
    const seg = pivotSegment3D(plane, half, 0.8)!;
    const n = [Math.cos(70 * Math.PI / 180) * Math.sin(15 * Math.PI / 180), Math.cos(70 * Math.PI / 180) * Math.cos(15 * Math.PI / 180), Math.sin(70 * Math.PI / 180)];
    for (const p of seg) expect(n[0] * p[0] + n[1] * p[1] + n[2] * p[2]).toBeCloseTo(0.05);
    expect(seg[0][2]).toBeCloseTo(seg[1][2]);
  });
});

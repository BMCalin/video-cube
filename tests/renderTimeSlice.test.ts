import { describe, it, expect } from 'vitest';
import { renderTimeSlice, volumeStack } from '../src/export/renderTimeSlice';
import type { FrameStack } from '../src/export/renderTimeSlice';

/** RGB stack where every pixel of frame k has red = k * step. */
function rampStack(w: number, h: number, n: number, step = 10): FrameStack {
  const frames = Array.from({ length: n }, (_, k) => new Uint8Array(w * h * 3).map((_, i) => (i % 3 === 0 ? k * step : 0)));
  return { width: w, height: h, count: n, channels: 3, first: 0, last: n - 1, frame: (k) => frames[k] };
}

const red = (out: Uint8ClampedArray, w: number, x: number, y: number) => out[(y * w + x) * 4];

describe('renderTimeSlice', () => {
  const W = 8;
  const H = 6;
  const N = 10;
  const stack = rampStack(W, H, N);

  it('zero span reproduces one source frame', () => {
    const out = new Uint8ClampedArray(W * H * 4);
    // frame 3 is centred at (3 + 0.5) / 10
    renderTimeSlice(stack, { time: 0.35, span: 0, azimuth: 0 }, { edge: 'hold', blend: true }, out);
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) expect(red(out, W, x, y)).toBe(30);
    expect(out[3]).toBe(255);
  });

  it('azimuth 0 puts the past at the top and the future at the bottom', () => {
    const out = new Uint8ClampedArray(W * H * 4);
    renderTimeSlice(stack, { time: 0.5, span: 0.5, azimuth: 0 }, { edge: 'hold', blend: false }, out);
    expect(red(out, W, 0, 0)).toBeLessThan(red(out, W, 0, H - 1));
    // rows are uniform, columns vary only with y
    for (let x = 1; x < W; x++) expect(red(out, W, x, 2)).toBe(red(out, W, 0, 2));
  });

  it('the earliest and latest moments in a frame are |span| apart', () => {
    const big = rampStack(4, 101, 101, 1);
    const out = new Uint8ClampedArray(4 * 101 * 4);
    renderTimeSlice(big, { time: 0.5, span: 0.5, azimuth: 0 }, { edge: 'hold', blend: false }, out);
    const top = red(out, 4, 0, 0);
    const bottom = red(out, 4, 0, 100);
    expect(Math.abs(top - bottom)).toBeGreaterThanOrEqual(49);
    expect(Math.abs(top - bottom)).toBeLessThanOrEqual(51);
  });

  it('azimuth 90 turns the gradient horizontal', () => {
    const out = new Uint8ClampedArray(W * H * 4);
    renderTimeSlice(stack, { time: 0.5, span: 0.5, azimuth: 90 }, { edge: 'hold', blend: false }, out);
    expect(red(out, W, 0, 0)).not.toBe(red(out, W, W - 1, 0));
    expect(red(out, W, 3, 0)).toBe(red(out, W, 3, H - 1));
  });

  it('blends between neighbouring frames', () => {
    const out = new Uint8ClampedArray(W * H * 4);
    // halfway between frame 3 (0.35) and frame 4 (0.45)
    renderTimeSlice(stack, { time: 0.4, span: 0, azimuth: 0 }, { edge: 'hold', blend: true }, out);
    expect(red(out, W, 0, 0)).toBe(35);
  });

  it('edge mode black blanks pixels outside the clip, hold repeats the edge frame', () => {
    const out = new Uint8ClampedArray(W * H * 4);
    renderTimeSlice(stack, { time: 1.2, span: 0, azimuth: 0 }, { edge: 'black', blend: true }, out);
    expect(red(out, W, 0, 0)).toBe(0);
    renderTimeSlice(stack, { time: 1.2, span: 0, azimuth: 0 }, { edge: 'hold', blend: true }, out);
    expect(red(out, W, 0, 0)).toBe(90);
  });

  it('never reads outside the resident range', () => {
    const frames = new Map<number, Uint8Array>();
    for (let k = 4; k <= 6; k++) frames.set(k, new Uint8Array(W * H * 3).fill(k));
    const partial: FrameStack = {
      width: W, height: H, count: N, channels: 3, first: 4, last: 6,
      frame: (k) => {
        const f = frames.get(k);
        if (!f) throw new Error(`frame ${k} is not resident`);
        return f;
      },
    };
    const out = new Uint8ClampedArray(W * H * 4);
    renderTimeSlice(partial, { time: 0.5, span: 0.9, azimuth: 30 }, { edge: 'hold', blend: true }, out);
    expect(out[0]).toBeGreaterThanOrEqual(4);
  });

  it('reads packed RGBA volumes from the viewer', () => {
    const w = 2;
    const h = 2;
    const d = 3;
    const data = new Uint8Array(w * h * d * 4);
    for (let k = 0; k < d; k++) data.fill(k * 50, k * w * h * 4, (k + 1) * w * h * 4);
    const out = new Uint8ClampedArray(w * h * 4);
    renderTimeSlice(volumeStack(data, [w, h, d]), { time: 0.5, span: 0, azimuth: 0 }, { edge: 'hold', blend: false }, out);
    expect(out[0]).toBe(50);
  });
});

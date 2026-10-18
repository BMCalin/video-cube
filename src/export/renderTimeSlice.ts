/**
 * CPU renderer for one time-sliced output frame.
 *
 * Runs on plain typed arrays so the same code drives both the live preview
 * (low-resolution viewer volume) and the full-resolution export, and so it
 * can be unit-tested without a browser.
 */
import { gradientExtent } from './timeSlice';
import type { SliceParams } from './timeSlice';

/**
 * A stack of equally spaced frames covering the whole clip. Frame k is
 * centred at clip time (k + 0.5) / count. Only frames `first..last` need to
 * be resident; `frame(k)` is only called inside that range.
 */
export interface FrameStack {
  width: number;
  height: number;
  /** Total number of frames in the clip at the stack's sampling rate. */
  count: number;
  /** Bytes per pixel in each frame buffer: 3 (RGB) or 4 (RGBA). */
  channels: 3 | 4;
  /** First resident frame index (inclusive). */
  first: number;
  /** Last resident frame index (inclusive). */
  last: number;
  frame(k: number): ArrayLike<number>;
}

/** What to draw where the slice reaches before the first or after the last frame. */
export type EdgeMode = 'hold' | 'black';

export interface RenderOptions {
  edge: EdgeMode;
  /** Linear blend between neighbouring frames (smooth gradient) instead of nearest frame. */
  blend: boolean;
}

/** Wrap a packed depth-major RGBA volume (as used by the 3D viewer) as a FrameStack. */
export function volumeStack(data: Uint8Array, dims: [number, number, number]): FrameStack {
  const [w, h, d] = dims;
  const size = w * h * 4;
  return {
    width: w,
    height: h,
    count: d,
    channels: 4,
    first: 0,
    last: d - 1,
    frame: (k) => data.subarray(k * size, (k + 1) * size),
  };
}

/**
 * Render one output frame into `out` (RGBA, stack.width x stack.height).
 * The output has the same pixel grid as the stack frames.
 */
export function renderTimeSlice(
  stack: FrameStack,
  slice: SliceParams,
  opts: RenderOptions,
  out: Uint8ClampedArray | Uint8Array,
): void {
  const { width: W, height: H, count: N, channels: C, first, last } = stack;
  const m = Math.max(W, H);
  const ax = W / m;
  const ay = H / m;
  const az = (slice.azimuth * Math.PI) / 180;
  const sa = Math.sin(az);
  const ca = Math.cos(az);
  const g = slice.span / gradientExtent(slice.azimuth, ax, ay);

  // tau is linear in pixel coordinates: tau = tau00 + x * dx + y * dy, with
  // X = ((x + 0.5) / W - 0.5) * ax and Y = (0.5 - (y + 0.5) / H) * ay.
  // Work directly in fractional frame index f = tau * N - 0.5.
  const dx = -g * sa * (ax / W) * N;
  const dy = g * ca * (ay / H) * N;
  const f00 =
    (slice.time - g * (sa * (0.5 / W - 0.5) * ax + ca * (0.5 - 0.5 / H) * ay)) * N - 0.5;

  // Resolve frame buffers once; the inner loop indexes this table.
  const frames: ArrayLike<number>[] = [];
  for (let k = first; k <= last; k++) frames[k] = stack.frame(k);

  const hold = opts.edge === 'hold';
  const blend = opts.blend;
  let o = 0;
  for (let y = 0; y < H; y++) {
    let f = f00 + y * dy;
    const rowBase = y * W;
    for (let x = 0; x < W; x++, f += dx, o += 4) {
      // Outside the clip: |tau| beyond [0, 1] means f beyond [-0.5, N - 0.5].
      if (!hold && (f < -0.5 || f > N - 0.5)) {
        out[o] = 0;
        out[o + 1] = 0;
        out[o + 2] = 0;
        out[o + 3] = 255;
        continue;
      }
      const fc = f < first ? first : f > last ? last : f;
      const p = (rowBase + x) * C;
      if (blend) {
        const i0 = fc | 0; // fc >= 0 here, so truncation is floor
        const i1 = i0 < last ? i0 + 1 : last;
        const t = fc - i0;
        const a = frames[i0];
        const b = frames[i1];
        out[o] = a[p] + (b[p] - a[p]) * t;
        out[o + 1] = a[p + 1] + (b[p + 1] - a[p + 1]) * t;
        out[o + 2] = a[p + 2] + (b[p + 2] - a[p + 2]) * t;
      } else {
        const a = frames[(fc + 0.5) | 0];
        out[o] = a[p];
        out[o + 1] = a[p + 1];
        out[o + 2] = a[p + 2];
      }
      out[o + 3] = 255;
    }
  }
}

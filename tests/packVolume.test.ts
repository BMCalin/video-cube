import { describe, it, expect } from 'vitest';
import { packVolume } from '../src/ingest/packVolume';

describe('packVolume', () => {
  it('preserves RGBA bytes and orders frames depth-major', () => {
    // 1x1x2: frame 0 red, frame 1 green
    const f0 = new Uint8ClampedArray([255, 0, 0, 128]);
    const f1 = new Uint8ClampedArray([0, 255, 0, 200]);
    expect(packVolume([f0, f1], 1, 1)).toEqual(
      new Uint8Array([255, 0, 0, 128, 0, 255, 0, 200]),
    );
  });

  it('is row-major within a frame', () => {
    // 2x1x1: pixel 0 = RGBA(1,2,3,9), pixel 1 = RGBA(4,5,6,9)
    const f = new Uint8ClampedArray([1, 2, 3, 9, 4, 5, 6, 9]);
    expect(packVolume([f], 2, 1)).toEqual(new Uint8Array([1, 2, 3, 9, 4, 5, 6, 9]));
  });

  it('sizes output to w*h*d*4', () => {
    const f = new Uint8ClampedArray(4 * 3 * 4);
    expect(packVolume([f, f], 4, 3)).toHaveLength(4 * 3 * 2 * 4);
  });
});

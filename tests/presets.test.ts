import { describe, it, expect } from 'vitest';
import { RESOLUTION_PRESETS, estimateStackBytes, formatBytes, outputSize } from '../src/export/presets';

const preset = (id: string) => RESOLUTION_PRESETS.find((p) => p.id === id)!;

describe('outputSize', () => {
  it('scales landscape clips by their height', () => {
    expect(outputSize(3840, 2160, preset('1080p'))).toEqual({ width: 1920, height: 1080, upscale: false });
  });

  it('scales portrait clips by their width', () => {
    expect(outputSize(2160, 3840, preset('1080p'))).toEqual({ width: 1080, height: 1920, upscale: false });
  });

  it('always returns even dimensions', () => {
    const s = outputSize(1001, 777, preset('720p'));
    expect(s.width % 2).toBe(0);
    expect(s.height % 2).toBe(0);
  });

  it('flags presets larger than the source', () => {
    expect(outputSize(1280, 720, preset('1080p')).upscale).toBe(true);
    expect(outputSize(1280, 720, preset('source'))).toEqual({ width: 1280, height: 720, upscale: false });
  });
});

describe('memory estimate', () => {
  it('counts three bytes per pixel', () => {
    expect(estimateStackBytes(1920, 1080, 100)).toBe(1920 * 1080 * 3 * 100);
    expect(formatBytes(estimateStackBytes(1920, 1080, 1000))).toBe('5.8 GB');
  });
});

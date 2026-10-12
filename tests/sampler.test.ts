import { describe, it, expect } from 'vitest';
import { sampleTimestamps } from '../src/ingest/sampler';

describe('sampleTimestamps', () => {
  it('returns count timestamps', () => {
    expect(sampleTimestamps(10, 4)).toHaveLength(4);
  });

  it('uses bin midpoints', () => {
    expect(sampleTimestamps(10, 4)).toEqual([1.25, 3.75, 6.25, 8.75]);
  });

  it('is ascending and inside [0, duration]', () => {
    const ts = sampleTimestamps(7, 96);
    for (let i = 1; i < ts.length; i++) expect(ts[i]).toBeGreaterThan(ts[i - 1]);
    for (const t of ts) {
      expect(t).toBeGreaterThan(0);
      expect(t).toBeLessThan(7);
    }
  });

  it('returns empty for invalid input', () => {
    expect(sampleTimestamps(0, 10)).toEqual([]);
    expect(sampleTimestamps(-1, 10)).toEqual([]);
    expect(sampleTimestamps(10, 0)).toEqual([]);
  });
});

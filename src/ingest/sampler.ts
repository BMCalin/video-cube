/** Midpoint of each of `count` equal time bins across the duration. */
export function sampleTimestamps(duration: number, count: number): number[] {
  if (count < 1 || !(duration > 0)) return [];
  return Array.from({ length: count }, (_, i) => ((i + 0.5) * duration) / count);
}

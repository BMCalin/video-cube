/**
 * Export presets.
 *
 * To add a resolution, frame rate or quality level, append an entry to the
 * matching list below; the export panel picks it up automatically.
 */

export interface ResolutionPreset {
  id: string;
  label: string;
  /**
   * Target length of the frame's short side in pixels (1080 for 1080p, for
   * both landscape and portrait clips). `null` keeps the source resolution.
   */
  shortSide: number | null;
}

export const RESOLUTION_PRESETS: ResolutionPreset[] = [
  { id: 'source', label: 'Source resolution', shortSide: null },
  { id: '2160p', label: '2160p (4K UHD)', shortSide: 2160 },
  { id: '1440p', label: '1440p (QHD)', shortSide: 1440 },
  { id: '1080p', label: '1080p (Full HD)', shortSide: 1080 },
  { id: '720p', label: '720p (HD)', shortSide: 720 },
  { id: '480p', label: '480p (SD)', shortSide: 480 },
  { id: '360p', label: '360p', shortSide: 360 },
];

export const DEFAULT_RESOLUTION_ID = '1080p';

export interface FrameRatePreset {
  fps: number;
  label: string;
}

export const FRAME_RATE_PRESETS: FrameRatePreset[] = [
  { fps: 24, label: '24 fps (film)' },
  { fps: 25, label: '25 fps (PAL)' },
  { fps: 30, label: '30 fps' },
  { fps: 50, label: '50 fps' },
  { fps: 60, label: '60 fps' },
];

export const DEFAULT_FPS = 30;

export type QualityId = 'medium' | 'high' | 'veryHigh';

export interface QualityPreset {
  id: QualityId;
  label: string;
}

/** Bitrate scales with resolution and frame rate; see encoders.ts. */
export const QUALITY_PRESETS: QualityPreset[] = [
  { id: 'medium', label: 'Medium (smaller file)' },
  { id: 'high', label: 'High' },
  { id: 'veryHigh', label: 'Very high (archival)' },
];

export const DEFAULT_QUALITY: QualityId = 'high';

/** H.264 needs even dimensions. */
const even = (v: number): number => Math.max(2, 2 * Math.round(v / 2));

export interface OutputSize {
  width: number;
  height: number;
  /** True when the preset is larger than the source (the preset is then not offered). */
  upscale: boolean;
}

/** Output frame size for a preset, preserving the source aspect ratio. */
export function outputSize(srcW: number, srcH: number, preset: ResolutionPreset): OutputSize {
  if (preset.shortSide === null) return { width: even(srcW), height: even(srcH), upscale: false };
  const k = preset.shortSide / Math.min(srcW, srcH);
  return { width: even(srcW * k), height: even(srcH * k), upscale: k > 1.0001 };
}

/** Approximate RAM needed to hold `frames` decoded source frames (RGB, 3 bytes per pixel). */
export function estimateStackBytes(width: number, height: number, frames: number): number {
  return width * height * 3 * frames;
}

export function formatBytes(bytes: number): string {
  if (bytes >= 1024 ** 3) return `${(bytes / 1024 ** 3).toFixed(1)} GB`;
  if (bytes >= 1024 ** 2) return `${Math.round(bytes / 1024 ** 2)} MB`;
  return `${Math.max(1, Math.round(bytes / 1024))} KB`;
}

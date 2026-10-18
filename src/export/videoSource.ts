/**
 * Full-resolution frame access for export.
 *
 * The 3D viewer works on a small, downsampled volume. Export goes back to the
 * original file and decodes every frame it needs at the output resolution.
 *
 * Decoding uses WebCodecs through Mediabunny (fast, frame-accurate, reads MP4,
 * MOV, WebM, MKV and more). If the file cannot be demuxed that way, it falls
 * back to seeking an HTMLVideoElement, which is slower but accepts anything
 * the browser can play. Image sequences are decoded one still at a time.
 */
import { ALL_FORMATS, BlobSource, CanvasSink, Input } from 'mediabunny';
import type { InputVideoTrack } from 'mediabunny';
import { seek } from '@/ingest/ingestVideo';
import { imageSize, loadImage } from '@/ingest/ingestImages';
import { imageIndexAt } from '@/ingest/source';
import type { ClipSource } from '@/ingest/source';
import type { FrameStack } from './renderTimeSlice';

export interface SourceInfo {
  /** Display size of the video in pixels (rotation applied). */
  width: number;
  height: number;
  /** Clip length in seconds. */
  duration: number;
  /** Clip start in seconds (usually 0). */
  start: number;
  /** Average native frame rate, or null when it cannot be determined. */
  fps: number | null;
  /** Which decoding path will be used. */
  decoder: 'webcodecs' | 'element' | 'images';
  /** Number of stills, for image sequences. */
  imageCount?: number;
}

async function openTrack(file: File): Promise<{ input: Input; track: InputVideoTrack } | null> {
  const input = new Input({ source: new BlobSource(file), formats: ALL_FORMATS });
  try {
    const track = await input.getPrimaryVideoTrack();
    if (track && (await track.canDecode())) return { input, track };
  } catch {
    // Unsupported container: fall through to the element path.
  }
  input.dispose();
  return null;
}

function loadVideoElement(file: File): Promise<{ video: HTMLVideoElement; url: string }> {
  const url = URL.createObjectURL(file);
  const video = document.createElement('video');
  video.muted = true;
  video.preload = 'auto';
  video.src = url;
  return new Promise((resolve, reject) => {
    video.onloadedmetadata = () => resolve({ video, url });
    video.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('Could not decode this video file.'));
    };
  });
}

/** Read size, duration and frame rate of a clip. */
export async function probeSource(src: ClipSource): Promise<SourceInfo> {
  if (src.kind === 'video') return probeVideo(src.file);
  const { width, height } = await imageSize(src.files[0]);
  return {
    width,
    height,
    duration: src.files.length / src.fps,
    start: 0,
    fps: src.fps,
    decoder: 'images',
    imageCount: src.files.length,
  };
}

/** Read size, duration and frame rate of a video file. */
export async function probeVideo(file: File): Promise<SourceInfo> {
  const opened = await openTrack(file);
  if (opened) {
    const { input, track } = opened;
    try {
      const start = await track.getFirstTimestamp();
      const end = await track.computeDuration();
      const stats = await track.computePacketStats(240);
      const fps = stats.averagePacketRate > 0 ? stats.averagePacketRate : null;
      return {
        width: track.displayWidth,
        height: track.displayHeight,
        duration: Math.max(0, end - start),
        start,
        fps,
        decoder: 'webcodecs',
      };
    } finally {
      input.dispose();
    }
  }
  const { video, url } = await loadVideoElement(file);
  URL.revokeObjectURL(url);
  if (!video.videoWidth || !video.videoHeight || !(video.duration > 0)) {
    throw new Error('Could not decode this video file.');
  }
  return {
    width: video.videoWidth,
    height: video.videoHeight,
    duration: video.duration,
    start: 0,
    fps: null,
    decoder: 'element',
  };
}

export interface DecodeRequest {
  width: number;
  height: number;
  /** Frames in the whole clip at the chosen sampling rate. */
  count: number;
  /** Resident range to decode (inclusive). */
  first: number;
  last: number;
  signal?: AbortSignal;
  onProgress?: (done: number, total: number) => void;
}

export class ExportAbortedError extends Error {
  constructor() {
    super('Export cancelled.');
    this.name = 'ExportAbortedError';
  }
}

function checkAbort(signal?: AbortSignal): void {
  if (signal?.aborted) throw new ExportAbortedError();
}

/** RGBA canvas pixels to a compact RGB buffer (saves 25% memory per frame). */
function toRgb(rgba: Uint8ClampedArray): Uint8Array {
  const n = rgba.length / 4;
  const out = new Uint8Array(n * 3);
  for (let i = 0, j = 0; i < rgba.length; i += 4, j += 3) {
    out[j] = rgba[i];
    out[j + 1] = rgba[i + 1];
    out[j + 2] = rgba[i + 2];
  }
  return out;
}

/**
 * Decode frames `first..last` of a clip sampled into `count` equal time bins
 * (frame k is taken at the middle of bin k), scaled to width x height.
 */
export async function decodeFrameStack(
  src: ClipSource,
  info: SourceInfo,
  req: DecodeRequest,
): Promise<FrameStack> {
  const { width, height, count, first, last, signal, onProgress } = req;
  const total = last - first + 1;
  const stamps: number[] = [];
  for (let k = first; k <= last; k++) stamps.push(info.start + ((k + 0.5) * info.duration) / count);

  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) throw new Error('Canvas 2D is unavailable.');

  const frames: Uint8Array[] = [];
  const grab = () => frames.push(toRgb(ctx.getImageData(0, 0, width, height).data));
  const repeatLast = () => frames.push(frames.length ? frames[frames.length - 1] : new Uint8Array(width * height * 3));

  const opened = src.kind === 'video' && info.decoder === 'webcodecs' ? await openTrack(src.file) : null;
  if (src.kind === 'images') {
    let lastIndex = -1;
    for (const t of stamps) {
      checkAbort(signal);
      const index = imageIndexAt(t - info.start, src.files.length, src.fps);
      if (index === lastIndex) {
        repeatLast(); // sampling faster than the sequence: reuse the still
      } else {
        const bmp = await loadImage(src.files[index], width, height);
        ctx.drawImage(bmp, 0, 0, width, height);
        bmp.close();
        grab();
        lastIndex = index;
      }
      onProgress?.(frames.length, total);
    }
  } else if (opened) {
    const { input, track } = opened;
    try {
      const sink = new CanvasSink(track, { width, height, fit: 'fill', poolSize: 2 });
      for await (const wrapped of sink.canvasesAtTimestamps(stamps)) {
        checkAbort(signal);
        if (wrapped) {
          ctx.drawImage(wrapped.canvas, 0, 0, width, height);
          grab();
        } else {
          repeatLast();
        }
        onProgress?.(frames.length, total);
      }
    } finally {
      input.dispose();
    }
  } else {
    const { video, url } = await loadVideoElement(src.file);
    try {
      for (const t of stamps) {
        checkAbort(signal);
        await seek(video, t);
        ctx.drawImage(video, 0, 0, width, height);
        grab();
        onProgress?.(frames.length, total);
      }
    } finally {
      URL.revokeObjectURL(url);
    }
  }
  while (frames.length < total) repeatLast();

  return {
    width,
    height,
    count,
    channels: 3,
    first,
    last,
    frame: (k) => frames[k - first],
  };
}

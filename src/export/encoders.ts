/**
 * Output writers for rendered RGBA frames: MP4 (H.264 via WebCodecs and
 * Mediabunny), PNG sequences (written to a folder or bundled as a ZIP), and
 * single PNG stills.
 */
import {
  BufferTarget,
  Mp4OutputFormat,
  Output,
  QUALITY_HIGH,
  QUALITY_MEDIUM,
  QUALITY_VERY_HIGH,
  VideoSample,
  VideoSampleSource,
  getFirstEncodableVideoCodec,
} from 'mediabunny';
import type { Quality, VideoCodec } from 'mediabunny';
import { Zip, ZipPassThrough } from 'fflate';
import type { QualityId } from './presets';

export interface FrameSink {
  /** Human-readable description of what is being written, e.g. "H.264". */
  label?: string;
  /** Append frame `index` (RGBA, sink width x height). Resolves when ready for the next one. */
  add(rgba: Uint8ClampedArray<ArrayBuffer>, index: number): Promise<void>;
  /** Finish writing. Returns the file to download, or null if output was written in place. */
  finish(): Promise<Blob | null>;
  /** Abort and release resources. */
  cancel(): Promise<void>;
}

const QUALITY: Record<QualityId, Quality> = {
  medium: QUALITY_MEDIUM,
  high: QUALITY_HIGH,
  veryHigh: QUALITY_VERY_HIGH,
};

export interface Mp4Options {
  width: number;
  height: number;
  fps: number;
  quality: QualityId;
}

/** True when this browser has a WebCodecs video encoder at all. */
export function hasVideoEncoder(): boolean {
  return typeof VideoEncoder !== 'undefined';
}

/**
 * Codecs tried for MP4, in order. H.264 plays everywhere; VP9 and AV1 are
 * fallbacks for browsers without an H.264 encoder (e.g. open-source Chromium).
 */
const MP4_CODECS: VideoCodec[] = ['avc', 'vp9', 'av1'];

const CODEC_LABEL: Partial<Record<VideoCodec, string>> = { avc: 'H.264', vp9: 'VP9', av1: 'AV1' };

export async function createMp4Sink(opts: Mp4Options): Promise<FrameSink> {
  const { width, height, fps } = opts;
  const quality = QUALITY[opts.quality];
  if (!hasVideoEncoder()) {
    throw new Error(
      'This browser has no WebCodecs video encoder. Use a recent Chrome or Edge, or export a PNG sequence instead.',
    );
  }
  const codec = await getFirstEncodableVideoCodec(MP4_CODECS, { width, height, quality, frameRate: fps });
  if (!codec) {
    throw new Error(
      `This browser cannot encode video at ${width}x${height}. Try a lower resolution, or export a PNG sequence.`,
    );
  }
  const target = new BufferTarget();
  const output = new Output({ format: new Mp4OutputFormat({ fastStart: 'in-memory' }), target });
  const source = new VideoSampleSource({ codec, quality, keyFrameInterval: 2 });
  output.addVideoTrack(source, { frameRate: fps });
  await output.start();

  return {
    label: CODEC_LABEL[codec] ?? codec,
    async add(rgba, index) {
      const sample = new VideoSample(rgba, {
        format: 'RGBA',
        codedWidth: width,
        codedHeight: height,
        timestamp: index / fps,
        duration: 1 / fps,
      });
      try {
        await source.add(sample);
      } finally {
        sample.close();
      }
    },
    async finish() {
      await output.finalize();
      if (!target.buffer) throw new Error('The MP4 writer produced no data.');
      return new Blob([target.buffer], { type: 'video/mp4' });
    },
    async cancel() {
      await output.cancel();
    },
  };
}

/** Encode one RGBA frame as a PNG file. */
export async function encodePng(
  rgba: Uint8ClampedArray<ArrayBuffer>,
  width: number,
  height: number,
): Promise<Blob> {
  const canvas = new OffscreenCanvas(width, height);
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Canvas 2D is unavailable.');
  ctx.putImageData(new ImageData(rgba, width, height), 0, 0);
  return canvas.convertToBlob({ type: 'image/png' });
}

export function pngFrameName(prefix: string, index: number): string {
  return `${prefix}_${String(index).padStart(6, '0')}.png`;
}

type DirectoryPicker = (opts?: { mode?: 'read' | 'readwrite' }) => Promise<FileSystemDirectoryHandle>;

/** Whether frames can be written straight into a user-chosen folder (Chrome, Edge). */
export function canPickDirectory(): boolean {
  return typeof (window as unknown as { showDirectoryPicker?: DirectoryPicker }).showDirectoryPicker === 'function';
}

/** Ask the user for an output folder. Must be called from a click handler. */
export async function pickDirectory(): Promise<FileSystemDirectoryHandle> {
  const picker = (window as unknown as { showDirectoryPicker: DirectoryPicker }).showDirectoryPicker;
  return picker({ mode: 'readwrite' });
}

/** PNG sequence written file by file into a folder. Nothing is held in memory. */
export function createPngFolderSink(
  dir: FileSystemDirectoryHandle,
  prefix: string,
  width: number,
  height: number,
): FrameSink {
  return {
    async add(rgba, index) {
      const blob = await encodePng(rgba, width, height);
      const handle = await dir.getFileHandle(pngFrameName(prefix, index), { create: true });
      const writable = await handle.createWritable();
      await writable.write(blob);
      await writable.close();
    },
    async finish() {
      return null;
    },
    async cancel() {},
  };
}

/** PNG sequence bundled into an uncompressed ZIP (PNG data is already compressed). */
export function createPngZipSink(prefix: string, width: number, height: number): FrameSink {
  const chunks: Uint8Array<ArrayBuffer>[] = [];
  let failure: Error | null = null;
  let done: (() => void) | null = null;
  const finished = new Promise<void>((resolve) => {
    done = resolve;
  });
  const zip = new Zip((err, data, final) => {
    if (err) failure = err;
    else chunks.push(data as Uint8Array<ArrayBuffer>);
    if (final || err) done?.();
  });
  return {
    async add(rgba, index) {
      const png = new Uint8Array(await (await encodePng(rgba, width, height)).arrayBuffer());
      const entry = new ZipPassThrough(pngFrameName(prefix, index));
      zip.add(entry);
      entry.push(png, true);
      if (failure) throw failure;
    },
    async finish() {
      zip.end();
      await finished;
      if (failure) throw failure;
      return new Blob(chunks, { type: 'application/zip' });
    },
    async cancel() {
      zip.terminate();
    },
  };
}

/** Offer a Blob to the user as a download. */
export function saveBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  // Give the browser time to start the download before releasing the URL.
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}

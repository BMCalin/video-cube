/**
 * Image-sequence counterpart of ingestVideo: samples a sequence of stills
 * into the viewer's depth-major RGBA volume.
 */
import { MAX_FRAMES } from './ingestVideo';
import type { IngestResult } from './ingestVideo';
import { packVolume } from './packVolume';
import { sampleTimestamps } from './sampler';
import { imageIndexAt, sequenceDuration } from './source';
import type { ClipSource } from './source';

type ImageSource = Extract<ClipSource, { kind: 'images' }>;

/** Decode one still, optionally resized. EXIF orientation is applied. */
export async function loadImage(file: File, width?: number, height?: number): Promise<ImageBitmap> {
  try {
    return width && height
      ? await createImageBitmap(file, { resizeWidth: width, resizeHeight: height, resizeQuality: 'high' })
      : await createImageBitmap(file);
  } catch {
    throw new Error(`Could not decode "${file.name}". Use JPEG, PNG, WebP or AVIF images (convert RAW or TIFF first).`);
  }
}

/** Pixel size of the first image of a sequence. */
export async function imageSize(file: File): Promise<{ width: number; height: number }> {
  const bmp = await loadImage(file);
  const size = { width: bmp.width, height: bmp.height };
  bmp.close();
  return size;
}

export async function ingestImages(
  src: ImageSource,
  rate: number,
  maxDim = 512,
  onProgress?: (done: number, total: number) => void,
): Promise<IngestResult> {
  const { files, fps } = src;
  const size = await imageSize(files[0]);
  const k = Math.min(1, maxDim / Math.max(size.width, size.height));
  const width = Math.max(2, Math.round(size.width * k));
  const height = Math.max(2, Math.round(size.height * k));

  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) throw new Error('Canvas 2D unavailable.');

  // Same sampling rule as video: `rate` frames per second of clip time,
  // capped by the volume limit and by the number of images.
  const duration = sequenceDuration(src);
  const count = Math.max(1, Math.min(MAX_FRAMES, files.length, Math.round(duration * rate)));
  const stamps = sampleTimestamps(duration, count);
  const frames: Uint8ClampedArray[] = [];
  for (let i = 0; i < stamps.length; i++) {
    const bmp = await loadImage(files[imageIndexAt(stamps[i], files.length, fps)], width, height);
    ctx.drawImage(bmp, 0, 0, width, height);
    bmp.close();
    frames.push(ctx.getImageData(0, 0, width, height).data);
    onProgress?.(i + 1, stamps.length);
  }
  return { data: packVolume(frames, width, height), width, height, depth: frames.length };
}

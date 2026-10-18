import { sampleTimestamps } from './sampler';
import { packVolume } from './packVolume';

export interface IngestResult {
  data: Uint8Array;
  width: number;
  height: number;
  depth: number;
}

/**
 * 'seeked' alone can fire before the new frame is presented, so drawImage
 * paints nothing (black). Wait for the composited frame via rVFC when
 * available - but race it with a timeout, because rVFC never fires for a
 * paused video in some environments (headless Chrome among them).
 */
function waitForFrame(video: HTMLVideoElement): Promise<void> {
  return new Promise((resolve) => {
    let settled = false;
    const done = () => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve();
    };
    const timer = setTimeout(done, 250);
    if ('requestVideoFrameCallback' in video) {
      (video as HTMLVideoElement & {
        requestVideoFrameCallback: (cb: () => void) => void;
      }).requestVideoFrameCallback(done);
    } else {
      requestAnimationFrame(done);
    }
  });
}

/** Seek is unreliable at the exact last frame; clamp into the file. */
export async function seek(video: HTMLVideoElement, t: number): Promise<void> {
  await new Promise<void>((resolve) => {
    const target = Math.min(t, Math.max(0, video.duration - 0.05));
    const done = () => {
      video.removeEventListener('seeked', done);
      clearTimeout(timer);
      resolve();
    };
    const timer = setTimeout(done, 5000); // never hang on a stalled seek
    video.addEventListener('seeked', done);
    video.currentTime = target;
  });
  await waitForFrame(video);
}

/** Hard cap on sampled frames - volume texture memory + shader loop bound. */
export const MAX_FRAMES = 192;

export async function ingestVideo(
  file: File,
  rate: number,
  maxDim = 256,
  onProgress?: (done: number, total: number) => void,
): Promise<IngestResult> {
  const url = URL.createObjectURL(file);
  const video = document.createElement('video');
  video.muted = true;
  video.preload = 'auto';
  video.src = url;
  try {
    await new Promise<void>((resolve, reject) => {
      video.onloadedmetadata = () => resolve();
      video.onerror = () => reject(new Error('Could not decode this video file.'));
    });
    if (!video.videoWidth || !video.videoHeight) {
      throw new Error('Could not decode this video file.');
    }
    const k = Math.min(1, maxDim / Math.max(video.videoWidth, video.videoHeight));
    const width = Math.max(2, Math.round(video.videoWidth * k));
    const height = Math.max(2, Math.round(video.videoHeight * k));
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    if (!ctx) throw new Error('Canvas 2D unavailable.');
    // rate = frames per second of video time; cap keeps the volume bounded
    const count = Math.max(1, Math.min(MAX_FRAMES, Math.round(video.duration * rate)));
    const stamps = sampleTimestamps(video.duration, count);
    const frames: Uint8ClampedArray[] = [];
    let brightSum = 0;
    for (let i = 0; i < stamps.length; i++) {
      await seek(video, stamps[i]);
      ctx.drawImage(video, 0, 0, width, height);
      const px = ctx.getImageData(0, 0, width, height).data;
      frames.push(px);
      // mean luma over a sparse sample of pixels - diagnostic for black frames
      let luma = 0;
      const stride = Math.max(4, Math.floor(px.length / 4 / 256) * 4);
      let n = 0;
      for (let j = 0; j < px.length; j += stride * 4) {
        luma += 0.2126 * px[j] + 0.7152 * px[j + 1] + 0.0722 * px[j + 2];
        n++;
      }
      const mean = luma / n;
      brightSum += mean;
      if (import.meta.env.DEV) {
        console.info(`frame ${i} @ ${stamps[i].toFixed(2)}s: luma=${mean.toFixed(1)} readyState=${video.readyState}`);
      }
      onProgress?.(i + 1, stamps.length);
    }
    if (brightSum / stamps.length < 2) {
      throw new Error(
        'All sampled frames are black. This file may use a codec the browser cannot decode. Try an MP4 (H.264) or WebM.',
      );
    }
    return { data: packVolume(frames, width, height), width, height, depth: frames.length };
  } finally {
    URL.revokeObjectURL(url);
  }
}

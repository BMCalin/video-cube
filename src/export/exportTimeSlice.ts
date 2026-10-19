/**
 * Export pipeline: decode the source frames a time-slice animation needs at
 * full resolution, render every output frame, and stream it into a writer.
 */
import { renderTimeSlice, splitMatte } from './renderTimeSlice';
import type { RenderOptions } from './renderTimeSlice';
import { frameProgress, sliceAt, sourceFrameRange } from './timeSlice';
import type { SliceAnimation } from './timeSlice';
import { ExportAbortedError, decodeFrameStack } from './videoSource';
import type { SourceInfo } from './videoSource';
import type { ClipSource } from '@/ingest/source';
import { encodePng } from './encoders';
import type { FrameSink } from './encoders';

export interface ExportSettings {
  anim: SliceAnimation;
  /** Output frame size (also the decode size of the source frames). */
  width: number;
  height: number;
  /** Number of frames in the full output animation. */
  frameCount: number;
  /** Number of frames the clip is sampled into (duration x source frame rate). */
  sourceCount: number;
  render: RenderOptions;
}

export type ExportPhase = 'decode' | 'render' | 'finalize';

export interface ExportProgress {
  phase: ExportPhase;
  done: number;
  total: number;
}

export interface RunOptions {
  signal?: AbortSignal;
  onProgress?: (p: ExportProgress) => void;
}

/** Second writer that receives a black-and-white matte of the colour key. */
export interface MatteOutput {
  sink: FrameSink;
  /** Colour that keyed pixels get in the main (colour) output. */
  background: [number, number, number];
}

export interface AnimationResult {
  /** The finished colour file, or null if written in place. */
  blob: Blob | null;
  /** The finished matte file, when a matte was requested. */
  matte: Blob | null;
}

/**
 * Yield to the event loop so the page can repaint progress. Uses a
 * MessageChannel instead of setTimeout, which background tabs throttle.
 */
function yieldToUi(): Promise<void> {
  return new Promise((resolve) => {
    const ch = new MessageChannel();
    ch.port1.onmessage = () => resolve();
    ch.port2.postMessage(null);
  });
}

async function decodeFor(source: ClipSource, info: SourceInfo, s: ExportSettings, frames: number[], opts: RunOptions) {
  const [first, last] = sourceFrameRange(s.anim, frames, s.frameCount, s.sourceCount);
  return decodeFrameStack(source, info, {
    width: s.width,
    height: s.height,
    count: s.sourceCount,
    first,
    last,
    signal: opts.signal,
    onProgress: (done, total) => opts.onProgress?.({ phase: 'decode', done, total }),
  });
}

/**
 * Render the whole animation into `sink`. With `matte`, the key is rendered as
 * alpha and split into the colour frame (over the background colour) and a
 * black-and-white matte written to the second sink, frame for frame.
 */
export async function exportAnimation(
  source: ClipSource,
  info: SourceInfo,
  s: ExportSettings,
  sink: FrameSink,
  opts: RunOptions = {},
  matte: MatteOutput | null = null,
): Promise<AnimationResult> {
  try {
    const all = Array.from({ length: s.frameCount }, (_, i) => i);
    const stack = await decodeFor(source, info, s, all, opts);
    const out = new Uint8ClampedArray(s.width * s.height * 4);
    const matteBuf = matte ? new Uint8ClampedArray(s.width * s.height * 4) : null;
    const render: RenderOptions =
      matte && s.render.key ? { ...s.render, key: { ...s.render.key, transparent: true } } : s.render;
    let lastYield = performance.now();
    for (let i = 0; i < s.frameCount; i++) {
      if (opts.signal?.aborted) throw new ExportAbortedError();
      renderTimeSlice(stack, sliceAt(s.anim, frameProgress(i, s.frameCount)), render, out);
      if (matte && matteBuf) {
        if (render.key) splitMatte(out, matteBuf, matte.background);
        else matteBuf.fill(255);
        await matte.sink.add(matteBuf, i);
      }
      await sink.add(out, i);
      opts.onProgress?.({ phase: 'render', done: i + 1, total: s.frameCount });
      if (performance.now() - lastYield > 50) {
        await yieldToUi();
        lastYield = performance.now();
      }
    }
    opts.onProgress?.({ phase: 'finalize', done: 0, total: 1 });
    const blob = await sink.finish();
    const matteBlob = matte ? await matte.sink.finish() : null;
    return { blob, matte: matteBlob };
  } catch (e) {
    await sink.cancel().catch(() => undefined);
    await matte?.sink.cancel().catch(() => undefined);
    throw e;
  }
}

/** Render a single output frame of the animation as a full-resolution PNG. */
export async function exportStill(
  source: ClipSource,
  info: SourceInfo,
  s: ExportSettings,
  frameIndex: number,
  opts: RunOptions = {},
): Promise<Blob> {
  const stack = await decodeFor(source, info, s, [frameIndex], opts);
  const out = new Uint8ClampedArray(s.width * s.height * 4);
  opts.onProgress?.({ phase: 'render', done: 0, total: 1 });
  renderTimeSlice(stack, sliceAt(s.anim, frameProgress(frameIndex, s.frameCount)), s.render, out);
  opts.onProgress?.({ phase: 'finalize', done: 0, total: 1 });
  return encodePng(out, s.width, s.height);
}

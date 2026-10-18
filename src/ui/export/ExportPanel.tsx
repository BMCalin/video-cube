/**
 * Time-slice export panel.
 *
 * Animates the slice plane from a start keyframe to an end keyframe and
 * renders every position as one output frame. The preview runs on the
 * viewer's volume; the export re-decodes the original video or images at
 * the chosen output resolution.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Film, ImageDown, Pause, Play, X } from 'lucide-react';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Label } from '@/components/ui/label';
import { Progress } from '@/components/ui/progress';
import { Slider } from '@/components/ui/slider';
import { cn } from '@/lib/utils';
import type { Vec3 } from '@/render/linalg';
import {
  DEFAULT_ANIMATION,
  EASINGS,
  keyframeFromPlane,
  pivotSegment2D,
  planeFromKeyframe,
  sliceAt,
  sourceFrameRange,
} from '@/export/timeSlice';
import type { Easing, SliceAnimation, SliceKeyframe, ViewerPlane } from '@/export/timeSlice';
import { renderTimeSlice, volumeStack } from '@/export/renderTimeSlice';
import type { EdgeMode, RenderOptions } from '@/export/renderTimeSlice';
import {
  DEFAULT_FPS,
  DEFAULT_QUALITY,
  DEFAULT_RESOLUTION_ID,
  FRAME_RATE_PRESETS,
  QUALITY_PRESETS,
  RESOLUTION_PRESETS,
  estimateStackBytes,
  formatBytes,
  outputSize,
} from '@/export/presets';
import type { QualityId } from '@/export/presets';
import { probeSource, ExportAbortedError } from '@/export/videoSource';
import type { ClipSource } from '@/ingest/source';
import type { SourceInfo } from '@/export/videoSource';
import {
  canPickDirectory,
  createMp4Sink,
  createPngFolderSink,
  createPngZipSink,
  hasVideoEncoder,
  pickDirectory,
  saveBlob,
} from '@/export/encoders';
import type { FrameSink } from '@/export/encoders';
import { exportAnimation, exportStill } from '@/export/exportTimeSlice';
import type { ExportProgress, ExportSettings } from '@/export/exportTimeSlice';
import { KeyframeEditor } from './KeyframeEditor';
import { NumberSlider, Section, SelectField } from './fields';

type Format = 'mp4' | 'png';

interface Status {
  kind: 'success' | 'error' | 'info';
  text: string;
}

const PHASE_LABEL: Record<ExportProgress['phase'], string> = {
  decode: 'Decoding source frames',
  render: 'Rendering',
  finalize: 'Finishing file',
};

/** Above this much decoded source data, warn about memory. */
const MEMORY_WARNING_BYTES = 8 * 1024 ** 3;

function formatSeconds(s: number): string {
  if (s < 60) return `${s.toFixed(1)} s`;
  const m = Math.floor(s / 60);
  return `${m} min ${Math.round(s - m * 60)} s`;
}

/**
 * Overlay the tilt pivot as a dashed orange line on a preview canvas. Drawn
 * on top of the rendered image only; exports never contain it.
 */
function drawPivotLine(ctx: CanvasRenderingContext2D, w: number, h: number, azimuth: number, pivot: number) {
  const m = Math.max(w, h);
  const ax = w / m;
  const ay = h / m;
  const seg = pivotSegment2D(azimuth, pivot, ax / 2, ay / 2);
  if (!seg) return;
  const lw = Math.max(1.5, m / 320);
  const toPx = ([X, Y]: [number, number]): [number, number] => [
    Math.min(w - lw / 2, Math.max(lw / 2, (X / ax + 0.5) * w)),
    Math.min(h - lw / 2, Math.max(lw / 2, (0.5 - Y / ay) * h)),
  ];
  const [a, b] = [toPx(seg[0]), toPx(seg[1])];
  ctx.save();
  ctx.strokeStyle = 'rgba(255, 166, 48, 0.9)';
  ctx.lineWidth = lw;
  ctx.setLineDash([lw * 4, lw * 3]);
  ctx.beginPath();
  ctx.moveTo(a[0], a[1]);
  ctx.lineTo(b[0], b[1]);
  ctx.stroke();
  ctx.restore();
}

export interface ExportPanelProps {
  /** Source clip (video or image sequence), or null while the demo volume is shown. */
  source: ClipSource | null;
  /** The viewer's volume (used for the live preview). */
  volume: { data: Uint8Array; dims: Vec3 };
  /** World-space half extents of the viewer's volume box. */
  half: Vec3;
  /** The viewer's current slice plane. */
  plane: ViewerPlane;
  /** Move the viewer's slice plane. */
  onApplyPlane: (plane: ViewerPlane) => void;
  /** Tilt pivot shared with the viewer, 0..1 along the gradient direction. */
  pivot: number;
  /** When set, the preview is also shown full size inside this element. */
  previewHost: HTMLElement | null;
  /** Keep the panel mounted but out of view, so its settings survive. */
  hidden?: boolean;
  onClose: () => void;
}

export function ExportPanel(props: ExportPanelProps) {
  const { source, volume, half, plane, onApplyPlane, pivot, previewHost, hidden = false } = props;

  // --- source --------------------------------------------------------------
  const [info, setInfo] = useState<SourceInfo | null>(null);
  const [probeError, setProbeError] = useState<string | null>(null);

  // --- animation -----------------------------------------------------------
  const [animBase, setAnim] = useState<SliceAnimation>(DEFAULT_ANIMATION);
  // The pivot is owned by the viewer so the 3D plane and the export agree.
  const anim = useMemo(() => ({ ...animBase, pivot }), [animBase, pivot]);
  const [edge, setEdge] = useState<EdgeMode>('hold');
  const [blend, setBlend] = useState(true);
  const render: RenderOptions = useMemo(() => ({ edge, blend }), [edge, blend]);

  // --- output --------------------------------------------------------------
  const [format, setFormat] = useState<Format>(hasVideoEncoder() ? 'mp4' : 'png');
  const [resolutionId, setResolutionId] = useState(DEFAULT_RESOLUTION_ID);
  const [fps, setFps] = useState(DEFAULT_FPS);
  const [duration, setDuration] = useState(10);
  const [quality, setQuality] = useState<QualityId>(DEFAULT_QUALITY);
  const [sourceFps, setSourceFps] = useState(30);

  // --- preview -------------------------------------------------------------
  const [progress, setProgress] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [sync3d, setSync3d] = useState(false);
  const [showPivot, setShowPivot] = useState(true);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const bigCanvasRef = useRef<HTMLCanvasElement>(null);
  // Bumped when the browser restores a lost canvas context, to force a redraw.
  const [canvasEpoch, setCanvasEpoch] = useState(0);

  // --- job -----------------------------------------------------------------
  const [job, setJob] = useState<ExportProgress | null>(null);
  const [status, setStatus] = useState<Status | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  // Probe the source whenever a new clip is loaded, and derive sensible defaults.
  useEffect(() => {
    setInfo(null);
    setProbeError(null);
    if (!source) return;
    let cancelled = false;
    probeSource(source)
      .then((i) => {
        if (cancelled) return;
        setInfo(i);
        setSourceFps(i.fps ? Math.round(i.fps * 1000) / 1000 : 30);
        setDuration(Math.max(1, Math.round(i.duration * 10) / 10));
        const fits = RESOLUTION_PRESETS.find((p) => p.id === DEFAULT_RESOLUTION_ID);
        setResolutionId(fits && !outputSize(i.width, i.height, fits).upscale ? DEFAULT_RESOLUTION_ID : 'source');
      })
      .catch((e: unknown) => {
        if (!cancelled) setProbeError(e instanceof Error ? e.message : 'Could not read this clip.');
      });
    return () => {
      cancelled = true;
    };
  }, [source]);

  const clipSeconds = info?.duration ?? null;
  const frameCount = Math.max(1, Math.round(duration * fps));
  const preset = RESOLUTION_PRESETS.find((p) => p.id === resolutionId) ?? RESOLUTION_PRESETS[0];
  const size = info ? outputSize(info.width, info.height, preset) : null;
  const sourceCount = info ? Math.max(1, Math.round(info.duration * sourceFps)) : 0;

  const neededFrames = useMemo(() => {
    if (!info) return 0;
    const all = Array.from({ length: frameCount }, (_, i) => i);
    const [a, b] = sourceFrameRange(anim, all, frameCount, sourceCount);
    return b - a + 1;
  }, [anim, frameCount, sourceCount, info]);
  const memoryBytes = size ? estimateStackBytes(size.width, size.height, neededFrames) : 0;
  const sweepSeconds = clipSeconds ? Math.abs(anim.end.time - anim.start.time) * clipSeconds : 0;
  const speed = duration > 0 ? sweepSeconds / duration : 0;

  // --- preview rendering ---------------------------------------------------
  const stack = useMemo(() => volumeStack(volume.data, volume.dims), [volume]);
  const slice = useMemo(() => sliceAt(anim, progress), [anim, progress]);

  // Render once, then copy into the panel canvas and, if shown, the large one.
  useEffect(() => {
    const canvases = [canvasRef.current, bigCanvasRef.current].filter((c): c is HTMLCanvasElement => !!c);
    if (!canvases.length) return;
    const img = new ImageData(stack.width, stack.height);
    renderTimeSlice(stack, slice, render, img.data);
    for (const canvas of canvases) {
      if (canvas.width !== stack.width || canvas.height !== stack.height) {
        canvas.width = stack.width;
        canvas.height = stack.height;
      }
      // CPU-backed context: the preview is written with putImageData every
      // frame, which is cheaper without a GPU round trip.
      const ctx = canvas.getContext('2d', { willReadFrequently: true });
      if (!ctx) continue;
      ctx.putImageData(img, 0, 0);
      if (showPivot) drawPivotLine(ctx, stack.width, stack.height, slice.azimuth, pivot);
    }
  }, [stack, slice, render, canvasEpoch, previewHost, showPivot, pivot]);

  useEffect(() => {
    const canvases = [canvasRef.current, bigCanvasRef.current].filter((c): c is HTMLCanvasElement => !!c);
    const restored = () => setCanvasEpoch((e) => e + 1);
    for (const c of canvases) c.addEventListener('contextrestored', restored);
    return () => {
      for (const c of canvases) c.removeEventListener('contextrestored', restored);
    };
  }, [previewHost]);

  // Playback loop at real output speed.
  useEffect(() => {
    if (!playing) return;
    let raf = 0;
    let last = performance.now();
    const tick = (now: number) => {
      const dt = (now - last) / 1000;
      last = now;
      setProgress((p) => {
        const next = p + dt / Math.max(0.1, duration);
        return next > 1 ? 0 : next;
      });
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [playing, duration]);

  // Optionally drive the 3D slice plane from the preview position.
  useEffect(() => {
    if (sync3d && !hidden) onApplyPlane(planeFromKeyframe(slice, half));
    // half changes with spacing; re-sync then as well
  }, [sync3d, hidden, slice, half, onApplyPlane]);

  // A hidden panel does not keep playing.
  useEffect(() => {
    if (hidden) setPlaying(false);
  }, [hidden]);

  // --- keyframe helpers ----------------------------------------------------
  const setKeyframe = useCallback((which: 'start' | 'end', kf: SliceKeyframe) => {
    setAnim((a) => ({ ...a, [which]: kf }));
  }, []);

  const capture = useCallback(
    (which: 'start' | 'end') => {
      const kf = keyframeFromPlane(plane, half, pivot);
      if (!kf) {
        setStatus({
          kind: 'error',
          text: 'The 3D slice plane runs along the time axis, so it does not map pixels to moments. Raise its elevation (90\u00b0 is an ordinary frame).',
        });
        return;
      }
      setStatus(null);
      setKeyframe(which, kf);
      setProgress(which === 'start' ? 0 : 1);
    },
    [plane, half, pivot, setKeyframe],
  );

  const show = useCallback(
    (which: 'start' | 'end') => {
      setPlaying(false);
      setProgress(which === 'start' ? 0 : 1);
      onApplyPlane(planeFromKeyframe(sliceAt(anim, which === 'start' ? 0 : 1), half));
    },
    [anim, half, onApplyPlane],
  );

  // --- export --------------------------------------------------------------
  const settings = (): ExportSettings | null =>
    info && size
      ? { anim, width: size.width, height: size.height, frameCount, sourceCount, render }
      : null;

  const runJob = async (work: (signal: AbortSignal) => Promise<string>) => {
    const ctrl = new AbortController();
    abortRef.current = ctrl;
    setPlaying(false);
    setStatus(null);
    setJob({ phase: 'decode', done: 0, total: 1 });
    const t0 = performance.now();
    try {
      const what = await work(ctrl.signal);
      setStatus({ kind: 'success', text: `${what} (${formatSeconds((performance.now() - t0) / 1000)}).` });
    } catch (e) {
      if (e instanceof ExportAbortedError || (e instanceof DOMException && e.name === 'AbortError')) {
        setStatus({ kind: 'info', text: 'Export cancelled.' });
      } else {
        console.error(e);
        setStatus({ kind: 'error', text: e instanceof Error ? e.message : 'Export failed.' });
      }
    } finally {
      abortRef.current = null;
      setJob(null);
    }
  };

  const handleExport = async () => {
    const s = settings();
    if (!source || !info || !s) return;
    const prefix = `${source.name}_timeslice`;
    // The folder picker needs the click's user activation, so ask first.
    let dir: FileSystemDirectoryHandle | null = null;
    if (format === 'png' && canPickDirectory()) {
      try {
        dir = await pickDirectory();
      } catch {
        return; // picker dismissed
      }
    }
    await runJob(async (signal) => {
      let sink: FrameSink;
      let filename: string;
      if (format === 'mp4') {
        sink = await createMp4Sink({ width: s.width, height: s.height, fps, quality });
        filename = `${prefix}_${s.width}x${s.height}_${fps}fps.mp4`;
      } else if (dir) {
        sink = createPngFolderSink(dir, prefix, s.width, s.height);
        filename = '';
      } else {
        sink = createPngZipSink(prefix, s.width, s.height);
        filename = `${prefix}_${s.width}x${s.height}_png.zip`;
      }
      const blob = await exportAnimation(source, info, s, sink, { signal, onProgress: setJob });
      if (blob) {
        saveBlob(blob, filename);
        return `Saved ${filename}${sink.label ? ` (${sink.label})` : ''}`;
      }
      return `Wrote ${s.frameCount} PNG frames to "${dir?.name ?? 'folder'}"`;
    });
  };

  const handleStill = async () => {
    const s = settings();
    if (!source || !info || !s) return;
    const index = Math.round(progress * (frameCount - 1));
    await runJob(async (signal) => {
      const blob = await exportStill(source, info, s, index, { signal, onProgress: setJob });
      const filename = `${source.name}_timeslice_f${String(index).padStart(5, '0')}_${s.width}x${s.height}.png`;
      saveBlob(blob, filename);
      return `Saved ${filename}`;
    });
  };

  const busy = job !== null;
  const canExport = !!source && !!info && !busy;
  const frameIndex = Math.round(progress * (frameCount - 1));
  const [lo, hi] = [slice.time - Math.abs(slice.span) / 2, slice.time + Math.abs(slice.span) / 2];
  const fmtClip = (t: number) =>
    clipSeconds ? `${(Math.min(1, Math.max(0, t)) * clipSeconds).toFixed(2)} s` : `${Math.round(Math.min(1, Math.max(0, t)) * 100)}%`;

  const togglePlay = () => setPlaying((p) => !p);
  const scrub = (v: number) => {
    setPlaying(false);
    setProgress(v);
  };

  // Full-size preview with a transport bar, shown in the main view.
  const bigPreview =
    previewHost &&
    createPortal(
      <div id="big-preview" className="absolute inset-0 bg-background">
        <div className="absolute inset-x-6 top-16 bottom-28">
          <canvas
            ref={bigCanvasRef}
            className="h-full w-full object-contain"
            aria-label="Time-slice preview"
          />
        </div>
        <div className="pointer-events-none absolute inset-x-0 bottom-6 flex justify-center px-6">
          <div className="pointer-events-auto flex w-full max-w-3xl flex-col gap-1.5 rounded-xl border bg-card/90 px-4 py-3 shadow-lg backdrop-blur">
            <div className="flex items-center gap-3">
              <Button
                id="big-play"
                size="icon"
                onClick={togglePlay}
                aria-label={playing ? 'Pause preview' : 'Play preview'}
              >
                {playing ? <Pause /> : <Play />}
              </Button>
              <Slider
                aria-label="Preview position"
                min={0}
                max={1}
                step={0.001}
                value={[progress]}
                onValueChange={([v]) => scrub(v)}
                className="flex-1"
              />
            </div>
            <div className="flex justify-between text-[11px] text-muted-foreground tabular-nums">
              <span>
                Frame {frameIndex + 1} / {frameCount}
              </span>
              <span>
                Shows {fmtClip(lo)} - {fmtClip(hi)}
              </span>
            </div>
          </div>
        </div>
      </div>,
      previewHost,
    );

  return (
    <>
      {bigPreview}
      <aside
        id="export-panel"
        className={cn(
          'flex h-svh w-[360px] shrink-0 flex-col border-l bg-sidebar text-sidebar-foreground',
          hidden && 'hidden',
        )}
      >
        <header className="flex items-center justify-between border-b px-4 py-3">
          <div>
            <h2 className="text-sm font-semibold tracking-tight">Time-slice export</h2>
            <p className="text-[11px] text-muted-foreground">Every slice position becomes one frame.</p>
          </div>
          <Button size="icon-sm" variant="ghost" onClick={props.onClose} aria-label="Close export panel">
            <X />
          </Button>
        </header>

        <div className="flex-1 overflow-y-auto">
          <Section title="Preview">
            <canvas
              ref={canvasRef}
              id="export-preview"
              className="w-full rounded-md border bg-black"
              style={{ aspectRatio: `${stack.width} / ${stack.height}`, imageRendering: 'auto' }}
            />
            <div className="flex items-center gap-2">
              <Button
                size="icon-sm"
                variant="outline"
                onClick={togglePlay}
                aria-label={playing ? 'Pause preview' : 'Play preview'}
              >
                {playing ? <Pause /> : <Play />}
              </Button>
              <Slider
                aria-label="Preview position"
                min={0}
                max={1}
                step={0.001}
                value={[progress]}
                onValueChange={([v]) => scrub(v)}
                className="flex-1"
              />
            </div>
            <p className="text-[11px] text-muted-foreground tabular-nums">
              Frame {frameIndex + 1} / {frameCount} | shows {fmtClip(lo)} - {fmtClip(hi)}
            </p>
            <div className="flex items-center gap-2">
              <Checkbox id="show-pivot" checked={showPivot} onCheckedChange={(c) => setShowPivot(c === true)} />
              <Label htmlFor="show-pivot" className="text-xs">
                Show the tilt pivot line (preview only)
              </Label>
            </div>
            <div className="flex items-center gap-2">
              <Checkbox id="sync3d" checked={sync3d} onCheckedChange={(c) => setSync3d(c === true)} />
              <Label htmlFor="sync3d" className="text-xs">
                Move the 3D slice plane with the preview
              </Label>
            </div>
            {!source && (
              <p className="text-[11px] text-muted-foreground">
                Showing the demo volume. Load a video or an image sequence to enable export.
              </p>
            )}
          </Section>

          <Section title="Animation">
            <KeyframeEditor
              id="kf-start"
              title="Start"
              value={anim.start}
              clipSeconds={clipSeconds}
              half={half}
              onChange={(kf) => setKeyframe('start', kf)}
              onCapture={() => capture('start')}
              onShow={() => show('start')}
            />
            <KeyframeEditor
              id="kf-end"
              title="End"
              value={anim.end}
              clipSeconds={clipSeconds}
              half={half}
              onChange={(kf) => setKeyframe('end', kf)}
              onCapture={() => capture('end')}
              onShow={() => show('end')}
            />
            <SelectField<Easing>
              id="easing"
              label="Tilt transition"
              value={anim.easing}
              options={EASINGS.map((e) => ({ value: e.id, label: e.label }))}
              onValueChange={(easing) => setAnim((a) => ({ ...a, easing }))}
            />
            <div className="flex items-start gap-2">
              <Checkbox
                id="fit"
                checked={anim.fit}
                onCheckedChange={(c) => setAnim((a) => ({ ...a, fit: c === true }))}
              />
              <Label htmlFor="fit" className="flex-col items-start gap-0.5 text-xs">
                Keep the slice inside the clip
                <span className="font-normal text-muted-foreground">
                  Avoids frozen edges; the sweep shortens slightly as the span grows.
                </span>
              </Label>
            </div>
            <SelectField<EdgeMode>
              id="edge"
              label="Beyond the first / last frame"
              value={edge}
              options={[
                { value: 'hold', label: 'Hold the first / last frame' },
                { value: 'black', label: 'Black' },
              ]}
              onValueChange={setEdge}
            />
            <div className="flex items-start gap-2">
              <Checkbox id="blend" checked={blend} onCheckedChange={(c) => setBlend(c === true)} />
              <Label htmlFor="blend" className="flex-col items-start gap-0.5 text-xs">
                Blend between frames
                <span className="font-normal text-muted-foreground">
                  Smooth gradient. Turn off for hard steps between source frames.
                </span>
              </Label>
            </div>
          </Section>

          <Section title="Output">
            <SelectField<Format>
              id="format"
              label="Format"
              value={format}
              options={[
                { value: 'mp4', label: 'MP4 video (H.264)', disabled: !hasVideoEncoder() },
                { value: 'png', label: canPickDirectory() ? 'PNG sequence (to a folder)' : 'PNG sequence (ZIP)' },
              ]}
              onValueChange={setFormat}
            />
            <SelectField<string>
              id="resolution"
              label="Resolution"
              value={resolutionId}
              disabled={!info}
              options={RESOLUTION_PRESETS.map((p) => {
                const s = info ? outputSize(info.width, info.height, p) : null;
                return {
                  value: p.id,
                  label: s ? `${p.label} - ${s.width}x${s.height}` : p.label,
                  disabled: !!s?.upscale,
                };
              })}
              onValueChange={setResolutionId}
            />
            <div className="grid grid-cols-2 gap-3">
              <SelectField<number>
                id="fps"
                label="Frame rate"
                value={fps}
                options={FRAME_RATE_PRESETS.map((f) => ({ value: f.fps, label: f.label }))}
                onValueChange={setFps}
              />
              <SelectField<QualityId>
                id="quality"
                label="Quality"
                value={quality}
                disabled={format !== 'mp4'}
                options={QUALITY_PRESETS.map((q) => ({ value: q.id, label: q.label }))}
                onValueChange={setQuality}
              />
            </div>
            <NumberSlider
              id="duration"
              label="Duration"
              hint={`${frameCount} frames${sweepSeconds > 0 ? ` | ${speed.toFixed(2)}x speed` : ''}`}
              unit="s"
              min={1}
              max={120}
              step={0.1}
              inputMin={0.1}
              inputMax={3600}
              value={duration}
              decimals={1}
              onValueChange={setDuration}
            />
            <NumberSlider
              id="source-fps"
              label="Source sampling"
              hint={
                info?.decoder === 'images'
                  ? `${info.imageCount} images at ${info.fps} fps`
                  : info?.fps
                    ? `native ${info.fps.toFixed(2)} fps`
                    : 'native rate unknown'
              }
              unit="fps"
              min={1}
              max={Math.max(60, Math.ceil(info?.fps ?? 60))}
              step={1}
              inputMax={240}
              value={sourceFps}
              decimals={3}
              disabled={!info}
              onValueChange={(v) => setSourceFps(Math.max(1, v))}
            />
            {info && size && (
              <p
                className={
                  memoryBytes > MEMORY_WARNING_BYTES ? 'text-[11px] text-amber-400' : 'text-[11px] text-muted-foreground'
                }
              >
                Decodes {neededFrames} of {sourceCount} source frames at {size.width}x{size.height} | needs ~{' '}
                {formatBytes(memoryBytes)} of RAM
                {memoryBytes > MEMORY_WARNING_BYTES && '. Make sure that much memory is free, or lower the resolution or source sampling.'}
              </p>
            )}
            {probeError && (
              <Alert variant="destructive">
                <AlertTitle>Cannot read source</AlertTitle>
                <AlertDescription>{probeError}</AlertDescription>
              </Alert>
            )}
          </Section>
        </div>

        <footer className="flex flex-col gap-2 border-t px-4 py-3">
          {job && (
            <div id="export-progress" className="flex flex-col gap-1">
              <Progress value={job.total ? (job.done / job.total) * 100 : 0} />
              <div className="flex items-center justify-between text-[11px] text-muted-foreground tabular-nums">
                <span>
                  {PHASE_LABEL[job.phase]}
                  {job.phase !== 'finalize' && ` ${job.done} / ${job.total}`}
                </span>
                <Button size="xs" variant="ghost" onClick={() => abortRef.current?.abort()}>
                  Cancel
                </Button>
              </div>
            </div>
          )}
          {status && (
            <p
              id="export-status"
              role="status"
              className={
                status.kind === 'error'
                  ? 'text-xs text-destructive'
                  : status.kind === 'success'
                    ? 'text-xs text-emerald-400'
                    : 'text-xs text-muted-foreground'
              }
            >
              {status.text}
            </p>
          )}
          <div className="flex gap-2">
            <Button id="export-run" className="flex-1" disabled={!canExport} onClick={() => void handleExport()}>
              <Film /> Export {format === 'mp4' ? 'video' : 'PNG sequence'}
            </Button>
            <Button
              id="export-still"
              variant="outline"
              disabled={!canExport}
              onClick={() => void handleStill()}
              title="Save the current preview frame as a full-resolution PNG"
            >
              <ImageDown /> Still
            </Button>
          </div>
        </footer>
      </aside>
    </>
  );
}

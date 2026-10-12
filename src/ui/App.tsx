import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { ChangeEvent, DragEvent } from 'react';
import {
  Sidebar,
  SidebarContent,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarInset,
  SidebarProvider,
} from '@/components/ui/sidebar';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Progress } from '@/components/ui/progress';
import { Slider } from '@/components/ui/slider';
import { cn } from '@/lib/utils';
import { CubeRenderer } from '@/render/cubeRenderer';
import { ResliceRenderer } from '@/render/resliceRenderer';
import { ingestVideo } from '@/ingest/ingestVideo';
import { volumeHalfExtents } from '@/render/resliceMath';
import type { Vec3 } from '@/render/linalg';
import { syntheticVolume } from './syntheticVolume';

type Axis = 'x' | 'y' | 'z';

interface PlaneState {
  azimuth: number;
  elevation: number;
  offset: number;
  flip: boolean;
  axis: Axis | null;
}

/** Cut faces the time axis so it slices frames, parked a few frames into the
 *  stack (offset is refined once the volume extent is known). */
const INITIAL_PLANE: PlaneState = {
  azimuth: 0,
  elevation: 90,
  offset: 0,
  flip: false,
  axis: 'z',
};

function planeNormal(azimuth: number, elevation: number): Vec3 {
  const az = (azimuth * Math.PI) / 180;
  const el = (elevation * Math.PI) / 180;
  return [Math.cos(el) * Math.sin(az), Math.cos(el) * Math.cos(az), Math.sin(el)];
}

function clamp(v: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, v));
}

function SliderRow(props: {
  id: string;
  label: string;
  unit: string;
  min: number;
  max: number;
  step: number;
  value: number;
  onValueChange: (v: number) => void;
}) {
  const [text, setText] = useState(String(props.value));

  // Slider / external state changes rewrite the text box (unless the user is
  // mid-edit on a value that still parses to the same number).
  useEffect(() => {
    setText(String(props.value));
  }, [props.value]);

  const onInputChange = (e: ChangeEvent<HTMLInputElement>) => {
    const raw = e.target.value;
    setText(raw);
    const v = Number.parseFloat(raw);
    if (!Number.isNaN(v)) props.onValueChange(clamp(v, props.min, props.max));
  };

  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-center justify-between">
        <Label htmlFor={props.id} className="text-xs">
          {props.label}
        </Label>
        {props.unit && (
          <span className="text-xs text-muted-foreground">{props.unit}</span>
        )}
      </div>
      <div className="flex items-center gap-2">
        <Slider
          aria-label={props.label}
          min={props.min}
          max={props.max}
          step={props.step}
          value={[props.value]}
          onValueChange={([v]) => props.onValueChange(v)}
          className="flex-1"
        />
        {/* Native number input — also the drive surface for the e2e harness
            (value assignment + bubbled 'input' event, which React onChange
            receives). Resynced on blur so half-typed drafts don't stick. */}
        <Input
          id={props.id}
          type="number"
          inputMode="decimal"
          min={props.min}
          max={props.max}
          step={props.step}
          value={text}
          onChange={onInputChange}
          onBlur={() => setText(String(props.value))}
          className="h-7 w-16 text-xs tabular-nums"
        />
      </div>
    </div>
  );
}

export function App() {
  const [webgl2Supported] = useState(
    () => typeof document !== 'undefined' && !!document.createElement('canvas').getContext('webgl2'),
  );

  const cubeCanvasRef = useRef<HTMLCanvasElement>(null);
  const resliceCanvasRef = useRef<HTMLCanvasElement>(null);
  const cubeRef = useRef<CubeRenderer | null>(null);
  const resliceRef = useRef<ResliceRenderer | null>(null);
  const lastFileRef = useRef<File | null>(null);
  // False until the user moves a plane control; before that the cut keeps
  // its default parked position as dims/spacing change.
  const planeTouchedRef = useRef(false);

  const [dims, setDims] = useState<Vec3>([64, 64, 64]);
  const [hasVideo, setHasVideo] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [ingesting, setIngesting] = useState(false);
  const [progress, setProgress] = useState(0);
  const [rate, setRate] = useState(10);
  const [rateDirty, setRateDirty] = useState(false);
  const [opacity, setOpacity] = useState(8);
  const [spacing, setSpacing] = useState(1);
  const [dragOver, setDragOver] = useState(false);
  const [plane, setPlaneState] = useState<PlaneState>(INITIAL_PLANE);

  const normal = useMemo(
    () => planeNormal(plane.azimuth, plane.elevation),
    [plane.azimuth, plane.elevation],
  );
  const half = useMemo(() => volumeHalfExtents(dims, spacing), [dims, spacing]);
  const reach = useMemo(() => Math.hypot(...half), [half]);
  // The offset can only reach as far as the box; clamping here keeps the
  // plane on the volume even right after reach shrinks (spacing/dims).
  const clampedOffset = Math.min(reach, Math.max(-reach, plane.offset));

  // Boot with a synthetic volume so the cube renders before any video is loaded.
  useEffect(() => {
    if (!webgl2Supported) return;
    const canvas = cubeCanvasRef.current;
    if (!canvas) return;
    const cube = new CubeRenderer(canvas, syntheticVolume(64), [64, 64, 64]);
    cube.setDensity(opacity);
    cube.setSpacing(volumeHalfExtents([64, 64, 64], spacing));
    cube.start();
    cubeRef.current = cube;
    return () => {
      cubeRef.current?.dispose();
      cubeRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [webgl2Supported]);

  // Derived plane drives both renderers. The cut is always on; before the
  // user touches a plane control it stays parked near the start of the stack.
  useEffect(() => {
    cubeRef.current?.setPlane(normal, clampedOffset, true, plane.flip);
    resliceRef.current?.setPlane(normal, clampedOffset);
  }, [normal, clampedOffset, plane.flip]);

  // Park the cut three frames into the stack so the section is visible from
  // boot; once the user moves a plane control, their offset stands.
  useEffect(() => {
    if (planeTouchedRef.current) return;
    const pitch = (2 * half[2]) / dims[2];
    const d = -half[2] + 3 * pitch;
    setPlaneState((p) => (p.offset === d ? p : { ...p, offset: d }));
  }, [half, dims]);

  // Reconcile offset state when reach shrinks (spacing/dims change), so the
  // stored offset and the slider cannot sit beyond the volume.
  useEffect(() => {
    setPlaneState((p) => {
      const next = Math.min(reach, Math.max(-reach, p.offset));
      return next === p.offset ? p : { ...p, offset: next };
    });
  }, [reach]);

  // Spacing/dims change both renderers and re-apply the current plane.
  useEffect(() => {
    cubeRef.current?.setSpacing(half);
    resliceRef.current?.setSpacing(half);
    cubeRef.current?.setPlane(normal, clampedOffset, true, plane.flip);
    resliceRef.current?.setPlane(normal, clampedOffset);
  }, [half, normal, clampedOffset, plane.flip]);

  const ingest = useCallback(
    async (file: File) => {
      setIngesting(true);
      setProgress(0);
      try {
        const r = await ingestVideo(file, rate, 256, (done, total) =>
          setProgress(Math.round((done / total) * 100)),
        );
        const nextDims: Vec3 = [r.width, r.height, r.depth];
        const nextHalf = volumeHalfExtents(nextDims, spacing);
        const n = planeNormal(plane.azimuth, plane.elevation);

        cubeRef.current?.dispose();
        const cubeCanvas = cubeCanvasRef.current;
        if (cubeCanvas) {
          const cube = new CubeRenderer(cubeCanvas, r.data, nextDims);
          cube.setDensity(opacity);
          cube.setSpacing(nextHalf);
          cube.setPlane(n, clampedOffset, true, plane.flip);
          cube.start();
          cubeRef.current = cube;
        }
        setDims(nextDims);
        setHasVideo(true);

        resliceRef.current?.dispose();
        const resliceCanvas = resliceCanvasRef.current;
        if (resliceCanvas) {
          const reslice = new ResliceRenderer(resliceCanvas, r.data, nextDims);
          reslice.setSpacing(nextHalf);
          reslice.setPlane(n, clampedOffset);
          resliceRef.current = reslice;
        }
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Ingest failed.');
      } finally {
        setIngesting(false);
      }
    },
    [rate, spacing, opacity, plane.azimuth, plane.elevation, clampedOffset, plane.flip],
  );

  const ingestFile = useCallback(
    (file: File) => {
      if (!cubeRef.current) return;
      lastFileRef.current = file;
      setRateDirty(false);
      setError(null);
      void ingest(file);
    },
    [ingest],
  );

  const handleFile = useCallback(
    (e: ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (file) ingestFile(file);
    },
    [ingestFile],
  );

  const handleDrop = useCallback(
    (e: DragEvent<HTMLDivElement>) => {
      e.preventDefault();
      setDragOver(false);
      const file = e.dataTransfer.files?.[0];
      if (file) ingestFile(file);
    },
    [ingestFile],
  );

  const handleRate = useCallback((v: number) => {
    setRate(v);
    if (lastFileRef.current) setRateDirty(true);
  }, []);

  const handleResample = useCallback(() => {
    const file = lastFileRef.current;
    if (!file) return;
    setRateDirty(false);
    void ingest(file);
  }, [ingest]);

  const handleOpacity = useCallback((v: number) => {
    setOpacity(v);
    cubeRef.current?.setDensity(v);
  }, []);

  // A plane-control interaction hands the offset over to the user: the
  // parked default no longer follows dims/spacing changes.
  const updatePlane = useCallback((partial: Partial<PlaneState>) => {
    planeTouchedRef.current = true;
    setPlaneState((p) => ({ ...p, ...partial }));
  }, []);

  const setAxis = useCallback(
    (axis: Axis) => {
      updatePlane({
        axis,
        azimuth: axis === 'x' ? 90 : 0,
        elevation: axis === 'z' ? 90 : 0,
      });
    },
    [updatePlane],
  );

  if (!webgl2Supported) {
    return (
      <div className="flex min-h-svh items-center justify-center bg-background p-6">
        <Alert variant="destructive" id="msg" className="max-w-md">
          <AlertTitle>WebGL2 unavailable</AlertTitle>
          <AlertDescription>
            WebGL2 is required but not available in this browser.
          </AlertDescription>
        </Alert>
      </div>
    );
  }

  // Definite wrapper height (not just min-height) so the h-full sidebar
  // rail resolves to the viewport instead of its content height.
  return (
    <SidebarProvider className="h-svh overflow-hidden">
      <Sidebar side="left" collapsible="none">
        <SidebarHeader>
          <h1 className="px-2 py-1 text-sm font-semibold tracking-tight">Video Cube</h1>
        </SidebarHeader>
        <SidebarContent>
          <SidebarGroup>
            <SidebarGroupLabel>Source</SidebarGroupLabel>
            <SidebarGroupContent className="flex flex-col gap-2">
              <div
                onDragOver={(e) => {
                  e.preventDefault();
                  setDragOver(true);
                }}
                onDragLeave={() => setDragOver(false)}
                onDrop={handleDrop}
                className={cn(
                  'flex flex-col items-center gap-2 rounded-md border border-dashed p-4 transition-colors',
                  dragOver && 'border-primary bg-accent',
                )}
              >
                <span className="text-xs text-muted-foreground">
                  {ingesting ? 'Sampling…' : 'Drop a video here'}
                </span>
                <Button asChild variant="outline" size="sm">
                  <label htmlFor="file" className="cursor-pointer">
                    Load video
                  </label>
                </Button>
              </div>
              <input
                id="file"
                type="file"
                accept="video/*"
                className="hidden"
                onChange={handleFile}
              />
              {error && (
                <Alert variant="destructive" id="msg">
                  <AlertTitle>Ingest failed</AlertTitle>
                  <AlertDescription>{error}</AlertDescription>
                </Alert>
              )}
            </SidebarGroupContent>
          </SidebarGroup>

          <SidebarGroup>
            <SidebarGroupLabel>Sampling</SidebarGroupLabel>
            <SidebarGroupContent className="flex flex-col gap-3">
              <SliderRow
                id="rate"
                label="Sample rate"
                unit="frames/sec"
                min={1}
                max={40}
                step={1}
                value={rate}
                onValueChange={handleRate}
              />
              {rateDirty && (
                <Button size="sm" onClick={handleResample}>
                  Resample
                </Button>
              )}
              {ingesting && (
                <div id="progress" className="flex flex-col gap-1">
                  <Progress value={progress} />
                  <span id="progress-num" className="text-xs text-muted-foreground">
                    Sampling {progress}%
                  </span>
                </div>
              )}
            </SidebarGroupContent>
          </SidebarGroup>

          <SidebarGroup>
            <SidebarGroupLabel>Appearance</SidebarGroupLabel>
            <SidebarGroupContent className="flex flex-col gap-3">
              <SliderRow
                id="opacity"
                label="Opacity"
                unit=""
                min={0.5}
                max={100}
                step={0.5}
                value={opacity}
                onValueChange={handleOpacity}
              />
              <SliderRow
                id="spacing"
                label="Spacing"
                unit="×"
                min={0.2}
                max={3}
                step={0.05}
                value={spacing}
                onValueChange={setSpacing}
              />
            </SidebarGroupContent>
          </SidebarGroup>

          <SidebarGroup>
            <SidebarGroupLabel>Slice plane</SidebarGroupLabel>
            <SidebarGroupContent className="flex flex-col gap-3">
              <div className="flex gap-1.5">
                {(['x', 'y', 'z'] as const).map((a) => (
                  <Button
                    key={a}
                    data-axis={a}
                    size="sm"
                    variant={plane.axis === a ? 'default' : 'outline'}
                    className="flex-1"
                    onClick={() => setAxis(a)}
                  >
                    {a.toUpperCase()}
                  </Button>
                ))}
              </div>
              <SliderRow
                id="azimuth"
                label="Azimuth"
                unit="°"
                min={-180}
                max={180}
                step={1}
                value={plane.azimuth}
                onValueChange={(v) => updatePlane({ azimuth: v })}
              />
              <SliderRow
                id="elevation"
                label="Elevation"
                unit="°"
                min={-90}
                max={90}
                step={1}
                value={plane.elevation}
                onValueChange={(v) => updatePlane({ elevation: v })}
              />
              <SliderRow
                id="offset"
                label="Position"
                unit=""
                min={-reach}
                max={reach}
                step={0.005}
                value={clampedOffset}
                onValueChange={(v) => updatePlane({ offset: v })}
              />
              <div className="flex items-center gap-2">
                <Checkbox
                  id="flip"
                  checked={plane.flip}
                  onCheckedChange={(c) => updatePlane({ flip: c === true })}
                />
                <Label htmlFor="flip" className="text-xs">
                  Flip cut side
                </Label>
              </div>
            </SidebarGroupContent>
          </SidebarGroup>

          <SidebarGroup>
            <SidebarGroupLabel>Reslice</SidebarGroupLabel>
            <SidebarGroupContent className="flex flex-col gap-2">
              <canvas
                id="reslice"
                width={320}
                height={320}
                hidden={!hasVideo}
                ref={resliceCanvasRef}
                className="w-full max-w-80 rounded-md border"
              />
              {hasVideo && (
                <Button
                  id="download"
                  size="sm"
                  variant="outline"
                  onClick={() => resliceRef.current?.exportPng('reslice.png')}
                >
                  Download reslice PNG
                </Button>
              )}
            </SidebarGroupContent>
          </SidebarGroup>
        </SidebarContent>
      </Sidebar>

      <SidebarInset className="relative overflow-hidden">
        <canvas
          id="cube"
          width={800}
          height={600}
          ref={cubeCanvasRef}
          className="absolute inset-0 h-full w-full"
        />
      </SidebarInset>
    </SidebarProvider>
  );
}

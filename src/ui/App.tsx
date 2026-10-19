import { X } from 'lucide-react';
import { Suspense, lazy, useCallback, useEffect, useMemo, useRef, useState } from 'react';
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
import { ingestVideo } from '@/ingest/ingestVideo';
import { ingestImages } from '@/ingest/ingestImages';
import { DEFAULT_SEQUENCE_FPS, filesFromDataTransfer, sourceFromFiles } from '@/ingest/source';
import type { ClipSource } from '@/ingest/source';
import { DEFAULT_COLOR_KEY } from '@/render/colorKey';
import type { ColorKey } from '@/render/colorKey';
import { ColorKeyPanel } from './ColorKeyPanel';
import { volumeHalfExtents } from '@/render/resliceMath';
import type { Vec3 } from '@/render/linalg';
import { syntheticVolume } from './syntheticVolume';
import { offsetAboutPivot, pivotSegment3D } from '@/export/timeSlice';
import type { ViewerPlane } from '@/export/timeSlice';

// The export panel (and its video encoding libraries) loads on first use.
const ExportPanel = lazy(() => import('./export/ExportPanel').then((m) => ({ default: m.ExportPanel })));

type Axis = 'x' | 'y' | 'z';

/**
 * Long-side size of the viewer volume. Larger values sharpen the cut face and
 * the time-slice preview at the cost of GPU memory (w x h x frames x 4 bytes).
 * Export always decodes the source at full resolution regardless.
 */
const VIEWER_RESOLUTIONS = [512, 1024, 1536];

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
        {/* Native number input - also the drive surface for the e2e harness
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
  // Largest 3D texture edge the GPU accepts; caps the viewer resolution.
  const [max3dTexture] = useState(() => {
    try {
      const gl = document.createElement('canvas').getContext('webgl2');
      return gl ? (gl.getParameter(gl.MAX_3D_TEXTURE_SIZE) as number) : 0;
    } catch {
      return 0;
    }
  });

  const cubeCanvasRef = useRef<HTMLCanvasElement>(null);
  const cubeRef = useRef<CubeRenderer | null>(null);
  const lastFileRef = useRef<ClipSource | null>(null);
  // False until the user moves a plane control; before that the cut keeps
  // its default parked position as dims/spacing change.
  const planeTouchedRef = useRef(false);

  const [dims, setDims] = useState<Vec3>([64, 64, 64]);
  const [error, setError] = useState<string | null>(null);
  const [ingesting, setIngesting] = useState(false);
  const [progress, setProgress] = useState(0);
  const [rate, setRate] = useState(10);
  const [rateDirty, setRateDirty] = useState(false);
  const [opacity, setOpacity] = useState(8);
  const [planeImg, setPlaneImg] = useState(100);
  const [showClipped, setShowClipped] = useState(false);
  const [spacing, setSpacing] = useState(1);
  const [dragOver, setDragOver] = useState(false);
  const [plane, setPlaneState] = useState<PlaneState>(INITIAL_PLANE);
  // Volume currently shown in the viewer, shared with the export preview.
  const [volume, setVolume] = useState<{ data: Uint8Array; dims: Vec3 }>(() => ({
    data: syntheticVolume(64),
    dims: [64, 64, 64],
  }));
  const [source, setSource] = useState<ClipSource | null>(null);
  // Image sequences carry no timing; this frame rate defines their clip time.
  const [seqFps, setSeqFps] = useState(DEFAULT_SEQUENCE_FPS);
  // One tool panel at a time on the right. The export panel stays mounted
  // (hidden) once opened, so its keyframes survive switching panels.
  const [rightPanel, setRightPanel] = useState<'none' | 'export' | 'key'>('none');
  const [exportMounted, setExportMounted] = useState(false);
  const exportOpen = rightPanel === 'export';
  const [viewerRes, setViewerRes] = useState(512);
  // Tilt pivot along the tilt direction: 0 = top edge, 0.5 = centre, 1 = bottom (at azimuth 0).
  const [pivot, setPivot] = useState(0.5);
  const [viewMode, setViewMode] = useState<'3d' | 'preview'>('3d');
  const togglePanel = (panel: 'export' | 'key') => {
    if (panel === 'export') setExportMounted(true);
    setRightPanel((cur) => (cur === panel ? 'none' : panel));
    setViewMode('3d');
  };
  const [previewHost, setPreviewHost] = useState<HTMLDivElement | null>(null);
  const [colorKey, setColorKey] = useState<ColorKey>(DEFAULT_COLOR_KEY);
  // True while the eyedropper waits for a click on the cut face.
  const [picking, setPicking] = useState(false);
  // Green cut-face outline and orange pivot line; hide them for a clean view.
  const [showGuides, setShowGuides] = useState(true);

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
    const cube = new CubeRenderer(canvas, volume.data, [64, 64, 64]);
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

  // Keep the WebGL drawing buffer matched to the canvas when its box changes
  // without a window resize (e.g. the export panel opening or closing).
  useEffect(() => {
    const canvas = cubeCanvasRef.current;
    if (!canvas || typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(() => cubeRef.current?.resize());
    ro.observe(canvas);
    return () => ro.disconnect();
  }, [webgl2Supported]);

  // Derived plane drives the renderer. The cut is always on; before the
  // user touches a plane control it stays parked near the start of the stack.
  useEffect(() => {
    cubeRef.current?.setPlane(normal, clampedOffset, true, plane.flip);
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

  // Keep the orange tilt-pivot marker on the cut face in sync.
  useEffect(() => {
    const plane3 = { azimuth: plane.azimuth, elevation: plane.elevation, offset: clampedOffset };
    // Drawn 1.5% inside the frame so it stays distinguishable from the outline at 0% / 100%.
    cubeRef.current?.setPivotLine(pivotSegment3D(plane3, half, 0.015 + pivot * 0.97));
  }, [plane.azimuth, plane.elevation, clampedOffset, half, pivot, volume]);

  // Viewer colour key; re-applied when a new volume (and renderer) is created.
  useEffect(() => {
    cubeRef.current?.setColorKey(colorKey);
  }, [colorKey, volume]);

  useEffect(() => {
    cubeRef.current?.setGuidesVisible(showGuides);
  }, [showGuides, volume]);

  // Escape cancels the eyedropper.
  useEffect(() => {
    if (!picking) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setPicking(false);
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [picking]);

  const handleCanvasClick = useCallback(
    (e: React.MouseEvent<HTMLCanvasElement>) => {
      if (!picking) return;
      const rgb = cubeRef.current?.pickPlaneColor(e.clientX, e.clientY);
      if (!rgb) return; // missed the cut face: keep waiting
      setColorKey((k) => ({ ...k, color: rgb, enabled: true }));
      setPicking(false);
    },
    [picking],
  );

  // Spacing/dims change the volume box and re-apply the current plane.
  useEffect(() => {
    cubeRef.current?.setSpacing(half);
    cubeRef.current?.setPlane(normal, clampedOffset, true, plane.flip);
  }, [half, normal, clampedOffset, plane.flip]);

  const ingest = useCallback(
    async (src: ClipSource) => {
      setIngesting(true);
      setProgress(0);
      try {
        const onProgress = (done: number, total: number) => setProgress(Math.round((done / total) * 100));
        const r =
          src.kind === 'video'
            ? await ingestVideo(src.file, rate, viewerRes, onProgress)
            : await ingestImages(src, rate, viewerRes, onProgress);
        const nextDims: Vec3 = [r.width, r.height, r.depth];
        const nextHalf = volumeHalfExtents(nextDims, spacing);
        const n = planeNormal(plane.azimuth, plane.elevation);

        cubeRef.current?.dispose();
        const cubeCanvas = cubeCanvasRef.current;
        if (cubeCanvas) {
          const cube = new CubeRenderer(cubeCanvas, r.data, nextDims);
          cube.setDensity(opacity);
          cube.setPlaneImageAlpha(planeImg);
          cube.setClipCube(!showClipped);
          cube.setSpacing(nextHalf);
          cube.setPlane(n, clampedOffset, true, plane.flip);
          cube.start();
          cubeRef.current = cube;
        }
        setDims(nextDims);
        setVolume({ data: r.data, dims: nextDims });
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Ingest failed.');
      } finally {
        setIngesting(false);
      }
    },
    [rate, viewerRes, spacing, opacity, planeImg, showClipped, plane.azimuth, plane.elevation, clampedOffset, plane.flip],
  );

  const ingestFiles = useCallback(
    (files: Iterable<File>) => {
      if (!cubeRef.current) return;
      const src = sourceFromFiles(files, seqFps);
      if (!src) {
        setError('No video or images found. Pick one video file, or two or more JPEG, PNG, WebP or AVIF images.');
        return;
      }
      lastFileRef.current = src;
      setSource(src);
      setRateDirty(false);
      setError(null);
      void ingest(src);
    },
    [ingest, seqFps],
  );

  const handleFile = useCallback(
    (e: ChangeEvent<HTMLInputElement>) => {
      const files = e.target.files;
      if (files?.length) ingestFiles([...files]);
      e.target.value = ''; // allow picking the same files again
    },
    [ingestFiles],
  );

  const handleDrop = useCallback(
    async (e: DragEvent<HTMLDivElement>) => {
      e.preventDefault();
      setDragOver(false);
      const files = await filesFromDataTransfer(e.dataTransfer);
      if (files.length) ingestFiles(files);
    },
    [ingestFiles],
  );

  const handleSeqFps = useCallback((v: number) => {
    setSeqFps(v);
    setSource((s) => {
      if (s?.kind !== 'images') return s;
      const next = { ...s, fps: v };
      lastFileRef.current = next;
      return next;
    });
  }, []);

  const handleRate = useCallback((v: number) => {
    setRate(v);
    if (lastFileRef.current) setRateDirty(true);
  }, []);

  const handleResample = useCallback(() => {
    const src = lastFileRef.current;
    if (!src) return;
    setRateDirty(false);
    void ingest(src);
  }, [ingest]);

  const handleOpacity = useCallback((v: number) => {
    setOpacity(v);
    cubeRef.current?.setDensity(v);
  }, []);

  const handlePlaneImg = useCallback((v: number) => {
    setPlaneImg(v);
    cubeRef.current?.setPlaneImageAlpha(v);
  }, []);

  const handleShowClipped = useCallback((show: boolean) => {
    setShowClipped(show);
    cubeRef.current?.setClipCube(!show);
  }, []);

  // A plane-control interaction hands the offset over to the user: the
  // parked default no longer follows dims/spacing changes.
  const updatePlane = useCallback((partial: Partial<PlaneState>) => {
    planeTouchedRef.current = true;
    setPlaneState((p) => ({ ...p, ...partial }));
  }, []);

  // Azimuth / elevation changes rotate the plane around the tilt pivot line,
  // so the moment shown at the pivot stays put while the plane tilts.
  const rotatePlane = useCallback(
    (angles: { azimuth?: number; elevation?: number }) => {
      planeTouchedRef.current = true;
      setPlaneState((p) => {
        const next = { azimuth: angles.azimuth ?? p.azimuth, elevation: angles.elevation ?? p.elevation };
        const prev = { azimuth: p.azimuth, elevation: p.elevation, offset: Math.min(reach, Math.max(-reach, p.offset)) };
        return { ...p, ...next, offset: offsetAboutPivot(prev, next, half, pivot) };
      });
    },
    [half, reach, pivot],
  );

  const handleViewerRes = useCallback((v: number) => {
    setViewerRes(v);
    if (lastFileRef.current) setRateDirty(true);
  }, []);

  // The export panel moves the plane in its own terms (azimuth, elevation, offset).
  const applyPlane = useCallback(
    (p: ViewerPlane) => updatePlane({ azimuth: p.azimuth, elevation: p.elevation, offset: p.offset, axis: null }),
    [updatePlane],
  );

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
                onDrop={(e) => void handleDrop(e)}
                className={cn(
                  'flex flex-col items-center gap-2 rounded-md border border-dashed p-4 transition-colors',
                  dragOver && 'border-primary bg-accent',
                )}
              >
                <span className="text-center text-xs text-muted-foreground">
                  {ingesting ? 'Sampling...' : 'Drop a video, images or a folder here'}
                </span>
                <div className="flex flex-wrap justify-center gap-1.5">
                  <Button asChild variant="outline" size="sm">
                    <label htmlFor="file" className="cursor-pointer">
                      Load video
                    </label>
                  </Button>
                  <Button asChild variant="outline" size="sm">
                    <label htmlFor="file-images" className="cursor-pointer" title="Select all images of a sequence">
                      Images
                    </label>
                  </Button>
                  <Button asChild variant="outline" size="sm">
                    <label htmlFor="file-folder" className="cursor-pointer" title="Pick a folder with an image sequence">
                      Folder
                    </label>
                  </Button>
                </div>
              </div>
              <input id="file" type="file" accept="video/*" className="hidden" onChange={handleFile} />
              <input
                id="file-images"
                type="file"
                accept="image/*"
                multiple
                className="hidden"
                onChange={handleFile}
              />
              <input
                id="file-folder"
                type="file"
                className="hidden"
                onChange={handleFile}
                {...({ webkitdirectory: '', directory: '' } as Record<string, string>)}
              />
              {source && (
                <span id="source-name" className="truncate px-0.5 text-[11px] text-muted-foreground">
                  {source.kind === 'images'
                    ? `${source.files.length} images | ${source.name}`
                    : source.file.name}
                </span>
              )}
              {source?.kind === 'images' && (
                <SliderRow
                  id="seq-fps"
                  label="Sequence frame rate"
                  unit="fps"
                  min={1}
                  max={60}
                  step={1}
                  value={seqFps}
                  onValueChange={handleSeqFps}
                />
              )}
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
              <div className="flex flex-col gap-1.5">
                <Label className="text-xs">Viewer resolution</Label>
                <div className="flex gap-1.5">
                  {VIEWER_RESOLUTIONS.map((r) => (
                    <Button
                      key={r}
                      data-res={r}
                      size="sm"
                      variant={viewerRes === r ? 'default' : 'outline'}
                      className="flex-1"
                      disabled={max3dTexture > 0 && r > max3dTexture}
                      onClick={() => handleViewerRes(r)}
                    >
                      {r} px
                    </Button>
                  ))}
                </div>
                <span className="text-[11px] leading-snug text-muted-foreground">
                  Sharper cut face and preview; uses more GPU memory. Export is always full resolution.
                </span>
              </div>
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
                label="Cube opacity"
                unit=""
                min={0.5}
                max={100}
                step={0.5}
                value={opacity}
                onValueChange={handleOpacity}
              />
              <SliderRow
                id="plane-img"
                label="Plane image opacity"
                unit=""
                min={0}
                max={100}
                step={1}
                value={planeImg}
                onValueChange={handlePlaneImg}
              />
              <SliderRow
                id="spacing"
                label="Spacing"
                unit={'\u00d7'}
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
                unit={'\u00b0'}
                min={-180}
                max={180}
                step={1}
                value={plane.azimuth}
                onValueChange={(v) => rotatePlane({ azimuth: v })}
              />
              <SliderRow
                id="elevation"
                label="Elevation"
                unit={'\u00b0'}
                min={-90}
                max={90}
                step={1}
                value={plane.elevation}
                onValueChange={(v) => rotatePlane({ elevation: v })}
              />
              <SliderRow
                id="pivot"
                label="Tilt pivot"
                unit="%"
                min={0}
                max={100}
                step={1}
                value={Math.round(pivot * 100)}
                onValueChange={(v) => setPivot(v / 100)}
              />
              <p className="-mt-1.5 text-[11px] leading-snug text-muted-foreground">
                Line the plane tilts around: 0% top, 50% centre, 100% bottom (at azimuth 0 deg). That line keeps its moment
                in time.
              </p>
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
              <div className="flex items-center gap-2">
                <Checkbox
                  id="show-clipped"
                  checked={showClipped}
                  onCheckedChange={(c) => handleShowClipped(c === true)}
                />
                <Label htmlFor="show-clipped" className="text-xs">
                  Show clipped side
                </Label>
              </div>
            </SidebarGroupContent>
          </SidebarGroup>

          <SidebarGroup>
            <SidebarGroupLabel>Tools</SidebarGroupLabel>
            <SidebarGroupContent className="flex flex-col gap-2">
              <Button
                id="open-key"
                size="sm"
                variant={rightPanel === 'key' ? 'default' : 'outline'}
                onClick={() => togglePanel('key')}
              >
                Colour key...{colorKey.enabled && ' (on)'}
              </Button>
              <p className="px-0.5 text-[11px] leading-snug text-muted-foreground">
                Hide or isolate a colour picked from the slice, e.g. hide the sky to see the clouds.
              </p>
              <Button
                id="open-export"
                size="sm"
                variant={exportOpen ? 'default' : 'outline'}
                onClick={() => togglePanel('export')}
              >
                Time-slice export...
              </Button>
              <p className="px-0.5 text-[11px] leading-snug text-muted-foreground">
                Sweep the slice plane through time and save every position as a frame of a new video.
              </p>
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
          onClick={handleCanvasClick}
          className={cn('absolute inset-0 h-full w-full', picking && 'cursor-crosshair')}
        />
        {exportOpen && viewMode === 'preview' && <div ref={setPreviewHost} className="absolute inset-0 z-10" />}
        {exportOpen && (
          <div className="absolute top-3 left-1/2 z-20 flex -translate-x-1/2 gap-1 rounded-lg border bg-card/90 p-1 shadow-md backdrop-blur">
            <Button
              id="view-3d"
              size="sm"
              variant={viewMode === '3d' ? 'default' : 'ghost'}
              onClick={() => setViewMode('3d')}
            >
              3D view
            </Button>
            <Button
              id="view-preview"
              size="sm"
              variant={viewMode === 'preview' ? 'default' : 'ghost'}
              onClick={() => setViewMode('preview')}
            >
              Time-slice preview
            </Button>
          </div>
        )}
      </SidebarInset>

      {rightPanel === 'key' && (
        <aside
          id="color-key-panel"
          className="flex h-svh w-[320px] shrink-0 flex-col border-l bg-sidebar text-sidebar-foreground"
        >
          <header className="flex items-center justify-between border-b px-4 py-3">
            <div>
              <h2 className="text-sm font-semibold tracking-tight">Colour key</h2>
              <p className="text-[11px] text-muted-foreground">Keys the 3D view; the export can use it too.</p>
            </div>
            <Button size="icon-sm" variant="ghost" onClick={() => setRightPanel('none')} aria-label="Close colour key">
              <X />
            </Button>
          </header>
          <div className="flex-1 overflow-y-auto px-4 py-4">
            <ColorKeyPanel
              value={colorKey}
              onChange={setColorKey}
              picking={picking}
              onPickToggle={() => {
                setViewMode('3d');
                setPicking((p) => !p);
              }}
              showGuides={showGuides}
              onShowGuidesChange={setShowGuides}
            />
          </div>
        </aside>
      )}

      {exportMounted && (
        <Suspense fallback={exportOpen ? <aside className="w-[360px] shrink-0 border-l bg-sidebar" /> : null}>
          <ExportPanel
            hidden={!exportOpen}
            source={source}
            volume={volume}
            half={half}
            plane={{ azimuth: plane.azimuth, elevation: plane.elevation, offset: clampedOffset }}
            onApplyPlane={applyPlane}
            pivot={pivot}
            previewHost={viewMode === 'preview' ? previewHost : null}
            colorKey={colorKey}
            onShowPreview={() => setViewMode('preview')}
            onClose={() => {
              setRightPanel('none');
              setViewMode('3d');
            }}
          />
        </Suspense>
      )}
    </SidebarProvider>
  );
}

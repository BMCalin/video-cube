/**
 * Time-slice animation model.
 *
 * The video volume has two spatial axes (x, y) and one time axis (z). A slice
 * plane that is perpendicular to the time axis shows one ordinary video frame.
 * Tilting the plane makes every row (or column) of the output image come from
 * a different moment: a time gradient across the picture.
 *
 * For export we describe a plane in time terms rather than 3D terms, so the
 * result does not depend on the viewer's "Spacing" setting:
 *
 *   - `time`    the moment shown at the tilt pivot (by default the centre of
 *               the frame), normalised to the clip: 0 = first frame,
 *               1 = last frame.
 *   - `span`    how much clip time the plane covers from one edge of the
 *               frame to the opposite edge, in the same normalised units.
 *               0 = an ordinary frame. Negative values reverse the gradient.
 *   - `azimuth` direction of the gradient in degrees, using the same
 *               convention as the viewer's Azimuth slider.
 *
 * For a pixel at aspect-preserving image coordinates (X, Y), centred on the
 * frame with Y pointing up, the sampled clip time is
 *
 *   tau(X, Y) = time - span * (sin(az) * X + cos(az) * Y) / R
 *   R         = |sin(az)| * aspectX + |cos(az)| * aspectY
 *
 * R is the extent of the frame along the gradient direction, so the earliest
 * and latest moments visible in one output frame are exactly `|span|` apart.
 *
 * The tilt pivot is the line across the frame that keeps its moment while the
 * span changes, given as a fraction along the gradient direction: 0 = the edge
 * the azimuth points to (the top for azimuth 0), 0.5 = the centre, 1 = the
 * opposite edge (the bottom for azimuth 0). Internally everything is
 * converted to the centre time, which is what the renderer uses.
 */
import type { Vec3 } from '@/render/linalg';

export interface SliceKeyframe {
  /** Clip time at the tilt pivot, 0..1. */
  time: number;
  /** Signed clip time covered edge to edge, in clip units (1 = whole clip). */
  span: number;
  /** Gradient direction in degrees (viewer azimuth convention). */
  azimuth: number;
}

export type Easing = 'linear' | 'easeIn' | 'easeOut' | 'easeInOut';

export const EASINGS: { id: Easing; label: string }[] = [
  { id: 'linear', label: 'Linear' },
  { id: 'easeInOut', label: 'Ease in-out' },
  { id: 'easeIn', label: 'Ease in' },
  { id: 'easeOut', label: 'Ease out' },
];

export interface SliceAnimation {
  start: SliceKeyframe;
  end: SliceKeyframe;
  /** Easing for the tilt (span) and direction transition. Time always moves linearly. */
  easing: Easing;
  /**
   * When true, the centre time is remapped so the whole slice stays inside
   * the clip: no pixel ever needs a moment before the first frame or after
   * the last one. The sweep becomes slightly shorter as the span grows.
   */
  fit: boolean;
  /** Tilt pivot along the gradient direction, 0..1 (0.5 = frame centre). */
  pivot: number;
}

/**
 * Resolved slice for one output frame. `time` is the clip time at the frame
 * centre and already includes the pivot shift and the fit remap.
 */
export interface SliceParams {
  time: number;
  span: number;
  azimuth: number;
}

export const DEFAULT_ANIMATION: SliceAnimation = {
  start: { time: 0, span: 0, azimuth: 0 },
  end: { time: 1, span: 0, azimuth: 0 },
  easing: 'linear',
  fit: true,
  pivot: 0.5,
};

const DEG = Math.PI / 180;

const lerp = (a: number, b: number, t: number): number => a + (b - a) * t;

/**
 * Interpolate between two angles in degrees along the shorter way around the
 * circle, so -170 -> 170 sweeps 20 degrees through +/-180 rather than 340
 * degrees through 0. The result is wrapped into [-180, 180].
 */
export function lerpAngle(a: number, b: number, t: number): number {
  const delta = ((((b - a + 180) % 360) + 360) % 360) - 180;
  return wrapDegrees(a + delta * t);
}

export function ease(kind: Easing, t: number): number {
  const x = Math.min(1, Math.max(0, t));
  switch (kind) {
    case 'easeIn':
      return x * x * x;
    case 'easeOut':
      return 1 - (1 - x) ** 3;
    case 'easeInOut':
      return x < 0.5 ? 4 * x * x * x : 1 - (-2 * x + 2) ** 3 / 2;
    default:
      return x;
  }
}

/**
 * Remap a centre time so that [time - |span|/2, time + |span|/2] stays inside
 * [0, 1]. Spans wider than the clip cannot fit and are centred.
 */
export function fitCenter(time: number, span: number): number {
  const a = Math.abs(span);
  if (a >= 1) return 0.5;
  return a / 2 + Math.min(1, Math.max(0, time)) * (1 - a);
}

/**
 * Offset from the pivot time to the centre time:
 * centre = pivotTime + pivotShift(span, pivot).
 */
export function pivotShift(span: number, pivot: number): number {
  return span * (0.5 - pivot);
}

/**
 * Remap a pivot time so the whole slice stays inside [0, 1]. The pivot sweeps
 * the range that keeps both the earliest and the latest moment in the clip.
 * With the pivot at the centre this is exactly fitCenter().
 */
export function fitPivotTime(pivotTime: number, span: number, pivot: number): number {
  const a = Math.abs(span);
  const shift = pivotShift(span, pivot);
  if (a >= 1) return 0.5 - shift; // too wide to fit: centre the slice
  const before = a / 2 - shift; // clip time needed before the pivot moment
  return before + Math.min(1, Math.max(0, pivotTime)) * (1 - a);
}

/** Slice parameters at animation progress `p` (0 = first frame, 1 = last). */
export function sliceAt(anim: SliceAnimation, p: number): SliceParams {
  const t = Math.min(1, Math.max(0, p));
  const shape = ease(anim.easing, t);
  const span = lerp(anim.start.span, anim.end.span, shape);
  const azimuth = lerpAngle(anim.start.azimuth, anim.end.azimuth, shape);
  const linearTime = lerp(anim.start.time, anim.end.time, t);
  const pivotTime = anim.fit ? fitPivotTime(linearTime, span, anim.pivot) : linearTime;
  return { time: pivotTime + pivotShift(span, anim.pivot), span, azimuth };
}

/** Progress value for output frame `i` of `count`. */
export function frameProgress(i: number, count: number): number {
  return count <= 1 ? 0 : i / (count - 1);
}

/** Earliest and latest clip time touched by one output frame (may exceed 0..1). */
export function sliceTimeRange(s: SliceParams): [number, number] {
  const h = Math.abs(s.span) / 2;
  return [s.time - h, s.time + h];
}

/**
 * Source frame indices (inclusive) needed to render the given output frames
 * from a stack of `sourceCount` frames. Frame k is centred at (k + 0.5) / N.
 */
export function sourceFrameRange(
  anim: SliceAnimation,
  outputFrames: number[],
  outputCount: number,
  sourceCount: number,
): [number, number] {
  let lo = Infinity;
  let hi = -Infinity;
  for (const i of outputFrames) {
    const [a, b] = sliceTimeRange(sliceAt(anim, frameProgress(i, outputCount)));
    lo = Math.min(lo, a);
    hi = Math.max(hi, b);
  }
  const k0 = Math.floor(lo * sourceCount - 0.5);
  const k1 = Math.ceil(hi * sourceCount - 0.5);
  const last = sourceCount - 1;
  return [Math.min(last, Math.max(0, k0)), Math.min(last, Math.max(0, k1))];
}

/** Aspect-preserving frame extent along the gradient direction (R above). */
export function gradientExtent(azimuthDeg: number, aspectX: number, aspectY: number): number {
  const a = azimuthDeg * DEG;
  return Math.abs(Math.sin(a)) * aspectX + Math.abs(Math.cos(a)) * aspectY;
}

/** Wrap an angle into [-180, 180]. */
export function wrapDegrees(d: number): number {
  const w = ((((d + 180) % 360) + 360) % 360) - 180;
  return w === -180 && d > 0 ? 180 : w;
}

/** A plane as the viewer describes it (degrees, world-space offset). */
export interface ViewerPlane {
  azimuth: number;
  elevation: number;
  offset: number;
}

/**
 * Convert the viewer's slice plane into a keyframe whose time is measured at
 * `pivot`. `half` is the world-space half extent of the volume box (see
 * volumeHalfExtents). Returns null when the plane is (almost) parallel to the
 * time axis: such a plane does not map each pixel to a single moment.
 */
export function keyframeFromPlane(plane: ViewerPlane, half: Vec3, pivot = 0.5): SliceKeyframe | null {
  const el = plane.elevation * DEG;
  const nz = Math.sin(el);
  if (Math.abs(nz) < 0.02) return null;
  const zc = plane.offset / nz;
  const time = (zc + half[2]) / (2 * half[2]);
  const R = gradientExtent(plane.azimuth, 2 * half[0], 2 * half[1]);
  const span = ((Math.cos(el) / nz) * R) / (2 * half[2]);
  return { time: time - pivotShift(span, pivot), span, azimuth: plane.azimuth };
}

/**
 * Viewer plane for a resolved slice (centre time, as returned by sliceAt),
 * normalised to elevation in (0, 90].
 */
export function planeFromKeyframe(kf: SliceParams, half: Vec3): ViewerPlane {
  let { span, azimuth } = kf;
  if (span < 0) {
    span = -span;
    azimuth = wrapDegrees(azimuth + 180);
  }
  const R = gradientExtent(azimuth, 2 * half[0], 2 * half[1]);
  const el = Math.atan2(R, span * 2 * half[2]);
  const zc = kf.time * 2 * half[2] - half[2];
  return { azimuth, elevation: el / DEG, offset: zc * Math.sin(el) };
}

/** Tilt away from an ordinary frame, in degrees, as it appears in the 3D view. */
export function tiltDegrees(kf: SliceParams, half: Vec3): number {
  return 90 - planeFromKeyframe(kf, half).elevation;
}

/**
 * World-space point on the viewer plane that lies on the tilt pivot line, or
 * null when the plane is parallel to the time axis.
 */
export function pivotPoint(plane: ViewerPlane, half: Vec3, pivot: number): Vec3 | null {
  const az = plane.azimuth * DEG;
  const el = plane.elevation * DEG;
  const n: Vec3 = [Math.cos(el) * Math.sin(az), Math.cos(el) * Math.cos(az), Math.sin(el)];
  if (Math.abs(n[2]) < 1e-3) return null;
  const proj = (0.5 - pivot) * gradientExtent(plane.azimuth, 2 * half[0], 2 * half[1]);
  const px = proj * Math.sin(az);
  const py = proj * Math.cos(az);
  return [px, py, (plane.offset - n[0] * px - n[1] * py) / n[2]];
}

/**
 * Offset that keeps the tilt pivot of `prev` on the plane after its angles
 * change to `next`, so tilting rotates the plane around the pivot line instead
 * of around the centre of the cube.
 */
export function offsetAboutPivot(
  prev: ViewerPlane,
  next: { azimuth: number; elevation: number },
  half: Vec3,
  pivot: number,
): number {
  const p = pivotPoint(prev, half, pivot);
  if (!p) return prev.offset;
  const az = next.azimuth * DEG;
  const el = next.elevation * DEG;
  return Math.cos(el) * Math.sin(az) * p[0] + Math.cos(el) * Math.cos(az) * p[1] + Math.sin(el) * p[2];
}

type Point2 = [number, number];

/**
 * The tilt pivot line clipped to a frame with half extents (hx, hy), in the
 * same centred, Y-up units as the time formula above. Null when the line
 * misses the frame.
 */
export function pivotSegment2D(azimuthDeg: number, pivot: number, hx: number, hy: number): [Point2, Point2] | null {
  const a = azimuthDeg * DEG;
  const sa = Math.sin(a);
  const ca = Math.cos(a);
  const proj = (0.5 - pivot) * gradientExtent(azimuthDeg, 2 * hx, 2 * hy);
  const base: Point2 = [proj * sa, proj * ca];
  const dir: Point2 = [ca, -sa]; // along the pivot line, perpendicular to the gradient
  let t0 = -Infinity;
  let t1 = Infinity;
  const lim = [hx, hy];
  for (let k = 0; k < 2; k++) {
    if (Math.abs(dir[k]) < 1e-9) {
      if (Math.abs(base[k]) > lim[k] + 1e-9) return null;
      continue;
    }
    let u = (-lim[k] - base[k]) / dir[k];
    let v = (lim[k] - base[k]) / dir[k];
    if (u > v) [u, v] = [v, u];
    t0 = Math.max(t0, u);
    t1 = Math.min(t1, v);
  }
  if (!(t1 >= t0 - 1e-9)) return null;
  if (t1 < t0) t1 = t0; // touches a corner: degenerate segment
  return [
    [base[0] + t0 * dir[0], base[1] + t0 * dir[1]],
    [base[0] + t1 * dir[0], base[1] + t1 * dir[1]],
  ];
}

/** The tilt pivot line on the viewer's slice plane, clipped to the volume box. */
export function pivotSegment3D(plane: ViewerPlane, half: Vec3, pivot: number): [Vec3, Vec3] | null {
  const p = pivotPoint(plane, half, pivot);
  if (!p || Math.abs(p[2]) > half[2]) return null;
  const seg = pivotSegment2D(plane.azimuth, pivot, half[0], half[1]);
  if (!seg) return null;
  return [
    [seg[0][0], seg[0][1], p[2]],
    [seg[1][0], seg[1][1], p[2]],
  ];
}

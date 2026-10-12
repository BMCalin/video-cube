# Video Cube Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Browser app that stacks video frames into a rotatable, translucent 3D volume with a slice plane and live reslice image export.

**Architecture:** Pure client-side SPA. Video frames are sampled, downscaled, packed RGB, and uploaded once as a WebGL2 `TEXTURE_3D` (x,y = pixels, z = time). The cube is one box rasterized BackSide with a raymarching fragment shader (front-to-back alpha compositing); the slice plane clips the march interval in-shader and drives a second pass that samples the volume across the plane into a reslice canvas. Pure math (ray-box, plane clipping, reslice basis, plane-cube polygon) lives in dependency-free modules under unit test.

**Tech Stack:** Vite + TypeScript (strict), Three.js (GLSL3 `ShaderMaterial`, OrbitControls), WebGL2 `TEXTURE_3D` RGB8, Vitest.

**Spec:** `docs/superpowers/specs/2026-10-11-video-cube-design.md`

## Global Constraints

- Pure client-side; no backend, no network calls at runtime.
- TypeScript `strict: true`. GL-dependent code must not be imported by pure-math modules (`linalg`, `rayMath`, `resliceMath`, `sampler`, `packVolume`).
- Volume: RGB8 `TEXTURE_3D`, `UNPACK_ALIGNMENT 1`, max frame dim 256, frame count default 96 (range 16-192).
- Raymarch: unit cube (half-size 0.5, centered at origin); time axis = z; image v-flip in shader (`uvw.y = 0.5 - p.y`).
- Work on feature branch `feat/video-cube` (never commit to `main`); conventional commit messages (`feat:`, `test:`, `chore:`); no `Co-Authored-By` trailers.
- Run tests with `npm test`, dev server with `npm run dev`.

---

### Task 1: Project scaffold + app shell

**Files:**
- Create: `package.json`, `tsconfig.json`, `vite.config.ts`, `index.html`, `src/main.ts`, `src/style.css`, `tests/sanity.test.ts`

**Interfaces:**
- Produces: runnable Vite app; `npm test` executes Vitest.

- [ ] **Step 1: Create package.json**

```json
{
  "name": "video-cube",
  "private": true,
  "version": "0.1.0",
  "type": "module",
  "scripts": {
    "dev": "vite",
    "build": "tsc && vite build",
    "preview": "vite preview",
    "test": "vitest run"
  }
}
```

- [ ] **Step 2: Install dependencies**

Run: `npm install --save three@^0.180.0 && npm install --save-dev vite@^6.3.0 typescript@^5.8.0 vitest@^3.1.0 @types/three@^0.180.0`
Expected: installs without errors.

- [ ] **Step 3: Create tsconfig.json**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "bundler",
    "lib": ["ES2022", "DOM", "DOM.Iterable"],
    "strict": true,
    "noUnusedLocals": true,
    "noEmit": true,
    "skipLibCheck": true
  },
  "include": ["src", "tests"]
}
```

- [ ] **Step 4: Create vite.config.ts**

```ts
import { defineConfig } from 'vite';

export default defineConfig({});
```

- [ ] **Step 5: Create index.html**

```html
<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>Video Cube</title>
  </head>
  <body>
    <div id="msg" hidden></div>
    <main>
      <canvas id="cube" width="800" height="600"></canvas>
      <aside>
        <canvas id="reslice" width="320" height="320" hidden></canvas>
        <section id="controls" hidden>
          <label>Video <input id="file" type="file" accept="video/*" /></label>
          <label>Frames <input id="frames" type="number" min="16" max="192" step="1" value="96" /></label>
          <label>Opacity <input id="opacity" type="range" min="0.5" max="40" step="0.5" value="8" /></label>
          <div id="plane-ui" hidden>
            <button data-axis="x">X</button>
            <button data-axis="y">Y</button>
            <button data-axis="z">Z</button>
            <label>Position <input id="offset" type="range" min="-0.87" max="0.87" step="0.005" value="0" /></label>
            <label>Azimuth <input id="azimuth" type="range" min="-180" max="180" step="1" value="0" /></label>
            <label>Elevation <input id="elevation" type="range" min="-89" max="89" step="1" value="0" /></label>
            <button id="download" hidden>Download reslice PNG</button>
          </div>
        </section>
        <div id="progress" hidden>Sampling <span id="progress-num">0</span>%</div>
      </aside>
    </main>
    <script type="module" src="/src/main.ts"></script>
  </body>
</html>
```

- [ ] **Step 6: Create src/style.css**

```css
:root { color-scheme: dark; font-family: system-ui, sans-serif; }
body { margin: 0; background: #111; color: #ddd; }
main { display: grid; grid-template-columns: 1fr 340px; height: 100vh; }
#cube { width: 100%; height: 100%; display: block; }
aside { padding: 12px; display: flex; flex-direction: column; gap: 12px; }
#reslice { width: 320px; height: 320px; background: #000; }
label { display: flex; flex-direction: column; gap: 4px; font-size: 13px; }
#msg { position: fixed; inset-block-start: 8px; inset-inline: 8px; background: #5b1d1d; color: #fff; padding: 8px 12px; border-radius: 6px; }
#progress { font-size: 13px; }
```

- [ ] **Step 7: Create src/main.ts (stub) and tests/sanity.test.ts**

`src/main.ts`:
```ts
import './style.css';

const msg = document.querySelector<HTMLElement>('#msg')!;
if (!document.createElement('canvas').getContext('webgl2')) {
  msg.textContent = 'WebGL2 is required but not available in this browser.';
  msg.hidden = false;
}
```

`tests/sanity.test.ts`:
```ts
import { describe, it, expect } from 'vitest';

describe('sanity', () => {
  it('runs', () => {
    expect(1 + 1).toBe(2);
  });
});
```

- [ ] **Step 8: Create feature branch and verify**

Run: `git checkout -b feat/video-cube && npm test && (npm run dev & sleep 3 && curl -s http://localhost:5173 | grep -q video-cube && echo DEV_OK; kill %1)`
Expected: test passes; `DEV_OK` printed. Stop the dev server afterward.

- [ ] **Step 9: Commit**

```bash
git add package.json package-lock.json tsconfig.json vite.config.ts index.html src tests .gitignore
git commit -m "chore: scaffold vite + typescript + vitest app shell"
```

(Create `.gitignore` with `node_modules/` and `dist/` before committing.)

---

### Task 2: Frame timestamp sampler

**Files:**
- Create: `src/ingest/sampler.ts`
- Test: `tests/sampler.test.ts`

**Interfaces:**
- Produces: `sampleTimestamps(duration: number, count: number): number[]` — midpoints of `count` equal bins across `[0, duration]`, ascending; `[]` for invalid input.

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect } from 'vitest';
import { sampleTimestamps } from '../src/ingest/sampler';

describe('sampleTimestamps', () => {
  it('returns count timestamps', () => {
    expect(sampleTimestamps(10, 4)).toHaveLength(4);
  });

  it('uses bin midpoints', () => {
    expect(sampleTimestamps(10, 4)).toEqual([1.25, 3.75, 6.25, 8.75]);
  });

  it('is ascending and inside [0, duration]', () => {
    const ts = sampleTimestamps(7, 96);
    for (let i = 1; i < ts.length; i++) expect(ts[i]).toBeGreaterThan(ts[i - 1]);
    for (const t of ts) {
      expect(t).toBeGreaterThan(0);
      expect(t).toBeLessThan(7);
    }
  });

  it('returns empty for invalid input', () => {
    expect(sampleTimestamps(0, 10)).toEqual([]);
    expect(sampleTimestamps(-1, 10)).toEqual([]);
    expect(sampleTimestamps(10, 0)).toEqual([]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- sampler`
Expected: FAIL — cannot resolve `../src/ingest/sampler`.

- [ ] **Step 3: Write implementation**

```ts
/** Midpoint of each of `count` equal time bins across the duration. */
export function sampleTimestamps(duration: number, count: number): number[] {
  if (count < 1 || !(duration > 0)) return [];
  return Array.from({ length: count }, (_, i) => ((i + 0.5) * duration) / count);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- sampler`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add src/ingest/sampler.ts tests/sampler.test.ts
git commit -m "feat: frame timestamp sampler"
```

---

### Task 3: Volume packing

**Files:**
- Create: `src/ingest/packVolume.ts`
- Test: `tests/packVolume.test.ts`

**Interfaces:**
- Consumes: per-frame RGBA `Uint8ClampedArray` (from canvas `getImageData`).
- Produces: `packVolume(frames: Uint8ClampedArray[], width: number, height: number): Uint8Array` — depth-major RGB byte volume, stride `width * 3`, ready for `texImage3D`.

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect } from 'vitest';
import { packVolume } from '../src/ingest/packVolume';

describe('packVolume', () => {
  it('drops alpha and orders z-major with RGB stride', () => {
    // 1x1x2: frame 0 red, frame 1 green
    const f0 = new Uint8ClampedArray([255, 0, 0, 128]);
    const f1 = new Uint8ClampedArray([0, 255, 0, 200]);
    expect(packVolume([f0, f1], 1, 1)).toEqual(new Uint8Array([255, 0, 0, 0, 255, 0]));
  });

  it('is row-major within a frame', () => {
    // 2x1x1: pixel 0 = RGBA(1,2,3,9), pixel 1 = RGBA(4,5,6,9)
    const f = new Uint8ClampedArray([1, 2, 3, 9, 4, 5, 6, 9]);
    expect(packVolume([f], 2, 1)).toEqual(new Uint8Array([1, 2, 3, 4, 5, 6]));
  });

  it('sizes output to w*h*d*3', () => {
    const f = new Uint8ClampedArray(4 * 3 * 4);
    expect(packVolume([f, f], 4, 3)).toHaveLength(4 * 3 * 2 * 3);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- packVolume`
Expected: FAIL — cannot resolve module.

- [ ] **Step 3: Write implementation**

```ts
/** Pack RGBA frames into a depth-major RGB byte volume for TEXTURE_3D upload. */
export function packVolume(
  frames: Uint8ClampedArray[],
  width: number,
  height: number,
): Uint8Array {
  const out = new Uint8Array(width * height * frames.length * 3);
  let o = 0;
  for (const f of frames) {
    const px = width * height;
    for (let i = 0; i < px; i++) {
      out[o++] = f[i * 4];
      out[o++] = f[i * 4 + 1];
      out[o++] = f[i * 4 + 2];
    }
  }
  return out;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- packVolume`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add src/ingest/packVolume.ts tests/packVolume.test.ts
git commit -m "feat: RGB volume packing from RGBA frames"
```

---

### Task 4: Video ingest pipeline

**Files:**
- Create: `src/ingest/ingestVideo.ts`

**Interfaces:**
- Consumes: `sampleTimestamps` (Task 2), `packVolume` (Task 3).
- Produces: `ingestVideo(file: File, count: number, maxDim?: number, onProgress?: (done: number, total: number) => void): Promise<IngestResult>` where `IngestResult = { data: Uint8Array; width: number; height: number; depth: number }`.

- [ ] **Step 1: Write implementation**

```ts
import { sampleTimestamps } from './sampler';
import { packVolume } from './packVolume';

export interface IngestResult {
  data: Uint8Array;
  width: number;
  height: number;
  depth: number;
}

/** Seek is unreliable at the exact last frame; clamp into the file. */
function seek(video: HTMLVideoElement, t: number): Promise<void> {
  return new Promise((resolve) => {
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
}

export async function ingestVideo(
  file: File,
  count: number,
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
    const stamps = sampleTimestamps(video.duration, count);
    const frames: Uint8ClampedArray[] = [];
    for (let i = 0; i < stamps.length; i++) {
      await seek(video, stamps[i]);
      ctx.drawImage(video, 0, 0, width, height);
      frames.push(ctx.getImageData(0, 0, width, height).data);
      onProgress?.(i + 1, stamps.length);
    }
    return { data: packVolume(frames, width, height), width, height, depth: frames.length };
  } finally {
    URL.revokeObjectURL(url);
  }
}
```

- [ ] **Step 2: Typecheck**

Run: `npx tsc`
Expected: no errors.

- [ ] **Step 3: Manual browser smoke (deferred wiring is fine)**

This module touches `HTMLVideoElement` and cannot run under Vitest. Verify in Task 7 when wired to the file input; for now confirm typecheck passes and the seek/progress logic reads correct.

- [ ] **Step 4: Commit**

```bash
git add src/ingest/ingestVideo.ts
git commit -m "feat: video ingest with frame sampling and progress"
```

---

### Task 5: Vector + ray math (pure)

**Files:**
- Create: `src/render/linalg.ts`, `src/render/rayMath.ts`
- Test: `tests/rayMath.test.ts`

**Interfaces:**
- Produces:
  - `type Vec3 = [number, number, number]`
  - `dot(a: Vec3, b: Vec3): number`, `sub`, `cross`, `normalize(a: Vec3): Vec3`
  - `rayBox(ro: Vec3, rd: Vec3, half?: number): [t0: number, t1: number] | null` — slab intersection with axis-aligned cube `[-half, half]^3`, entry clamped to 0
  - `clipRayToHalfSpace(ro: Vec3, rd: Vec3, n: Vec3, d: number, iv: [number, number]): [number, number] | null` — keeps the half-space `dot(p, n) >= d` when the ray origin is in it, else `dot(p, n) <= d`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect } from 'vitest';
import { rayBox, clipRayToHalfSpace } from '../src/render/rayMath';
import { normalize } from '../src/render/linalg';
import type { Vec3 } from '../src/render/linalg';

describe('rayBox', () => {
  it('hits centered cube from outside', () => {
    const iv = rayBox([2, 0, 0], [-1, 0, 0]);
    expect(iv).toEqual([1.5, 2.5]);
  });

  it('misses when parallel and off-axis', () => {
    expect(rayBox([2, 2, 0], [-1, 0, 0])).toBeNull();
  });

  it('starts at 0 when origin inside', () => {
    const iv = rayBox([0, 0, 0], [1, 0, 0]);
    expect(iv).toEqual([0, 0.5]);
  });
});

describe('clipRayToHalfSpace', () => {
  const iv: [number, number] = [0, 10];
  it('keeps near half when origin on positive side', () => {
    // plane x=2 (n=[1,0,0]), ro x=4 -> keep x>=2; ray -x direction: valid [0,2]
    const out = clipRayToHalfSpace([4, 0, 0], [-1, 0, 0], [1, 0, 0], 2, iv);
    expect(out).toEqual([0, 2]);
  });

  it('cuts entry when ray moves away from kept side', () => {
    // ro x=1, ray +x: kept x>=2 -> starts at 2
    const out = clipRayToHalfSpace([1, 0, 0], [1, 0, 0], [1, 0, 0], 2, iv);
    expect(out).toEqual([2, 10]);
  });

  it('returns null when parallel and outside kept side', () => {
    const out = clipRayToHalfSpace([0, 0, 0], [0, 1, 0], [1, 0, 0], 2, iv);
    expect(out).toBeNull();
  });

  it('keeps opposite side when origin below plane', () => {
    const out = clipRayToHalfSpace([0, 0, 0], [1, 0, 0], [1, 0, 0], 2, iv);
    expect(out).toEqual([0, 2]);
  });
});

describe('normalize', () => {
  it('unit length', () => {
    const n: Vec3 = normalize([3, 0, 4]);
    expect(n[0]).toBeCloseTo(0.6);
    expect(n[2]).toBeCloseTo(0.8);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- rayMath`
Expected: FAIL — modules missing.

- [ ] **Step 3: Write implementations**

`src/render/linalg.ts`:
```ts
export type Vec3 = [number, number, number];

export const dot = (a: Vec3, b: Vec3): number => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];

export const sub = (a: Vec3, b: Vec3): Vec3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];

export const cross = (a: Vec3, b: Vec3): Vec3 => [
  a[1] * b[2] - a[2] * b[1],
  a[2] * b[0] - a[0] * b[2],
  a[0] * b[1] - a[1] * b[0],
];

export function normalize(a: Vec3): Vec3 {
  const len = Math.hypot(a[0], a[1], a[2]) || 1;
  return [a[0] / len, a[1] / len, a[2] / len];
}
```

`src/render/rayMath.ts`:
```ts
import { dot } from './linalg';
import type { Vec3 } from './linalg';

/** Slab test against the axis-aligned cube [-half, half]^3; entry clamped at 0. */
export function rayBox(ro: Vec3, rd: Vec3, half = 0.5): [number, number] | null {
  let t0 = -Infinity;
  let t1 = Infinity;
  for (let i = 0; i < 3; i++) {
    if (Math.abs(rd[i]) < 1e-9) {
      if (ro[i] < -half || ro[i] > half) return null;
      continue;
    }
    let a = (-half - ro[i]) / rd[i];
    let b = (half - ro[i]) / rd[i];
    if (a > b) [a, b] = [b, a];
    t0 = Math.max(t0, a);
    t1 = Math.min(t1, b);
  }
  return t1 > Math.max(t0, 0) ? [Math.max(t0, 0), t1] : null;
}

/**
 * Intersect the march interval with the half-space on the ray-origin side of
 * the plane { p : dot(p, n) = d }. Plane normal must be unit length.
 */
export function clipRayToHalfSpace(
  ro: Vec3,
  rd: Vec3,
  n: Vec3,
  d: number,
  iv: [number, number],
): [number, number] | null {
  let [t0, t1] = iv;
  const f0 = dot(ro, n) - d;
  const dn = dot(rd, n);
  if (Math.abs(dn) < 1e-9) return f0 >= 0 ? [t0, t1] : null;
  const tc = (d - dot(ro, n)) / dn;
  if (dn > 0 === f0 >= 0) t0 = Math.max(t0, tc);
  else t1 = Math.min(t1, tc);
  return t1 > t0 ? [t0, t1] : null;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- rayMath`
Expected: PASS (7 tests).

- [ ] **Step 5: Commit**

```bash
git add src/render/linalg.ts src/render/rayMath.ts tests/rayMath.test.ts
git commit -m "feat: ray-box and half-space clipping math"
```

---

### Task 6: Reslice basis + plane-cube polygon (pure)

**Files:**
- Create: `src/render/resliceMath.ts`
- Test: `tests/resliceMath.test.ts`

**Interfaces:**
- Consumes: `dot`, `cross`, `normalize`, `Vec3` from `src/render/linalg.ts`.
- Produces:
  - `resliceBasis(n: Vec3): { u: Vec3; v: Vec3 }` — orthonormal in-plane axes; z-axis fallback when `n` is parallel to time axis
  - `normalFromAngles(azimuth: number, elevation: number): Vec3` — radians, unit length
  - `planeCubePolygon(n: Vec3, d: number, half?: number): Vec3[]` — plane ∩ cube boundary, wound by angle around centroid; `[]` when no intersection

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect } from 'vitest';
import { resliceBasis, normalFromAngles, planeCubePolygon } from '../src/render/resliceMath';
import { dot } from '../src/render/linalg';

describe('resliceBasis', () => {
  it('orthonormal for arbitrary normal', () => {
    const { u, v } = resliceBasis([0.3, -0.5, 0.8]);
    expect(dot(u, v)).toBeCloseTo(0);
    expect(Math.hypot(...u)).toBeCloseTo(1);
    expect(Math.hypot(...v)).toBeCloseTo(1);
    expect(dot(u, [0.3, -0.5, 0.8])).toBeCloseTo(0);
    expect(dot(v, [0.3, -0.5, 0.8])).toBeCloseTo(0);
  });

  it('falls back for time-aligned normal', () => {
    const { u, v } = resliceBasis([0, 0, 1]);
    expect(u).toEqual([1, 0, 0]);
    expect(v).toEqual([0, 1, 0]);
  });
});

describe('normalFromAngles', () => {
  it('unit length and matches spherical definition', () => {
    const n = normalFromAngles(Math.PI / 2, 0);
    expect(n[0]).toBeCloseTo(1);
    expect(n[2]).toBeCloseTo(0);
    const m = normalFromAngles(0.7, -0.3);
    expect(Math.hypot(...m)).toBeCloseTo(1);
  });
});

describe('planeCubePolygon', () => {
  it('center plane through x gives 4-gon', () => {
    const poly = planeCubePolygon([1, 0, 0], 0);
    expect(poly).toHaveLength(4);
  });

  it('vertices lie on plane and inside cube', () => {
    const n = normalFromAngles(0.9, 0.4);
    const poly = planeCubePolygon(n, 0.2);
    expect(poly.length).toBeGreaterThanOrEqual(3);
    for (const p of poly) {
      expect(dot(p, n)).toBeCloseTo(0.2);
      for (const c of p) expect(Math.abs(c)).toBeLessThanOrEqual(0.5 + 1e-9);
    }
  });

  it('empty when plane misses cube', () => {
    expect(planeCubePolygon([1, 0, 0], 2)).toEqual([]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- resliceMath`
Expected: FAIL — module missing.

- [ ] **Step 3: Write implementation**

```ts
import { dot, cross, normalize, sub } from './linalg';
import type { Vec3 } from './linalg';

/** Orthonormal in-plane axes for sampling the reslice image. */
export function resliceBasis(n: Vec3): { u: Vec3; v: Vec3 } {
  const z: Vec3 = [0, 0, 1];
  if (Math.abs(dot(n, z)) > 0.999) return { u: [1, 0, 0], v: [0, 1, 0] };
  const u = normalize(cross(z, n));
  const v = normalize(cross(n, u));
  return { u, v };
}

/** Slice-plane normal from azimuth/elevation in radians. */
export function normalFromAngles(azimuth: number, elevation: number): Vec3 {
  const ce = Math.cos(elevation);
  return [ce * Math.sin(azimuth), ce * Math.cos(azimuth), Math.sin(elevation)];
}

/**
 * Cross-section of the cube [-half, half]^3 by the plane dot(p, n) = d,
 * vertices ordered by angle around the section centroid.
 */
export function planeCubePolygon(n: Vec3, d: number, half = 0.5): Vec3[] {
  const corners: Vec3[] = [];
  for (const x of [-half, half])
    for (const y of [-half, half]) for (const z of [-half, half]) corners.push([x, y, z]);
  const pts: Vec3[] = [];
  for (let i = 0; i < 8; i++) {
    for (let j = i + 1; j < 8; j++) {
      let axisDiff = 0;
      for (let k = 0; k < 3; k++) if (corners[i][k] !== corners[j][k]) axisDiff++;
      if (axisDiff !== 1) continue; // cube edges only
      const f1 = dot(corners[i], n) - d;
      const f2 = dot(corners[j], n) - d;
      if (f1 < 0 === f2 < 0) continue;
      const t = f1 / (f1 - f2);
      pts.push([
        corners[i][0] + t * (corners[j][0] - corners[i][0]),
        corners[i][1] + t * (corners[j][1] - corners[i][1]),
        corners[i][2] + t * (corners[j][2] - corners[i][2]),
      ]);
    }
  }
  if (pts.length < 3) return [];
  const c: Vec3 = [0, 0, 0];
  for (const p of pts) {
    c[0] += p[0];
    c[1] += p[1];
    c[2] += p[2];
  }
  const { u, v } = resliceBasis(n);
  const angle = (p: Vec3) => {
    const r = sub(p, [c[0] / pts.length, c[1] / pts.length, c[2] / pts.length]);
    return Math.atan2(dot(r, v), dot(r, u));
  };
  return pts.sort((a, b) => angle(a) - angle(b));
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- resliceMath`
Expected: PASS (6 tests).

- [ ] **Step 5: Commit**

```bash
git add src/render/resliceMath.ts tests/resliceMath.test.ts
git commit -m "feat: reslice basis, plane normals, plane-cube cross-section"
```

---

### Task 7: Cube renderer + raymarch shader + app wiring

**Files:**
- Create: `src/render/shaders.ts`, `src/render/texture3d.ts`, `src/render/cubeRenderer.ts`
- Modify: `src/main.ts` (full rewrite)

**Interfaces:**
- Consumes: `rayBox`/`clipRayToHalfSpace` math concepts (re-expressed in GLSL); `ingestVideo` (Task 4); `normalFromAngles`, `planeCubePolygon` (Task 6).
- Produces:
  - `createVolumeTexture(gl: WebGL2RenderingContext, data: Uint8Array, dims: Vec3): WebGLTexture`
  - `class CubeRenderer { constructor(canvas, data, dims); setDensity(v: number): void; setPlane(normal, offset, on): void; start(): void; }` — normal as `[number, number, number]`
  - `main.ts` boot flow: synthetic gradient cube on load -> file input -> `ingestVideo` -> rebuild renderer; plane UI + reslice wired in Task 8.

- [ ] **Step 1: Write shaders.ts**

```ts
export const CUBE_VERT = /* glsl */ `
out vec3 vWorld;
void main() {
  vWorld = (modelMatrix * vec4(position, 1.0)).xyz;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;

export const CUBE_FRAG = /* glsl */ `
precision highp float;
precision highp sampler3D;
in vec3 vWorld;
uniform sampler3D uVolume;
uniform float uDensity;
uniform int uSteps;
uniform vec3 uPlaneNormal;
uniform float uPlaneOffset;
uniform bool uPlaneOn;
out vec4 outColor;

bool rayBox(vec3 ro, vec3 rd, out float t0, out float t1) {
  vec3 inv = 1.0 / rd;
  vec3 a = (-0.5 - ro) * inv;
  vec3 b = (0.5 - ro) * inv;
  vec3 mn = min(a, b);
  vec3 mx = max(a, b);
  t0 = max(max(mn.x, mn.y), mn.z);
  t1 = min(min(mx.x, mx.y), mx.z);
  return t1 > max(t0, 0.0);
}

void main() {
  vec3 ro = cameraPosition;
  vec3 rd = normalize(vWorld - ro);
  float t0, t1;
  if (!rayBox(ro, rd, t0, t1)) discard;
  t0 = max(t0, 0.0);
  if (uPlaneOn) {
    float dn = dot(rd, uPlaneNormal);
    float f0 = dot(ro, uPlaneNormal) - uPlaneOffset;
    if (abs(dn) < 1e-6) {
      if (f0 < 0.0) discard;
    } else {
      float tc = (uPlaneOffset - f0) / dn;
      if ((dn > 0.0) == (f0 >= 0.0)) t0 = max(t0, tc);
      else t1 = min(t1, tc);
    }
  }
  if (t1 <= t0) discard;
  float stepLen = (t1 - t0) / float(uSteps);
  float a = 1.0 - exp(-uDensity * stepLen);
  vec3 acc = vec3(0.0);
  float accA = 0.0;
  for (int i = 0; i < 512; i++) {
    if (i >= uSteps) break;
    vec3 p = ro + rd * (t0 + (float(i) + 0.5) * stepLen);
    vec3 uvw = vec3(p.x + 0.5, 0.5 - p.y, p.z + 0.5);
    vec3 c = texture(uVolume, uvw).rgb;
    acc += (1.0 - accA) * a * c;
    accA += (1.0 - accA) * a;
    if (accA > 0.99) break;
  }
  if (accA < 0.004) discard;
  outColor = vec4(acc, accA);
}
`;

export const RESLICE_VERT = /* glsl */ `
out vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;

export const RESLICE_FRAG = /* glsl */ `
precision highp float;
precision highp sampler3D;
in vec2 vUv;
uniform sampler3D uVolume;
uniform vec3 uNormal;
uniform vec3 uU;
uniform vec3 uV;
uniform float uOffset;
uniform float uExtent;
out vec4 outColor;
void main() {
  vec3 p = uNormal * uOffset
         + uU * ((vUv.x - 0.5) * uExtent)
         + uV * ((vUv.y - 0.5) * uExtent);
  vec3 uvw = vec3(p.x + 0.5, 0.5 - p.y, p.z + 0.5);
  if (any(lessThan(uvw, vec3(0.0))) || any(greaterThan(uvw, vec3(1.0)))) {
    outColor = vec4(0.0);
    return;
  }
  outColor = vec4(texture(uVolume, uvw).rgb, 1.0);
}
`;
```

- [ ] **Step 2: Write texture3d.ts**

```ts
import type { Vec3 } from './linalg';

export function createVolumeTexture(
  gl: WebGL2RenderingContext,
  data: Uint8Array,
  dims: Vec3,
): WebGLTexture {
  const tex = gl.createTexture();
  if (!tex) throw new Error('Could not create 3D texture.');
  gl.bindTexture(gl.TEXTURE_3D, tex);
  gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
  gl.texImage3D(
    gl.TEXTURE_3D, 0, gl.RGB8,
    dims[0], dims[1], dims[2], 0,
    gl.RGB, gl.UNSIGNED_BYTE, data,
  );
  for (const p of [gl.TEXTURE_WRAP_S, gl.TEXTURE_WRAP_T, gl.TEXTURE_WRAP_R]) {
    gl.texParameteri(gl.TEXTURE_3D, p, gl.CLAMP_TO_EDGE);
  }
  gl.texParameteri(gl.TEXTURE_3D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_3D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  return tex;
}
```

- [ ] **Step 3: Write cubeRenderer.ts**

```ts
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { createVolumeTexture } from './texture3d';
import { CUBE_VERT, CUBE_FRAG } from './shaders';
import { planeCubePolygon } from './resliceMath';
import type { Vec3 } from './linalg';

export class CubeRenderer {
  private renderer: THREE.WebGLRenderer;
  private scene = new THREE.Scene();
  private camera = new THREE.PerspectiveCamera(50, 1, 0.01, 100);
  private uniforms: Record<string, THREE.IUniform>;
  private line: THREE.Line;
  private linePositions: THREE.BufferAttribute;

  constructor(canvas: HTMLCanvasElement, data: Uint8Array, dims: Vec3) {
    this.renderer = new THREE.WebGLRenderer({ canvas, alpha: true, antialias: true });
    this.renderer.setClearColor(0x000000, 0);
    this.camera.position.set(1.7, 1.2, 1.7);
    this.camera.lookAt(0, 0, 0);
    new OrbitControls(this.camera, canvas);

    const gl = this.renderer.getContext();
    const tex = createVolumeTexture(gl, data, dims);
    this.uniforms = {
      uVolume: { value: tex },
      uDensity: { value: 8 },
      uSteps: { value: 160 },
      uPlaneNormal: { value: new THREE.Vector3(0, 0, 1) },
      uPlaneOffset: { value: 0 },
      uPlaneOn: { value: false },
    };
    const mat = new THREE.ShaderMaterial({
      glslVersion: THREE.GLSL3,
      vertexShader: CUBE_VERT,
      fragmentShader: CUBE_FRAG,
      uniforms: this.uniforms,
      transparent: true,
      depthWrite: false,
      side: THREE.BackSide,
      blending: THREE.CustomBlending,
      blendSrc: THREE.OneFactor,
      blendDst: THREE.OneMinusSrcAlphaFactor,
    });
    this.scene.add(new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), mat));

    // Slice-plane cross-section outline; resized per updatePlane.
    this.linePositions = new THREE.BufferAttribute(new Float32Array(8 * 3), 3);
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', this.linePositions);
    this.line = new THREE.Line(geo, new THREE.LineBasicMaterial({ color: 0x55ffcc }));
    this.line.visible = false;
    this.scene.add(this.line);

    this.resize();
  }

  setDensity(v: number): void {
    this.uniforms.uDensity.value = v;
  }

  setPlane(normal: Vec3, offset: number, on: boolean): void {
    (this.uniforms.uPlaneNormal.value as THREE.Vector3).set(...normal);
    this.uniforms.uPlaneOffset.value = offset;
    this.uniforms.uPlaneOn.value = on;
    if (!on) {
      this.line.visible = false;
      return;
    }
    const poly = planeCubePolygon(normal, offset);
    this.line.visible = poly.length >= 2;
    if (poly.length >= 2) {
      const arr = this.linePositions.array as Float32Array;
      poly.forEach((p, i) => arr.set(p, i * 3));
      // wrap: repeat first vertex to close the loop
      if (poly.length < 8) arr.set(poly[0], poly.length * 3);
      this.linePositions.needsUpdate = true;
      this.line.geometry.setDrawRange(0, poly.length + 1);
    }
  }

  resize(): void {
    const canvas = this.renderer.domElement;
    const w = canvas.clientWidth || 800;
    const h = canvas.clientHeight || 600;
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }

  start(): void {
    window.addEventListener('resize', () => this.resize());
    this.renderer.setAnimationLoop(() => this.renderer.render(this.scene, this.camera));
  }
}
```

- [ ] **Step 4: Rewrite main.ts with wiring + synthetic demo volume**

```ts
import './style.css';
import { CubeRenderer } from './render/cubeRenderer';
import { ingestVideo } from './ingest/ingestVideo';
import type { Vec3 } from './render/linalg';

const msg = document.querySelector<HTMLElement>('#msg')!;
const progress = document.querySelector<HTMLElement>('#progress')!;
const progressNum = document.querySelector<HTMLElement>('#progress-num')!;
const controls = document.querySelector<HTMLElement>('#controls')!;
const planeUi = document.querySelector<HTMLElement>('#plane-ui')!;
const resliceCanvas = document.querySelector<HTMLCanvasElement>('#reslice')!;
const fileInput = document.querySelector<HTMLInputElement>('#file')!;
const framesInput = document.querySelector<HTMLInputElement>('#frames')!;
const opacityInput = document.querySelector<HTMLInputElement>('#opacity')!;
const offsetInput = document.querySelector<HTMLInputElement>('#offset')!;
const azimuthInput = document.querySelector<HTMLInputElement>('#azimuth')!;
const elevationInput = document.querySelector<HTMLInputElement>('#elevation')!;
const downloadBtn = document.querySelector<HTMLButtonElement>('#download')!;
const cubeCanvas = document.querySelector<HTMLCanvasElement>('#cube')!;

const AXIS: Record<string, Vec3> = { x: [1, 0, 0], y: [0, 1, 0], z: [0, 0, 1] };

function fail(text: string): void {
  msg.textContent = text;
  msg.hidden = false;
}

if (!document.createElement('canvas').getContext('webgl2')) {
  fail('WebGL2 is required but not available in this browser.');
} else {
  boot(syntheticVolume(64));
}

function syntheticVolume(n: number): Uint8Array {
  const out = new Uint8Array(n * n * n * 3);
  let o = 0;
  for (let z = 0; z < n; z++)
    for (let y = 0; y < n; y++)
      for (let x = 0; x < n; x++) {
        out[o++] = Math.round((x / n) * 255);
        out[o++] = Math.round((y / n) * 255);
        out[o++] = Math.round((z / n) * 255);
      }
  return out;
}

let cube: CubeRenderer | null = null;

function boot(data: Uint8Array, dims?: Vec3): void {
  const d: Vec3 = dims ?? [64, 64, 64];
  cube = new CubeRenderer(cubeCanvas, data, d);
  cube.setDensity(Number(opacityInput.value));
  cube.start();
  controls.hidden = false;
  planeUi.hidden = false;
}

fileInput.addEventListener('change', async () => {
  const file = fileInput.files?.[0];
  if (!file || !cube) return;
  progress.hidden = false;
  try {
    const count = Math.min(192, Math.max(16, Number(framesInput.value) || 96));
    const r = await ingestVideo(file, count, 256, (done, total) => {
      progressNum.textContent = String(Math.round((done / total) * 100));
    });
    cube = new CubeRenderer(cubeCanvas, r.data, [r.width, r.height, r.depth]);
    cube.setDensity(Number(opacityInput.value));
    cube.start();
    resliceCanvas.hidden = false;
    downloadBtn.hidden = false;
  } catch (e) {
    fail(e instanceof Error ? e.message : 'Ingest failed.');
  } finally {
    progress.hidden = true;
  }
});

opacityInput.addEventListener('input', () => cube?.setDensity(Number(opacityInput.value)));

let planeNormal: Vec3 = AXIS.z;
for (const btn of document.querySelectorAll<HTMLButtonElement>('[data-axis]')) {
  btn.addEventListener('click', () => {
    planeNormal = AXIS[btn.dataset.axis!];
    azimuthInput.value = '0';
    elevationInput.value = btn.dataset.axis === 'z' ? '90' : '0';
    applyPlane();
  });
}
offsetInput.addEventListener('input', applyPlane);
azimuthInput.addEventListener('input', applyPlane);
elevationInput.addEventListener('input', applyPlane);

function applyPlane(): void {
  if (!cube) return;
  const az = (Number(azimuthInput.value) * Math.PI) / 180;
  const el = (Number(elevationInput.value) * Math.PI) / 180;
  // axis buttons set the normal directly; dials recompute it
  planeNormal = el !== 0 || az !== 0
    ? [Math.cos(el) * Math.sin(az), Math.cos(el) * Math.cos(az), Math.sin(el)]
    : planeNormal;
  cube.setPlane(planeNormal, Number(offsetInput.value), true);
}
```

- [ ] **Step 5: Manual smoke**

Run: `npm run dev`, open `http://localhost:5173`.
Expected: gradient RGB cube visible, rotates with drag, zooms with wheel; opacity slider fades it toward ghost and back; X/Y/Z buttons + offset slider cut into the cube with a cyan outline on the cut plane; no console errors. Stop the server.

- [ ] **Step 6: Typecheck + full tests**

Run: `npx tsc && npm test`
Expected: no errors, all tests pass.

- [ ] **Step 7: Commit**

```bash
git add src/render/shaders.ts src/render/texture3d.ts src/render/cubeRenderer.ts src/main.ts
git commit -m "feat: raymarched volume cube with slice plane and app wiring"
```

---

### Task 8: Reslice renderer + PNG export

**Files:**
- Create: `src/render/resliceRenderer.ts`
- Modify: `src/main.ts` (ingest handler + plane/export wiring)

**Interfaces:**
- Consumes: `RESLICE_VERT`, `RESLICE_FRAG` (Task 7); `createVolumeTexture` (Task 7); `resliceBasis` (Task 6); `CubeRenderer` (Task 7).
- Produces: `class ResliceRenderer { constructor(canvas, data, dims); setPlane(normal: Vec3, offset: number): void; render(): void; exportPng(name: string): void; }`

- [ ] **Step 1: Write resliceRenderer.ts**

```ts
import * as THREE from 'three';
import { createVolumeTexture } from './texture3d';
import { RESLICE_VERT, RESLICE_FRAG } from './shaders';
import { resliceBasis } from './resliceMath';
import type { Vec3 } from './linalg';

const EXTENT = 0.75; // covers every cube cross-section (max in-plane radius ~0.707)

export class ResliceRenderer {
  private renderer: THREE.WebGLRenderer;
  private scene = new THREE.Scene();
  private camera = new THREE.OrthographicCamera(-0.5, 0.5, 0.5, -0.5, -1, 1);
  private uniforms: Record<string, THREE.IUniform>;

  constructor(canvas: HTMLCanvasElement, data: Uint8Array, dims: Vec3) {
    this.renderer = new THREE.WebGLRenderer({
      canvas,
      alpha: true,
      antialias: false,
      preserveDrawingBuffer: true, // required for toBlob export
    });
    const tex = createVolumeTexture(this.renderer.getContext(), data, dims);
    const { u, v } = resliceBasis([0, 0, 1]);
    this.uniforms = {
      uVolume: { value: tex },
      uNormal: { value: new THREE.Vector3(0, 0, 1) },
      uU: { value: new THREE.Vector3(...u) },
      uV: { value: new THREE.Vector3(...v) },
      uOffset: { value: 0 },
      uExtent: { value: EXTENT },
    };
    const mat = new THREE.ShaderMaterial({
      glslVersion: THREE.GLSL3,
      vertexShader: RESLICE_VERT,
      fragmentShader: RESLICE_FRAG,
      uniforms: this.uniforms,
    });
    this.scene.add(new THREE.Mesh(new THREE.PlaneGeometry(1, 1), mat));
    this.render();
  }

  setPlane(normal: Vec3, offset: number): void {
    const { u, v } = resliceBasis(normal);
    (this.uniforms.uNormal.value as THREE.Vector3).set(...normal);
    (this.uniforms.uU.value as THREE.Vector3).set(...u);
    (this.uniforms.uV.value as THREE.Vector3).set(...v);
    this.uniforms.uOffset.value = offset;
    this.render();
  }

  render(): void {
    this.renderer.render(this.scene, this.camera);
  }

  exportPng(name: string): void {
    this.render();
    this.renderer.domElement.toBlob((blob) => {
      if (!blob) return;
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = name;
      a.click();
      URL.revokeObjectURL(url);
    }, 'image/png');
  }
}
```

- [ ] **Step 2: Wire into main.ts**

In the ingest success path, after the new `CubeRenderer` is created, replace the current block (`resliceCanvas.hidden = false; downloadBtn.hidden = false;`) with:

```ts
resliceCanvas.hidden = false;
downloadBtn.hidden = false;
reslice = new ResliceRenderer(resliceCanvas, r.data, [r.width, r.height, r.depth]);
reslice.setPlane(planeNormal, Number(offsetInput.value));
```

At module top add `let reslice: ResliceRenderer | null = null;` declared next to `let cube`, and inside `applyPlane()` append:

```ts
reslice?.setPlane(planeNormal, Number(offsetInput.value));
```

Add the download handler:

```ts
downloadBtn.addEventListener('click', () => reslice?.exportPng('reslice.png'));
```

Import `ResliceRenderer` alongside the other render imports.

- [ ] **Step 3: Manual smoke**

Run: `npm run dev`, ingest a real video file.
Expected: reslice panel appears; for Z axis it shows the frame at the slider position; for X/Y it shows the space-time tomograph (spatial axis vs time); panel updates live with the offset slider; Download saves a PNG matching the panel; no console errors.

- [ ] **Step 4: Typecheck + full tests**

Run: `npx tsc && npm test`
Expected: no errors, all tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/render/resliceRenderer.ts src/main.ts
git commit -m "feat: live reslice panel with PNG export"
```

---

### Task 9: Polish, README, final smoke checklist

**Files:**
- Modify: `src/main.ts` (axis-button/dial interplay cleanup), `index.html` (button active states)
- Create: `README.md`

**Interfaces:**
- Consumes: everything above; no new interfaces.

- [ ] **Step 1: Clean up plane-normal state in main.ts**

The Task 7 `applyPlane` recomputes `planeNormal` from dials with a special case; make it uniform — dials are the single source of truth and axis buttons just set dial values:

```ts
function normalFromInputs(): Vec3 {
  const az = (Number(azimuthInput.value) * Math.PI) / 180;
  const el = (Number(elevationInput.value) * Math.PI) / 180;
  return [Math.cos(el) * Math.sin(az), Math.cos(el) * Math.cos(az), Math.sin(el)];
}
```

Axis buttons map: X -> azimuth 90 / elevation 0; Y -> azimuth 0 / elevation 0; Z -> azimuth 0 / elevation 90. Remove the `planeNormal` mutable variable; `applyPlane()` uses `const planeNormal = normalFromInputs();` and passes it to both renderers. Dial degree rounding (90 / 0) makes the axis presets exact.

- [ ] **Step 2: Active axis button styling**

In `index.html` add `class="axis-active"` toggling in the axis-button listener (clear on all, set on clicked); in `src/style.css` add:

```css
.axis-active { background: #55ffcc; color: #000; }
```

- [ ] **Step 3: Write README.md**

```markdown
# Video Cube

Stack a video into a 3D cube — one frame per layer along the time axis —
and fly around it. Rotate the cube, fade it transparent to see inside,
then cut it with a plane: frames crossing the plane form a resliced
image (one axis spatial, one axis time), exportable as PNG.

Everything runs in your browser; video files never leave your machine.

## Run

    npm install
    npm run dev

Requires WebGL2. A synthetic gradient cube loads as a demo; pick a video
file to replace it (16-192 sampled frames, downscaled to fit 256 px).

## Controls

- Drag to rotate, wheel to zoom
- Opacity: volumetric transparency
- X / Y / Z + Position: axis-aligned slice through the cube
- Azimuth / Elevation: arbitrary slice angle
- Download reslice PNG: saves the panel image
```

- [ ] **Step 4: Full verification**

Run: `npx tsc && npm test && npm run build`
Expected: typecheck clean, all tests pass, build succeeds.

- [ ] **Step 5: Final manual smoke checklist**

Run: `npm run dev`. Verify each item:
1. Demo cube renders and rotates on load
2. Bad file (e.g. `.txt`) -> red error banner, app still usable
3. Real video: progress counts to 100%, cube rebuilds
4. Opacity slider sweeps ghost <-> solid
5. Each axis slice cuts correctly; outline tracks the cut
6. Arbitrary angles slice correctly; reslice updates live
7. PNG download opens as an image
No console errors at any step. Stop the server.

- [ ] **Step 6: Commit**

```bash
git add src/main.ts index.html src/style.css README.md
git commit -m "feat: axis preset polish, README, final polish"
```

---

## Self-Review Notes

- Spec coverage: ingest (Tasks 2-4), 3D texture + raymarch cube + opacity (Task 7), axis slice plane (Tasks 5, 7), reslice panel (Tasks 6, 8), arbitrary plane (Tasks 6, 8-9), PNG export (Task 8), error handling (Tasks 1, 7, 9), testing strategy (all pure-math tasks + smoke checklists).
- Shader `uPlaneOn` clipping re-implements `clipRayToHalfSpace` in GLSL — kept as tested-TS reference, GPU copy mirrors the same algebra.
- Type consistency: `Vec3` tuple type used across all modules; `IngestResult` matches `CubeRenderer`/`ResliceRenderer` constructor args.

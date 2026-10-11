# Video Cube — Design Spec

Date: 2026-10-11
Status: Approved design, pre-implementation

## Summary

Browser app that turns a video into a 3D "space-time cube": each sampled
frame becomes one layer of a volumetric texture, stacked along the time
axis. The user rotates the cube, sees through it via adjustable
transparency, and can slice it with a plane. Frames intersected by the
slice plane form a resliced 2D image (one axis spatial, one axis time),
displayable and exportable as PNG.

Purely client-side. No backend, no uploads leave the machine.

## Tech Stack

- Vite + TypeScript, static single-page app
- Three.js (render loop, camera, OrbitControls) — no scene-graph geometry
  beyond one unit box
- Custom GLSL (WebGL2) for raymarching and reslicing
- Vitest for pure-math unit tests

## Core Concept

The video volume is a WebGL2 `TEXTURE_3D`:

- x, y: pixel coordinates (downscaled)
- z: time (frame index)

Cube interior is rendered by raymarching: the fragment shader casts a ray
from the camera through the unit cube, clips it to the volume, and
front-to-back accumulates color with per-step alpha. Global opacity
slider controls how see-through the cube is. This avoids transparency
sorting problems entirely and reads as a true volumetric object.

## Components

### 1. Ingest (`src/ingest/`)

- `<input type="file" accept="video/*">` -> object URL -> `<video>` element
- Frame sampler seeks the video and samples N frames evenly across the
  duration. Default N = 96, user-adjustable 16-192 at load time.
- Each frame is drawn to an offscreen canvas downscaled so the larger
  dimension is ≤ 256 px (aspect preserved).
- Pixels are packed row-major per frame into a `Uint8Array` and uploaded
  once as an RGB `TEXTURE_3D`.
- Ingest is async with a progress bar; the UI never blocks on a sync
  loop longer than one frame.

### 2. Cube renderer (`src/render/`)

- Scene = one unit box (`BoxGeometry`) with a custom `ShaderMaterial`.
- Fragment shader: ray-box intersection -> march in fixed steps
  (~128, quality constant) -> accumulate `color = color + (1 - accA) *
  stepAlpha * sampleColor`, `accA += (1 - accA) * stepAlpha`.
- Uniforms: `uVolume` (3D texture), `uOpacity` (global multiplier),
  `uSteps`, `uPlaneNormal`, `uPlaneOffset`, `uPlaneOn`.
- OrbitControls: rotate, zoom. No pan.

### 3. Slice plane (stage 2)

- Plane defined by `planeNormal` (unit vec3) + `planeOffset` (signed
  distance along normal, slider range covers the cube diagonal).
- Raymarch start point is advanced to the plane when the plane is on and
  the ray enters the half-space in front of it, so the user sees the
  content on the near side of the cut.
- Plane is visualized as a wireframe rectangle where the plane
  intersects the cube bounds.
- Axis preset buttons (X / Y / Z) + one offset slider.

### 4. Reslice panel (stage 2)

- Second pass: an orthographic quad whose fragment shader samples the
  3D texture across the slice plane. Result rendered to its own canvas
  beside the cube view.
- One axis of the reslice image is spatial (along one cube axis lying in
  the plane), the other is time. For an axis-aligned plane normal to Z
  (time), the reslice shows the single frame at the plane position;
  normals X/Y produce the classic space-time "tomograph" view.
- Updates live as the offset slider moves.

### 5. Arbitrary plane + export (stage 3)

- `planeNormal` becomes freely orientable: two angle dials (azimuth,
  elevation) driven by drag; presets remain.
- "Download PNG" button on the reslice canvas: `canvas.toBlob` ->
  object URL -> programmatic anchor click.

## Data Flow

```
file -> <video> -> frame sampler -> Uint8Array volume -> TEXTURE_3D
  -> raymarch shader (uOpacity, uPlane*) -> main canvas
  -> reslice shader (uPlane*) -> reslice canvas -> PNG export
```

## Error Handling

- No WebGL2: inline message, app disabled.
- Video decode failure or unsupported codec: inline message, file
  picker re-offered.
- Very large/long videos: bounded by the fixed downscale (≤256) and
  frame cap (192); ingest stays async with progress feedback.

## Testing Strategy

Pure TypeScript functions kept free of WebGL/Three imports so they unit
test cleanly:

- Frame index/duration math for the sampler
- Volume packing (index math for (x, y, z) -> byte offset)
- Ray-box intersection
- Ray-plane clipping / march-interval computation
- Reslice coordinate mapping (plane -> texture-space quad corners)

GL-dependent code (shaders, texture upload) covered by a manual smoke
checklist: load sample file, rotate, adjust opacity, slice on each axis,
export PNG.

## Delivery Stages

1. Ingest + 3D texture + rotatable translucent cube with opacity slider
2. Axis-aligned slice plane + live reslice panel
3. Arbitrary plane orientation + PNG export

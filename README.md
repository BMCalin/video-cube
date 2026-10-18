# Video Cube

Stack a video into a 3D cube — one frame per layer along the time axis —
and fly around it.

<video src="https://github.com/czl9707/video-cube/releases/download/v0.1.0/export-1792267964386.mp4" controls muted loop width="640"></video>

## How it works

Each sampled frame of the video becomes one textured sheet in a 3D
stack, spaced along the time axis. The result is a volume you can
inspect from any angle:

- **Rotate the cube** — drag to orbit, wheel to zoom.
- **See inside** — fade the cube's opacity down and the sheets read as
  a translucent volume.
- **Reslice it** — cut through the stack with a plane. The frames
  crossing the plane form a new image: one axis spatial, one axis time.
  Slice straight across for a timeline strip; tilt the plane for a
  sheared view.
- **Export** — download the reslice panel as a PNG.

The cube boots with a synthetic gradient stack so there is something to
play with immediately; pick any video file to replace it (16–192
sampled frames, downscaled to fit 256 px).

Everything runs in your browser. Video files never leave your machine.

## Live

Hosted on Cloudflare Workers: **https://video-cube.czl970721.workers.dev**

## Run locally

    npm install
    npm run dev

Requires a WebGL2-capable browser.

## Controls

| Control | What it does |
| --- | --- |
| Drag / wheel | Orbit the camera, zoom |
| Sample rate | How many frames are sampled from the video |
| Spacing | Gap between sheets along the time axis |
| Cube opacity | Volumetric transparency of the whole stack |
| Plane axis (X / Y / Z) + Position | Axis-aligned slice through the cube |
| Azimuth / Elevation | Arbitrary slice angle |
| Plane image opacity | Opacity of the reslice panel |
| Download reslice PNG | Saves the panel image |

## Deployment

A Cloudflare Worker serves the built static assets. `wrangler.jsonc`
carries the config; pushes to `main` build and deploy automatically via
Workers Builds.

    npm run build
    npx wrangler deploy

## Tech

React 19 + TypeScript + Vite · three.js (WebGL2) · Tailwind 4 + shadcn/ui · Vitest

# Video Cube

Stack a video into a 3D cube (one frame per layer along the time axis)
and fly around it.

Weekend project hosted on Cloudflare: **https://video-cube.kiyo-n-zane.com**

https://github.com/user-attachments/assets/88a57dd4-33ea-4dc4-9b94-ddc9d60e6949

## How it works

Each sampled frame of the video becomes one textured sheet in a 3D
stack, spaced along the time axis. The result is a volume you can
inspect from any angle:

- **Rotate the cube**: drag to orbit, wheel to zoom.
- **See inside**: fade the cube's opacity down and the sheets read as
  a translucent volume.
- **Reslice it**: cut through the stack with a plane. The frames
  crossing the plane form a new image: one axis spatial, one axis time.
  Slice straight across for a timeline strip; tilt the plane for a
  sheared view.
- **Export**: download the reslice panel as a PNG.

## What's new

- **Time-slice export**: sweep the slice plane through the cube and render
  every position as one frame of a new clip, saved as MP4 (H.264) or a PNG
  sequence, with presets from 360p to 4K. With a slightly tilted plane, a
  cloud timelapse turns into a moving gradient of time: the top of the frame
  shows the sky a few seconds ago while the bottom shows it now.
- **Tilt pivot**: choose the line the plane tilts around (top, centre,
  bottom or anywhere between), shown as an orange line on the cut face.
- **Full-size preview** of the time-slice animation with a transport bar.
- **Image sequences**: load a folder of stills (e.g. a camera timelapse) as
  well as videos.
- **Colour key**: hide or isolate a colour picked from the slice, e.g. hide
  the sky to see the clouds as a volume.
- **Viewer resolution** up to 1536 px, and `start.bat` to launch on Windows
  with a double-click.

Everything runs locally in your browser. Files never leave your machine.

## How to run

You need [Node.js](https://nodejs.org/) version 24 or newer (see
`.node-version`). Install it once.

**On Windows, the easy way:** double-click `start.bat` in the project folder.
It installs or updates the dependencies when needed, starts the app and opens
it in your browser. Keep its window open while you use the app; close it to
stop.

**Any system, step by step:**

1. Open a terminal in the project folder. On Windows, open the folder in
   Explorer, type `cmd` in the address bar and press Enter, or run
   `cd /d D:\path\to\video-cube`.
2. Install the dependencies (first time, and after pulling changes that touch
   `package.json`):

   ```bash
   npm install
   ```

3. Start the app:

   ```bash
   npm run dev
   ```

4. Open the address it prints, usually <http://localhost:5173/>, in a recent
   **Chrome** or **Edge**. Keep the terminal open while you use the app; press
   `Ctrl+C` in it to stop.

WebGL2 is required for the 3D view and WebCodecs for MP4 export.

A synthetic gradient cube loads as a demo. Drop a video, a set of images or a
folder on the sidebar, or use **Load video**, **Images** or **Folder**, to
replace it.

## Sources

- **Video**: any file the browser can play (MP4, MOV, WebM, ...).
- **Image sequence**: two or more stills, for example a timelapse straight
  from the camera. Select the images with **Images**, pick their folder with
  **Folder**, or drop either on the sidebar. Files are ordered by name, with
  numbers compared numerically (`IMG_2` comes before `IMG_10`); other files in
  the folder are ignored. Supported formats are JPEG, PNG, WebP and AVIF;
  convert RAW or TIFF files first. Set **Sequence frame rate** to the playback
  rate you intend for the timelapse: it defines the clip's length in seconds
  (images / frame rate) and therefore the timing shown in the export panel.

| Script            | Purpose                                   |
| ----------------- | ----------------------------------------- |
| `npm run dev`     | Development server with hot reload        |
| `npm run build`   | Type-check and build a static site to `dist/` |
| `npm run preview` | Serve the production build locally        |
| `npm test`        | Run the unit tests (Vitest)               |

## The 3D viewer

The viewer samples the clip into a volume of up to 192 frames, with the long
side scaled to the **Viewer resolution** (512, 1024 or 1536 px). Larger sizes
sharpen the cut face and the time-slice preview but need more GPU memory
(width x height x frames x 4 bytes; about 450 MB at 1024 px). Sizes your GPU
cannot hold as a 3D texture are disabled. Export does not use this volume; it
goes back to the original file (see below).

- **Drag** to rotate, **wheel** to zoom.
- **Sample rate**: frames per second of video taken into the cube. Press
  **Resample** after changing it.
- **Cube opacity**: volumetric transparency of the frame stack.
- **Plane image opacity**: opacity of the cut face.
- **Spacing**: stretches the time axis.
- **X / Y / Z** and **Position**: axis-aligned slice through the cube.
- **Azimuth / Elevation**: arbitrary slice angle. Elevation 90 degrees is an ordinary
  frame; lower values tilt the plane through time.
- **Tilt pivot**: the line across the frame the plane tilts around. 0% is the
  top edge, 50% the centre (default), 100% the bottom edge, measured along the
  tilt direction (top to bottom at azimuth 0 degrees). The pivot line keeps its moment
  in time while you tilt. At 100%, the bottom of the picture stays in the
  present and only the part above it reaches into the past, which suits
  landscapes with a moving sky. An orange line on the cut face (and a dashed
  one on the time-slice preview) shows where the pivot is, and follows the
  slider as you move it. Moving the pivot does not move the plane; it changes
  the line the next tilt rotates around.
- **Flip cut side / Show clipped side**: choose which half of the cube is kept.

### Colour key

Open it with **Colour key...** under **Tools** in the sidebar; it appears as a
panel on the right (the button shows "(on)" while a key is active). It is a
visual aid for exploring the volume and never affects the preview or the
export.

- **Hide colour** makes voxels close to the key colour transparent, for
  example the blue sky, so the clouds remain and their volume can be followed
  through time. **Isolate colour** does the opposite and keeps only the key
  colour.
- **Pick from slice** turns the cursor into an eyedropper: click the cut face
  to take its colour (Esc cancels). The swatch next to it opens a colour
  chooser.
- **Hue / Saturation / Brightness tolerance** set how far a colour may be from
  the key and still count as a match; **Softness** feathers the edge.
- **Also key the cut face** applies the key to the image on the plane as well
  as to the frame stack.
- **Show the cut-face outline and pivot line** (bottom of the panel) hides the
  green outline of the cut face and the orange pivot line for an unobstructed
  view.

## Time-slice export

Open it with **Time-slice export...** under **Tools** in the sidebar. The
panel opens on the right, has three parts, and keeps its settings when you
close it or switch to the colour key.

### How it works

Think of the cube from the side. Time runs left to right, the frame's height
runs bottom to top:

```
  frame top    +---------------------------+
               |\        \        \        |   Each \ is the slice plane
               | \        \        \       |   at one output frame.
               |  \        \        \      |
               |   \        \        \     |   A tilted plane takes the top
               |    \        \        \    |   of the picture from an earlier
  frame bottom +---------------------------+   moment than the bottom.
               first frame      time ->      last frame
```

The plane moves from left to right over the length of the export, so the
result plays like the original clip, but every row (or column, or diagonal)
lags a little behind its neighbour.

Each end of the animation is a **keyframe** with three values:

- **Time at pivot**: the moment shown on the tilt pivot line (the centre of
  the picture unless you moved **Tilt pivot** in the sidebar). The pivot is
  shared by the 3D view and the export.
- **Time span across frame**: how much clip time the plane covers from one
  edge of the picture to the other. `0` is an ordinary frame. Negative values
  reverse the gradient. The panel also shows the equivalent tilt in degrees as
  it appears in the 3D view.
- **Gradient direction**: the direction of the time gradient across the
  picture, in degrees. It uses the same convention as the viewer's Azimuth:
  0 degrees puts the past at the top, 90 on the right, 180 at the bottom.

Between the keyframes, time always moves at constant speed, while the span and
direction follow the selected **Tilt transition** curve. Starting at a span of
0 and ending at a few seconds gives an ordinary timelapse that gradually melts
into a time gradient.

**From 3D plane** copies the plane currently set in the viewer into a
keyframe, so you can design the look interactively. **Show** moves the 3D
plane to a keyframe. With **Move the 3D slice plane with the preview**
switched on, the 3D view follows the preview as it plays.

**Keep the slice inside the clip** shifts the plane so it never reaches
before the first or after the last frame. Without it, pixels beyond the clip
either hold the first/last frame or turn black. With the fit on, the pivot
moment is nudged slightly as the span grows; turn it off if the pivot line
must play back at exactly the source speed.

**Blend between frames** interpolates between neighbouring source frames for
a smooth gradient. Turn it off to see the individual source frames as bands.

### Preview

The preview renders the animation live from the viewer's volume. Use
play/pause and the scrubber in the panel, or switch the main view from
**3D view** to **Time-slice preview** (buttons at the top of the screen) to
watch it full size with a transport bar at the bottom. For a sharper preview,
raise the **Viewer resolution** and resample. The output uses the same maths
at full resolution.

### Output

| Setting         | Notes |
| --------------- | ----- |
| Format          | **MP4** (H.264, encoded in the browser) or a **PNG sequence**. In Chrome and Edge, PNG frames are written straight into a folder you choose; other browsers get a ZIP file. |
| Resolution      | Presets from 360p to 4K, or the source resolution. Presets larger than the source are disabled. |
| Frame rate      | Output frames per second. |
| Quality         | MP4 bitrate level. The bitrate scales with resolution and frame rate. |
| Duration        | Output length. The panel shows the resulting frame count and the playback speed relative to the source. |
| Source sampling | How many frames per second are read from the source. Defaults to the clip's native frame rate, so every original frame is used. Lower it to save memory on long clips. |

**Still** saves the frame currently shown in the preview as a full-resolution
PNG.

The export decodes the source frames it needs at the output resolution and
keeps them in memory (3 bytes per pixel). The panel shows the estimate before
you start; for example, 1,000 frames at 1080p need about 5.8 GB of RAM.
Videos are decoded with WebCodecs, which is fast and frame-accurate, with a
fallback to seeking a `<video>` element for files it cannot read directly.
Image sequences are decoded one still at a time at the output resolution.

If the browser has no H.264 encoder (for example an open-source Chromium
build), the MP4 is written with VP9 or AV1 instead, and the status line says
which codec was used.

## Adding presets

All presets live in [`src/export/presets.ts`](src/export/presets.ts). Append
an entry to the relevant list and the panel picks it up:

```ts
// Resolution: short side in pixels (works for landscape and portrait clips).
{ id: '1200p', label: '1200p', shortSide: 1200 },

// Frame rate:
{ fps: 120, label: '120 fps' },
```

H.264 needs even dimensions; `outputSize()` rounds for you.

## Project layout

```
src/
  ingest/          video or image sequence -> volume for the viewer
  render/          WebGL2 volume renderer (Three.js) and slice geometry
  export/
    timeSlice.ts       keyframes, easing, plane <-> keyframe conversion
    renderTimeSlice.ts per-pixel time-displacement renderer (CPU)
    videoSource.ts     probing and full-resolution decoding (Mediabunny, images)
    encoders.ts        MP4, PNG folder, PNG ZIP and still writers
    exportTimeSlice.ts decode -> render -> encode pipeline
    presets.ts         resolution, frame-rate and quality presets
  ui/
    App.tsx            viewer layout and controls
    export/            export panel, keyframe editor, form fields
tests/             unit tests (Vitest)
```

The export maths is plain TypeScript with no browser dependencies, so it is
covered by unit tests (`tests/timeSlice.test.ts`,
`tests/renderTimeSlice.test.ts`, `tests/presets.test.ts`).

## Browser support

| Feature            | Chrome / Edge | Firefox | Safari |
| ------------------ | :-----------: | :-----: | :----: |
| 3D viewer (WebGL2) | yes           | yes     | yes    |
| MP4 export         | yes           | partial (1) | partial (1) |
| PNG sequence       | yes (folder)  | yes (ZIP) | yes (ZIP) |

(1) Depends on the browser's WebCodecs encoder support. PNG export always works.

## Deploying

`npm run build` produces a static site in `dist/` that can be hosted anywhere.
`wrangler.jsonc` is set up for Cloudflare Workers static assets.

## About

Sorry Zane for the mess, I'll polish later :D

## Credits

- **Video Cube** (3D viewer and reslicing): Zane Chen ([@Zane__Chen](https://www.threads.com/@Zane__Chen) on Threads).
- **Time-slice export**, with a photographer's touch: Bidian M. Calin.

Time-slice export uses [Mediabunny](https://mediabunny.dev/) for decoding and
MP4 muxing and [fflate](https://github.com/101arrowz/fflate) for ZIP output.

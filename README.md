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

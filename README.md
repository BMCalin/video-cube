# Video Cube

Stack a video into a 3D cube — one frame per layer along the time axis —
and fly around it. 

Weekend project hosted on Cloudflare: **https://video-cube.kiyo-n-zane.com**

https://github.com/user-attachments/assets/88a57dd4-33ea-4dc4-9b94-ddc9d60e6949

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

## Credits

Video Cube by Zane Chen. Viewer resolution, the tilt pivot, the colour key
and the time-slice maths are adapted from [@BMCalin](https://github.com/BMCalin)'s
[time-slice export proposal](https://github.com/czl9707/video-cube/pull/2).


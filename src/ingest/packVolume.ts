/** Pack RGBA frames into a depth-major RGBA byte volume for THREE.Data3DTexture upload. */
export function packVolume(
  frames: Uint8ClampedArray[],
  width: number,
  height: number,
): Uint8Array {
  const out = new Uint8Array(width * height * frames.length * 4);
  let o = 0;
  for (const f of frames) {
    out.set(f, o);
    o += width * height * 4;
  }
  return out;
}

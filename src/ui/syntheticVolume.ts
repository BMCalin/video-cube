/** RGB gradient test volume, one RGBA texel per voxel. */
export function syntheticVolume(n: number): Uint8Array {
  const out = new Uint8Array(n * n * n * 4);
  let o = 0;
  for (let z = 0; z < n; z++)
    for (let y = 0; y < n; y++)
      for (let x = 0; x < n; x++) {
        out[o++] = Math.round((x / n) * 255);
        out[o++] = Math.round((y / n) * 255);
        out[o++] = Math.round((z / n) * 255);
        out[o++] = 255;
      }
  return out;
}

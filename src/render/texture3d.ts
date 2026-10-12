import * as THREE from 'three';
import type { Vec3 } from './linalg';

export function createVolumeTexture(
  data: Uint8Array,
  dims: Vec3,
): THREE.Data3DTexture {
  const tex = new THREE.Data3DTexture(data, dims[0], dims[1], dims[2]);
  tex.format = THREE.RGBAFormat;
  tex.type = THREE.UnsignedByteType;
  tex.minFilter = THREE.LinearFilter;
  tex.magFilter = THREE.LinearFilter;
  tex.wrapS = THREE.ClampToEdgeWrapping;
  tex.wrapT = THREE.ClampToEdgeWrapping;
  tex.wrapR = THREE.ClampToEdgeWrapping;
  tex.unpackAlignment = 1;
  tex.needsUpdate = true;
  return tex;
}

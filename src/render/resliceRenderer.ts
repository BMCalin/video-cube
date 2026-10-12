import * as THREE from 'three';
import { createVolumeTexture } from './texture3d';
import { RESLICE_VERT, RESLICE_FRAG } from './shaders';
import { resliceBasis, volumeHalfExtents } from './resliceMath';
import type { Vec3 } from './linalg';

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
    const tex = createVolumeTexture(data, dims);
    const half = volumeHalfExtents(dims, 1);
    const { u, v } = resliceBasis([0, 0, 1]);
    this.uniforms = {
      uVolume: { value: tex },
      uNormal: { value: new THREE.Vector3(0, 0, 1) },
      uU: { value: new THREE.Vector3(...u) },
      uV: { value: new THREE.Vector3(...v) },
      uHalf: { value: new THREE.Vector3(...half) },
      uOffset: { value: 0 },
      uExtent: { value: Math.hypot(...half) },
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

  setSpacing(half: Vec3): void {
    (this.uniforms.uHalf.value as THREE.Vector3).set(...half);
    this.uniforms.uExtent.value = Math.hypot(...half);
    this.render();
  }

  render(): void {
    this.renderer.render(this.scene, this.camera);
  }

  dispose(): void {
    this.scene.traverse((o) => {
      const mesh = o as THREE.Mesh;
      if (mesh.isMesh) {
        mesh.geometry.dispose();
        (mesh.material as THREE.Material).dispose();
      }
    });
    this.renderer.dispose();
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

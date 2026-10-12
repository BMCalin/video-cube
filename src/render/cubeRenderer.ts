import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { createVolumeTexture } from './texture3d';
import { CUBE_VERT, CUBE_FRAG } from './shaders';
import { planeCubePolygon, volumeHalfExtents } from './resliceMath';
import type { Vec3 } from './linalg';

export class CubeRenderer {
  private renderer: THREE.WebGLRenderer;
  private scene = new THREE.Scene();
  private camera = new THREE.PerspectiveCamera(50, 1, 0.01, 100);
  private uniforms: Record<string, THREE.IUniform>;
  private line: THREE.Line;
  private linePositions: THREE.BufferAttribute;
  private controls: OrbitControls;
  private box: THREE.Mesh<THREE.BoxGeometry, THREE.ShaderMaterial>;
  private half: Vec3;
  private plane: { normal: Vec3; offset: number; on: boolean; flip: boolean } = {
    normal: [0, 0, 1],
    offset: 0,
    on: false,
    flip: false,
  };

  constructor(canvas: HTMLCanvasElement, data: Uint8Array, dims: Vec3) {
    this.renderer = new THREE.WebGLRenderer({ canvas, alpha: true, antialias: true });
    this.renderer.setClearColor(0x000000, 0);

    const tex = createVolumeTexture(data, dims);
    this.half = volumeHalfExtents(dims, 1);
    // mostly-frontal so the video face reads at its true aspect; orbit free
    const dist = Math.hypot(...this.half) * 3.4;
    this.camera.position.set(0.45, 0.35, 1).normalize().multiplyScalar(dist);
    this.camera.lookAt(0, 0, 0);
    this.controls = new OrbitControls(this.camera, canvas);
    this.uniforms = {
      uVolume: { value: tex },
      uDensity: { value: 0.08 }, // per-sheet opacity fraction
      uFrames: { value: dims[2] },
      // one frame sheet = half the frame pitch at spacing 1; spacing only widens gaps
      uSliceThick: { value: 0.5 / dims[2] },
      uHalf: { value: new THREE.Vector3(...this.half) },
      uPlaneNormal: { value: new THREE.Vector3(0, 0, 1) },
      uPlaneOffset: { value: 0 },
      uPlaneOn: { value: false },
      uPlaneFlip: { value: false },
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
    this.box = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), mat);
    this.box.scale.set(this.half[0] * 2, this.half[1] * 2, this.half[2] * 2);
    this.scene.add(this.box);
    if (import.meta.env.DEV) {
      (window as unknown as Record<string, unknown>).__vcCube = this;
    }

    // Slice-plane cross-section outline; resized per updatePlane.
    this.linePositions = new THREE.BufferAttribute(new Float32Array(8 * 3), 3);
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', this.linePositions);
    this.line = new THREE.Line(geo, new THREE.LineBasicMaterial({ color: 0x55ffcc }));
    this.line.visible = false;
    this.scene.add(this.line);

    this.resize();
  }

  /** Slider value (0.5-100) maps to per-sheet opacity fraction. */
  setDensity(v: number): void {
    this.uniforms.uDensity.value = v / 100;
  }

  /** Reshape the volume box (video aspect + time-axis spacing). */
  setSpacing(half: Vec3): void {
    this.half = half;
    (this.uniforms.uHalf.value as THREE.Vector3).set(...half);
    this.box.scale.set(half[0] * 2, half[1] * 2, half[2] * 2);
    this.updateOutline();
  }

  setPlane(normal: Vec3, offset: number, on: boolean, flip: boolean): void {
    this.plane = { normal, offset, on, flip };
    (this.uniforms.uPlaneNormal.value as THREE.Vector3).set(...normal);
    this.uniforms.uPlaneOffset.value = offset;
    this.uniforms.uPlaneOn.value = on;
    this.uniforms.uPlaneFlip.value = flip;
    this.updateOutline();
  }

  private updateOutline(): void {
    const { normal, offset, on } = this.plane;
    if (!on) {
      this.line.visible = false;
      return;
    }
    const poly = planeCubePolygon(normal, offset, this.half);
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
    window.addEventListener('resize', this.onResize);
    this.renderer.setAnimationLoop(() => this.renderer.render(this.scene, this.camera));
  }

  private onResize = (): void => this.resize();

  /** Stop the render loop and release listeners; call before replacing the renderer. */
  dispose(): void {
    this.renderer.setAnimationLoop(null);
    window.removeEventListener('resize', this.onResize);
    this.controls.dispose();
    this.scene.traverse((o) => {
      const mesh = o as THREE.Mesh;
      if (mesh.isMesh) {
        mesh.geometry.dispose();
        (mesh.material as THREE.Material).dispose();
      }
    });
    this.renderer.dispose();
  }
}

export const CUBE_VERT = /* glsl */ `
out vec3 vWorld;
void main() {
  vWorld = (modelMatrix * vec4(position, 1.0)).xyz;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;

export const CUBE_FRAG = /* glsl */ `
precision highp float;
precision highp sampler3D;
in vec3 vWorld;
uniform sampler3D uVolume;
uniform float uDensity;
uniform float uFrames;
uniform float uSliceThick;
uniform vec3 uHalf;
uniform vec3 uPlaneNormal;
uniform float uPlaneOffset;
uniform bool uPlaneOn;
uniform bool uPlaneFlip;
out vec4 outColor;

bool rayBox(vec3 ro, vec3 rd, out float t0, out float t1) {
  vec3 inv = 1.0 / rd;
  vec3 a = (-uHalf - ro) * inv;
  vec3 b = (uHalf - ro) * inv;
  vec3 mn = min(a, b);
  vec3 mx = max(a, b);
  t0 = max(max(mn.x, mn.y), mn.z);
  t1 = min(min(mx.x, mx.y), mx.z);
  return t1 > max(t0, 0.0);
}

void main() {
  vec3 ro = cameraPosition;
  vec3 rd = normalize(vWorld - ro);
  float t0, t1;
  if (!rayBox(ro, rd, t0, t1)) discard;
  t0 = max(t0, 0.0);
  if (uPlaneOn) {
    // section cut: keep { dot(p, n) >= d }, or the other side when flipped
    bool keepPos = !uPlaneFlip;
    float dn = dot(rd, uPlaneNormal);
    float f0 = dot(ro, uPlaneNormal) - uPlaneOffset;
    if (abs(dn) < 1e-6) {
      if ((f0 >= 0.0) != keepPos) discard;
    } else {
      // f0 = dot(ro, n) - d  =>  plane crossing at t = -f0 / dn
      float tc = -f0 / dn;
      if ((dn > 0.0) == keepPos) t0 = max(t0, tc);
      else t1 = min(t1, tc);
    }
  }
  if (t1 <= t0) discard;
  // March sheet by sheet: each frame is a thin slab around its z center.
  float pitch = 2.0 * uHalf.z / uFrames;
  float ht = 0.5 * min(uSliceThick, pitch); // sheet half-thickness (never overlaps neighbor)
  vec3 acc = vec3(0.0);
  float accA = 0.0;
  for (int i = 0; i < 192; i++) {
    if (i >= int(uFrames)) break;
    // march in ray order (near -> far) so the nearest sheet composites last-in-weight
    int k = rd.z >= 0.0 ? i : (int(uFrames) - 1 - i);
    float zc = -uHalf.z + (float(k) + 0.5) * pitch;
    float ta = (zc - ht - ro.z) / rd.z;
    float tb = (zc + ht - ro.z) / rd.z;
    float s0 = max(min(ta, tb), t0);
    float s1 = min(max(ta, tb), t1);
    if (s1 <= s0) continue;
    // uDensity = per-sheet opacity; thin chords (grazing clip) scale proportionally
    float sa = uDensity * clamp((s1 - s0) / uSliceThick, 0.0, 1.0);
    vec3 p = ro + rd * (0.5 * (s0 + s1));
    vec3 uvw = vec3(p.x / (2.0 * uHalf.x) + 0.5, 0.5 - p.y / (2.0 * uHalf.y), (float(k) + 0.5) / uFrames);
    vec3 c = texture(uVolume, uvw).rgb;
    acc += (1.0 - accA) * sa * c;
    accA += (1.0 - accA) * sa;
    if (accA > 0.99) break;
  }
  if (accA < 0.004) discard;
  outColor = vec4(acc, accA);
}
`;

export const RESLICE_VERT = /* glsl */ `
out vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;

export const RESLICE_FRAG = /* glsl */ `
precision highp float;
precision highp sampler3D;
in vec2 vUv;
uniform sampler3D uVolume;
uniform vec3 uNormal;
uniform vec3 uU;
uniform vec3 uV;
uniform vec3 uHalf;
uniform float uOffset;
uniform float uExtent;
out vec4 outColor;
void main() {
  vec3 p = uNormal * uOffset
         + uU * ((vUv.x - 0.5) * uExtent)
         + uV * ((vUv.y - 0.5) * uExtent);
  vec3 uvw = vec3(p.x / (2.0 * uHalf.x) + 0.5, 0.5 - p.y / (2.0 * uHalf.y), p.z / (2.0 * uHalf.z) + 0.5);
  if (any(lessThan(uvw, vec3(0.0))) || any(greaterThan(uvw, vec3(1.0)))) {
    outColor = vec4(0.0);
    return;
  }
  outColor = vec4(texture(uVolume, uvw).rgb, 1.0);
}
`;

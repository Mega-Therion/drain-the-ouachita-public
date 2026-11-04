import * as THREE from 'three';
import { G, COMMON_GLSL } from '../render/common.js';

// Suspended particles and a school of fish around the camera when diving.

const PART_VERT = /* glsl */`
${COMMON_GLSL}
uniform vec3 uCenter;
uniform float uBox;
attribute float aSeed;
varying float vA;
void main() {
  vec3 p = position;
  p.y += sin(uTime * 0.3 + aSeed * 6.28) * 0.15 - uTime * 0.05 * fract(aSeed * 7.1);
  // wrap into a box that follows the camera
  vec3 rel = mod(p - uCenter + uBox * 0.5, uBox) - uBox * 0.5;
  vec3 wp = uCenter + rel;
  vec4 mv = viewMatrix * vec4(wp, 1.0);
  float d = -mv.z;
  vA = clamp(1.0 - d / (uBox * 0.5), 0.0, 1.0) * clamp(d / 0.6, 0.0, 1.0);
  gl_PointSize = clamp(60.0 / d, 1.0, 9.0);
  gl_Position = projectionMatrix * mv;
}
`;
const PART_FRAG = /* glsl */`
${COMMON_GLSL}
varying float vA;
void main() {
  vec2 c = gl_PointCoord - 0.5;
  float a = smoothstep(0.5, 0.0, length(c)) * vA * 0.55;
  if (a < 0.01) discard;
  vec3 col = uWaterTint * (uSkyUp * 3.0 + uLightColor * 1.2) + vec3(0.04, 0.05, 0.04);
  gl_FragColor = vec4(col * a, a);
}
`;

const FISH_VERT = /* glsl */`
${COMMON_GLSL}
attribute vec4 aFish; // phase, speed, radius, height offset
uniform vec3 uSchool;
varying vec3 vN;
varying vec3 vWorld;
varying float vSide;
void main() {
  float ph = aFish.x + uTime * aFish.y * 0.25;
  float r = aFish.z;
  vec3 c = uSchool + vec3(cos(ph) * r, aFish.w + sin(ph * 2.0) * 0.4, sin(ph) * r);
  vec3 fwd = normalize(vec3(-sin(ph), cos(ph * 2.0) * 0.1, cos(ph)));
  vec3 side = normalize(cross(vec3(0.0, 1.0, 0.0), fwd));
  vec3 p = position;
  // tail wiggle
  p.x += sin(uTime * 9.0 + aFish.x * 10.0 + p.z * 6.0) * 0.06 * smoothstep(0.0, -0.25, p.z);
  vec3 wp = c + side * p.x + vec3(0.0, 1.0, 0.0) * p.y + fwd * p.z;
  vN = normalize(side * normal.x + vec3(0.0, 1.0, 0.0) * normal.y + fwd * normal.z);
  vWorld = wp;
  vSide = p.y;
  gl_Position = projectionMatrix * viewMatrix * vec4(wp, 1.0);
}
`;
const FISH_FRAG = /* glsl */`
${COMMON_GLSL}
varying vec3 vN;
varying vec3 vWorld;
varying float vSide;
void main() {
  vec3 N = normalize(vN);
  vec3 alb = mix(vec3(0.25, 0.28, 0.24), vec3(0.75, 0.78, 0.72), smoothstep(0.0, -0.04, vSide));
  vec3 V = normalize(cameraPosition - vWorld);
  float spec = pow(max(dot(reflect(-uLightDir, N), V), 0.0), 24.0) * 0.6;
  vec3 col = alb * (ambientLight(N) * 1.3 + uLightColor * max(dot(N, uLightDir), 0.0) * 0.5) + uLightColor * spec;
  col = applyAerial(col, vWorld);
  gl_FragColor = vec4(col, 1.0);
}
`;

function fishGeometry() {
  // a small spindle body + tail fin, length ~0.35 m (bass-sized)
  const g = new THREE.SphereGeometry(0.06, 8, 6);
  g.scale(0.55, 1.0, 2.9);
  const tail = new THREE.BufferGeometry();
  tail.setAttribute('position', new THREE.Float32BufferAttribute([0, 0, -0.16, 0, 0.07, -0.27, 0, -0.07, -0.27], 3));
  tail.setAttribute('normal', new THREE.Float32BufferAttribute([1, 0, 0, 1, 0, 0, 1, 0, 0], 3));
  tail.setAttribute('uv', new THREE.Float32BufferAttribute([0, 0, 0, 1, 1, 1], 2));
  const merged = new THREE.BufferGeometry();
  const a = g.toNonIndexed();
  const pos = [...a.attributes.position.array, ...tail.attributes.position.array];
  const nor = [...a.attributes.normal.array, ...tail.attributes.normal.array];
  merged.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  merged.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  return merged;
}

export class Underwater {
  constructor() {
    this.group = new THREE.Group();
    this.group.visible = false;
    const N = 1800;
    const pos = new Float32Array(N * 3); const seed = new Float32Array(N);
    for (let i = 0; i < N; i++) { pos[i * 3] = Math.random() * 40; pos[i * 3 + 1] = Math.random() * 40; pos[i * 3 + 2] = Math.random() * 40; seed[i] = Math.random(); }
    const pg = new THREE.BufferGeometry();
    pg.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    pg.setAttribute('aSeed', new THREE.BufferAttribute(seed, 1));
    this.partUniforms = { uCenter: { value: new THREE.Vector3() }, uBox: { value: 40 } };
    this.points = new THREE.Points(pg, new THREE.ShaderMaterial({
      uniforms: { ...G, ...this.partUniforms }, vertexShader: PART_VERT, fragmentShader: PART_FRAG,
      transparent: true, depthWrite: false, blending: THREE.CustomBlending,
      blendSrc: THREE.OneFactor, blendDst: THREE.OneMinusSrcAlphaFactor,
    }));
    this.points.frustumCulled = false;
    this.group.add(this.points);
    // fish school
    const F = 70;
    const fg = new THREE.InstancedBufferGeometry().copy(fishGeometry());
    fg.instanceCount = F;
    const af = new Float32Array(F * 4);
    for (let i = 0; i < F; i++) {
      af[i * 4] = Math.random() * 6.28; af[i * 4 + 1] = 0.7 + Math.random() * 0.5;
      af[i * 4 + 2] = 2.5 + Math.random() * 3.5; af[i * 4 + 3] = (Math.random() - 0.5) * 2.5;
    }
    fg.setAttribute('aFish', new THREE.InstancedBufferAttribute(af, 4));
    this.schoolU = { uSchool: { value: new THREE.Vector3() } };
    this.fish = new THREE.Mesh(fg, new THREE.ShaderMaterial({ uniforms: { ...G, ...this.schoolU }, vertexShader: FISH_VERT, fragmentShader: FISH_FRAG, side: THREE.DoubleSide }));
    this.fish.frustumCulled = false;
    this.group.add(this.fish);
    this.school = new THREE.Vector3();
  }

  update(camera, under, bedY, surfY) {
    this.group.visible = under;
    if (!under) return;
    this.partUniforms.uCenter.value.copy(camera.position);
    // keep the school a few metres ahead of the diver, between bed and surface
    const dir = new THREE.Vector3(); camera.getWorldDirection(dir);
    const want = camera.position.clone().addScaledVector(dir.setY(0).normalize(), 9);
    want.y = THREE.MathUtils.clamp(camera.position.y, bedY + 1.5, surfY - 1.0);
    if (this.school.distanceTo(want) > 30) this.school.copy(want);
    this.school.lerp(want, 0.01);
    this.schoolU.uSchool.value.copy(this.school);
  }
}

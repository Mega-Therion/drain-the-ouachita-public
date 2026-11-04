import * as THREE from 'three';
import { G, RT } from '../render/common.js';

// Ray-marched cumulus layer rendered at reduced resolution after the opaque
// pass (depth aware), composited in the final pass. Coverage uses the same 2D
// noise as the cloud shadows on the ground, so shadows line up with clouds.

function make3DNoise(N = 64) {
  // tileable Worley-Perlin-ish noise packed in R (shape) and G (detail)
  const rnd = (() => { let s = 7; return () => { s = (s * 16807) % 2147483647; return s / 2147483647; }; })();
  const data = new Uint8Array(N * N * N * 4);
  const cellsA = 6; const cellsB = 12;
  const ptsA = []; const ptsB = [];
  for (let i = 0; i < cellsA ** 3; i++) ptsA.push([rnd(), rnd(), rnd()]);
  for (let i = 0; i < cellsB ** 3; i++) ptsB.push([rnd(), rnd(), rnd()]);
  const worley = (x, y, z, C, pts) => {
    const fx = x * C; const fy = y * C; const fz = z * C;
    const ix = Math.floor(fx); const iy = Math.floor(fy); const iz = Math.floor(fz);
    let md = 9;
    for (let dz = -1; dz <= 1; dz++) for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
      const cx = ix + dx; const cy = iy + dy; const cz = iz + dz;
      const wx = ((cx % C) + C) % C; const wy = ((cy % C) + C) % C; const wz = ((cz % C) + C) % C;
      const p = pts[(wz * C + wy) * C + wx];
      const ddx = cx + p[0] - fx; const ddy = cy + p[1] - fy; const ddz = cz + p[2] - fz;
      const d = ddx * ddx + ddy * ddy + ddz * ddz;
      if (d < md) md = d;
    }
    return Math.sqrt(md);
  };
  for (let z = 0; z < N; z++) for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
    const u = x / N; const v = y / N; const w = z / N;
    const a = 1 - Math.min(1, worley(u, v, w, cellsA, ptsA) * 1.3);
    const b = 1 - Math.min(1, worley(u, v, w, cellsB, ptsB) * 1.3);
    const o = ((z * N + y) * N + x) * 4;
    data[o] = Math.max(0, Math.min(255, (a * 0.75 + b * 0.25) * 255));
    data[o + 1] = b * 255;
    data[o + 2] = 0; data[o + 3] = 255;
  }
  const t = new THREE.Data3DTexture(data, N, N, N);
  t.format = THREE.RGBAFormat;
  t.wrapS = t.wrapT = t.wrapR = THREE.RepeatWrapping;
  t.minFilter = THREE.LinearFilter; t.magFilter = THREE.LinearFilter;
  t.needsUpdate = true;
  return t;
}

const FRAG = /* glsl */`
precision highp float;
precision highp sampler3D;
uniform sampler2D uDepth;
uniform sampler3D uNoise3;
uniform sampler2D uNoiseTex;
uniform sampler2D uSkyLUT;
uniform mat4 uInvProjView;
uniform vec3 uCam;
uniform vec3 uSunDir;
uniform vec3 uLightColor;
uniform vec3 uSkyUp;
uniform vec3 uSkyHorizon;
uniform vec4 uCloud;      // cover, offx, offy, shadow
uniform float uDepthMode; // 1 = reversed z (0..1), 0 = standard (-1..1)
uniform float uFrame;
uniform float uSteps;
uniform float uNight;
uniform sampler2D uHist;
uniform mat4 uPrevVP;
uniform float uHistOn;
uniform float uVol;
varying vec2 vUv;
#define PI 3.14159265
const float BASE = 1450.0, TOP = 2700.0;

float fbm2(vec2 p) {
  float a = 0.5, s = 0.0;
  for (int i = 0; i < 4; i++) { s += a * texture(uNoiseTex, p / 256.0).g; p = p * 2.03 + 17.1; a *= 0.5; }
  return s / 0.9375;
}
float coverage(vec2 xz) {
  vec2 p = xz * 0.0004 + uCloud.yz;
  float n = fbm2(p * 6.0);
  return smoothstep(1.0 - uCloud.x, 1.0 - uCloud.x + 0.25, n);
}
float density(vec3 p, float cov) {
  float h = (p.y - BASE) / (TOP - BASE);
  if (h < 0.0 || h > 1.0) return 0.0;
  // cumulus profile: flat-ish base, rounded tops
  float prof = smoothstep(0.0, 0.12, h) * smoothstep(1.0, 0.45 - 0.35 * cov, h);
  vec3 q = p * 0.00028 + vec3(uCloud.y, 0.0, uCloud.z) * 4.0;
  float shape = texture(uNoise3, q).r;
  float d = cov * prof - (1.0 - shape) * 0.55;
  if (d <= 0.0) return 0.0;
  float detail = texture(uNoise3, q * 4.3 + vec3(0.0, uCloud.y, 0.0)).g;
  d -= (1.0 - detail) * 0.18 * (1.0 - h * 0.5);
  return max(d, 0.0) * 0.045;
}
float hg(float c, float g) { float g2 = g * g; return (1.0 - g2) / (4.0 * PI * pow(1.0 + g2 - 2.0 * g * c, 1.5)); }
vec2 skyUV(vec3 d) {
  float el = asin(clamp(d.y, -1.0, 1.0));
  float v = 0.5 + 0.5 * sign(el) * sqrt(abs(el) / (PI * 0.5));
  vec2 a = normalize(d.xz + 1e-5); vec2 s = normalize(uSunDir.xz + 1e-5);
  return vec2(acos(clamp(dot(a, s), -1.0, 1.0)) / PI, v);
}
// interleaved gradient noise: blue-noise-like dither, far less blocky than white noise
float ign(vec2 p) { return fract(52.9829189 * fract(dot(p, vec2(0.06711056, 0.00583715)))); }

void main() {
  float dz = texture(uDepth, vUv).r;
  vec4 ndc = vec4(vUv * 2.0 - 1.0, uDepthMode > 0.5 ? dz : dz * 2.0 - 1.0, 1.0);
  vec4 wp = uInvProjView * ndc; wp /= wp.w;
  vec4 fp = uInvProjView * vec4(vUv * 2.0 - 1.0, uDepthMode > 0.5 ? 0.0001 : 0.9999, 1.0); fp /= fp.w;
  vec3 dir = normalize(fp.xyz - uCam);
  bool sky = uDepthMode > 0.5 ? dz <= 0.0 : dz >= 1.0;
  float sceneT = sky ? 1e9 : length(wp.xyz - uCam);
  // 2.5D cumulus layer: intersect the ray with the layer's mid plane, then shade
  float H = 2050.0;
  if (abs(dir.y) < 1e-3 || uCloud.x < 0.02) { gl_FragColor = vec4(0.0, 0.0, 0.0, 1.0); return; }
  float t = (H - uCam.y) / dir.y;
  if (t <= 0.0 || t > sceneT || t > 90000.0) { gl_FragColor = vec4(0.0, 0.0, 0.0, 1.0); return; }
  vec3 p = uCam + dir * t;
  float cov = coverage(p.xz);
  vec3 q = vec3(p.x, 0.0, p.z) * 0.00022 + vec3(uCloud.y, 0.37, uCloud.z) * 3.0;
  float puff = texture(uNoise3, q).r * 0.65 + texture(uNoise3, q * 3.7 + 0.21).g * 0.35;
  float dens = smoothstep(0.28, 0.75, cov * (0.55 + 0.75 * puff));
  if (dens <= 0.002) { gl_FragColor = vec4(0.0, 0.0, 0.0, 1.0); return; }
  // optical depth grows at grazing angles (we look through more cloud)
  float tau = dens * (3.0 + 6.0 * uCloud.x) / max(abs(dir.y), 0.12) * 0.35;
  float alpha = 1.0 - exp(-tau);
  // volumetric refinement only where the 2.5D layer says there is real cloud
  float volLit = 1.0;
  if (uVol > 0.5 && dens > 0.08) {
    float ta = (BASE - uCam.y) / dir.y, tb = (TOP - uCam.y) / dir.y;
    float s0 = max(min(ta, tb), 0.0), s1 = min(max(ta, tb), s0 + 3500.0);
    float ds = (s1 - s0) / 7.0;
    float sv = s0 + ds * ign(gl_FragCoord.xy + uFrame * 5.588238);
    float Tv = 1.0; float lsum = 0.0;
    for (int i = 0; i < 7; i++) {
      vec3 q3 = uCam + dir * sv;
      float c3 = coverage(q3.xz);
      float d3 = density(q3, c3);
      if (d3 > 0.0) {
        float od = density(q3 + uSunDir * 220.0, c3) * 220.0 + density(q3 + uSunDir * 520.0, c3) * 300.0;
        float a3 = exp(-d3 * ds);
        lsum += Tv * (1.0 - a3) * exp(-od * 1.3);
        Tv *= a3;
      }
      sv += ds;
    }
    float aV = 1.0 - Tv;
    alpha = mix(alpha, max(alpha * 0.6, aV), 0.65);
    volLit = aV > 0.01 ? clamp(lsum / aV, 0.0, 1.0) * 0.8 + 0.2 : 1.0;
  }
  // self shadowing: how much cloud lies toward the sun from here
  vec2 toSun = normalize(uSunDir.xz + 1e-4) * 650.0;
  float c2 = coverage(p.xz + toSun);
  vec3 q2 = vec3(p.x + toSun.x, 0.0, p.z + toSun.y) * 0.00022 + vec3(uCloud.y, 0.37, uCloud.z) * 3.0;
  float d2 = smoothstep(0.28, 0.75, c2 * (0.55 + 0.75 * texture(uNoise3, q2).r));
  float lit = (exp(-d2 * 2.2) * 0.85 + 0.15) * volLit;
  float mu = dot(dir, uSunDir);
  float phase = mix(hg(mu, 0.55), hg(mu, -0.2), 0.35) * 4.0 * PI;
  // underside darker, tops brighter when seen from above
  float under = dir.y > 0.0 ? 1.0 : 0.0;
  vec3 amb = mix(uSkyHorizon, uSkyUp, 0.55) * mix(1.25, 0.75, dens * under);
  vec3 sun = uLightColor * lit * mix(0.55, 1.0, phase * 0.35) * mix(1.0, 0.55, dens * under) * 1.35;
  // silver lining at the edges when looking toward the sun
  sun += uLightColor * pow(max(mu, 0.0), 8.0) * (1.0 - dens) * 2.0;
  vec3 col = (amb + sun) * alpha;
  float T = 1.0 - alpha;
  // aerial perspective
  float fade = exp(-t / 55000.0);
  vec3 skyc = texture(uSkyLUT, skyUV(vec3(dir.x, max(dir.y, 0.01), dir.z))).rgb;
  col = mix(skyc * alpha, col, fade);
  vec4 cur = vec4(col, T);
  if (uHistOn > 0.5) {
    vec4 pc = uPrevVP * vec4(p, 1.0);
    vec2 puv = pc.xy / pc.w * 0.5 + 0.5;
    if (pc.w > 0.0 && all(greaterThan(puv, vec2(0.0))) && all(lessThan(puv, vec2(1.0)))) {
      vec4 h = texture(uHist, puv);
      cur = mix(cur, h, 0.82);
    }
  }
  gl_FragColor = cur;
}
`;

export class Clouds {
  constructor(renderer, reversed) {
    this.r = renderer;
    this.reversed = reversed;
    this.rt = null;
    this.scale = 0.25;
    this.mat = new THREE.ShaderMaterial({
      uniforms: {
        uDepth: { value: null }, uNoise3: { value: make3DNoise() }, uNoiseTex: G.uNoiseTex, uSkyLUT: G.uSkyLUT,
        uInvProjView: { value: new THREE.Matrix4() }, uCam: { value: new THREE.Vector3() },
        uSunDir: G.uSunDir, uLightColor: G.uLightColor, uSkyUp: G.uSkyUp, uSkyHorizon: G.uSkyHorizon,
        uCloud: G.uCloud, uDepthMode: { value: reversed ? 1 : 0 }, uFrame: { value: 0 }, uSteps: { value: 20 }, uNight: G.uNight, uHist: { value: null }, uPrevVP: { value: new THREE.Matrix4() }, uHistOn: { value: 0 }, uVol: { value: 0 },
      },
      vertexShader: 'varying vec2 vUv; void main(){ vUv = position.xy*0.5+0.5; gl_Position = vec4(position.xy,0.0,1.0); }',
      fragmentShader: FRAG, depthTest: false, depthWrite: false,
    });
    this.scene = new THREE.Scene();
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute([-1, -1, 0, 3, -1, 0, -1, 3, 0], 3));
    const q = new THREE.Mesh(g, this.mat); q.frustumCulled = false;
    this.scene.add(q);
    this.cam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
    this.frame = 0;
  }

  setQuality(level) {
    // 0 off, 1 low, 2 medium, 3 high
    this.level = level;
    this.scale = level >= 3 ? 0.5 : level === 2 ? 0.33 : 0.25;
    this.mat.uniforms.uSteps.value = level >= 3 ? 28 : level === 2 ? 20 : 14;
  }

  render(camera, targets) {
    if (!this.level || G.uCloud.value.x < 0.02) return null;
    const w = Math.max(1, Math.floor(targets.main.width * this.scale));
    const h = Math.max(1, Math.floor(targets.main.height * this.scale));
    if (!this.rts || this.rts[0].width !== w || this.rts[0].height !== h) {
      if (this.rts) this.rts.forEach((t) => t.dispose());
      const o = { type: RT.type, depthBuffer: false, minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter };
      this.rts = [new THREE.WebGLRenderTarget(w, h, o), new THREE.WebGLRenderTarget(w, h, o)];
      this.histValid = false;
    }
    const cur = this.rts[this.frame % 2]; const prev = this.rts[(this.frame + 1) % 2];
    const u = this.mat.uniforms;
    u.uDepth.value = targets.main.depthTexture;
    u.uInvProjView.value.multiplyMatrices(camera.matrixWorld, camera.projectionMatrixInverse);
    u.uCam.value.copy(camera.position);
    u.uFrame.value = (this.frame % 64);
    u.uHist.value = prev.texture;
    u.uHistOn.value = this.histValid ? 1 : 0;
    u.uVol.value = this.level >= 2 ? 1 : 0;
    this.r.setRenderTarget(cur);
    this.r.render(this.scene, this.cam);
    u.uPrevVP.value.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
    this.histValid = true;
    this.frame++;
    return cur.texture;
  }
}

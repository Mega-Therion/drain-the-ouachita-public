import * as THREE from 'three';
import { G, RT } from '../render/common.js';
import { sunPosition, moonPosition, altAzToDir } from '../geo.js';

// Physically based single-scattering sky (Rayleigh + Mie + ozone), baked into a
// small sky-view LUT whenever the sun moves; the same model on the CPU gives the
// sun colour and ambient light. Units: km for the atmosphere.
const RE = 6360.0; const RA = 6460.0;
const BETA_R = [5.802e-3, 13.558e-3, 33.1e-3];
const BETA_M = 3.996e-3;
const BETA_O = [0.650e-3, 1.881e-3, 0.085e-3];
const HR = 8.0; const HM = 1.2;

const LUT_FRAG = /* glsl */`
precision highp float;
uniform vec3 uSun;        // sun direction in LUT frame
uniform float uAlt;       // observer altitude km
uniform float uMie;       // turbidity multiplier
uniform float uSunE;      // sun irradiance scale
varying vec2 vUv;
#define PI 3.14159265
const float RE = 6360.0, RA = 6460.0, HR = 8.0, HM = 1.2;
const vec3 BR = vec3(5.802e-3, 13.558e-3, 33.1e-3);
const float BM = 3.996e-3;
const vec3 BO = vec3(0.650e-3, 1.881e-3, 0.085e-3);
vec2 rs(vec3 ro, vec3 rd, float r) {
  float b = dot(ro, rd); float c = dot(ro, ro) - r * r; float d = b * b - c;
  if (d < 0.0) return vec2(1e9, -1e9);
  d = sqrt(d); return vec2(-b - d, -b + d);
}
vec3 extinctionAt(float h) {
  float r = exp(-h / HR); float m = exp(-h / HM); float o = max(0.0, 1.0 - abs(h - 25.0) / 15.0);
  return BR * r + BM * uMie * 1.11 * m + BO * o;
}
vec3 transmittanceToSun(vec3 p) {
  vec2 t = rs(p, uSun, RA);
  float L = t.y; float dt = L / 8.0; vec3 od = vec3(0.0);
  for (int i = 0; i < 8; i++) { vec3 q = p + uSun * (float(i) + 0.5) * dt; od += extinctionAt(length(q) - RE) * dt; }
  vec2 g = rs(p, uSun, RE);
  if (g.x > 0.0) return vec3(0.0);
  return exp(-od);
}
void main() {
  float v = vUv.y * 2.0 - 1.0;
  float el = sign(v) * v * v * PI * 0.5;
  float az = vUv.x * PI;
  vec3 dir = vec3(cos(el) * cos(az), sin(el), cos(el) * sin(az));
  vec3 ro = vec3(0.0, RE + uAlt, 0.0);
  vec2 ta = rs(ro, dir, RA);
  vec2 tg = rs(ro, dir, RE);
  float tmax = ta.y;
  if (tg.x > 0.0) tmax = min(tmax, tg.x);
  float dt = tmax / 24.0;
  vec3 sumR = vec3(0.0), sumM = vec3(0.0), od = vec3(0.0);
  for (int i = 0; i < 24; i++) {
    float s = (float(i) + 0.5) * dt;
    vec3 p = ro + dir * s;
    float h = length(p) - RE;
    vec3 ext = extinctionAt(h);
    od += ext * dt;
    vec3 T = exp(-od) * transmittanceToSun(p);
    sumR += T * exp(-h / HR) * dt;
    sumM += T * exp(-h / HM) * dt;
  }
  float mu = dot(dir, uSun);
  float pr = 3.0 / (16.0 * PI) * (1.0 + mu * mu);
  float g = 0.76;
  float pm = 3.0 / (8.0 * PI) * ((1.0 - g * g) * (1.0 + mu * mu)) / ((2.0 + g * g) * pow(1.0 + g * g - 2.0 * g * mu, 1.5));
  vec3 L = uSunE * (sumR * BR * pr + sumM * BM * uMie * pm);
  // multiple-scattering fudge: lift shadows of the sky a little
  L += uSunE * 0.012 * BR * 30.0 * max(uSun.y + 0.1, 0.0);
  gl_FragColor = vec4(L, 1.0);
}
`;

const SKY_VERT = /* glsl */`
varying vec3 vDir;
uniform mat4 uInvProjView;
void main() {
  vec2 p = position.xy;
  vec4 w = uInvProjView * vec4(p, 1.0, 1.0);
  vDir = w.xyz / w.w - cameraPosition;
  gl_Position = vec4(p, 0.99999, 1.0);
}
`;

const SKY_FRAG = /* glsl */`
uniform sampler2D uSkyLUT;
uniform vec3 uSunDir;
uniform vec3 uMoonDir;
uniform vec3 uSunDiskColor;
uniform float uNight;
uniform float uMoonFrac;
uniform vec3 uFogBelow;
uniform float uTime;
uniform vec4 uCloud;
uniform sampler2D uNoiseTex;
varying vec3 vDir;
#define PI 3.14159265
float hash13(vec3 p3) { p3 = fract(p3 * .1031); p3 += dot(p3, p3.zyx + 31.32); return fract((p3.x + p3.y) * p3.z); }
vec2 skyUV(vec3 d) {
  float el = asin(clamp(d.y, -1.0, 1.0));
  float v = 0.5 + 0.5 * sign(el) * sqrt(abs(el) / (PI * 0.5));
  vec2 a = normalize(d.xz + 1e-5); vec2 s = normalize(uSunDir.xz + 1e-5);
  return vec2(acos(clamp(dot(a, s), -1.0, 1.0)) / PI, v);
}
void main() {
  vec3 d = normalize(vDir);
  vec3 col = texture(uSkyLUT, skyUV(vec3(d.x, max(d.y, 0.0), d.z))).rgb;
  // sun disk with limb darkening
  float cs = dot(d, uSunDir);
  float sunR = 0.00475;
  float ang = acos(clamp(cs, -1.0, 1.0));
  if (ang < sunR * 1.6) {
    float k = clamp(1.0 - ang / sunR, 0.0, 1.0);
    float limb = pow(max(k, 0.0), 0.4);
    col += uSunDiskColor * limb * 60.0 * smoothstep(-0.01, 0.0, d.y);
  }
  // night: stars + moon
  if (uNight > 0.01) {
    vec3 sd = d * 420.0;
    vec3 cell = floor(sd);
    float h = hash13(cell);
    float star = step(0.9965, h) * pow(hash13(cell + 7.0), 6.0);
    vec3 f = fract(sd) - 0.5;
    star *= smoothstep(0.25, 0.0, length(f));
    float tw = 0.7 + 0.3 * sin(uTime * 3.0 + h * 100.0);
    col += vec3(0.9, 0.95, 1.0) * star * tw * 6.0 * uNight * smoothstep(0.0, 0.15, d.y);
    // milky way haze band
    float band = exp(-pow(dot(d, normalize(vec3(0.4, 0.55, -0.73))) * 3.2, 2.0));
    col += vec3(0.02, 0.022, 0.03) * band * uNight * smoothstep(0.0, 0.3, d.y);
    float cm = dot(d, uMoonDir);
    float ma = acos(clamp(cm, -1.0, 1.0));
    if (ma < 0.0065) col += vec3(0.95, 0.93, 0.88) * 3.0 * uMoonFrac * uNight;
    col += vec3(0.6, 0.65, 0.8) * 0.02 * pow(max(cm, 0.0), 60.0) * uMoonFrac * uNight;
    col += vec3(0.002, 0.003, 0.006) * uNight;
  }
  // below the horizon: haze colour so the world edge melts away
  col = mix(col, uFogBelow, smoothstep(0.0, -0.04, d.y));
  gl_FragColor = vec4(col, 1.0);
}
`;

function rs(ro, rd, r) {
  const b = ro[0] * rd[0] + ro[1] * rd[1] + ro[2] * rd[2];
  const c = ro[0] * ro[0] + ro[1] * ro[1] + ro[2] * ro[2] - r * r;
  const d = b * b - c;
  if (d < 0) return [1e9, -1e9];
  const s = Math.sqrt(d);
  return [-b - s, -b + s];
}

function extinction(h, mie) {
  const r = Math.exp(-h / HR); const m = Math.exp(-h / HM); const o = Math.max(0, 1 - Math.abs(h - 25) / 15);
  return [0, 1, 2].map((i) => BETA_R[i] * r + BETA_M * mie * 1.11 * m + BETA_O[i] * o);
}

export class Atmosphere {
  constructor(renderer) {
    this.renderer = renderer;
    this.lut = new THREE.WebGLRenderTarget(192, 96, {
      type: RT.type, format: THREE.RGBAFormat, depthBuffer: false,
      minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter, wrapS: THREE.ClampToEdgeWrapping, wrapT: THREE.ClampToEdgeWrapping,
    });
    this.lutMat = new THREE.ShaderMaterial({
      uniforms: { uSun: { value: new THREE.Vector3() }, uAlt: { value: 0.3 }, uMie: { value: 1.0 }, uSunE: { value: 22 } },
      vertexShader: 'varying vec2 vUv; void main(){ vUv = position.xy*0.5+0.5; gl_Position = vec4(position.xy,0.,1.); }',
      fragmentShader: LUT_FRAG, depthTest: false, depthWrite: false,
    });
    this.quadScene = new THREE.Scene();
    const tri = new THREE.BufferGeometry();
    tri.setAttribute('position', new THREE.Float32BufferAttribute([-1, -1, 0, 3, -1, 0, -1, 3, 0], 3));
    this.tri = tri;
    this.quad = new THREE.Mesh(tri, this.lutMat);
    this.quad.frustumCulled = false;
    this.quadScene.add(this.quad);
    this.quadCam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
    G.uSkyLUT.value = this.lut.texture;

    this.skyMat = new THREE.ShaderMaterial({
      uniforms: {
        uSkyLUT: G.uSkyLUT, uSunDir: G.uSunDir, uTime: G.uTime, uCloud: G.uCloud, uNoiseTex: G.uNoiseTex,
        uMoonDir: { value: new THREE.Vector3(0, 1, 0) }, uSunDiskColor: { value: new THREE.Color(1, 1, 1) },
        uNight: G.uNight, uMoonFrac: { value: 0.5 }, uFogBelow: { value: new THREE.Color(0.5, 0.55, 0.6) },
        uInvProjView: { value: new THREE.Matrix4() },
      },
      vertexShader: SKY_VERT, fragmentShader: SKY_FRAG, depthWrite: false, depthTest: false,
    });
    this.sky = new THREE.Mesh(tri, this.skyMat);
    this.sky.frustumCulled = false;
    this.sky.renderOrder = -1000;
    this.sunDir = new THREE.Vector3();
    this.moonDir = new THREE.Vector3();
    this.turbidity = 1.0;
    this.dirty = true;
    this.lastKey = '';
    this._ipv = new THREE.Matrix4();
  }

  /** CPU sky radiance along a direction (for ambient light), same model as the LUT. */
  skyRadiance(dir, sun, alt = 0.3, steps = 12) {
    const ro = [0, RE + alt, 0];
    const ta = rs(ro, dir, RA); const tg = rs(ro, dir, RE);
    let tmax = ta[1]; if (tg[0] > 0) tmax = Math.min(tmax, tg[0]);
    const dt = tmax / steps;
    const sumR = [0, 0, 0]; const sumM = [0, 0, 0]; const od = [0, 0, 0];
    for (let i = 0; i < steps; i++) {
      const s = (i + 0.5) * dt;
      const p = [ro[0] + dir[0] * s, ro[1] + dir[1] * s, ro[2] + dir[2] * s];
      const h = Math.hypot(p[0], p[1], p[2]) - RE;
      const ext = extinction(h, this.turbidity);
      for (let c = 0; c < 3; c++) od[c] += ext[c] * dt;
      const Ts = this.transmittance(p, sun);
      const er = Math.exp(-h / HR); const em = Math.exp(-h / HM);
      for (let c = 0; c < 3; c++) {
        const T = Math.exp(-od[c]) * Ts[c];
        sumR[c] += T * er * dt; sumM[c] += T * em * dt;
      }
    }
    const mu = dir[0] * sun[0] + dir[1] * sun[1] + dir[2] * sun[2];
    const pr = 3 / (16 * Math.PI) * (1 + mu * mu);
    const g = 0.76;
    const pm = 3 / (8 * Math.PI) * ((1 - g * g) * (1 + mu * mu)) / ((2 + g * g) * Math.pow(1 + g * g - 2 * g * mu, 1.5));
    const E = 22;
    return [0, 1, 2].map((c) => E * (sumR[c] * BETA_R[c] * pr + sumM[c] * BETA_M * this.turbidity * pm) + E * 0.012 * BETA_R[c] * 30 * Math.max(sun[1] + 0.1, 0));
  }

  transmittance(p, sun) {
    const t = rs(p, sun, RA);
    const g = rs(p, sun, RE);
    if (g[0] > 0) return [0, 0, 0];
    const L = t[1]; const dt = L / 10; const od = [0, 0, 0];
    for (let i = 0; i < 10; i++) {
      const s = (i + 0.5) * dt;
      const q = [p[0] + sun[0] * s, p[1] + sun[1] * s, p[2] + sun[2] * s];
      const h = Math.hypot(q[0], q[1], q[2]) - RE;
      const e = extinction(h, this.turbidity);
      for (let c = 0; c < 3; c++) od[c] += e[c] * dt;
    }
    return od.map((x) => Math.exp(-x));
  }

  /** Set time & location; recomputes LUT + lights when needed. */
  update(date, lat, lon, weather) {
    const sp = sunPosition(date, lat, lon);
    const mp = moonPosition(date, lat, lon);
    altAzToDir(sp.azimuth, sp.altitude, this.sunDir);
    altAzToDir(mp.azimuth, mp.altitude, this.moonDir);
    this.turbidity = weather.turbidity;
    const key = `${this.sunDir.x.toFixed(4)},${this.sunDir.y.toFixed(4)},${this.sunDir.z.toFixed(4)},${this.turbidity}`;
    G.uSunDir.value.copy(this.sunDir);
    this.skyMat.uniforms.uMoonDir.value.copy(this.moonDir);
    this.skyMat.uniforms.uMoonFrac.value = mp.fraction;
    if (key === this.lastKey && !this.dirty) return;
    this.lastKey = key; this.dirty = false;

    // LUT frame: sun at azimuth 0
    const se = Math.asin(Math.max(-1, Math.min(1, this.sunDir.y)));
    const sunL = [Math.cos(se), Math.sin(se), 0];
    this.lutMat.uniforms.uSun.value.set(sunL[0], sunL[1], sunL[2]);
    this.lutMat.uniforms.uMie.value = this.turbidity;
    const prev = this.renderer.getRenderTarget();
    this.renderer.setRenderTarget(this.lut);
    this.renderer.render(this.quadScene, this.quadCam);
    this.renderer.setRenderTarget(prev);

    // lights
    const Tsun = this.transmittance([0, RE + 0.3, 0], sunL);
    const sunUp = this.sunDir.y;
    const dayK = THREE.MathUtils.smoothstep(sunUp, -0.06, 0.02);
    const sunCol = new THREE.Color(Tsun[0], Tsun[1], Tsun[2]);
    this.skyMat.uniforms.uSunDiskColor.value.copy(sunCol);
    const night = 1 - THREE.MathUtils.smoothstep(sunUp, -0.2, -0.02);
    G.uNight.value = night;
    // ambient: average a few sky directions
    const up = this.skyRadiance([0, 1, 0], sunL);
    const hz = [0, 0, 0];
    for (let k = 0; k < 6; k++) {
      const a = (k / 6) * Math.PI * 2;
      const r = this.skyRadiance([Math.cos(a) * 0.95, 0.3, Math.sin(a) * 0.95], sunL, 0.3, 8);
      for (let c = 0; c < 3; c++) hz[c] += r[c] / 6;
    }
    const moonUp = Math.max(0, this.moonDir.y);
    const moonK = night * THREE.MathUtils.smoothstep(this.moonDir.y, -0.02, 0.1) * (0.2 + 0.8 * mp.fraction);
    const amb = 1.15;
    G.uSkyUp.value.setRGB(up[0] * amb + 0.004 * night, up[1] * amb + 0.006 * night, up[2] * amb + 0.012 * night);
    G.uSkyHorizon.value.setRGB(hz[0] * amb + 0.004 * night, hz[1] * amb + 0.005 * night, hz[2] * amb + 0.009 * night);
    const gb = 0.18;
    G.uGroundBounce.value.setRGB(
      (sunCol.r * Math.max(sunUp, 0) * 3.0 + hz[0]) * gb * 0.35,
      (sunCol.g * Math.max(sunUp, 0) * 3.0 + hz[1]) * gb * 0.38,
      (sunCol.b * Math.max(sunUp, 0) * 3.0 + hz[2]) * gb * 0.3,
    );
    if (dayK > 0.001 || moonK < 0.001) {
      G.uLightDir.value.copy(this.sunDir);
      if (G.uLightDir.value.y < 0.02) G.uLightDir.value.y = 0.02;
      G.uLightDir.value.normalize();
      G.uLightColor.value.setRGB(sunCol.r * 3.9 * dayK, sunCol.g * 3.9 * dayK, sunCol.b * 3.9 * dayK);
    } else {
      G.uLightDir.value.copy(this.moonDir).normalize();
      G.uLightColor.value.setRGB(0.05 * moonK, 0.058 * moonK, 0.075 * moonK);
    }
    void moonUp;
    // fog / haze colours
    G.uFogSun.value.setRGB(sunCol.r * 0.35 * dayK, sunCol.g * 0.3 * dayK, sunCol.b * 0.25 * dayK);
    this.base = {
      light: G.uLightColor.value.clone(), up: G.uSkyUp.value.clone(), hz: G.uSkyHorizon.value.clone(), gb: G.uGroundBounce.value.clone(),
    };
    const fb = this.skyRadiance([0.99, 0.02, 0.1], sunL, 0.3, 8);
    this.skyMat.uniforms.uFogBelow.value.setRGB(fb[0] * 0.9 + 0.002 * night, fb[1] * 0.9 + 0.003 * night, fb[2] * 0.9 + 0.005 * night);
  }

  /** Weather modifiers on top of the clear-sky lights (cheap, every frame). */
  applyLights(dim, amb) {
    if (!this.base) return;
    G.uLightColor.value.copy(this.base.light).multiplyScalar(dim);
    G.uSkyUp.value.copy(this.base.up).multiplyScalar(amb);
    G.uSkyHorizon.value.copy(this.base.hz).multiplyScalar(amb);
    G.uGroundBounce.value.copy(this.base.gb).multiplyScalar(0.5 + 0.5 * dim);
  }

  updateCamera(camera) {
    this._ipv.multiplyMatrices(camera.matrixWorld, this._ipv.copy(camera.projectionMatrixInverse));
    this.skyMat.uniforms.uInvProjView.value.copy(this._ipv);
  }
}

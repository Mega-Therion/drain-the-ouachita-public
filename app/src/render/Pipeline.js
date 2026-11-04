import * as THREE from 'three';
import { G, RT } from './common.js';

const FS_VERT = 'varying vec2 vUv; void main(){ vUv = position.xy*0.5+0.5; gl_Position = vec4(position.xy, 0.0, 1.0); }';

function fsMaterial(frag, uniforms) {
  return new THREE.ShaderMaterial({ uniforms, vertexShader: FS_VERT, fragmentShader: frag, depthTest: false, depthWrite: false });
}

const COPY_FRAG = 'uniform sampler2D t; varying vec2 vUv; void main(){ gl_FragColor = texture(t, vUv); }';

const BRIGHT_FRAG = /* glsl */`
uniform sampler2D t; uniform float uThresh; varying vec2 vUv;
void main(){
  vec3 c = texture(t, vUv).rgb;
  float l = max(c.r, max(c.g, c.b));
  float k = smoothstep(uThresh, uThresh * 2.0, l);
  gl_FragColor = vec4(min(c * k, vec3(60.0)), 1.0);
}`;

// dual-filter (Kawase) blur
const DOWN_FRAG = /* glsl */`
uniform sampler2D t; uniform vec2 uTexel; varying vec2 vUv;
void main(){
  vec3 s = texture(t, vUv).rgb * 4.0;
  s += texture(t, vUv - uTexel).rgb; s += texture(t, vUv + uTexel).rgb;
  s += texture(t, vUv + vec2(uTexel.x, -uTexel.y)).rgb; s += texture(t, vUv - vec2(uTexel.x, -uTexel.y)).rgb;
  gl_FragColor = vec4(s / 8.0, 1.0);
}`;
const UP_FRAG = /* glsl */`
uniform sampler2D t; uniform sampler2D tPrev; uniform vec2 uTexel; uniform float uAdd; varying vec2 vUv;
void main(){
  vec3 s = texture(t, vUv + vec2(-uTexel.x * 2.0, 0.0)).rgb;
  s += texture(t, vUv + vec2(-uTexel.x, uTexel.y)).rgb * 2.0;
  s += texture(t, vUv + vec2(0.0, uTexel.y * 2.0)).rgb;
  s += texture(t, vUv + vec2(uTexel.x, uTexel.y)).rgb * 2.0;
  s += texture(t, vUv + vec2(uTexel.x * 2.0, 0.0)).rgb;
  s += texture(t, vUv + vec2(uTexel.x, -uTexel.y)).rgb * 2.0;
  s += texture(t, vUv + vec2(0.0, -uTexel.y * 2.0)).rgb;
  s += texture(t, vUv + vec2(-uTexel.x, -uTexel.y)).rgb * 2.0;
  gl_FragColor = vec4(s / 12.0 + texture(tPrev, vUv).rgb * uAdd, 1.0);
}`;

const COMPOSITE_FRAG = /* glsl */`
uniform sampler2D tScene;
uniform sampler2D tBloom;
uniform sampler2D tClouds;
uniform float uBloom;
uniform float uExposure;
uniform float uCloudsOn;
uniform float uUnder;
uniform vec3 uUnderTint;
uniform float uTime;
uniform float uVignette;
uniform float uGrade;
uniform float uLetterbox;   // target aspect (0 = off)
uniform vec2 uSize;
varying vec2 vUv;
vec3 agx(vec3 v) {
  // AgX-ish filmic curve (Troy Sobotka style approximation)
  const mat3 m = mat3(0.842479062253094, 0.0423282422610123, 0.0423756549057051,
                      0.0784335999999992, 0.878468636469772, 0.0784336,
                      0.0792237451477643, 0.0791661274605434, 0.879142973793104);
  const mat3 mi = mat3(1.19687900512017, -0.0528968517574562, -0.0529716355144438,
                       -0.0980208811401368, 1.15190312990417, -0.0980434501171241,
                       -0.0990297440797205, -0.0989611768448433, 1.15107367264116);
  v = m * v;
  v = clamp(log2(max(v, 1e-10)), -12.47393, 4.026069);
  v = (v + 12.47393) / 16.5;
  vec3 x2 = v * v; vec3 x4 = x2 * x2;
  v = 15.5 * x4 * x2 - 40.14 * x4 * v + 31.96 * x4 - 6.868 * x2 * v + 0.4298 * x2 + 0.1191 * v - 0.00232;
  v = mi * v;
  return clamp(pow(max(v, 0.0), vec3(2.2)), 0.0, 1.0);
}
float hash(vec2 p) { return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }
void main(){
  vec3 c = texture(tScene, vUv).rgb;
  if (uCloudsOn > 0.5) {
    // soft upsample of the low-res cloud buffer
    vec2 ts = 1.0 / vec2(textureSize(tClouds, 0));
    vec4 cl = texture(tClouds, vUv) * 0.4
      + texture(tClouds, vUv + vec2(ts.x, ts.y) * 0.75) * 0.15 + texture(tClouds, vUv + vec2(-ts.x, ts.y) * 0.75) * 0.15
      + texture(tClouds, vUv + vec2(ts.x, -ts.y) * 0.75) * 0.15 + texture(tClouds, vUv + vec2(-ts.x, -ts.y) * 0.75) * 0.15;
    c = c * cl.a + cl.rgb;
  }
  c += texture(tBloom, vUv).rgb * uBloom;
  if (uUnder > 0.5) {
    float d = length(vUv - 0.5);
    c = mix(c, c * uUnderTint * 3.0, 0.35) * (1.0 - d * 0.6);
    // slanting light shafts from the surface
    float x = vUv.x * 7.0 + vUv.y * 1.8;
    float sh = sin(x + uTime * 0.35) * sin(x * 2.3 - uTime * 0.21) * sin(x * 0.7 + uTime * 0.13);
    sh = pow(max(sh, 0.0), 2.0) * smoothstep(0.1, 1.0, vUv.y);
    c += uUnderTint * sh * 0.06;
  }
  c *= uExposure;
  c = agx(c);
  // grade: AgX is neutral; add saturation and a gentle S-curve
  float l = dot(c, vec3(0.2126, 0.7152, 0.0722));
  c = mix(vec3(l), c, 1.0 + 0.18 * uGrade);
  c = mix(c, c * c * (3.0 - 2.0 * c), 0.28 * uGrade);
  float v = smoothstep(0.95, 0.25, length((vUv - 0.5) * vec2(1.0, 0.85)));
  c *= mix(1.0, v, uVignette);
  c = pow(c, vec3(1.0 / 2.2));
  if (uLetterbox > 0.0) {
    float asp = uSize.x / uSize.y;
    if (asp < uLetterbox) { float bar = 0.5 - 0.5 * asp / uLetterbox; if (vUv.y < bar || vUv.y > 1.0 - bar) c = vec3(0.0); }
  }
  c += (hash(vUv * 1000.0 + uTime) - 0.5) / 255.0;
  gl_FragColor = vec4(c, 1.0);
}`;

const FXAA_FRAG = /* glsl */`
uniform sampler2D t; uniform vec2 uTexel; varying vec2 vUv;
float lum(vec3 c){ return dot(c, vec3(0.299, 0.587, 0.114)); }
void main(){
  vec3 rgbNW = texture(t, vUv + vec2(-1.0, -1.0) * uTexel).rgb;
  vec3 rgbNE = texture(t, vUv + vec2(1.0, -1.0) * uTexel).rgb;
  vec3 rgbSW = texture(t, vUv + vec2(-1.0, 1.0) * uTexel).rgb;
  vec3 rgbSE = texture(t, vUv + vec2(1.0, 1.0) * uTexel).rgb;
  vec3 rgbM = texture(t, vUv).rgb;
  float lNW = lum(rgbNW), lNE = lum(rgbNE), lSW = lum(rgbSW), lSE = lum(rgbSE), lM = lum(rgbM);
  float lMin = min(lM, min(min(lNW, lNE), min(lSW, lSE)));
  float lMax = max(lM, max(max(lNW, lNE), max(lSW, lSE)));
  vec2 dir = vec2(-((lNW + lNE) - (lSW + lSE)), ((lNW + lSW) - (lNE + lSE)));
  float dirReduce = max((lNW + lNE + lSW + lSE) * 0.03125, 1.0 / 128.0);
  float rcp = 1.0 / (min(abs(dir.x), abs(dir.y)) + dirReduce);
  dir = clamp(dir * rcp, -8.0, 8.0) * uTexel;
  vec3 a = 0.5 * (texture(t, vUv + dir * (1.0 / 3.0 - 0.5)).rgb + texture(t, vUv + dir * (2.0 / 3.0 - 0.5)).rgb);
  vec3 b = a * 0.5 + 0.25 * (texture(t, vUv + dir * -0.5).rgb + texture(t, vUv + dir * 0.5).rgb);
  float lB = lum(b);
  gl_FragColor = vec4((lB < lMin || lB > lMax) ? a : b, 1.0);
}`;

export class Pipeline {
  constructor(renderer) {
    this.r = renderer;
    this.scene = new THREE.Scene();
    this.cam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
    this.quad = new THREE.Mesh(new THREE.BufferGeometry(), null);
    this.quad.geometry.setAttribute('position', new THREE.Float32BufferAttribute([-1, -1, 0, 3, -1, 0, -1, 3, 0], 3));
    this.quad.frustumCulled = false;
    this.scene.add(this.quad);
    this.copyMat = fsMaterial(COPY_FRAG, { t: { value: null } });
    this.brightMat = fsMaterial(BRIGHT_FRAG, { t: { value: null }, uThresh: { value: 2.0 } });
    this.downMat = fsMaterial(DOWN_FRAG, { t: { value: null }, uTexel: { value: new THREE.Vector2() } });
    this.upMat = fsMaterial(UP_FRAG, { t: { value: null }, tPrev: { value: null }, uTexel: { value: new THREE.Vector2() }, uAdd: { value: 1 } });
    this.compMat = fsMaterial(COMPOSITE_FRAG, {
      tScene: { value: null }, tBloom: { value: null }, tClouds: { value: null }, uBloom: { value: 0.06 },
      uExposure: { value: 1.0 }, uCloudsOn: { value: 0 }, uUnder: { value: 0 }, uUnderTint: { value: new THREE.Color(0.2, 0.55, 0.5) },
      uTime: G.uTime, uVignette: { value: 0.35 }, uGrade: { value: 1 }, uLetterbox: { value: 0 }, uSize: { value: new THREE.Vector2(1, 1) },
    });
    this.fxaaMat = fsMaterial(FXAA_FRAG, { t: { value: null }, uTexel: { value: new THREE.Vector2() } });
    this.bloomOn = true;
    this.msaa = 0;
    this.size = new THREE.Vector2(1, 1);
    this.targets = null;
  }

  setup(w, h, msaa, bloomOn, floatDepth = false) {
    this.bloomOn = bloomOn;
    if (this.targets && this.size.x === w && this.size.y === h && this.msaa === msaa) return;
    this.size.set(w, h);
    this.msaa = msaa;
    if (this.targets) Object.values(this.targets).forEach((t) => (Array.isArray(t) ? t.forEach((x) => x.dispose()) : t.dispose()));
    const hdr = { type: RT.type, format: THREE.RGBAFormat, minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter, depthBuffer: false };
    const main = new THREE.WebGLRenderTarget(w, h, { ...hdr, depthBuffer: true, samples: msaa });
    main.depthTexture = new THREE.DepthTexture(w, h);
    main.depthTexture.type = floatDepth ? THREE.FloatType : THREE.UnsignedIntType;
    const copy = new THREE.WebGLRenderTarget(w, h, hdr);
    const ldr = new THREE.WebGLRenderTarget(w, h, { minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter, depthBuffer: false });
    const bloom = [];
    let bw = Math.max(1, w >> 1); let bh = Math.max(1, h >> 1);
    for (let i = 0; i < 5; i++) {
      bloom.push(new THREE.WebGLRenderTarget(bw, bh, hdr));
      bw = Math.max(1, bw >> 1); bh = Math.max(1, bh >> 1);
    }
    const bloomUp = bloom.map((b) => new THREE.WebGLRenderTarget(b.width, b.height, hdr));
    this.targets = { main, copy, ldr, bloom, bloomUp };
    G.uViewport.value.set(w, h);
  }

  pass(mat, target) {
    this.quad.material = mat;
    this.r.setRenderTarget(target);
    this.r.render(this.scene, this.cam);
  }

  copyScene() {
    this.copyMat.uniforms.t.value = this.targets.main.texture;
    this.pass(this.copyMat, this.targets.copy);
    return this.targets.copy.texture;
  }

  bloom() {
    const T = this.targets;
    this.brightMat.uniforms.t.value = T.main.texture;
    this.pass(this.brightMat, T.bloom[0]);
    for (let i = 1; i < T.bloom.length; i++) {
      this.downMat.uniforms.t.value = T.bloom[i - 1].texture;
      this.downMat.uniforms.uTexel.value.set(1 / T.bloom[i - 1].width, 1 / T.bloom[i - 1].height);
      this.pass(this.downMat, T.bloom[i]);
    }
    let prev = T.bloom[T.bloom.length - 1];
    for (let i = T.bloom.length - 2; i >= 0; i--) {
      this.upMat.uniforms.t.value = prev.texture;
      this.upMat.uniforms.tPrev.value = T.bloom[i].texture;
      this.upMat.uniforms.uTexel.value.set(1 / prev.width, 1 / prev.height);
      this.pass(this.upMat, T.bloomUp[i]);
      prev = T.bloomUp[i];
    }
    return prev.texture;
  }

  finish(cloudsTex) {
    const T = this.targets;
    const c = this.compMat.uniforms;
    c.tScene.value = T.main.texture;
    c.uSize.value.copy(this.size);
    c.tBloom.value = this.bloomOn ? this.bloom() : T.bloom[0].texture;
    if (!this.bloomOn) c.uBloom.value = 0;
    c.tClouds.value = cloudsTex || null;
    c.uCloudsOn.value = cloudsTex ? 1 : 0;
    this.pass(this.compMat, T.ldr);
    this.fxaaMat.uniforms.t.value = T.ldr.texture;
    this.fxaaMat.uniforms.uTexel.value.set(1 / this.size.x, 1 / this.size.y);
    this.pass(this.fxaaMat, null);
  }
}

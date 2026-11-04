import * as THREE from 'three';
import { gunzipSync } from 'fflate';
import { G, COMMON_GLSL } from '../render/common.js';
import { Tree } from '../vendor/eztree/tree.js';
import { DATA_URL, LAKE } from '../config.js';
import { worldToMerc, REGION_MERC } from '../geo.js';

// ------------------------------------------------------------------ shaders
const TREE_VERT = /* glsl */`
${COMMON_GLSL}
uniform float uWindAmp;
varying vec2 vUv;
varying vec3 vN;
varying vec3 vWorld;
varying vec3 vTint;
varying float vH;
void main() {
  mat4 im = instanceMatrix;
  vec4 wp = modelMatrix * im * vec4(position, 1.0);
  vec3 base = (modelMatrix * im * vec4(0.0, 0.0, 0.0, 1.0)).xyz;
  float hgt = max(wp.y - base.y, 0.0);
  float ph = dot(base.xz, vec2(0.13, 0.171));
  float sway = (sin(uTime * 1.1 + ph) + 0.45 * sin(uTime * 2.3 + ph * 1.7)) * uWindAmp * hgt * hgt * 0.0009;
  wp.x += sway; wp.z += sway * 0.7;
  vN = normalize(mat3(modelMatrix * im) * normal);
  vUv = uv;
  vWorld = wp.xyz;
#ifdef USE_INSTANCING_COLOR
  vTint = instanceColor;
#else
  vTint = vec3(1.0);
#endif
  vH = hgt;
  gl_Position = projectionMatrix * viewMatrix * wp;
}
`;

const BARK_FRAG = /* glsl */`
${COMMON_GLSL}
uniform sampler2D uMap;
uniform vec3 uColor;
uniform vec2 uUvScale;
uniform float uClipY;
varying vec2 vUv;
varying vec3 vN;
varying vec3 vWorld;
varying vec3 vTint;
varying float vH;
void main() {
  if (vWorld.y < uClipY) discard;
  vec3 alb = srgbToLinear(texture(uMap, vUv * uUvScale).rgb) * uColor * vTint;
  vec3 N = normalize(vN);
  if (!gl_FrontFacing) N = -N;
  float ndl = max(dot(N, uLightDir), 0.0);
  float sh = sunShadow(vWorld, ndl) * cloudShadow(vWorld);
  vec3 col = alb * (uLightColor * ndl * sh + ambientLight(N) * (0.55 + 0.45 * clamp(vH / 8.0, 0.0, 1.0)));
  // wet if under (or recently under) water
  col = applyAerial(col, vWorld);
  gl_FragColor = vec4(col, 1.0);
}
`;

const LEAF_FRAG = /* glsl */`
${COMMON_GLSL}
uniform sampler2D uMap;
uniform vec3 uColor;
uniform float uAlphaTest;
uniform float uClipY;
varying vec2 vUv;
varying vec3 vN;
varying vec3 vWorld;
varying vec3 vTint;
varying float vH;
void main() {
  if (vWorld.y < uClipY) discard;
  vec4 t = texture(uMap, vUv);
  if (t.a < uAlphaTest) discard;
  vec3 alb = srgbToLinear(t.rgb) * uColor * vTint;
  vec3 N = normalize(vN);
  if (!gl_FrontFacing) N = -N;
  vec3 V = normalize(cameraPosition - vWorld);
  float wrap = max((dot(N, uLightDir) + 0.5) / 1.5, 0.0);
  float trans = pow(max(dot(-V, uLightDir), 0.0), 4.0) * 0.6;
  float sh = sunShadow(vWorld, 0.6) * cloudShadow(vWorld);
  float ao = 0.55 + 0.45 * clamp(vH / 18.0, 0.0, 1.0);
  vec3 col = alb * (uLightColor * (wrap * 0.85 + trans) * sh + ambientLight(N) * ao * 1.1);
  col = applyAerial(col, vWorld);
  gl_FragColor = vec4(col, 1.0);
}
`;

const DEPTH_ALPHA_FRAG = /* glsl */`
uniform sampler2D uMap;
uniform float uAlphaTest;
varying vec2 vUv;
void main() { if (texture(uMap, vUv).a < uAlphaTest) discard; gl_FragColor = vec4(1.0); }
`;

const IMP_VERT = /* glsl */`
${COMMON_GLSL}
attribute float aVar;
uniform vec2 uAtlas;   // variants count, unused
varying vec2 vUv;
varying vec3 vWorld;
varying vec3 vTint;
varying vec2 vQ;
void main() {
  vec3 base = (modelMatrix * instanceMatrix * vec4(0.0, 0.0, 0.0, 1.0)).xyz;
  float sx = length(instanceMatrix[0].xyz);
  float sy = length(instanceMatrix[1].xyz);
  vec3 toCam = cameraPosition - base;
  vec3 right = normalize(cross(vec3(0.0, 1.0, 0.0), toCam));
  vec3 wp = base + right * position.x * sx * 0.62 + vec3(0.0, 1.0, 0.0) * position.y * sy;
  vWorld = wp;
  vQ = position.xy;
  vUv = vec2((aVar + position.x + 0.5) / uAtlas.x, position.y);
#ifdef USE_INSTANCING_COLOR
  vTint = instanceColor;
#else
  vTint = vec3(1.0);
#endif
  gl_Position = projectionMatrix * viewMatrix * vec4(wp, 1.0);
}
`;

const IMP_FRAG = /* glsl */`
${COMMON_GLSL}
uniform sampler2D uAtlasTex;
uniform float uClipY;
varying vec2 vUv;
varying vec3 vWorld;
varying vec3 vTint;
varying vec2 vQ;
void main() {
  if (vWorld.y < uClipY) discard;
  vec4 t = texture(uAtlasTex, vUv);
  if (t.a < 0.45) discard;
  vec3 alb = t.rgb * vTint;
  vec3 V = normalize(cameraPosition - vWorld);
  vec3 right = normalize(cross(vec3(0.0, 1.0, 0.0), V));
  vec3 N = normalize(right * vQ.x * 1.6 + vec3(0.0, 0.55, 0.0) + V * 0.75);
  float wrap = max((dot(N, uLightDir) + 0.4) / 1.4, 0.0);
  float sh = cloudShadow(vWorld) * (0.6 + 0.4 * sunShadow(vWorld, 0.6));
  vec3 col = alb * (uLightColor * wrap * 0.9 * sh + ambientLight(N) * (0.6 + 0.4 * vQ.y));
  col = applyAerial(col, vWorld);
  gl_FragColor = vec4(col, 1.0);
}
`;

const ALBEDO_FRAG = /* glsl */`
uniform sampler2D uMap;
uniform vec3 uColor;
uniform float uAlphaTest;
uniform float uLeaf;
varying vec2 vUv;
varying vec3 vN;
void main() {
  vec4 t = texture(uMap, vUv * (uLeaf > 0.5 ? vec2(1.0) : vec2(1.0, 6.0)));
  if (uLeaf > 0.5 && t.a < uAlphaTest) discard;
  vec3 c = pow(t.rgb, vec3(2.2)) * uColor;
  float l = 0.75 + 0.25 * normalize(vN).y;
  gl_FragColor = vec4(c * l, 1.0);
}
`;

// ------------------------------------------------------------------ helpers
function mulberry(seed) {
  return () => {
    seed |= 0; seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
function hashCell(i, j) { return ((i * 73856093) ^ (j * 19349663)) >>> 0; }

function normalizeGeo(geos) {
  // scale so the tree is 1 unit tall with its base at the origin
  const box = new THREE.Box3();
  for (const g of geos) { g.computeBoundingBox(); box.union(g.boundingBox); }
  const h = box.max.y - box.min.y;
  const s = 1 / h;
  const m = new THREE.Matrix4().makeScale(s, s, s).multiply(new THREE.Matrix4().makeTranslation(-(box.min.x + box.max.x) / 2, -box.min.y, -(box.min.z + box.max.z) / 2));
  for (const g of geos) { g.applyMatrix4(m); g.computeBoundingSphere(); }
  return (box.max.x - box.min.x) * s;
}

function stumpGeometry() {
  // cut stump with flared root collar: a lathe with a slightly ragged top
  const pts = [];
  pts.push(new THREE.Vector2(0.0, 1.0));
  pts.push(new THREE.Vector2(0.42, 1.0));
  pts.push(new THREE.Vector2(0.45, 0.96));
  pts.push(new THREE.Vector2(0.47, 0.6));
  pts.push(new THREE.Vector2(0.52, 0.3));
  pts.push(new THREE.Vector2(0.68, 0.1));
  pts.push(new THREE.Vector2(0.95, -0.05));
  pts.push(new THREE.Vector2(0.95, -0.4));
  const g = new THREE.LatheGeometry(pts, 9);
  const pos = g.attributes.position;
  const rnd = mulberry(99);
  for (let i = 0; i < pos.count; i++) {
    const y = pos.getY(i);
    if (y > 0.95) pos.setY(i, y - rnd() * 0.18);
    const a = Math.atan2(pos.getZ(i), pos.getX(i));
    const k = 1 + 0.18 * Math.sin(a * 5 + 1.3) * (y < 0.35 ? 1 : 0.25);
    pos.setX(i, pos.getX(i) * k); pos.setZ(i, pos.getZ(i) * k);
  }
  g.computeVertexNormals();
  return g;
}

function quadGeometry() {
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute([-0.5, 0, 0, 0.5, 0, 0, 0.5, 1, 0, -0.5, 1, 0], 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute([0, 0, 1, 0, 1, 1, 0, 1], 2));
  g.setIndex([0, 1, 2, 0, 2, 3]);
  g.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e9);
  return g;
}

const VARIANTS = [
  // name, preset, seed, leaves, bark, kind, overrides
  { id: 'pineA', preset: 'Pine Large', seed: 11, kind: 'pine', bark: 'pine', leaf: 'pine' },
  { id: 'pineB', preset: 'Pine Medium', seed: 23, kind: 'pine', bark: 'pine', leaf: 'pine' },
  { id: 'oakA', preset: 'Oak Large', seed: 37, kind: 'oak', bark: 'oak', leaf: 'oak' },
  { id: 'oakB', preset: 'Oak Medium', seed: 41, kind: 'oak', bark: 'oak', leaf: 'oak' },
  { id: 'snagA', preset: 'Oak Large', seed: 53, kind: 'snag', bark: 'oak', leaf: null },
  { id: 'snagB', preset: 'Pine Medium', seed: 67, kind: 'snag', bark: 'pine', leaf: null },
];

const CELL = 128;
const LC_DENSITY = [0, 0.12, 0.03, 0, 0.78, 0.85, 0.82, 0.3, 0.04, 0.025, 0.01, 0.6, 0.05];

export class Vegetation {
  constructor(app) {
    this.app = app;
    this.group = new THREE.Group();
    this.depthGroup = new THREE.Group();
    this.ready = false;
    this.showTrees = true;
    this.showAttractors = true;
    this.cells = new Map();
    this.lastPos = new THREE.Vector3(1e9, 0, 0);
    this.lastBuild = 0;
    this.season = new THREE.Color(1, 1, 1);
    this.uniforms = { uWindAmp: { value: 0.5 }, uClipY: app.terrain.uClipY };
  }

  async init() {
    const r = await fetch(`${DATA_URL}/landcover.bin?v=${__BUILD__}`);
    const raw = gunzipSync(new Uint8Array(await r.arrayBuffer()));
    const dv = new DataView(raw.buffer, raw.byteOffset);
    this.lcW = dv.getUint16(4, true); this.lcH = dv.getUint16(6, true);
    this.lc = raw.subarray(8);
    const tl = new THREE.TextureLoader();
    const load = (u, srgb = false) => new Promise((res) => tl.load(u, (t) => { t.wrapS = t.wrapT = THREE.RepeatWrapping; t.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace; res(t); }, undefined, () => res(null)));
    const [barkPine, barkOak, leafPine, leafOak] = await Promise.all([
      load('/tex/bark_pine.jpg'), load('/tex/bark_oak.jpg'), load('/tex/leaf_pine.png'), load('/tex/leaf_oak.png'),
    ]);
    for (const t of [leafPine, leafOak]) if (t) { t.wrapS = t.wrapT = THREE.ClampToEdgeWrapping; t.premultiplyAlpha = false; }
    this.tex = { bark: { pine: barkPine, oak: barkOak }, leaf: { pine: leafPine, oak: leafOak } };
    // build variants progressively so the main thread stays responsive
    this.variants = [];
    for (const v of VARIANTS) {
      await new Promise((res) => setTimeout(res, 0));
      this.variants.push(this._buildVariant(v));
    }
    this._buildAtlas();
    this._buildMeshes();
    this.ready = true;
  }

  _buildVariant(v) {
    const tree = new Tree();
    tree.loadPreset(v.preset);
    const o = tree.options;
    o.seed = v.seed;
    // budget: fewer sections/segments than the presets
    for (const k of [1, 2, 3]) {
      if (o.branch.sections[k]) o.branch.sections[k] = Math.max(3, Math.round(o.branch.sections[k] * 0.55));
      if (o.branch.segments[k]) o.branch.segments[k] = Math.max(3, Math.round(o.branch.segments[k] * 0.7));
    }
    o.branch.sections[0] = Math.round(o.branch.sections[0] * 0.7);
    o.branch.segments[0] = Math.max(6, Math.round(o.branch.segments[0] * 0.75));
    if (v.kind === 'pine') { o.branch.children[0] = Math.min(o.branch.children[0], 70); o.leaves.count = Math.min(o.leaves.count, 12); }
    if (v.kind === 'oak') o.leaves.count = Math.min(o.leaves.count, 8);
    if (v.kind === 'snag') {
      o.leaves.count = 0;
      o.branch.levels = Math.min(o.branch.levels, 2);
      if (v.bark === 'pine') o.branch.children[0] = 24;
      o.branch.gnarliness[1] = (o.branch.gnarliness[1] || 0) + 0.15;
    }
    tree.generate();
    const bg = tree.branchesMesh.geometry;
    const lg = v.leaf ? tree.leavesMesh.geometry : null;
    const width = normalizeGeo(lg ? [bg, lg] : [bg]);
    const tris = (bg.index.count + (lg ? lg.index.count : 0)) / 3;
    return { ...v, branches: bg, leaves: lg, width, tris, alphaTest: o.leaves.alphaTest || 0.4, uvScaleY: o.bark.textureScale?.y || 1 };
  }

  _barkMaterial(v) {
    const snag = v.kind === 'snag';
    return new THREE.ShaderMaterial({
      uniforms: { ...G, ...this.uniforms, uMap: { value: this.tex.bark[v.bark] }, uColor: { value: snag ? new THREE.Color(0.62, 0.6, 0.57) : new THREE.Color(0.85, 0.82, 0.78) }, uUvScale: { value: new THREE.Vector2(1, v.uvScaleY) } },
      vertexShader: TREE_VERT, fragmentShader: BARK_FRAG,
    });
  }

  _leafMaterial(v) {
    return new THREE.ShaderMaterial({
      uniforms: { ...G, ...this.uniforms, uMap: { value: this.tex.leaf[v.leaf] }, uColor: { value: v.kind === 'pine' ? new THREE.Color(0.75, 0.82, 0.7) : this.season }, uAlphaTest: { value: v.alphaTest } },
      vertexShader: TREE_VERT, fragmentShader: LEAF_FRAG, side: THREE.DoubleSide,
    });
  }

  _buildAtlas() {
    const r = this.app.renderer;
    const n = this.variants.length;
    const W = 256; const H = 512;
    this.atlas = new THREE.WebGLRenderTarget(W * n, H, { minFilter: THREE.LinearMipmapLinearFilter, magFilter: THREE.LinearFilter, generateMipmaps: true });
    const scene = new THREE.Scene();
    const cam = new THREE.OrthographicCamera(-0.5, 0.5, 1.0, 0, -10, 10);
    cam.position.set(0, 0, 5); cam.lookAt(0, 0, 0);
    const depthState = r.state.buffers.depth;
    const wasRev = depthState.getReversed ? depthState.getReversed() : false;
    const prevViewport = r.getViewport(new THREE.Vector4());
    if (wasRev) depthState.setReversed(false);
    r.setRenderTarget(this.atlas);
    r.setClearColor(0x000000, 0);
    r.clear(true, true, false);
    this.variants.forEach((v, i) => {
      scene.children.length = 0;
      const mk = (geo, leaf) => new THREE.Mesh(geo, new THREE.ShaderMaterial({
        uniforms: { uMap: { value: leaf ? this.tex.leaf[v.leaf] : this.tex.bark[v.bark] }, uColor: { value: leaf ? (v.kind === 'pine' ? new THREE.Color(0.75, 0.82, 0.7) : new THREE.Color(0.85, 0.88, 0.75)) : new THREE.Color(0.8, 0.77, 0.72) }, uAlphaTest: { value: v.alphaTest }, uLeaf: { value: leaf ? 1 : 0 } },
        vertexShader: 'varying vec2 vUv; varying vec3 vN; void main(){ vUv = uv; vN = normal; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }',
        fragmentShader: ALBEDO_FRAG, side: THREE.DoubleSide,
      }));
      scene.add(mk(v.branches, false));
      if (v.leaves) scene.add(mk(v.leaves, true));
      const s = 1 / Math.max(1, v.width * 1.2);
      scene.children.forEach((m) => m.scale.set(s, 1, s));
      r.setViewport(i * W, 0, W, H);
      r.setScissor(i * W, 0, W, H);
      r.setScissorTest(true);
      r.render(scene, cam);
      r.setScissorTest(false);
      scene.children.forEach((m) => m.material.dispose());
    });
    r.setRenderTarget(null);
    if (wasRev) depthState.setReversed(true);
    r.setViewport(prevViewport);
  }

  _buildMeshes() {
    const MAXA = this.app.isMobile ? 260 : 900;
    this.tierA = this.variants.map((v) => {
      const bark = new THREE.InstancedMesh(v.branches, this._barkMaterial(v), MAXA);
      const leaves = v.leaves ? new THREE.InstancedMesh(v.leaves, this._leafMaterial(v), MAXA) : null;
      const dBark = new THREE.InstancedMesh(v.branches, new THREE.ShaderMaterial({ uniforms: { ...G, ...this.uniforms }, vertexShader: TREE_VERT, fragmentShader: 'void main(){ gl_FragColor = vec4(1.0); }' }), MAXA);
      const dLeaf = v.leaves ? new THREE.InstancedMesh(v.leaves, new THREE.ShaderMaterial({ uniforms: { ...G, ...this.uniforms, uMap: { value: this.tex.leaf[v.leaf] }, uAlphaTest: { value: v.alphaTest } }, vertexShader: TREE_VERT, fragmentShader: DEPTH_ALPHA_FRAG, side: THREE.DoubleSide }), MAXA) : null;
      for (const m of [bark, leaves, dBark, dLeaf]) if (m) { m.frustumCulled = false; m.count = 0; m.instanceMatrix.setUsage(THREE.DynamicDrawUsage); }
      bark.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(MAXA * 3), 3);
      if (leaves) leaves.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(MAXA * 3), 3);
      this.group.add(bark); if (leaves) this.group.add(leaves);
      this.depthGroup.add(dBark); if (dLeaf) this.depthGroup.add(dLeaf);
      return { v, bark, leaves, dBark, dLeaf };
    });
    const MAXB = this.app.isMobile ? 9000 : 30000;
    const q = quadGeometry();
    const aVar = new THREE.InstancedBufferAttribute(new Float32Array(MAXB), 1);
    q.setAttribute('aVar', aVar);
    this.imp = new THREE.InstancedMesh(q, new THREE.ShaderMaterial({
      uniforms: { ...G, ...this.uniforms, uAtlasTex: { value: this.atlas.texture }, uAtlas: { value: new THREE.Vector2(this.variants.length, 1) } },
      vertexShader: IMP_VERT, fragmentShader: IMP_FRAG, side: THREE.DoubleSide,
    }), MAXB);
    this.imp.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(MAXB * 3), 3);
    this.imp.frustumCulled = false; this.imp.count = 0;
    this.impVar = aVar;
    this.group.add(this.imp);
    // stumps
    const MAXS = this.app.isMobile ? 2500 : 9000;
    this.stumps = new THREE.InstancedMesh(stumpGeometry(), new THREE.ShaderMaterial({
      uniforms: { ...G, ...this.uniforms, uMap: { value: this.tex.bark.oak }, uColor: { value: new THREE.Color(0.55, 0.5, 0.45) }, uUvScale: { value: new THREE.Vector2(2, 1) } },
      vertexShader: TREE_VERT, fragmentShader: BARK_FRAG,
    }), MAXS);
    this.stumps.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(MAXS * 3), 3);
    this.stumps.frustumCulled = false; this.stumps.count = 0;
    this.group.add(this.stumps);
    this.maxA = MAXA; this.maxB = MAXB; this.maxS = MAXS;
  }

  lcAt(x, z) {
    const [mx, my] = worldToMerc(x, z);
    const r = REGION_MERC;
    const i = Math.floor(((mx - r[0]) / (r[2] - r[0])) * this.lcW);
    const j = Math.floor(((r[3] - my) / (r[3] - r[1])) * this.lcH);
    if (i < 0 || j < 0 || i >= this.lcW || j >= this.lcH) return -1;
    return this.lc[j * this.lcW + i];
  }

  /** Generate (and cache) the objects of a 128 m cell. */
  _cell(ci, cj) {
    const key = `${ci},${cj}`;
    let c = this.cells.get(key);
    if (c && c.complete) return c;
    const app = this.app;
    const store = app.store;
    const x0 = ci * CELL; const z0 = cj * CELL;
    // need detailed data under the cell
    const t = store.finestAt(x0 + CELL / 2, z0 + CELL / 2);
    if (!t || t.z < 13) return null;
    const rnd = mulberry(hashCell(ci, cj));
    const trees = []; const stumps = []; const snags = [];
    const full = LAKE.fullPoolM;
    const step = 7.5;
    for (let gz = 0; gz < CELL; gz += step) {
      for (let gx = 0; gx < CELL; gx += step) {
        const x = x0 + gx + rnd() * step; const z = z0 + gz + rnd() * step;
        const tile = store.finestAt(x, z);
        if (!tile) continue;
        const h = tile.heightAt(x, z);
        const cls = tile.classAt(x, z);
        const r1 = rnd(); const r2 = rnd(); const r3 = rnd();
        if ((cls & 1) && h < full + 0.6) {
          // lake bed: stumps from the 1950s clearing, scattered standing snags
          if (h > full - 0.4) continue;
          if (cls & 2) continue; // not in the river channel
          if (r1 < 0.32) stumps.push([x, h, z, 0.35 + r2 * 0.45, r3 * 6.28]);
          // standing timber left in some coves (illustrative)
          const zone = Math.sin(x * 0.0021 + 1.7) * Math.sin(z * 0.0017 - 0.4) + Math.sin(x * 0.0007 - z * 0.0009) * 0.6;
          if (zone > 0.75 && r2 < 0.05 && full - h < 30) snags.push([x, h, z, 9 + r3 * 13, r1 * 6.28, r2 < 0.025 ? 4 : 5]);
          continue;
        }
        if (cls & 8) continue; // other water
        const lc = this.lcAt(x, z);
        if (lc < 0) continue;
        // measured canopy height (Meta/WRI 1 m CHM) decides where trees stand and how tall
        const ch = app.canopyAt ? app.canopyAt(x, z) : -1;
        let p = LC_DENSITY[lc] || 0;
        if (ch >= 0) p = ch < 2.5 ? 0 : Math.min(0.9, 0.25 + ch / 25);
        if (r1 > p) continue;
        // forest type
        let pine;
        if (lc === 5) pine = r2 < 0.85;
        else if (lc === 6) pine = r2 < 0.55;
        else if (lc === 4 || lc === 11) pine = r2 < 0.12;
        else pine = r2 < 0.5;
        const variant = pine ? (r3 < 0.6 ? 0 : 1) : (r3 < 0.5 ? 2 : 3);
        const height = ch >= 2.5 ? Math.max(3, ch * (0.85 + r3 * 0.25)) : (pine ? 17 + r3 * 13 : 12 + r3 * 11);
        trees.push([x, h, z, height, r2 * 6.28, variant]);
      }
    }
    c = { trees, stumps, snags, complete: t.z >= 14 };
    this.cells.set(key, c);
    if (this.cells.size > 1600) {
      // drop far cells
      const cam = app.camera.position;
      for (const [k, v] of this.cells) {
        const [a, b] = k.split(',').map(Number);
        if (Math.hypot((a + 0.5) * CELL - cam.x, (b + 0.5) * CELL - cam.z) > 4000) this.cells.delete(k);
        void v;
      }
    }
    return c;
  }

  setSeason(month) {
    // deciduous colour by month (Ouachita oaks/hickories)
    const cols = {
      0: [0.62, 0.48, 0.32], 1: [0.62, 0.48, 0.32], 2: [0.75, 0.85, 0.5], 3: [0.62, 0.92, 0.42], 4: [0.55, 0.85, 0.4], 5: [0.52, 0.8, 0.38],
      6: [0.52, 0.78, 0.36], 7: [0.55, 0.76, 0.35], 8: [0.62, 0.74, 0.34], 9: [0.95, 0.62, 0.22], 10: [0.88, 0.45, 0.18], 11: [0.6, 0.45, 0.3],
    };
    const c = cols[month] || cols[6];
    this.season.setRGB(c[0], c[1], c[2]);
    this.bareMonths = month === 0 || month === 1 || month === 11;
  }

  setTrees(v) { this.showTrees = v; this.group.visible = v; this.depthGroup.visible = v; }
  setAttractors(v) { this.showAttractors = v; }

  update(camera, dt, opts) {
    if (!this.ready) return;
    this.uniforms.uWindAmp.value = 0.25 + (this.app.weather.wind || 0) * 1.2;
    if (!this.showTrees) return;
    const cam = camera.position;
    const now = performance.now();
    const moved = cam.distanceTo(this.lastPos);
    if (moved < 4 && now - this.lastBuild < 400) return;
    if (now - this.lastBuild < 90) return;
    this.lastBuild = now;
    this.lastPos.copy(cam);
    const q = opts.quality;
    const ground = this.app.terrain.heightAt(cam.x, cam.z);
    const agl = ground === null ? 1000 : cam.y - this.app.terrain.toY(ground);
    // far views: no point in placing individual trees
    if (agl > 2500) { this._clear(); return; }
    const R = q.treeRadius * (agl > 600 ? 0.7 : 1);
    const RA = this.app.isMobile ? 45 : 110;
    const ci0 = Math.floor((cam.x - R) / CELL); const ci1 = Math.floor((cam.x + R) / CELL);
    const cj0 = Math.floor((cam.z - R) / CELL); const cj1 = Math.floor((cam.z + R) / CELL);
    const counts = new Array(this.variants.length).fill(0);
    let nb = 0; let ns = 0;
    const m = new THREE.Matrix4(); const qn = new THREE.Quaternion(); const s = new THREE.Vector3(); const p = new THREE.Vector3();
    const up = new THREE.Vector3(0, 1, 0);
    const toY = (h) => this.app.terrain.toY(h);
    const col = new THREE.Color();
    const density = q.trees;
    const fr = this.app.frustum;
    const sphere = new THREE.Sphere();
    const levelM = G.uWater.value.x;
    const bare = this.bareMonths;
    for (let cj = cj0; cj <= cj1; cj++) {
      for (let ci = ci0; ci <= ci1; ci++) {
        const cx = (ci + 0.5) * CELL; const cz = (cj + 0.5) * CELL;
        const dc = Math.hypot(cx - cam.x, cz - cam.z);
        if (dc > R + CELL) continue;
        const c = this._cell(ci, cj);
        if (!c) continue;
        sphere.center.set(cx, cam.y, cz); sphere.radius = CELL * 1.5 + 400;
        if (!fr.intersectsSphere(sphere)) continue;
        const add = (t, isSnag) => {
          const [x, h, z, height, rot, variant] = t;
          const d = Math.hypot(x - cam.x, z - cam.z);
          if (d > R) return;
          // thin out with distance and quality
          const keep = density * (d < RA ? 1 : 1 - 0.55 * (d - RA) / R);
          if (((x * 12.9898 + z * 78.233) % 1 + 1) % 1 > keep) return;
          const y = toY(h) - 0.6;
          const v = bare && (variant === 2 || variant === 3) ? (variant === 2 ? 4 : 4) : variant;
          col.setRGB(0.85 + ((x * 0.37) % 0.3), 0.85 + ((z * 0.29) % 0.3), 0.85 + ((x * z * 0.0001) % 0.2));
          if (d < RA) {
            const k = counts[v];
            if (k >= this.maxA) return;
            const T = this.tierA[v];
            qn.setFromAxisAngle(up, rot);
            s.set(height, height, height);
            p.set(x, y, z);
            m.compose(p, qn, s);
            T.bark.setMatrixAt(k, m); T.dBark.setMatrixAt(k, m); T.bark.setColorAt(k, col);
            if (T.leaves) { T.leaves.setMatrixAt(k, m); T.dLeaf.setMatrixAt(k, m); T.leaves.setColorAt(k, col); }
            counts[v] = k + 1;
          } else if (nb < this.maxB) {
            qn.identity();
            s.set(height * this.variants[v].width * 1.2, height, 1);
            p.set(x, y, z);
            m.compose(p, qn, s);
            this.imp.setMatrixAt(nb, m);
            this.imp.setColorAt(nb, col);
            this.impVar.array[nb] = v;
            nb++;
          }
          void isSnag;
        };
        for (const t of c.trees) add(t, false);
        // lake-bed objects only when the lake has been lowered or we are under water
        const camUnder = G.uWater.value.z > 0.5;
        for (const t of c.snags) if (t[1] < levelM + 40) add(t, true);
        if (levelM < LAKE.fullPoolM - 0.3 || camUnder) {
          for (const st of c.stumps) {
            if (ns >= this.maxS) break;
            const [x, h, z, sz, rot] = st;
            const d = Math.hypot(x - cam.x, z - cam.z);
            if (d > Math.min(R, 320)) continue;
            qn.setFromAxisAngle(up, rot);
            s.set(sz, sz * (0.8 + (rot % 0.6)), sz);
            p.set(x, toY(h) - 0.05, z);
            m.compose(p, qn, s);
            this.stumps.setMatrixAt(ns, m);
            col.setRGB(0.8 + (rot % 0.3), 0.78 + (rot % 0.25), 0.75);
            this.stumps.setColorAt(ns, col);
            ns++;
          }
        }
      }
    }
    // AGFC brush piles: small cut cedars lying on the bed
    if (this.showAttractors && this.app.poiData) {
      for (const a of this.app.poiData.attractors) {
        const [x, z, h] = a;
        const d = Math.hypot(x - cam.x, z - cam.z);
        if (d > 260) continue;
        const rnd = mulberry(hashCell(Math.round(x), Math.round(z)));
        for (let k = 0; k < 7; k++) {
          const v = 5;
          const c = counts[v];
          if (c >= this.maxA) break;
          const T = this.tierA[v];
          const ang = rnd() * 6.28;
          qn.setFromEuler(new THREE.Euler(1.3 + rnd() * 0.3, ang, 0, 'YXZ'));
          const ht = 3 + rnd() * 3;
          s.set(ht, ht, ht);
          p.set(x + (rnd() - 0.5) * 6, toY(h) + 0.3, z + (rnd() - 0.5) * 6);
          m.compose(p, qn, s);
          T.bark.setMatrixAt(c, m); T.dBark.setMatrixAt(c, m);
          col.setRGB(0.7, 0.62, 0.55); T.bark.setColorAt(c, col);
          counts[v] = c + 1;
        }
      }
    }
    this.tierA.forEach((T, i) => {
      for (const mm of [T.bark, T.leaves, T.dBark, T.dLeaf]) {
        if (!mm) continue;
        mm.count = counts[i];
        mm.instanceMatrix.needsUpdate = true;
        if (mm.instanceColor) mm.instanceColor.needsUpdate = true;
      }
    });
    this.imp.count = nb;
    this.imp.instanceMatrix.needsUpdate = true;
    this.imp.instanceColor.needsUpdate = true;
    this.impVar.needsUpdate = true;
    this.stumps.count = ns;
    this.stumps.instanceMatrix.needsUpdate = true;
    this.stumps.instanceColor.needsUpdate = true;
    this.stats = { near: counts.reduce((a, b) => a + b, 0), far: nb, stumps: ns };
  }

  _clear() {
    if (!this.tierA) return;
    for (const T of this.tierA) for (const mm of [T.bark, T.leaves, T.dBark, T.dLeaf]) if (mm) mm.count = 0;
    this.imp.count = 0; this.stumps.count = 0;
  }
}

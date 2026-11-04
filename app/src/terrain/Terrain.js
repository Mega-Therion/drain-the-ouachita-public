import * as THREE from 'three';
import { G } from '../render/common.js';
import { TERRAIN_VERT, TERRAIN_FRAG, DEPTH_FRAG } from './terrainShader.js';
import { WATER_VERT, WATER_FRAG } from '../water/waterShader.js';
import { tileWorldRect, tileSize, SCALE, REGION_MERC, tileBoundsMerc } from '../geo.js';
import { REGION, TILE_N, HD_TERRAIN } from '../config.js';

const _box = new THREE.Box3();
const _v = new THREE.Vector3();

function gridGeometry(M) {
  const verts = [];
  const idx = [];
  const n = M + 1;
  for (let j = 0; j <= M; j++) for (let i = 0; i <= M; i++) verts.push(i, 0, j);
  for (let j = 0; j < M; j++) for (let i = 0; i < M; i++) {
    const a = j * n + i; const b = a + 1; const c = a + n; const d = c + 1;
    // alternate diagonals for nicer shading
    if ((i + j) % 2 === 0) idx.push(a, c, b, b, c, d); else idx.push(a, c, d, a, d, b);
  }
  // skirts: duplicate edge vertices pushed down
  const base = verts.length / 3;
  const edge = [];
  for (let i = 0; i <= M; i++) edge.push([i, 0]);
  for (let j = 1; j <= M; j++) edge.push([M, j]);
  for (let i = M - 1; i >= 0; i--) edge.push([i, M]);
  for (let j = M - 1; j >= 1; j--) edge.push([0, j]);
  for (const [i, j] of edge) verts.push(i, 1, j);
  for (let k = 0; k < edge.length; k++) {
    const [i0, j0] = edge[k]; const [i1, j1] = edge[(k + 1) % edge.length];
    const a = j0 * n + i0; const b = j1 * n + i1;
    const c = base + k; const d = base + (k + 1) % edge.length;
    idx.push(a, c, b, b, c, d);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(verts, 3));
  g.setIndex(idx);
  g.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e9);
  return g;
}

function waterGeometry(M) {
  const verts = [];
  const idx = [];
  const n = M + 1;
  for (let j = 0; j <= M; j++) for (let i = 0; i <= M; i++) verts.push(i, 0, j);
  for (let j = 0; j < M; j++) for (let i = 0; i < M; i++) {
    const a = j * n + i; const b = a + 1; const c = a + n; const d = c + 1;
    idx.push(a, c, b, b, c, d);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(verts, 3));
  g.setIndex(idx);
  g.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e9);
  return g;
}

const DUMMY_TEX = new THREE.DataTexture(new Uint8Array([40, 45, 35, 255]), 1, 1);
DUMMY_TEX.needsUpdate = true;

class Node {
  constructor(terrain, z, x, y, parent) {
    this.t = terrain; this.z = z; this.x = x; this.y = y; this.parent = parent;
    this.rect = tileWorldRect(z, x, y);
    this.size = this.rect[2] - this.rect[0];
    this.children = null;
    const info = terrain.store.info(z, x, y);
    this.baked = !!info;
    if (info) { this.hmin = info[0]; this.hmax = info[1]; this.waterFlag = info[2]; }
    else if (parent) { this.hmin = parent.hmin; this.hmax = parent.hmax; this.waterFlag = parent.waterFlag; }
    else { this.hmin = 0; this.hmax = 800; this.waterFlag = 0; }
    this.inRegion = terrain.inRegion(this);
    this.mesh = null;
    this.water = null;
    this.uniforms = null;
    this.imgKey = null;
    this.imgFadeStart = 0;
    this.lastFrame = -1;
    this.hd = null; this.hdState = 0;
  }

  get maxZ() { return this.inRegion ? this.t.maxZoom : Math.min(this.t.maxZoom, 13); }

  /** Data tile used for heights: own baked tile, or nearest loaded baked ancestor. */
  dataSource() {
    if (this.hd) return { tile: this.hd, off: [0, 0], scale: 1 };
    let n = this; let f = 1; let ox = 0; let oy = 0;
    while (n) {
      if (n.baked) {
        const t = this.t.store.get(n.z, n.x, n.y);
        if (t) {
          const d = this.z - n.z;
          const s = 2 ** d;
          ox = (this.x - n.x * s) / s; oy = (this.y - n.y * s) / s;
          return { tile: t, off: [ox, oy], scale: 1 / s };
        }
      }
      n = n.parent; f *= 2;
    }
    return null;
  }

  ownDataReady() {
    if (!this.baked) return true;
    return !!this.t.store.get(this.z, this.x, this.y);
  }

  makeChildren() {
    if (this.children) return this.children;
    const z = this.z + 1; const x = this.x * 2; const y = this.y * 2;
    this.children = [
      new Node(this.t, z, x, y, this), new Node(this.t, z, x + 1, y, this),
      new Node(this.t, z, x, y + 1, this), new Node(this.t, z, x + 1, y + 1, this),
    ];
    return this.children;
  }

  box(out) {
    const lo = this.t.toY(Math.min(this.hmin, this.waterFlag ? this.t.levelM : 1e9)) - 2;
    const hi = this.t.toY(Math.max(this.hmax, this.waterFlag ? this.t.levelM : -1e9)) + 2;
    out.min.set(this.rect[0], lo, this.rect[1]);
    out.max.set(this.rect[2], hi, this.rect[3]);
    return out;
  }

  dispose() {
    if (this.mesh) { this.mesh.material.dispose(); this.depthMesh.material.dispose(); }
    if (this.water) this.water.material.dispose();
    if (this.hd) { this.hd.dispose(); this.hd = null; }
    this.mesh = null; this.water = null;
    if (this.children) for (const c of this.children) c.dispose();
    this.children = null;
  }
}

export class Terrain {
  constructor({ store, imagery, quality }) {
    this.store = store;
    this.imagery = imagery;
    this.group = new THREE.Group();
    this.group.matrixAutoUpdate = false;
    this.waterGroup = new THREE.Group();
    this.waterGroup.matrixAutoUpdate = false;
    this.depthGroup = new THREE.Group();
    this.depthGroup.matrixAutoUpdate = false;
    this.frame = 0;
    this.levelM = 176.17;
    this.selected = [];
    this.lodCam = new THREE.Vector3();
    this.setQuality(quality);
    this.uClipY = { value: -1e9 };
    this.hdEnabled = quality.hd;
    this.hdInflight = 0;
    this.stats = { nodes: 0, water: 0 };
    const rm = REGION_MERC;
    this.regionMerc = rm;
    this.roots = [];
    for (let y = REGION.z9y[0]; y <= REGION.z9y[1]; y++) for (let x = REGION.z9x[0]; x <= REGION.z9x[1]; x++) {
      this.roots.push(new Node(this, 9, x, y, null));
    }
  }

  setQuality(q) {
    this.q = q;
    this.gridRes = q.gridRes;
    this.lodK = q.lodK;
    this.maxZoom = q.maxZoom;
    if (this.geo) this.geo.dispose();
    if (this.wgeo) this.wgeo.dispose();
    this.geo = gridGeometry(this.gridRes);
    this.wgeo = waterGeometry(Math.max(16, this.gridRes / 2));
    // rebuild existing meshes lazily
    if (this.roots) for (const r of this.roots) r.dispose();
  }

  inRegion(node) {
    const [minx, miny, maxx, maxy] = tileBoundsMerc(node.z, node.x, node.y);
    const r = this.regionMerc;
    return minx >= r[0] - 1 && maxx <= r[2] + 1 && miny >= r[1] - 1 && maxy <= r[3] + 1;
  }

  toY(h) { return G.uExag.value.y + (h - G.uExag.value.y) * G.uExag.value.x; }

  range(z) { return this.lodK * tileSize(z) * SCALE; }

  _material(node) {
    const u = {
      uNodeRect: { value: new THREE.Vector4(node.rect[0], node.rect[1], node.size, this.gridRes) },
      uMorph: { value: new THREE.Vector2(1e9, 2e9) },
      uLodCam: { value: this.lodCam },
      uDataX: { value: new THREE.Vector4(0, 0, 1, 0) },
      uHeightTex: { value: null },
      uNormalTex: { value: null },
      uClassTex: { value: null },
      uSkirt: { value: Math.max(2, node.size * 0.015) },
      uImg: { value: DUMMY_TEX },
      uImgX: { value: new THREE.Vector4(0, 0, 1, 0) },
      uImgPrev: { value: DUMMY_TEX },
      uImgPrevX: { value: new THREE.Vector4(0, 0, 0, 1) },
      uClipY: this.uClipY,
      uDetail: { value: this.q.gridRes >= 48 ? 1 : 0.6 },
    };
    node.uniforms = u;
    const uniforms = { ...G, ...u };
    const mat = new THREE.ShaderMaterial({
      uniforms, vertexShader: TERRAIN_VERT, fragmentShader: TERRAIN_FRAG,
    });
    mat.extensions = { derivatives: true };
    const dmat = new THREE.ShaderMaterial({ uniforms, vertexShader: TERRAIN_VERT, fragmentShader: DEPTH_FRAG });
    return [mat, dmat];
  }

  _waterMaterial(node) {
    const u = node.uniforms;
    const wu = {
      uNodeRect: { value: new THREE.Vector4(node.rect[0], node.rect[1], node.size, Math.max(16, this.gridRes / 2)) },
      uDataX: u.uDataX, uHeightTex: u.uHeightTex, uNormalTex: u.uNormalTex, uClassTex: u.uClassTex,
      uLodCam: { value: this.lodCam },
    };
    return new THREE.ShaderMaterial({
      uniforms: { ...G, ...this.waterUniforms, ...wu },
      vertexShader: WATER_VERT, fragmentShader: WATER_FRAG,
      transparent: false, depthWrite: true,
      side: THREE.DoubleSide,
      polygonOffset: true,
      // pull the surface toward the camera; three.js flips the sign itself for a reversed depth buffer,
      // so flipping it here too pushed distant water behind the ground (west arms looked dry)
      polygonOffsetFactor: -1,
      polygonOffsetUnits: -4,
    });
  }

  /** Assign data + imagery to a node's uniforms; returns false if no data at all. */
  _bind(node) {
    const src = node.dataSource();
    if (!src) return false;
    const u = node.uniforms;
    const t = src.tile;
    u.uDataX.value.set(src.off[0], src.off[1], src.scale, t.base);
    u.uHeightTex.value = t.heightTex;
    u.uNormalTex.value = t.normalTex;
    u.uClassTex.value = t.classTex;
    node.srcTile = t;
    // imagery
    const plan = this.imagery.plan(node.z, node.x, node.y);
    const tex = this.imagery.get(plan.key);
    const now = performance.now();
    if (tex) {
      if (u.uImg.value !== tex) {
        // remember what was showing for a cross-fade
        if (u.uImgX.value.w > 0.5) {
          u.uImgPrev.value = u.uImg.value; u.uImgPrevX.value.set(u.uImgX.value.x, u.uImgX.value.y, u.uImgX.value.z, 0);
        }
        u.uImg.value = tex;
        u.uImgX.value.set(plan.off[0], plan.off[1], plan.scale, 1);
        node.imgFadeStart = now;
      }
      const f = Math.min(1, (now - node.imgFadeStart) / 350);
      u.uImgPrevX.value.w = u.uImgPrev.value === DUMMY_TEX ? 1 : f;
    } else {
      // fall back to the nearest ancestor imagery
      u.uImgX.value.w = 0;
      let p = node.parent; let d = 1;
      while (p) {
        const pp = this.imagery.plan(p.z, p.x, p.y);
        const pt = this.imagery.get(pp.key);
        if (pt) {
          const s = 2 ** d;
          const ox = (node.x - p.x * s) / s; const oy = (node.y - p.y * s) / s;
          u.uImgPrev.value = pt;
          u.uImgPrevX.value.set(pp.off[0] + ox * pp.scale, pp.off[1] + oy * pp.scale, pp.scale / s, 0);
          break;
        }
        p = p.parent; d++;
      }
      if (!p) u.uImgPrevX.value.set(0, 0, 0, 0);
    }
    return true;
  }

  /** Per-frame: choose nodes, stream data, update meshes. */
  update(camera, frustum, opts = {}) {
    this.frame++;
    this.store.frame = this.frame;
    this.lodCam.copy(camera.position);
    const sel = [];
    const want = [];
    const visit = (node) => {
      node.box(_box);
      const inView = frustum.intersectsBox(_box);
      const dist = _box.distanceToPoint(camera.position);
      if (!inView) {
        // keep data warm for nearby off-screen nodes, but do not draw
        return;
      }
      const canSplit = node.z < node.maxZ && dist < this.range(node.z + 1);
      if (canSplit) {
        const kids = node.makeChildren();
        let ready = true;
        for (const c of kids) {
          if (!c.ownDataReady()) { ready = false; want.push([c, dist]); }
        }
        if (ready) { for (const c of kids) visit(c); return; }
      }
      sel.push([node, dist]);
      if (node.baked && !node.ownDataReady()) want.push([node, dist]);
    };
    for (const r of this.roots) {
      if (!r.ownDataReady()) { want.push([r, 0]); continue; }
      visit(r);
    }
    for (const [n, d] of want) this.store.request(n.z, n.x, n.y, d / n.size);

    // HD lidar for the closest land nodes
    if (this.hdEnabled && opts.hdLoader) opts.hdLoader.update(sel, camera);

    // build draw list
    this.group.children.length = 0;
    this.waterGroup.children.length = 0;
    this.depthGroup.children.length = 0;
    let nw = 0;
    for (const [node, dist] of sel) {
      if (!node.mesh) {
        const [m, dm] = this._material(node);
        node.mesh = new THREE.Mesh(this.geo, m);
        node.mesh.frustumCulled = false;
        node.mesh.matrixAutoUpdate = false;
        node.depthMesh = new THREE.Mesh(this.geo, dm);
        node.depthMesh.frustumCulled = false;
        node.depthMesh.matrixAutoUpdate = false;
      }
      if (!this._bind(node)) continue;
      node.lastFrame = this.frame;
      const r = this.range(node.z);
      node.uniforms.uMorph.value.set(node.z === 9 ? 1e9 : r * 0.62, node.z === 9 ? 2e9 : r * 0.98);
      // imagery request, prioritised by distance relative to node size
      const plan = this.imagery.plan(node.z, node.x, node.y);
      if (!this.imagery.get(plan.key)) this.imagery.request(plan, dist / node.size + (node.z < 12 ? -1 : 0));
      node.mesh.renderOrder = -node.z;
      this.group.children.push(node.mesh);
      this.depthGroup.children.push(node.depthMesh);
      const hasWater = node.srcTile && node.srcTile.hasWater;
      if (hasWater) {
        if (!node.water) {
          node.water = new THREE.Mesh(this.wgeo, this._waterMaterial(node));
          node.water.frustumCulled = false;
          node.water.matrixAutoUpdate = false;
        }
        this.waterGroup.children.push(node.water);
        nw++;
      }
    }
    for (const c of this.group.children) c.parent = this.group;
    for (const c of this.waterGroup.children) c.parent = this.waterGroup;
    for (const c of this.depthGroup.children) c.parent = this.depthGroup;
    this.selected = sel;
    this.stats.nodes = sel.length;
    this.stats.water = nw;
    this.imagery.update();
    if (this.frame % 120 === 0) this._gc();
  }

  /** Free GPU resources of nodes not drawn for a while. */
  _gc() {
    const stale = this.frame - 240;
    const walk = (n) => {
      if (!n.children) return;
      for (const c of n.children) walk(c);
      if (n.children.every((c) => c.lastFrame < stale && !c.children)) {
        if (n.lastFrame >= stale || n.z < 11) {
          for (const c of n.children) c.dispose();
          n.children = null;
        }
      }
    };
    for (const r of this.roots) walk(r);
  }

  /** Height (metres) at world x,z using the finest loaded data incl. HD. */
  heightAt(wx, wz) {
    for (let i = this.selected.length - 1; i >= 0; i--) {
      const [n] = this.selected[i];
      if (wx >= n.rect[0] && wx <= n.rect[2] && wz >= n.rect[1] && wz <= n.rect[3] && n.hd) {
        return n.hd.heightAt(wx, wz);
      }
    }
    return this.store.heightAt(wx, wz);
  }
}

export { DUMMY_TEX };

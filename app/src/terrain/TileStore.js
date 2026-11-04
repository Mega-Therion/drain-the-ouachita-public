import * as THREE from 'three';
import { DATA_URL, TILE_N } from '../config.js';
import { tileWorldRect, worldToTile, tileSize } from '../geo.js';
import { SCALE } from '../geo.js';

const CORE = TILE_N + 1; // 257

/** Float32 -> IEEE half (Uint16) */
const f32 = new Float32Array(1);
const u32 = new Uint32Array(f32.buffer);
export function toHalf(v) {
  f32[0] = v;
  const x = u32[0];
  const sign = (x >>> 16) & 0x8000;
  let e = ((x >>> 23) & 0xff) - 127 + 15;
  let m = x & 0x7fffff;
  if (e <= 0) {
    if (e < -10) return sign;
    m = (m | 0x800000) >> (1 - e);
    return sign | ((m + 0x1000) >> 13);
  }
  if (e >= 31) return sign | 0x7c00;
  const r = sign | (e << 10) | ((m + 0x1000) >> 13);
  return r;
}

/**
 * A decoded terrain data tile with GPU textures:
 *  heightTex  RG16F  (height - base, static water - base or -9999)
 *  normalTex  RGBA8  (normal xyz, concavity)
 *  classTex   RGBA8  (basin, channel, reconstructed bed, fixed water)
 */
export class DataTile {
  constructor(key, z, x, y, msg, isHD = false) {
    this.key = key; this.z = z; this.x = x; this.y = y; this.isHD = isHD;
    this.n = CORE;
    this.height = msg.height; // Float32 CORE^2
    this.water = msg.water;   // Float32 or null
    this.cls = msg.cls;       // Uint8 or null
    this.hmin = msg.hmin; this.hmax = msg.hmax;
    this.base = Math.floor(msg.hmin);
    this.rect = tileWorldRect(z, x, y);
    this.size = this.rect[2] - this.rect[0];
    this.lastUsed = 0;
    this.hasWater = !!this.water;
    this._buildTextures(msg.normal);
  }

  _buildTextures(normal) {
    const n = this.n;
    const hv = new Uint16Array(n * n * 2);
    const base = this.base;
    for (let k = 0; k < n * n; k++) {
      hv[k * 2] = toHalf(this.height[k] - base);
      const w = this.water ? this.water[k] : -1000;
      hv[k * 2 + 1] = toHalf(w > -999 ? w - base : -9999);
    }
    const ht = new THREE.DataTexture(hv, n, n, THREE.RGFormat, THREE.HalfFloatType);
    ht.minFilter = ht.magFilter = THREE.LinearFilter;
    ht.wrapS = ht.wrapT = THREE.ClampToEdgeWrapping;
    ht.generateMipmaps = false;
    ht.needsUpdate = true;
    this.heightTex = ht;

    const nt = new THREE.DataTexture(normal, n, n, THREE.RGBAFormat, THREE.UnsignedByteType);
    nt.minFilter = THREE.LinearMipmapLinearFilter; nt.magFilter = THREE.LinearFilter;
    nt.generateMipmaps = true;
    nt.wrapS = nt.wrapT = THREE.ClampToEdgeWrapping;
    nt.needsUpdate = true;
    this.normalTex = nt;

    const cv = new Uint8Array(n * n * 4);
    if (this.cls) {
      for (let k = 0; k < n * n; k++) {
        const c = this.cls[k];
        cv[k * 4] = c & 1 ? 255 : 0;
        cv[k * 4 + 1] = c & 2 ? 255 : 0;
        cv[k * 4 + 2] = c & 4 ? 255 : 0;
        cv[k * 4 + 3] = c & 24 ? 255 : 0;
      }
    }
    const ct = new THREE.DataTexture(cv, n, n, THREE.RGBAFormat, THREE.UnsignedByteType);
    ct.minFilter = ct.magFilter = THREE.LinearFilter;
    ct.generateMipmaps = false;
    ct.needsUpdate = true;
    this.classTex = ct;
  }

  /** Bilinear sample of a field at fractional tile coords (u,v in [0,1]). */
  sample(arr, u, v) {
    const n = this.n;
    const fx = Math.min(Math.max(u, 0), 1) * (n - 1);
    const fy = Math.min(Math.max(v, 0), 1) * (n - 1);
    const x0 = Math.min(n - 2, Math.floor(fx)); const y0 = Math.min(n - 2, Math.floor(fy));
    const tx = fx - x0; const ty = fy - y0;
    const k = y0 * n + x0;
    return arr[k] * (1 - tx) * (1 - ty) + arr[k + 1] * tx * (1 - ty)
      + arr[k + n] * (1 - tx) * ty + arr[k + n + 1] * tx * ty;
  }

  uvOf(wx, wz) {
    return [(wx - this.rect[0]) / this.size, (wz - this.rect[1]) / this.size];
  }

  heightAt(wx, wz) {
    const [u, v] = this.uvOf(wx, wz);
    return this.sample(this.height, u, v);
  }

  /** nearest-sample class bits */
  classAt(wx, wz) {
    if (!this.cls) return 0;
    const [u, v] = this.uvOf(wx, wz);
    const n = this.n;
    const i = Math.round(Math.min(Math.max(u, 0), 1) * (n - 1));
    const j = Math.round(Math.min(Math.max(v, 0), 1) * (n - 1));
    return this.cls[j * n + i];
  }

  staticWaterAt(wx, wz) {
    if (!this.water) return -1000;
    const [u, v] = this.uvOf(wx, wz);
    const n = this.n;
    const i = Math.round(Math.min(Math.max(u, 0), 1) * (n - 1));
    const j = Math.round(Math.min(Math.max(v, 0), 1) * (n - 1));
    return this.water[j * n + i];
  }

  dispose() {
    this.heightTex.dispose(); this.normalTex.dispose(); this.classTex.dispose();
  }
}

export class TileStore {
  constructor() {
    this.tiles = new Map();      // key -> DataTile
    this.pending = new Map();    // key -> Promise
    this.manifest = null;
    this.workers = [];
    this.nextWorker = 0;
    this.reqId = 0;
    this.callbacks = new Map();
    this.frame = 0;
    this.maxTiles = 160;
    this.loadedBytes = 0;
    const nw = Math.min(4, Math.max(2, (navigator.hardwareConcurrency || 4) - 1));
    for (let i = 0; i < nw; i++) {
      const w = new Worker(new URL('./tileWorker.js', import.meta.url), { type: 'module' });
      w.onmessage = (ev) => {
        const cb = this.callbacks.get(ev.data.id);
        if (cb) { this.callbacks.delete(ev.data.id); cb(ev.data); }
      };
      this.workers.push(w);
    }
    this.inflight = 0;
    this.queue = [];
    this.maxInflight = 6;
  }

  async init() {
    const r = await fetch(`${DATA_URL}/manifest.json?v=${__BUILD__}`);
    this.manifest = await r.json();
    return this.manifest;
  }

  key(z, x, y) { return `${z}/${x}/${y}`; }

  info(z, x, y) {
    const m = this.manifest.tiles[z];
    return m ? m[`${x},${y}`] : undefined;
  }

  has(z, x, y) { return this.info(z, x, y) !== undefined; }

  get(z, x, y) {
    const t = this.tiles.get(this.key(z, x, y));
    if (t) t.lastUsed = this.frame;
    return t;
  }

  _decode(msg, transfer) {
    return new Promise((resolve) => {
      const id = ++this.reqId;
      this.callbacks.set(id, resolve);
      const w = this.workers[this.nextWorker++ % this.workers.length];
      w.postMessage({ id, ...msg }, transfer);
    });
  }

  /** Request a baked tile; resolves to DataTile or null. Priority: lower = sooner. */
  request(z, x, y, priority = 0) {
    const key = this.key(z, x, y);
    if (this.tiles.has(key)) return Promise.resolve(this.tiles.get(key));
    if (this.pending.has(key)) return this.pending.get(key).promise;
    if (!this.has(z, x, y)) return Promise.resolve(null);
    let resolveFn;
    const promise = new Promise((res) => { resolveFn = res; });
    const job = { key, z, x, y, priority, resolve: resolveFn, promise };
    this.pending.set(key, job);
    this.queue.push(job);
    this._pump();
    return promise;
  }

  reprioritize(z, x, y, priority) {
    const job = this.pending.get(this.key(z, x, y));
    if (job) job.priority = Math.min(job.priority, priority);
  }

  _pump() {
    if (this.inflight >= this.maxInflight || this.queue.length === 0) return;
    this.queue.sort((a, b) => a.priority - b.priority);
    while (this.inflight < this.maxInflight && this.queue.length) {
      const job = this.queue.shift();
      this.inflight++;
      this._load(job).finally(() => { this.inflight--; this._pump(); });
    }
  }

  async _load(job) {
    const { key, z, x, y } = job;
    try {
      const r = await fetch(`${DATA_URL}/t/${z}_${x}_${y}.bin${this.manifest?.built ? `?v=${this.manifest.built}` : ''}`);
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const buf = await r.arrayBuffer();
      this.loadedBytes += buf.byteLength;
      const spacing = tileSize(z) * SCALE / TILE_N;
      const msg = await this._decode({ kind: 'baked', buf, spacing }, [buf]);
      if (!msg.ok) throw new Error(msg.error);
      const t = new DataTile(key, z, x, y, msg);
      t.lastUsed = this.frame;
      this.tiles.set(key, t);
      this.pending.delete(key);
      job.resolve(t);
      this._evict();
    } catch (e) {
      console.warn('tile failed', key, e);
      this.pending.delete(key);
      job.resolve(null);
    }
  }

  _evict() {
    if (this.tiles.size <= this.maxTiles) return;
    const arr = [...this.tiles.values()].filter((t) => t.z > 9 && this.frame - t.lastUsed > 2);
    arr.sort((a, b) => a.lastUsed - b.lastUsed);
    const over = this.tiles.size - this.maxTiles;
    for (let i = 0; i < Math.min(over, arr.length); i++) {
      arr[i].dispose();
      this.tiles.delete(arr[i].key);
    }
  }

  /** Finest loaded baked tile covering a world point. */
  finestAt(wx, wz, maxZ = 14) {
    for (let z = maxZ; z >= 9; z--) {
      const [tx, ty] = worldToTile(wx, wz, z);
      const t = this.tiles.get(this.key(z, tx, ty));
      if (t) return t;
    }
    return null;
  }

  heightAt(wx, wz) {
    const t = this.finestAt(wx, wz);
    return t ? t.heightAt(wx, wz) : null;
  }

  /** Water info at a point: {bed, basin, staticLevel} */
  waterInfo(wx, wz) {
    const t = this.finestAt(wx, wz);
    if (!t) return null;
    const c = t.classAt(wx, wz);
    return { bed: t.heightAt(wx, wz), basin: (c & 1) !== 0, fixed: (c & 8) !== 0, reconstructed: (c & 4) !== 0, channel: (c & 2) !== 0, staticLevel: t.staticWaterAt(wx, wz), z: t.z };
  }
}

export { CORE };

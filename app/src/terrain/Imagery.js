import * as THREE from 'three';
import { IMAGERY } from '../config.js';

/**
 * Streams satellite / aerial imagery tiles and composes per-node textures.
 * A node at zoom z gets imagery at zoom min(z + bias, maxZoom). When the imagery
 * zoom is finer than the node, 2x2 sub-tiles are composed into one texture.
 */
export class Imagery {
  constructor(renderer, { provider = 'usgs', bias = 1, maxTextures = 140 } = {}) {
    this.renderer = renderer;
    this.setProvider(provider);
    this.bias = bias;
    this.cache = new Map();     // key -> {tex, lastUsed, size}
    this.pending = new Map();   // key -> job
    this.queue = [];
    this.inflight = 0;
    this.maxInflight = 10;
    this.frame = 0;
    this.maxTextures = maxTextures;
    this.aniso = Math.min(8, renderer.capabilities.getMaxAnisotropy());
    this.failed = new Set();
    this.bytes = 0;
  }

  setProvider(name) {
    this.providerName = name;
    this.provider = IMAGERY[name];
    if (this.cache) {
      for (const v of this.cache.values()) v.tex.dispose();
      this.cache.clear();
      this.pending.clear();
      this.queue.length = 0;
      this.generation = (this.generation || 0) + 1;
    }
  }

  /** Which imagery request covers node (z,x,y): {iz, ix, iy, n, off, scale} */
  plan(z, x, y) {
    const maxZ = this.provider.maxZoom;
    const want = Math.min(z + this.bias, maxZ);
    if (want >= z) {
      const k = want - z;
      const n = Math.min(2 ** k, 2);       // compose at most 2x2
      const iz = z + Math.log2(n);
      return { iz, ix: x * n, iy: y * n, n, key: `${iz}/${x * n}/${y * n}/${n}`, off: [0, 0], scale: 1 };
    }
    // node finer than available imagery: use an ancestor tile with a sub-rect
    const d = z - want;
    const f = 2 ** d;
    const ax = Math.floor(x / f); const ay = Math.floor(y / f);
    return { iz: want, ix: ax, iy: ay, n: 1, key: `${want}/${ax}/${ay}/1`, off: [(x - ax * f) / f, (y - ay * f) / f], scale: 1 / f };
  }

  get(key) {
    const e = this.cache.get(key);
    if (e) { e.lastUsed = this.frame; return e.tex; }
    return null;
  }

  request(plan, priority) {
    if (this.cache.has(plan.key) || this.failed.has(plan.key)) return;
    const p = this.pending.get(plan.key);
    if (p) { p.priority = Math.min(p.priority, priority); return; }
    const job = { plan, priority, gen: this.generation };
    this.pending.set(plan.key, job);
    this.queue.push(job);
  }

  update() {
    this.frame++;
    if (this.queue.length && this.inflight < this.maxInflight) {
      this.queue.sort((a, b) => a.priority - b.priority);
      while (this.inflight < this.maxInflight && this.queue.length) {
        const job = this.queue.shift();
        this.inflight++;
        this._load(job).finally(() => { this.inflight--; });
      }
    }
    if (this.cache.size > this.maxTextures) this._evict();
  }

  /** Drop queued requests that were not re-requested recently (camera moved on). */
  prune(maxAgeFrames = 90) {
    this.queue = this.queue.filter((j) => {
      if (this.frame - (j.touch || this.frame) > maxAgeFrames) { this.pending.delete(j.plan.key); return false; }
      return true;
    });
  }

  async _fetchBitmap(z, x, y) {
    const url = this.provider.url(z, x, y);
    const r = await fetch(url, { mode: 'cors', credentials: 'omit' });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    const blob = await r.blob();
    this.bytes += blob.size;
    return createImageBitmap(blob);
  }

  async _load(job) {
    const { plan } = job;
    try {
      let image;
      if (plan.n === 1) {
        image = await this._fetchBitmap(plan.iz, plan.ix, plan.iy);
      } else {
        const n = plan.n;
        const size = 256 * n;
        const canvas = typeof OffscreenCanvas !== 'undefined' ? new OffscreenCanvas(size, size) : Object.assign(document.createElement('canvas'), { width: size, height: size });
        const ctx = canvas.getContext('2d');
        const parts = [];
        for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) {
          parts.push(this._fetchBitmap(plan.iz, plan.ix + i, plan.iy + j).then((bm) => {
            ctx.drawImage(bm, i * 256, j * 256);
            bm.close && bm.close();
          }).catch(() => {}));
        }
        await Promise.all(parts);
        image = canvas.transferToImageBitmap ? canvas.transferToImageBitmap() : canvas;
      }
      if (job.gen !== this.generation) return;
      const tex = new THREE.Texture(image);
      tex.colorSpace = THREE.NoColorSpace; // converted in shader
      tex.flipY = false;
      tex.anisotropy = this.aniso;
      tex.minFilter = THREE.LinearMipmapLinearFilter;
      tex.magFilter = THREE.LinearFilter;
      tex.wrapS = tex.wrapT = THREE.ClampToEdgeWrapping;
      tex.generateMipmaps = true;
      tex.needsUpdate = true;
      this.cache.set(plan.key, { tex, lastUsed: this.frame });
    } catch (e) {
      this.failed.add(plan.key);
    } finally {
      this.pending.delete(plan.key);
    }
  }

  _evict() {
    const arr = [...this.cache.entries()].filter(([, v]) => this.frame - v.lastUsed > 3);
    arr.sort((a, b) => a[1].lastUsed - b[1].lastUsed);
    let over = this.cache.size - this.maxTextures;
    for (const [k, v] of arr) {
      if (over-- <= 0) break;
      v.tex.dispose();
      if (v.tex.image && v.tex.image.close) v.tex.image.close();
      this.cache.delete(k);
    }
  }
}

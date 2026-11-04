import { HD_TERRAIN, TILE_N, LAKE } from '../config.js';
import { tileBoundsMerc, tileSize, SCALE } from '../geo.js';
import { DataTile } from './TileStore.js';

/**
 * Streams 1 m USGS 3DEP lidar (LERC) for the nodes closest to the camera and
 * merges it with the baked tile (the reconstructed lake bed stays under the lake).
 */
export class HDLoader {
  constructor(store) {
    this.store = store;
    this.cache = new Map();
    this.inflight = 0;
    this.max = 3;
    this.failed = new Map(); // key -> time of failure (retry after 30 s)
    this.frame = 0;
    this.enabled = true;
  }

  update(selected, camera) {
    this.frame++;
    if (!this.enabled) return;
    const cand = [];
    for (const [node, dist] of selected) {
      if (node.z < HD_TERRAIN.minZoom || node.z > HD_TERRAIN.maxZoom || !node.inRegion) continue;
      const key = `${node.z}/${node.x}/${node.y}`;
      const have = this.cache.get(key);
      if (have) { have.used = this.frame; if (node.hd !== have.tile) { node.hd = have.tile; } continue; }
      if (dist > node.size * 2.5 || (this.failed.has(key) && performance.now() - this.failed.get(key) < 30000)) continue;
      // only where there is land above the full pool (lidar has nothing new under the old lake)
      if (node.hmax < LAKE.fullPoolM - 1) continue;
      cand.push([node, dist, key]);
    }
    cand.sort((a, b) => a[1] - b[1]);
    for (const [node, , key] of cand) {
      if (this.inflight >= this.max) break;
      if (this.cache.has(key) || node._hdPending) continue;
      this._load(node, key);
    }
    if (this.frame % 60 === 0) this._evict();
  }

  async _load(node, key) {
    // baked ancestor for the merge
    let a = node; while (a && !(a.baked && this.store.get(a.z, a.x, a.y))) a = a.parent;
    if (!a) return;
    const base = this.store.get(a.z, a.x, a.y);
    node._hdPending = true;
    this.inflight++;
    try {
      const [minx, miny, maxx, maxy] = tileBoundsMerc(node.z, node.x, node.y);
      const step = (maxx - minx) / TILE_N;
      const n = TILE_N + 3;
      const bx0 = minx - step - step / 2; const bx1 = minx + (n - 1.5) * step;
      const by1 = maxy + step + step / 2; const by0 = maxy - (n - 1.5) * step;
      const url = `${HD_TERRAIN.url}?bbox=${bx0},${by0},${bx1},${by1}&bboxSR=3857&imageSR=3857&size=${n},${n}&format=lerc&pixelType=F32&noDataInterpretation=esriNoDataMatchAny&interpolation=RSP_BilinearInterpolation&f=image`;
      const r = await fetch(url);
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const buf = await r.arrayBuffer();
      this.store.loadedBytes += buf.byteLength;
      const d = node.z - a.z; const s = 2 ** d;
      const ox = ((node.x - a.x * s) / s) * (base.n - 1);
      const oy = ((node.y - a.y * s) / s) * (base.n - 1);
      const span = (base.n - 1) / s;
      const spacing = tileSize(node.z) * SCALE / TILE_N;
      const msg = await this.store._decode({
        kind: 'hd', buf, spacing,
        base: { bn: base.n, bh: base.height, bcls: base.cls, bwater: base.water, ox, oy, span },
      }, [buf]);
      if (!msg.ok) throw new Error(msg.error);
      const tile = new DataTile(`hd/${key}`, node.z, node.x, node.y, msg, true);
      this.cache.set(key, { tile, used: this.frame, node });
      node.hd = tile;
    } catch (e) {
      this.failed.set(key, performance.now());
    } finally {
      node._hdPending = false;
      this.inflight--;
    }
  }

  _evict() {
    if (this.cache.size < 48) return;
    const arr = [...this.cache.entries()].sort((a, b) => a[1].used - b[1].used);
    for (let i = 0; i < arr.length - 40; i++) {
      const [k, v] = arr[i];
      if (this.frame - v.used < 30) continue;
      if (v.node && v.node.hd === v.tile) v.node.hd = null;
      v.tile.dispose();
      this.cache.delete(k);
    }
  }
}

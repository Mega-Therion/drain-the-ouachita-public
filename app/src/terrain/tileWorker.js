// Decodes baked terrain tiles and HD lidar patches off the main thread.
import { gunzipSync } from 'fflate';
import lercWasmUrl from 'lerc/lerc-wasm.wasm?url';

let lercReady = null;
let Lerc = null;

function ensureLerc() {
  if (!lercReady) {
    lercReady = (async () => {
      const mod = await import('lerc');
      Lerc = mod;
      await Lerc.load({ locateFile: () => lercWasmUrl });
    })();
  }
  return lercReady;
}

/**
 * Baked tile layout (after gunzip), little-endian:
 *  0  'DTO1'
 *  4  u8 z, u8 version, u16 x, u16 y, u16 n (samples per side incl. 1-sample border), u16 flags, u16 reserved
 *  16 heights: n*n zigzag residuals of the planar predictor on dm=(h+100)*10, lo-byte plane then hi-byte plane
 *  if flags&1: static water level dm (0 = none) lo/hi planes, then class plane (u8 bits)
 */
function decodeBaked(buf) {
  const raw = gunzipSync(new Uint8Array(buf));
  const dv = new DataView(raw.buffer, raw.byteOffset, raw.byteLength);
  if (raw[0] !== 68 || raw[1] !== 84 || raw[2] !== 79) throw new Error('bad tile magic');
  const n = dv.getUint16(10, true);
  const flags = dv.getUint16(12, true);
  const count = n * n;
  let o = 16;
  const lo = raw.subarray(o, o + count); o += count;
  const hi = raw.subarray(o, o + count); o += count;
  const v = new Int32Array(count);
  for (let j = 0; j < n; j++) {
    for (let i = 0; i < n; i++) {
      const k = j * n + i;
      const zz = lo[k] | (hi[k] << 8);
      const res = (zz >>> 1) ^ -(zz & 1);
      let pred = 0;
      if (i > 0 && j > 0) pred = v[k - 1] + v[k - n] - v[k - n - 1];
      else if (i > 0) pred = v[k - 1];
      else if (j > 0) pred = v[k - n];
      v[k] = pred + res;
    }
  }
  const height = new Float32Array(count);
  for (let k = 0; k < count; k++) height[k] = v[k] / 10 - 100;
  let water = null;
  let cls = null;
  if (flags & 1) {
    const wlo = raw.subarray(o, o + count); o += count;
    const whi = raw.subarray(o, o + count); o += count;
    water = new Float32Array(count);
    for (let k = 0; k < count; k++) {
      const w = wlo[k] | (whi[k] << 8);
      water[k] = w === 0 ? -1000 : w / 10 - 100;
    }
    cls = raw.slice(o, o + count);
  }
  return { n, height, water, cls };
}

/** Normals (+ concavity in alpha) for the core of an (nb x nb) grid with 1-sample border. */
function coreNormals(nb, height, spacing) {
  const n = nb - 2;
  const out = new Uint8Array(n * n * 4);
  const inv = 1 / (2 * spacing);
  for (let j = 0; j < n; j++) {
    for (let i = 0; i < n; i++) {
      const k = (j + 1) * nb + (i + 1);
      const dx = (height[k + 1] - height[k - 1]) * inv;
      const dz = (height[k + nb] - height[k - nb]) * inv;
      const l = Math.hypot(dx, 1, dz);
      const o = (j * n + i) * 4;
      out[o] = Math.round((-dx / l * 0.5 + 0.5) * 255);
      out[o + 1] = Math.round((1 / l * 0.5 + 0.5) * 255);
      out[o + 2] = Math.round((-dz / l * 0.5 + 0.5) * 255);
      const lap = (height[k - 1] + height[k + 1] + height[k - nb] + height[k + nb] - 4 * height[k]) / (spacing * spacing);
      out[o + 3] = Math.max(0, Math.min(255, Math.round(128 + lap * 900)));
    }
  }
  return out;
}

function crop(nb, arr, ch = 1) {
  if (!arr) return null;
  const n = nb - 2;
  const out = new arr.constructor(n * n * ch);
  for (let j = 0; j < n; j++) {
    const src = ((j + 1) * nb + 1) * ch;
    out.set(arr.subarray(src, src + n * ch), j * n * ch);
  }
  return out;
}

function minmax(a) {
  let lo = Infinity; let hi = -Infinity;
  for (let k = 0; k < a.length; k++) { const v = a[k]; if (v < lo) lo = v; if (v > hi) hi = v; }
  return [lo, hi];
}

async function decodeHD(buf, base) {
  await ensureLerc();
  const img = Lerc.decode(buf);
  const nb = img.width;
  const px = img.pixels[0];
  const mask = img.mask;
  const height = new Float32Array(nb * nb);
  const water = new Float32Array(nb * nb);
  const cls = new Uint8Array(nb * nb);
  const { bn, bh, bcls, bwater, ox, oy, span } = base;
  for (let j = 0; j < nb; j++) {
    for (let i = 0; i < nb; i++) {
      const k = j * nb + i;
      // position of this sample in the baked parent's core grid (0..bn-1)
      const fx = ox + ((i - 1) / (nb - 3)) * span;
      const fy = oy + ((j - 1) / (nb - 3)) * span;
      const cx = Math.min(Math.max(fx, 0), bn - 1.001);
      const cy = Math.min(Math.max(fy, 0), bn - 1.001);
      const x0 = Math.floor(cx); const y0 = Math.floor(cy);
      const tx = cx - x0; const ty = cy - y0;
      const b = y0 * bn + x0;
      const bv = bh[b] * (1 - tx) * (1 - ty) + bh[b + 1] * tx * (1 - ty) + bh[b + bn] * (1 - tx) * ty + bh[b + bn + 1] * tx * ty;
      const nearest = Math.round(cy) * bn + Math.round(cx);
      const c = bcls ? bcls[nearest] : 0;
      cls[k] = c;
      water[k] = bwater ? bwater[nearest] : -1000;
      // basin weight: fraction of the 4 neighbours in the lake basin with a reconstructed bed
      let m = 0;
      if (bcls) {
        const w4 = [(bcls[b] & 4) ? 1 : 0, (bcls[b + 1] & 4) ? 1 : 0, (bcls[b + bn] & 4) ? 1 : 0, (bcls[b + bn + 1] & 4) ? 1 : 0];
        m = w4[0] * (1 - tx) * (1 - ty) + w4[1] * tx * (1 - ty) + w4[2] * (1 - tx) * ty + w4[3] * tx * ty;
      }
      let v = px[k];
      if ((mask && !mask[k]) || !(v > -500 && v < 9000)) v = bv;
      // keep the lidar where it is land; trust the reconstructed bed under the old water surface
      height[k] = m > 0.001 ? bv * m + v * (1 - m) : v;
    }
  }
  return { nb, height, water, cls };
}

self.onmessage = async (ev) => {
  const { id, kind, buf, spacing, base } = ev.data;
  try {
    let nb; let height; let water = null; let cls = null;
    if (kind === 'baked') {
      const t = decodeBaked(buf);
      nb = t.n; height = t.height; water = t.water; cls = t.cls;
    } else {
      const t = await decodeHD(buf, base);
      nb = t.nb; height = t.height; water = t.water; cls = t.cls;
    }
    const normal = coreNormals(nb, height, spacing);
    const h = crop(nb, height);
    const w = crop(nb, water);
    const c = crop(nb, cls);
    const [hmin, hmax] = minmax(h);
    const transfer = [h.buffer, normal.buffer];
    if (w) transfer.push(w.buffer);
    if (c) transfer.push(c.buffer);
    self.postMessage({ id, ok: true, n: nb - 2, height: h, water: w, cls: c, normal, hmin, hmax }, transfer);
  } catch (err) {
    self.postMessage({ id, ok: false, error: String((err && err.message) || err) });
  }
};

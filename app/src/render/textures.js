import * as THREE from 'three';

function mulberry(seed) {
  return () => {
    seed |= 0; seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function tileableValueNoise(size, cells, rnd) {
  const lat = new Float32Array(cells * cells).map(() => rnd());
  const out = new Float32Array(size * size);
  const s = (t) => t * t * (3 - 2 * t);
  for (let y = 0; y < size; y++) {
    const fy = (y / size) * cells; const y0 = Math.floor(fy); const ty = s(fy - y0);
    for (let x = 0; x < size; x++) {
      const fx = (x / size) * cells; const x0 = Math.floor(fx); const tx = s(fx - x0);
      const a = lat[(y0 % cells) * cells + (x0 % cells)];
      const b = lat[(y0 % cells) * cells + ((x0 + 1) % cells)];
      const c = lat[((y0 + 1) % cells) * cells + (x0 % cells)];
      const d = lat[((y0 + 1) % cells) * cells + ((x0 + 1) % cells)];
      out[y * size + x] = (a * (1 - tx) + b * tx) * (1 - ty) + (c * (1 - tx) + d * tx) * ty;
    }
  }
  return out;
}

/** 256^2 RGBA: R fine value noise, G fbm-friendly noise, B white, A cells. Repeat-wrapped. */
export function makeNoiseTexture() {
  const N = 256;
  const rnd = mulberry(1337);
  const r = tileableValueNoise(N, 32, rnd);
  const g1 = tileableValueNoise(N, 8, rnd);
  const g2 = tileableValueNoise(N, 16, rnd);
  const g3 = tileableValueNoise(N, 32, rnd);
  const data = new Uint8Array(N * N * 4);
  for (let k = 0; k < N * N; k++) {
    data[k * 4] = r[k] * 255;
    data[k * 4 + 1] = (g1[k] * 0.55 + g2[k] * 0.3 + g3[k] * 0.15) * 255;
    data[k * 4 + 2] = rnd() * 255;
    data[k * 4 + 3] = 0;
  }
  // cellular (tileable worley)
  const pts = [];
  const C = 12;
  for (let j = 0; j < C; j++) for (let i = 0; i < C; i++) pts.push([(i + rnd()) / C, (j + rnd()) / C]);
  for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
    const u = x / N; const v = y / N;
    let md = 9;
    const ci = Math.floor(u * C); const cj = Math.floor(v * C);
    for (let dj = -1; dj <= 1; dj++) for (let di = -1; di <= 1; di++) {
      const ii = (ci + di + C) % C; const jj = (cj + dj + C) % C;
      const [px, py] = pts[jj * C + ii];
      const ox = ci + di < 0 ? -1 : ci + di >= C ? 1 : 0;
      const oy = cj + dj < 0 ? -1 : cj + dj >= C ? 1 : 0;
      const dx = px + ox - u; const dy = py + oy - v;
      const d = dx * dx + dy * dy;
      if (d < md) md = d;
    }
    data[(y * N + x) * 4 + 3] = Math.min(255, Math.sqrt(md) * C * 255);
  }
  const t = new THREE.DataTexture(data, N, N, THREE.RGBAFormat);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.minFilter = THREE.LinearMipmapLinearFilter;
  t.magFilter = THREE.LinearFilter;
  t.generateMipmaps = true;
  t.needsUpdate = true;
  return t;
}

/** Tileable water normal map from a sum of directional waves (integer wave numbers). */
export function makeWaterNormalTexture() {
  const N = 256;
  const rnd = mulberry(4242);
  const waves = [];
  for (let i = 0; i < 28; i++) {
    const k = 1 + Math.floor(rnd() * (i < 8 ? 4 : i < 18 ? 9 : 18));
    const a = rnd() * Math.PI * 2;
    const kx = Math.round(Math.cos(a) * k); const ky = Math.round(Math.sin(a) * k);
    if (kx === 0 && ky === 0) continue;
    const amp = 1 / Math.pow(Math.hypot(kx, ky), 1.3);
    waves.push([kx, ky, amp, rnd() * Math.PI * 2]);
  }
  const h = new Float32Array(N * N);
  for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
    let s = 0;
    for (const [kx, ky, a, p] of waves) {
      const ph = 2 * Math.PI * (kx * x + ky * y) / N + p;
      // sharpened crests
      const w = Math.sin(ph);
      s += a * (w - 0.25 * w * w * w);
    }
    h[y * N + x] = s;
  }
  const data = new Uint8Array(N * N * 4);
  const scale = 6.0;
  for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
    const xl = h[y * N + ((x - 1 + N) % N)]; const xr = h[y * N + ((x + 1) % N)];
    const yu = h[((y - 1 + N) % N) * N + x]; const yd = h[((y + 1) % N) * N + x];
    const nx = (xl - xr) * scale * 0.5; const nz = (yu - yd) * scale * 0.5;
    const l = Math.hypot(nx, 1, nz);
    const o = (y * N + x) * 4;
    data[o] = (nx / l * 0.5 + 0.5) * 255;
    data[o + 1] = (nz / l * 0.5 + 0.5) * 255;
    data[o + 2] = (1 / l * 0.5 + 0.5) * 255;
    data[o + 3] = 255;
  }
  const t = new THREE.DataTexture(data, N, N, THREE.RGBAFormat);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.minFilter = THREE.LinearMipmapLinearFilter;
  t.magFilter = THREE.LinearFilter;
  t.generateMipmaps = true;
  t.needsUpdate = true;
  return t;
}

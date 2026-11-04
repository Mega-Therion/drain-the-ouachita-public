import * as THREE from 'three';
import { G } from './common.js';

const LAYERS = 8;
const S = 512;

function placeholder() {
  const t = new THREE.DataArrayTexture(new Uint8Array(4 * LAYERS).fill(128), 1, 1, LAYERS);
  t.needsUpdate = true;
  return t;
}

G.uGround = { value: placeholder() };
G.uGroundN = { value: placeholder() };
G.uGroundMean = { value: Array.from({ length: LAYERS }, () => new THREE.Vector3(0.5, 0.5, 0.5)) };
G.uLitter = { value: 1 };

async function loadStrip(url) {
  const r = await fetch(url);
  const bm = await createImageBitmap(await r.blob(), { colorSpaceConversion: 'none' });
  const c = typeof OffscreenCanvas !== 'undefined' ? new OffscreenCanvas(bm.width, bm.height) : Object.assign(document.createElement('canvas'), { width: bm.width, height: bm.height });
  const ctx = c.getContext('2d', { willReadFrequently: true });
  ctx.drawImage(bm, 0, 0);
  const n = Math.round(bm.width / S);
  const data = new Uint8Array(S * S * 4 * n);
  const means = [];
  for (let k = 0; k < n; k++) {
    const img = ctx.getImageData(k * S, 0, S, S).data;
    data.set(img, k * S * S * 4);
    let r = 0; let g = 0; let b = 0;
    for (let i = 0; i < img.length; i += 64) { r += img[i]; g += img[i + 1]; b += img[i + 2]; }
    const cnt = img.length / 64;
    means.push(new THREE.Vector3(r / cnt / 255, g / cnt / 255, b / cnt / 255));
  }
  const t = new THREE.DataArrayTexture(data, S, S, n);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.minFilter = THREE.LinearMipmapLinearFilter;
  t.magFilter = THREE.LinearFilter;
  t.generateMipmaps = true;
  t.anisotropy = 4;
  t.needsUpdate = true;
  return { t, means };
}

export async function loadGroundTextures() {
  const [a, n] = await Promise.all([loadStrip('/tex/ground_albedo.jpg'), loadStrip('/tex/ground_normal.jpg')]);
  G.uGround.value = a.t;
  G.uGroundN.value = n.t;
  G.uGroundMean.value = a.means;
}

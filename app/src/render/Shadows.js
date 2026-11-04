import * as THREE from 'three';
import { G } from './common.js';

const BIAS = new THREE.Matrix4().set(0.5, 0, 0, 0.5, 0, 0.5, 0, 0.5, 0, 0, 0.5, 0.5, 0, 0, 0, 1);

function makeTarget(size) {
  const rt = new THREE.WebGLRenderTarget(size, size, { depthBuffer: true });
  rt.depthTexture = new THREE.DepthTexture(size, size);
  rt.depthTexture.type = THREE.UnsignedIntType;
  rt.depthTexture.compareFunction = THREE.LessEqualCompare;
  rt.depthTexture.minFilter = rt.depthTexture.magFilter = THREE.LinearFilter;
  return rt;
}

/**
 * Two sun shadow cascades: a near one (terrain + trees, ~1 km) and a far one
 * (terrain only, ~25 km) for long mountain shadows at sunrise/sunset.
 */
export class Shadows {
  constructor(renderer) {
    this.r = renderer;
    this.size = 0;
    this.cams = [new THREE.OrthographicCamera(), new THREE.OrthographicCamera()];
    this.scene = new THREE.Scene();
    this.setSize(1);
    this.enabled = false;
    this.frame = 0;
  }

  setSize(size) {
    if (size === this.size) return;
    this.size = size;
    if (this.rts) this.rts.forEach((t) => t.dispose());
    const s0 = Math.max(1, size);
    const s1 = Math.max(1, Math.min(2048, size));
    this.rts = [makeTarget(s0), makeTarget(s1)];
    // initialise so the samplers are valid even when disabled
    const prev = this.r.getRenderTarget();
    for (const rt of this.rts) { this.r.setRenderTarget(rt); this.r.clear(true, true, false); }
    this.r.setRenderTarget(prev);
    G.uShadowMap0.value = this.rts[0].depthTexture;
    G.uShadowMap1.value = this.rts[1].depthTexture;
    G.uShadowOn.value.z = 1 / s0;
    G.uShadowOn.value.w = 1 / s1;
  }

  _fit(cam, center, radius, sunDir, texels) {
    const dist = radius * 3 + 6000;
    cam.left = -radius; cam.right = radius; cam.top = radius; cam.bottom = -radius;
    cam.near = 1; cam.far = dist * 2;
    cam.updateProjectionMatrix();
    // stabilise: snap the centre to shadow texels in light space
    const up = Math.abs(sunDir.y) > 0.99 ? new THREE.Vector3(0, 0, 1) : new THREE.Vector3(0, 1, 0);
    const look = new THREE.Matrix4().lookAt(new THREE.Vector3(0, 0, 0), sunDir.clone().negate(), up);
    const inv = look.clone().invert();
    const c = center.clone().applyMatrix4(inv);
    const unit = (2 * radius) / texels;
    c.x = Math.round(c.x / unit) * unit; c.y = Math.round(c.y / unit) * unit;
    c.applyMatrix4(look);
    cam.position.copy(c).addScaledVector(sunDir, dist);
    cam.up.copy(up);
    cam.lookAt(c);
    cam.updateMatrixWorld();
  }

  /** casters: [{group, near: bool}] */
  update(camera, focus, casters, opts) {
    this.enabled = opts.enabled && G.uLightDir.value.y > 0.01;
    G.uShadowOn.value.x = this.enabled ? 1 : 0;
    G.uShadowOn.value.y = this.enabled && opts.far ? 1 : 0;
    if (!this.enabled) return;
    this.frame++;
    const sun = G.uLightDir.value;
    const depthState = this.r.state.buffers.depth;
    const wasReversed = depthState.getReversed ? depthState.getReversed() : false;
    if (wasReversed) depthState.setReversed(false);
    const prev = this.r.getRenderTarget();
    const jobs = [[0, opts.nearRadius, true]];
    // far cascade updates every other frame
    if (opts.far && (this.frame % 2 === 0 || this.frame < 3)) jobs.push([1, opts.farRadius, false]);
    for (const [i, radius, near] of jobs) {
      const cam = this.cams[i];
      this._fit(cam, focus, radius, sun, this.rts[i].width);
      this.scene.children.length = 0;
      for (const c of casters) if (near || !c.nearOnly) this.scene.children.push(c.group);
      this.r.setRenderTarget(this.rts[i]);
      this.r.clear(false, true, false);
      this.r.render(this.scene, cam);
      const m = i === 0 ? G.uShadowMat0.value : G.uShadowMat1.value;
      m.multiplyMatrices(BIAS, cam.projectionMatrix).multiply(cam.matrixWorldInverse);
    }
    this.scene.children.length = 0;
    this.r.setRenderTarget(prev);
    if (wasReversed) depthState.setReversed(true);
  }
}

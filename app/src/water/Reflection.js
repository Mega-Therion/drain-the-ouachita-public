import * as THREE from 'three';
import { RT } from '../render/common.js';

const BIAS = new THREE.Matrix4().set(0.5, 0, 0, 0.5, 0, 0.5, 0, 0.5, 0, 0, 0.5, 0.5, 0, 0, 0, 1);

/** Planar reflection of the lake at its current level (rendered at reduced resolution). */
export class Reflection {
  constructor(renderer) {
    this.r = renderer;
    this.rt = null;
    this.vcam = new THREE.PerspectiveCamera();
    this.matrix = new THREE.Matrix4();
    this.scale = 0.5;
  }

  render(scene, camera, waterY, atmosphere, clipUniform, size) {
    const w = Math.max(1, Math.floor(size.x * this.scale));
    const h = Math.max(1, Math.floor(size.y * this.scale));
    if (!this.rt || this.rt.width !== w || this.rt.height !== h) {
      if (this.rt) this.rt.dispose();
      this.rt = new THREE.WebGLRenderTarget(w, h, { type: RT.type, minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter });
    }
    const vc = this.vcam;
    vc.fov = camera.fov; vc.aspect = camera.aspect; vc.near = camera.near; vc.far = camera.far;
    const p = camera.position;
    vc.position.set(p.x, 2 * waterY - p.y, p.z);
    const dir = new THREE.Vector3(); camera.getWorldDirection(dir);
    const target = p.clone().add(dir);
    target.y = 2 * waterY - target.y;
    const up = new THREE.Vector3(0, 1, 0).applyQuaternion(camera.quaternion);
    up.y = -up.y;
    vc.up.copy(up);
    vc.lookAt(target);
    vc.updateProjectionMatrix();
    vc.updateMatrixWorld();
    atmosphere.updateCamera(vc);
    clipUniform.value = waterY - 0.15;
    this.r.setRenderTarget(this.rt);
    this.r.clear(true, true, false);
    this.r.render(scene, vc);
    clipUniform.value = -1e9;
    atmosphere.updateCamera(camera);
    this.matrix.multiplyMatrices(BIAS, vc.projectionMatrix).multiply(vc.matrixWorldInverse);
    return this.rt.texture;
  }
}

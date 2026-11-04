import * as THREE from 'three';

const _e = new THREE.Euler(0, 0, 0, 'YXZ');
const _v = new THREE.Vector3();
const _f = new THREE.Vector3();
const _r = new THREE.Vector3();

/**
 * First-person camera used by Walk ("street view"), Drone and Dive modes.
 *  walk:  eye 1.7 m above ground, tap the ground to walk there, drag to look
 *  drone: free flight, speed scales with height
 *  dive:  swim inside the water column
 * Input: drag to look, WASD/QE + shift on desktop, thumb sticks on touch,
 * optional device-orientation ("magic window") look on phones.
 */
export class FirstPerson {
  constructor(camera, dom, terrainHeight, waterSurface) {
    this.camera = camera;
    this.dom = dom;
    this.heightFn = terrainHeight;      // (x,z) => metres | null
    this.waterFn = waterSurface;        // (x,z) => surface metres | -1e4
    this.toY = (h) => h;
    this.mode = 'walk';
    this.yaw = 0; this.pitch = 0;
    this.pos = new THREE.Vector3();
    this.vel = new THREE.Vector3();
    this.keys = {};
    this.enabled = false;
    this.eye = 1.7;
    this.goal = null;
    this.moveStick = null; this.lookStick = null;
    this.vertical = 0; // -1..1 from on-screen buttons
    this.gyro = false;
    this.gyroBase = null;
    this.pointers = new Map();
    this.speedMul = 1;
    this.onTapGround = null;
    this._bind();
  }

  _bind() {
    this._kd = (e) => { if (!this.enabled || e.target.tagName === 'INPUT') return; this.keys[e.code] = true; };
    this._ku = (e) => { this.keys[e.code] = false; };
    window.addEventListener('keydown', this._kd);
    window.addEventListener('keyup', this._ku);
    this._pd = (e) => {
      if (!this.enabled) return;
      this.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY, sx: e.clientX, sy: e.clientY, t: performance.now() });
      try { this.dom.setPointerCapture?.(e.pointerId); } catch { /* ignore */ }
    };
    this._pm = (e) => {
      const p = this.pointers.get(e.pointerId);
      if (!p || !this.enabled) return;
      const dx = e.clientX - p.x; const dy = e.clientY - p.y;
      p.x = e.clientX; p.y = e.clientY;
      const k = (this.camera.fov / 55) * 0.0042;
      this.yaw += dx * k; this.pitch = THREE.MathUtils.clamp(this.pitch + dy * k, -1.45, 1.45);
      if (this.gyro) this.gyroBase = null;
    };
    this._pu = (e) => {
      const p = this.pointers.get(e.pointerId);
      this.pointers.delete(e.pointerId);
      if (!p || !this.enabled) return;
      if (performance.now() - p.t < 280 && Math.hypot(p.x - p.sx, p.y - p.sy) < 7) this._tap(e.clientX, e.clientY);
    };
    this.dom.addEventListener('pointerdown', this._pd);
    window.addEventListener('pointermove', this._pm);
    window.addEventListener('pointerup', this._pu);
    this._ori = (e) => this._orientation(e);
  }

  enableGyro(on) {
    this.gyro = on;
    this.gyroBase = null;
    if (on) window.addEventListener('deviceorientation', this._ori);
    else window.removeEventListener('deviceorientation', this._ori);
  }

  _orientation(e) {
    if (!this.gyro || e.alpha === null) return;
    // device orientation -> camera quaternion (screen-aligned), then extract yaw/pitch
    const a = THREE.MathUtils.degToRad(e.alpha); const b = THREE.MathUtils.degToRad(e.beta); const g = THREE.MathUtils.degToRad(e.gamma);
    const orient = THREE.MathUtils.degToRad(screen.orientation?.angle || window.orientation || 0);
    const q = new THREE.Quaternion();
    _e.set(b, a, -g, 'YXZ');
    q.setFromEuler(_e);
    q.multiply(new THREE.Quaternion(-Math.sqrt(0.5), 0, 0, Math.sqrt(0.5)));
    q.multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), -orient));
    const eu = new THREE.Euler().setFromQuaternion(q, 'YXZ');
    if (!this.gyroBase) this.gyroBase = { yaw: this.yaw - eu.y };
    this.yaw = this.gyroBase.yaw + eu.y;
    this.pitch = THREE.MathUtils.clamp(eu.x, -1.45, 1.45);
  }

  _tap(cx, cy) {
    // street-view style: walk to the tapped ground point
    if (this.mode === 'drone') return;
    const r = this.dom.getBoundingClientRect();
    const ndc = new THREE.Vector2(((cx - r.left) / r.width) * 2 - 1, -((cy - r.top) / r.height) * 2 + 1);
    const ray = new THREE.Raycaster();
    ray.setFromCamera(ndc, this.camera);
    const o = ray.ray.origin; const d = ray.ray.direction;
    let t = 0.5;
    for (let i = 0; i < 300; i++) {
      _v.copy(d).multiplyScalar(t).add(o);
      const h = this.heightFn(_v.x, _v.z);
      if (h !== null && _v.y <= this.toY(h)) {
        if (t > 800) return;
        this.goal = _v.clone();
        this.onTapGround && this.onTapGround(this.goal);
        return;
      }
      t += Math.max(0.5, t * 0.03);
    }
  }

  setFromCamera(cam) {
    this.pos.copy(cam.position);
    const dir = new THREE.Vector3();
    cam.getWorldDirection(dir);
    this.yaw = Math.atan2(-dir.x, -dir.z);
    this.pitch = Math.asin(THREE.MathUtils.clamp(dir.y, -1, 1));
    this.vel.set(0, 0, 0);
    this.goal = null;
  }

  update(dt) {
    if (!this.enabled) return;
    const K = this.keys;
    // look with right stick
    if (this.lookStick) {
      const lv = this.lookStick.value;
      this.yaw -= lv.x * dt * 1.8;
      this.pitch = THREE.MathUtils.clamp(this.pitch + lv.y * dt * 1.2, -1.45, 1.45);
    }
    let fwd = (K.KeyW || K.ArrowUp ? 1 : 0) - (K.KeyS || K.ArrowDown ? 1 : 0);
    let side = (K.KeyD || K.ArrowRight ? 1 : 0) - (K.KeyA || K.ArrowLeft ? 1 : 0);
    let up = (K.KeyE || K.Space ? 1 : 0) - (K.KeyQ || K.KeyC ? 1 : 0) + this.vertical;
    if (this.moveStick) {
      const mv = this.moveStick.value; const m = Math.hypot(mv.x, mv.y) || 1;
      fwd += mv.y / Math.max(m, 1e-3) * Math.min(m, 1); side += mv.x / Math.max(m, 1e-3) * Math.min(m, 1);
    }
    const fast = K.ShiftLeft || K.ShiftRight ? 3.5 : 1;
    const ground = this.heightFn(this.pos.x, this.pos.z);
    const gy = ground === null ? this.pos.y - this.eye : this.toY(ground);
    const surf = this.waterFn(this.pos.x, this.pos.z);
    const sy = this.toY(surf);
    _f.set(-Math.sin(this.yaw), 0, -Math.cos(this.yaw));
    _r.set(Math.cos(this.yaw), 0, -Math.sin(this.yaw));

    if (Math.abs(fwd) + Math.abs(side) > 0.05) this.goal = null;
    let speed;
    if (this.mode === 'drone' && this.lock) {
      // subject lock: sticks orbit / dolly around the target, camera keeps it framed
      const L = this.lock;
      const rel = new THREE.Vector3().subVectors(this.pos, L);
      let dist = Math.hypot(rel.x, rel.z);
      let ang = Math.atan2(rel.z, rel.x);
      ang += side * dt * 0.5 * Math.max(0.25, 300 / Math.max(dist, 50));
      dist = THREE.MathUtils.clamp(dist * Math.exp(-fwd * dt * 0.7), 15, 30000);
      const hy = rel.y + up * dt * Math.max(10, dist * 0.35);
      const want = new THREE.Vector3(L.x + Math.cos(ang) * dist, L.y + hy, L.z + Math.sin(ang) * dist);
      this.pos.lerp(want, 1 - Math.exp(-dt * 6));
      const g2 = this.heightFn(this.pos.x, this.pos.z);
      if (g2 !== null && this.pos.y < this.toY(g2) + 3) this.pos.y = this.toY(g2) + 3;
      const d = new THREE.Vector3().subVectors(L, this.pos).normalize();
      const ty = Math.atan2(-d.x, -d.z); const tp = Math.asin(THREE.MathUtils.clamp(d.y, -1, 1));
      let dy = ty - this.yaw; dy = Math.atan2(Math.sin(dy), Math.cos(dy));
      const k = 1 - Math.exp(-dt * 4);
      this.yaw += dy * k; this.pitch += (tp - this.pitch) * k;
      // lens breathes with distance: a little longer when far
      this.camera.fov += (THREE.MathUtils.clamp(70 - Math.log10(dist) * 9, 32, 58) - this.camera.fov) * k;
      this.camera.updateProjectionMatrix();
    } else if (this.mode === 'drone') {
      if (Math.abs(this.camera.fov - 55) > 0.1) { this.camera.fov += (55 - this.camera.fov) * Math.min(1, dt * 3); this.camera.updateProjectionMatrix(); }
      const agl = Math.max(1, this.pos.y - gy);
      speed = THREE.MathUtils.clamp(agl * 0.9, 12, 900) * fast * this.speedMul;
      // fly where you look
      const look = new THREE.Vector3(-Math.sin(this.yaw) * Math.cos(this.pitch), Math.sin(this.pitch), -Math.cos(this.yaw) * Math.cos(this.pitch));
      const target = new THREE.Vector3().addScaledVector(look, fwd).addScaledVector(_r, side).multiplyScalar(speed);
      target.y += up * speed * 0.7;
      this.vel.lerp(target, 1 - Math.exp(-dt * 3.5));
      this.pos.addScaledVector(this.vel, dt);
      if (this.pos.y < gy + 2.0) { this.pos.y = gy + 2.0; this.vel.y = Math.max(0, this.vel.y); }
      if (this.pos.y > 12000) this.pos.y = 12000;
    } else {
      const underwater = this.pos.y < sy - 0.2;
      const swimming = this.mode === 'dive' || (underwater && sy - gy > this.eye + 0.3);
      const stick = this.moveStick ? Math.min(1, Math.hypot(this.moveStick.value.x, this.moveStick.value.y)) : 0;
      speed = (swimming ? 2.2 : 1.5 + 3.5 * stick * stick) * fast * this.speedMul;
      const target = new THREE.Vector3().addScaledVector(_f, fwd).addScaledVector(_r, side).multiplyScalar(speed);
      if (this.goal) {
        _v.subVectors(this.goal, this.pos).setY(0);
        const d = _v.length();
        if (d < 0.6) this.goal = null;
        else target.copy(_v.normalize().multiplyScalar(Math.min(speed * 2.2, 0.8 + d * 0.8)));
      }
      this.vel.x += (target.x - this.vel.x) * (1 - Math.exp(-dt * 6));
      this.vel.z += (target.z - this.vel.z) * (1 - Math.exp(-dt * 6));
      this.pos.x += this.vel.x * dt; this.pos.z += this.vel.z * dt;
      const g2 = this.heightFn(this.pos.x, this.pos.z);
      const gy2 = g2 === null ? gy : this.toY(g2);
      if (swimming) {
        // swim: vertical control, buoyancy keeps you near where you are
        this.vel.y += (up * 1.6 - this.vel.y) * (1 - Math.exp(-dt * 4));
        this.pos.y += this.vel.y * dt;
        if (this.pos.y < gy2 + 0.8) this.pos.y = gy2 + 0.8;
        if (this.mode !== 'dive' && this.pos.y > sy - 0.1 && up <= 0) this.pos.y = Math.min(this.pos.y, sy + this.eye * 0.3);
        if (this.mode === 'dive' && this.pos.y > sy - 0.3) this.pos.y = sy - 0.3;
      } else {
        // walk: follow the ground smoothly, a little head bob
        const want = gy2 + this.eye;
        const moving = Math.hypot(this.vel.x, this.vel.z);
        this.bob = (this.bob || 0) + moving * dt * 2.2;
        this.pos.y += (want + Math.sin(this.bob * Math.PI) * 0.025 * Math.min(1, moving) - this.pos.y) * (1 - Math.exp(-dt * 12));
      }
    }
    this.camera.position.copy(this.pos);
    _e.set(this.pitch, this.yaw, 0, 'YXZ');
    this.camera.quaternion.setFromEuler(_e);
    this.camera.updateMatrixWorld();
  }
}

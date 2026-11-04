import * as THREE from 'three';

const _ray = new THREE.Raycaster();
const _v2 = new THREE.Vector2();
const _p = new THREE.Vector3();
const _q = new THREE.Vector3();

function easeInOut(t) { return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2; }

/**
 * Google-Earth style orbit camera: a target point on the ground, a range,
 * heading and tilt. One finger/left button pans (the ground follows the finger),
 * two fingers pinch-zoom / twist / tilt, right button or two-finger drag orbits.
 */
export class EarthControls {
  constructor(camera, dom, heightFn) {
    this.camera = camera;
    this.dom = dom;
    this.heightFn = heightFn; // (x,z) => metres or null
    this.toY = (h) => h;
    this.target = new THREE.Vector3(0, 180, 0);
    this.range = 6000;
    this.heading = 0;      // radians, 0 = looking north
    this.tilt = 1.05;      // radians from straight down
    this.minRange = 25; this.maxRange = 180000;
    this.minTilt = 0.0; this.maxTilt = 1.48;
    this.vel = { x: 0, z: 0, heading: 0, tilt: 0, zoom: 0, anchorX: null, anchorY: null };
    this.hist = [];
    this.wheelGoal = 0;
    this.enabled = true;
    this.anim = null;
    this.pointers = new Map();
    this.onInteract = null;
    this._bind();
  }

  _bind() {
    const d = this.dom;
    this._down = (e) => this.pointerDown(e);
    this._move = (e) => this.pointerMove(e);
    this._up = (e) => this.pointerUp(e);
    this._wheel = (e) => this.wheel(e);
    this._ctx = (e) => e.preventDefault();
    this._dbl = (e) => this.dblclick(e);
    d.addEventListener('pointerdown', this._down);
    window.addEventListener('pointermove', this._move);
    window.addEventListener('pointerup', this._up);
    window.addEventListener('pointercancel', this._up);
    d.addEventListener('wheel', this._wheel, { passive: false });
    d.addEventListener('contextmenu', this._ctx);
    d.addEventListener('dblclick', this._dbl);
  }

  dispose() {
    const d = this.dom;
    d.removeEventListener('pointerdown', this._down);
    window.removeEventListener('pointermove', this._move);
    window.removeEventListener('pointerup', this._up);
    window.removeEventListener('pointercancel', this._up);
    d.removeEventListener('wheel', this._wheel);
    d.removeEventListener('contextmenu', this._ctx);
    d.removeEventListener('dblclick', this._dbl);
  }

  /** Intersect a screen point with the horizontal plane through the target. */
  groundPoint(cx, cy, out, planeY = this.target.y) {
    const r = this.dom.getBoundingClientRect();
    _v2.set(((cx - r.left) / r.width) * 2 - 1, -((cy - r.top) / r.height) * 2 + 1);
    _ray.setFromCamera(_v2, this.camera);
    const o = _ray.ray.origin; const dir = _ray.ray.direction;
    if (Math.abs(dir.y) < 1e-4) return null;
    const t = (planeY - o.y) / dir.y;
    if (t <= 0) {
      // above the horizon: use a far point along the ray projected to the plane
      out.copy(dir).setY(0).normalize().multiplyScalar(this.range * 3).add(o).setY(planeY);
      return out;
    }
    return out.copy(dir).multiplyScalar(Math.min(t, this.range * 6)).add(o);
  }

  /** Ray-march the terrain for the true picked point. */
  pickTerrain(cx, cy, out) {
    const r = this.dom.getBoundingClientRect();
    _v2.set(((cx - r.left) / r.width) * 2 - 1, -((cy - r.top) / r.height) * 2 + 1);
    _ray.setFromCamera(_v2, this.camera);
    const o = _ray.ray.origin; const dir = _ray.ray.direction;
    let t = 0; let step = Math.max(2, this.range * 0.004);
    let prevAbove = true;
    for (let i = 0; i < 400; i++) {
      t += step;
      _p.copy(dir).multiplyScalar(t).add(o);
      const h = this.heightFn(_p.x, _p.z);
      if (h === null) { step *= 1.04; continue; }
      const gy = this.toY(h);
      if (_p.y <= gy) {
        // refine
        let a = t - step; let b = t;
        for (let k = 0; k < 10; k++) {
          const m = (a + b) / 2;
          _q.copy(dir).multiplyScalar(m).add(o);
          const hh = this.heightFn(_q.x, _q.z);
          if (hh !== null && _q.y <= this.toY(hh)) b = m; else a = m;
        }
        return out.copy(dir).multiplyScalar(b).add(o);
      }
      prevAbove = true;
      step *= 1.025;
      if (t > 400000) break;
    }
    void prevAbove;
    return null;
  }

  // ------------------------------------------------------------------ gestures
  // Everything is anchored: the ground point under your finger(s) or cursor stays under them
  // while you pan, pinch, twist and zoom, and every motion glides to a stop with the speed you
  // actually released it at.

  /** Keep the world point `w` under screen point (cx, cy) after a change of range/heading/tilt. */
  _anchor(cx, cy, w) {
    for (let k = 0; k < 3; k++) {
      this.apply();
      const now = this.groundPoint(cx, cy, _p, w.y);
      if (!now) return;
      this.target.x += w.x - now.x; this.target.z += w.z - now.z;
    }
    this.apply();
  }

  _record() {
    const t = performance.now();
    this.hist.push({ t, x: this.target.x, z: this.target.z, lr: Math.log(this.range), h: this.heading, tl: this.tilt });
    while (this.hist.length > 2 && t - this.hist[0].t > 80) this.hist.shift();
  }

  _releaseVelocity() {
    const H = this.hist; this.hist = [];
    if (H.length < 2) return;
    const a = H[0]; const b = H[H.length - 1];
    const dt = (b.t - a.t) / 1000;
    if (dt < 0.012 || performance.now() - b.t > 90) return;   // finger stopped before lifting: no glide
    const cap = (v, m) => THREE.MathUtils.clamp(v, -m, m);
    // release speed, scaled so a flick coasts about its own length and a pinch settles gently
    this.vel.x = cap(0.8 * (b.x - a.x) / dt, this.range * 3); this.vel.z = cap(0.8 * (b.z - a.z) / dt, this.range * 3);
    this.vel.zoom = cap(0.45 * (b.lr - a.lr) / dt, 2.5);
    let dh = b.h - a.h; dh = Math.atan2(Math.sin(dh), Math.cos(dh));
    this.vel.heading = cap(0.6 * dh / dt, 3);
    this.vel.tilt = cap((b.tl - a.tl) / dt, 2.5);
  }

  pointerDown(e) {
    if (!this.enabled) return;
    try { this.dom.setPointerCapture?.(e.pointerId); } catch { /* synthetic or already-released pointer */ }
    const now = performance.now();
    this.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY, sx: e.clientX, sy: e.clientY, button: e.button, t: now });
    this.anim = null; this.wheelGoal = 0;
    this.vel.x = this.vel.z = this.vel.heading = this.vel.tilt = this.vel.zoom = 0;
    this.hist = [];
    if (this.pointers.size === 1) {
      const p = this.pointers.get(e.pointerId);
      p.rotate = e.button === 2 || e.ctrlKey || e.shiftKey || e.altKey;
      // double-tap-and-hold, then drag up/down: one-finger zoom
      if (e.pointerType !== 'mouse' && this.lastTap && now - this.lastTap < 300 && Math.hypot(e.clientX - this.lastTapX, e.clientY - this.lastTapY) < 40) {
        p.quick = { y0: e.clientY, lr0: Math.log(this.range), w: this.groundPoint(e.clientX, e.clientY, new THREE.Vector3()) };
      }
      this.grab = this.groundPoint(e.clientX, e.clientY, new THREE.Vector3());
    }
    if (this.pointers.size === 2) this._startPinch();
    this.onInteract && this.onInteract();
  }

  _startPinch() {
    const [a, b] = [...this.pointers.values()];
    a.px = a.x; a.py = a.y; b.px = b.x; b.py = b.y;
    const mx = (a.x + b.x) / 2; const my = (a.y + b.y) / 2;
    this.pinch = {
      d: Math.max(Math.hypot(a.x - b.x, a.y - b.y), 1), ang: Math.atan2(b.y - a.y, b.x - a.x), mx, my,
      range: this.range, heading: this.heading, tilt: this.tilt, mode: null, rot: false, rotOff: 0,
      w: this.groundPoint(mx, my, new THREE.Vector3()),
    };
    this.grab = null;
  }

  pointerMove(e) {
    const p = this.pointers.get(e.pointerId);
    if (!p || !this.enabled) return;
    const dx = e.clientX - p.x; const dy = e.clientY - p.y;
    p.x = e.clientX; p.y = e.clientY;
    if (this.pointers.size === 1) {
      if (p.quick) {
        if (!p.quick.w) return;
        this.range = THREE.MathUtils.clamp(Math.exp(p.quick.lr0 + (e.clientY - p.quick.y0) * 0.008), this.minRange, this.maxRange);
        this._anchor(p.sx, p.sy, p.quick.w);
        this.vel.anchorX = p.sx; this.vel.anchorY = p.sy;
      } else if (p.rotate) {
        this.heading -= dx * 0.005;
        this.tilt = THREE.MathUtils.clamp(this.tilt - dy * 0.004, this.minTilt, this.maxTilt);
        this.apply();
      } else if (this.grab) {
        const now = this.groundPoint(e.clientX, e.clientY, new THREE.Vector3(), this.grab.y);
        // near the horizon the finger can leave the ground (or the hit point races off to the far
        // distance): pan by screen distance there instead, so the drag never stalls or jumps
        const far = (v) => !v || Math.hypot(v.x - this.target.x, v.z - this.target.z) > this.range * 2.5;
        if (!far(now) && !far(this.grab)) {
          const lim = this.range * 0.5;
          this.target.x += THREE.MathUtils.clamp(this.grab.x - now.x, -lim, lim);
          this.target.z += THREE.MathUtils.clamp(this.grab.z - now.z, -lim, lim);
        } else {
          const h = this.dom.clientHeight || 800;
          const mpp = 2 * this.range * Math.tan((this.camera.fov * Math.PI / 180) / 2) / h;
          const fwd = mpp / Math.max(0.25, Math.cos(this.tilt));
          const sh = Math.sin(this.heading); const ch = Math.cos(this.heading);
          // screen right = (cos h, sin h); screen up (into the view) = (sin h, -cos h) in world x,z
          this.target.x += -dx * mpp * ch + dy * fwd * sh;
          this.target.z += -dx * mpp * sh - dy * fwd * ch;
          this.grab = this.groundPoint(e.clientX, e.clientY, new THREE.Vector3());
        }
        this.update(0, true);
      }
      this._record();
    } else if (this.pointers.size === 2 && this.pinch) {
      const P = this.pinch;
      const [a, b] = [...this.pointers.values()];
      const d = Math.max(Math.hypot(a.x - b.x, a.y - b.y), 1);
      const ang = Math.atan2(b.y - a.y, b.x - a.x);
      const mx = (a.x + b.x) / 2; const my = (a.y + b.y) / 2;
      if (!P.mode) {
        // decide once per gesture: both fingers sliding vertically together = tilt; anything else = zoom/pan/twist
        const ay = a.y - a.py; const by = b.y - b.py; const ax = a.x - a.px; const bx = b.x - b.px;
        const moved = Math.max(Math.hypot(ax, ay), Math.hypot(bx, by));
        if (moved < 9) return;
        const together = ay * by > 0 && Math.abs(ay) > Math.abs(ax) * 1.4 && Math.abs(by) > Math.abs(bx) * 1.4;
        P.mode = together && Math.abs(d - P.d) < P.d * 0.12 ? 'tilt' : 'xform';
        P.my = my; P.mx = mx; P.d = d; P.ang = ang; P.range = this.range; P.heading = this.heading; P.tilt = this.tilt;
        P.w = this.groundPoint(mx, my, new THREE.Vector3());
      }
      if (P.mode === 'tilt') {
        this.tilt = THREE.MathUtils.clamp(P.tilt - (my - P.my) * 0.0055, this.minTilt, this.maxTilt);
        this.apply();
      } else {
        this.range = THREE.MathUtils.clamp(P.range * P.d / d, this.minRange, this.maxRange);
        let da = ang - P.ang; da = Math.atan2(Math.sin(da), Math.cos(da));
        // twist only after a deliberate turn, then follow it exactly from that point on
        if (!P.rot && Math.abs(da) > 0.14) { P.rot = true; P.rotOff = da; }
        if (P.rot) this.heading = P.heading + (da - P.rotOff);
        if (P.w) this._anchor(mx, my, P.w); else this.apply();
        this.vel.anchorX = mx; this.vel.anchorY = my;
      }
      this._record();
    }
  }

  pointerUp(e) {
    const p = this.pointers.get(e.pointerId);
    const wasPinch = !!this.pinch && this.pointers.size === 2;
    this.pointers.delete(e.pointerId);
    if (wasPinch) {
      // fingers rarely lift together: remember the pinch's zoom/turn speed for the final release
      const H = this.hist.slice(); this._releaseVelocity(); this.hist = H;
      this._pinchVel = { zoom: this.vel.zoom, heading: this.vel.heading, ax: this.vel.anchorX, ay: this.vel.anchorY, t: performance.now() };
      this.vel.x = this.vel.z = this.vel.zoom = this.vel.heading = this.vel.tilt = 0;
    }
    if (this.pointers.size === 0) {
      this._releaseVelocity();
      const pv = this._pinchVel;
      if (pv && performance.now() - pv.t < 180) {
        this.vel.zoom = pv.zoom; this.vel.heading = pv.heading; this.vel.anchorX = pv.ax; this.vel.anchorY = pv.ay;
        this.vel.x *= 0.3; this.vel.z *= 0.3;
      }
      this._pinchVel = null;
    }
    if (this.pointers.size < 2) this.pinch = null;
    if (this.pointers.size === 1) {
      // keep panning with the remaining finger, without a jump
      const [q] = [...this.pointers.values()];
      q.quick = null;
      this.grab = this.groundPoint(q.x, q.y, new THREE.Vector3());
      this.hist = [];
    }
    if (p && performance.now() - p.t < 250 && Math.hypot(p.x - p.sx, p.y - p.sy) < 6) {
      this.onTap && this.onTap(e.clientX, e.clientY);
      if (!p.quick && this.lastTap && performance.now() - this.lastTap < 320) { this.dblclick(e); this.lastTap = 0; }
      else { this.lastTap = performance.now(); this.lastTapX = e.clientX; this.lastTapY = e.clientY; }
    }
  }

  wheel(e) {
    if (!this.enabled) return;
    e.preventDefault();
    this.anim = null;
    // trackpad pinch arrives as ctrl+wheel with small deltas; mouse wheels as big steps.
    // Both feed a goal that the camera eases toward, anchored under the cursor.
    const unit = e.deltaMode === 1 ? 0.05 : e.deltaMode === 2 ? 1 : 0.0016;
    const k = e.deltaY * unit * (e.ctrlKey ? 4.5 : 1);
    this.wheelGoal = THREE.MathUtils.clamp((this.wheelGoal || 0) + k, -3, 3);
    this.wheelX = e.clientX; this.wheelY = e.clientY;
    this.wheelW = this.groundPoint(e.clientX, e.clientY, new THREE.Vector3());
    this.vel.x = this.vel.z = this.vel.zoom = 0;
    this.onInteract && this.onInteract();
  }

  dblclick(e) {
    const p = this.pickTerrain(e.clientX, e.clientY, new THREE.Vector3());
    if (p) this.flyTo({ target: p, range: Math.max(this.minRange, this.range * 0.45), duration: 1.1 });
  }

  /** Animate to a view. view: {target, range, heading, tilt, duration} */
  flyTo(view) {
    const from = { target: this.target.clone(), range: this.range, heading: this.heading, tilt: this.tilt };
    const to = {
      target: view.target ? view.target.clone() : from.target.clone(),
      range: view.range ?? from.range,
      heading: view.heading ?? from.heading,
      tilt: view.tilt ?? from.tilt,
    };
    // shortest heading path
    let dh = to.heading - from.heading;
    dh = Math.atan2(Math.sin(dh), Math.cos(dh));
    to.heading = from.heading + dh;
    const dist = from.target.distanceTo(to.target);
    const peak = Math.max(from.range, to.range, dist * 0.8);
    this.anim = { from, to, t: 0, dur: view.duration ?? THREE.MathUtils.clamp(1.2 + dist / 12000, 1.2, 5), peak, done: view.onDone };
  }

  update(dt, immediate = false) {
    if (this.anim && !immediate) {
      const a = this.anim;
      a.t = Math.min(1, a.t + dt / a.dur);
      const s = easeInOut(a.t);
      this.target.lerpVectors(a.from.target, a.to.target, s);
      const arc = Math.sin(Math.PI * s);
      const base = THREE.MathUtils.lerp(Math.log(a.from.range), Math.log(a.to.range), s);
      const lift = Math.max(0, Math.log(a.peak) - base) * arc;
      this.range = Math.exp(base + lift);
      this.heading = THREE.MathUtils.lerp(a.from.heading, a.to.heading, s);
      this.tilt = THREE.MathUtils.lerp(a.from.tilt, a.to.tilt, s) * (1 - 0.5 * arc) + 0.2 * arc;
      if (a.t >= 1) { this.anim = null; a.done && a.done(); }
    } else if (!immediate && this.pointers.size === 0 && dt > 0) {
      const v = this.vel;
      // smooth wheel / trackpad zoom toward the cursor
      if (Math.abs(this.wheelGoal || 0) > 1e-4) {
        const step = this.wheelGoal * (1 - Math.exp(-dt * 16));
        this.wheelGoal -= step;
        this.range = THREE.MathUtils.clamp(this.range * Math.exp(step), this.minRange, this.maxRange);
        if (this.wheelW) this._anchor(this.wheelX, this.wheelY, this.wheelW);
      }
      // momentum: decays like a well-oiled flywheel (pan ~0.6 s, turn/zoom a little quicker)
      if (Math.abs(v.x) + Math.abs(v.z) > this.range * 0.01) {
        this.target.x += v.x * dt; this.target.z += v.z * dt;
        const f = Math.exp(-dt * 5.5); v.x *= f; v.z *= f;
      } else { v.x = v.z = 0; }
      if (Math.abs(v.heading) > 0.005) { this.heading += v.heading * dt; v.heading *= Math.exp(-dt * 4.5); } else v.heading = 0;
      if (Math.abs(v.tilt) > 0.005) { this.tilt = THREE.MathUtils.clamp(this.tilt + v.tilt * dt, this.minTilt, this.maxTilt); v.tilt *= Math.exp(-dt * 5); } else v.tilt = 0;
      if (Math.abs(v.zoom) > 0.01) {
        const w = v.anchorX != null ? (this._zw || (this._zw = this.groundPoint(v.anchorX, v.anchorY, new THREE.Vector3()))) : null;
        this.range = THREE.MathUtils.clamp(this.range * Math.exp(v.zoom * dt), this.minRange, this.maxRange);
        v.zoom *= Math.exp(-dt * 7);
        if (w) this._anchor(v.anchorX, v.anchorY, w);
      } else { v.zoom = 0; this._zw = null; }
    }
    // follow the ground under the target
    const h = this.heightFn(this.target.x, this.target.z);
    if (h !== null) {
      const gy = this.toY(h);
      this.target.y += (gy - this.target.y) * (immediate ? 1 : Math.min(1, dt * 4));
    }
    this.apply();
  }

  apply() {
    const cam = this.camera;
    const st = Math.sin(this.tilt); const ct = Math.cos(this.tilt);
    // heading 0 looks north (-z): camera sits south of the target
    const off = new THREE.Vector3(-Math.sin(this.heading) * st, ct, Math.cos(this.heading) * st).multiplyScalar(this.range);
    cam.position.copy(this.target).add(off);
    // keep above ground
    const h = this.heightFn(cam.position.x, cam.position.z);
    if (h !== null) {
      const minY = this.toY(h) + Math.max(3, this.range * 0.02);
      if (cam.position.y < minY) cam.position.y = minY;
    }
    cam.up.set(0, 1, 0);
    cam.lookAt(this.target);
    cam.updateMatrixWorld();
  }

  /** Sync orbit state from an arbitrary camera pose (when switching modes). */
  fromCamera(cam) {
    const dir = new THREE.Vector3();
    cam.getWorldDirection(dir);
    const p = cam.position;
    let t = null;
    if (dir.y < -0.05) {
      const gy = this.toY(this.heightFn(p.x, p.z) ?? 180);
      t = (p.y - gy) / -dir.y;
      t = Math.min(t, 20000);
    }
    const dist = t ?? 800;
    this.target.copy(dir).multiplyScalar(dist).add(p);
    this.range = Math.max(this.minRange, p.distanceTo(this.target));
    this.heading = Math.atan2(-dir.x, -dir.z);
    this.tilt = THREE.MathUtils.clamp(Math.acos(THREE.MathUtils.clamp(-dir.y, -1, 1)), this.minTilt, this.maxTilt);
  }
}

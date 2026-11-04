import * as THREE from 'three';
import { lonLatToWorld } from './geo.js';
import { LAKE } from './config.js';

// Keyframes: [lon, lat, height above ground (m)] for the camera, and a look-at
// point [lon, lat, height above ground]. Times in seconds.
export const TOURS = [
  {
    id: 'doc', name: 'The drain — a directed documentary',
    desc: 'The lake drains while the camera directs itself: every milestone cuts to a new shot, from full pool to the old riverbed. Different every time.',
    directed: true, daysPerSec: 1.7,
    shots: [
      { at: 600, type: 'orbit', c: [-93.262, 34.596], r: 7600, h: 2600, rate: 0.035 },
      { at: 566, type: 'dolly', from: [-93.215, 34.612, 140], to: [-93.27, 34.6, 110], look: [-93.31, 34.598, 0], dur: 16 },
      { at: 540, type: 'dolly', from: [-93.235, 34.588, 260], to: [-93.205, 34.578, 140], look: [-93.1955, 34.5735, 0], dur: 14 },
      { at: 505, type: 'orbit', c: [-93.2974, 34.6126], r: 700, h: 170, rate: 0.12 },
      { at: 470, type: 'dolly', from: [-93.31, 34.6, 90], to: [-93.36, 34.608, 80], look: [-93.40, 34.605, 0], dur: 14 },
      { at: 430, type: 'orbit', c: [-93.345, 34.6106], r: 520, h: 110, rate: 0.14 },
      { at: 400, type: 'orbit', c: [-93.198, 34.575], r: 900, h: 160, rate: -0.12, pullback: true },
    ],
  },
  {
    id: 'native', name: 'First peoples of the valley',
    desc: '13,500 years in order: Ice Age hunters, Archaic fishing camps, Fourche Maline and Caddo villages, and removal. General areas only; sites are protected.',
    duration: 90, era: 'firstpeoples',
    cam: [[-93.19, 34.555, 900], [-93.22, 34.565, 700], [-93.28, 34.55, 800], [-93.27, 34.60, 700], [-93.38, 34.585, 800], [-93.52, 34.57, 900], [-93.47, 34.62, 900], [-93.36, 34.62, 1800]],
    look: [[-93.205, 34.578, 0], [-93.205, 34.578, 0], [-93.30, 34.567, 0], [-93.265, 34.62, 0], [-93.41, 34.605, 0], [-93.545, 34.585, 0], [-93.455, 34.635, 0], [-93.345, 34.598, 0]],
  },
  {
    id: 'west', name: 'The west end: Washita to Mount Ida',
    desc: 'Up the old Ouachita River arm past the drowned Fir community and Washita, then over the crystal hills to Mount Ida.',
    duration: 80,
    cam: [[-93.40, 34.575, 320], [-93.43, 34.585, 220], [-93.47, 34.60, 180], [-93.505, 34.615, 170], [-93.535, 34.635, 160], [-93.55, 34.62, 220], [-93.585, 34.585, 320], [-93.615, 34.565, 260], [-93.64, 34.545, 300]],
    look: [[-93.4391, 34.5876, 0], [-93.4391, 34.5876, 0], [-93.50, 34.61, 0], [-93.5335, 34.6529, 0], [-93.5335, 34.6529, 0], [-93.58, 34.60, 0], [-93.62, 34.56, 0], [-93.6341, 34.5568, 0], [-93.6217, 34.4891, 0]],
  },
  {
    id: 'grand', name: 'Dam to headwaters',
    desc: 'A low, sweeping flight from Blakely Mountain Dam up the main basin to where the Ouachita River enters.',
    duration: 70,
    cam: [[-93.178, 34.568, 260], [-93.215, 34.585, 180], [-93.27, 34.6, 160], [-93.33, 34.61, 170], [-93.39, 34.604, 150], [-93.44, 34.59, 160], [-93.5, 34.585, 170], [-93.545, 34.61, 200]],
    look: [[-93.215, 34.585, 0], [-93.26, 34.6, 0], [-93.32, 34.61, 0], [-93.38, 34.605, 0], [-93.43, 34.595, 0], [-93.49, 34.585, 0], [-93.54, 34.61, 0], [-93.57, 34.625, 0]],
  },
  {
    id: 'drain', name: 'Drain the lake',
    desc: 'Orbit the central basin while the water drops 193 ft to the old streambed, then let it fill back up.',
    duration: 60, orbit: { lon: -93.27, lat: 34.598, radius: 6500, height: 2600, turns: 0.55 },
    events: [[2, { drain: true, speed: 2 }], [40, { refill: true, speed: 2 }]],
  },
  {
    id: 'ghost', name: 'Ghost towns of the valley',
    desc: 'Lower the lake to 480 ft and visit Cedar Glades, Buckville and the old river gauge.',
    duration: 60,
    events: [[0, { level: 480 }]],
    cam: [[-93.25, 34.585, 900], [-93.285, 34.6, 300], [-93.3, 34.605, 140], [-93.325, 34.61, 220], [-93.338, 34.607, 120], [-93.35, 34.6, 300], [-93.27, 34.595, 600], [-93.215, 34.595, 220], [-93.2, 34.59, 300]],
    look: [[-93.297, 34.6126, 0], [-93.2974, 34.6126, 0], [-93.32, 34.611, 0], [-93.345, 34.6106, 0], [-93.3452, 34.6106, 0], [-93.32, 34.6, 0], [-93.21, 34.6, 0], [-93.2057, 34.6001, 0], [-93.195, 34.573, 0]],
  },
  {
    id: 'dam', name: 'The dam, high and dry',
    desc: 'Circle Blakely Mountain Dam as the water falls away from its 231 ft face.',
    duration: 45, orbit: { lon: -93.1965, lat: 34.574, radius: 1300, height: 420, turns: 0.75 },
    events: [[1, { level: 420 }], [32, { level: LAKE.fullPoolFt }]],
  },
  {
    id: 'sunset', name: 'Golden hour on the water',
    desc: 'Skim the islands of the eastern basin as the sun sets over the Ouachitas.',
    duration: 55, sunset: true,
    cam: [[-93.19, 34.6, 40], [-93.215, 34.598, 30], [-93.24, 34.6, 28], [-93.265, 34.605, 35], [-93.29, 34.6, 45], [-93.31, 34.596, 60]],
    look: [[-93.24, 34.6, 10], [-93.27, 34.6, 10], [-93.3, 34.6, 10], [-93.33, 34.598, 10], [-93.36, 34.595, 10], [-93.39, 34.59, 10]],
  },
];

export class TourPlayer {
  constructor(app) {
    this.app = app;
    this.active = null;
    this.t = 0;
  }

  _pt(ll, app) {
    const [x, z] = lonLatToWorld(ll[0], ll[1]);
    const g = app.terrain.heightAt(x, z);
    const ground = Math.max(g ?? 180, (app.sim.levelFt * 0.3048));
    return new THREE.Vector3(x, app.terrain.toY(ground) + ll[2], z);
  }

  play(tour) {
    const app = this.app;
    this.active = tour;
    this.t = 0;
    this.fired = new Set();
    if (tour.era) app.ui.setEra(tour.era);
    if (tour.sunset && app.sunTimes?.set) { app.timeState.hour = app.sunTimes.set - 0.45; app.setTimeOfDay(); }
    if (tour.cam) {
      this.camCurve = new THREE.CatmullRomCurve3(tour.cam.map((p) => this._pt(p, app)), false, 'centripetal');
      this.lookCurve = new THREE.CatmullRomCurve3(tour.look.map((p) => this._pt(p, app)), false, 'centripetal');
    }
    this.startPos = app.camera.position.clone();
    this.startQ = app.camera.quaternion.clone();
    app.ui.toast(tour.name, 2500);
    if (tour.directed) {
      this.shot = -1;
      this.flip = Math.random() < 0.5 ? -1 : 1;
      this.phase0 = Math.random() * Math.PI * 2;
      app.setLevel(LAKE.fullPoolFt, true);
      app.sim.daysOverride = tour.daysPerSec;
      app.sim.playing = false;
      this.started = false;
      this.endT = null;
    }
  }

  _shotPose(sh, ts, pos, look) {
    const app = this.app;
    const lvl = app.sim.levelFt * 0.3048;
    const P = (ll) => {
      const [x, z] = lonLatToWorld(ll[0], ll[1]);
      const g = app.terrain.heightAt(x, z) ?? 175;
      return new THREE.Vector3(x, app.terrain.toY(Math.max(g, lvl)) + (ll[2] || 0), z);
    };
    if (sh.type === 'orbit') {
      const c = P([sh.c[0], sh.c[1], 0]);
      const a = this.phase0 + this.flip * sh.rate * ts;
      const pull = sh.pullback ? 1 + Math.max(0, ts - 8) * 0.12 : 1;
      pos.set(c.x + Math.cos(a) * sh.r * pull, c.y + sh.h * pull * pull, c.z + Math.sin(a) * sh.r * pull);
      look.copy(c);
    } else {
      const k = Math.min(1, ts / sh.dur); const e = k * k * (3 - 2 * k);
      pos.lerpVectors(P(sh.from), P(sh.to), e);
      look.copy(P(sh.look));
    }
    const g = app.terrain.heightAt(pos.x, pos.z);
    if (g !== null) pos.y = Math.max(pos.y, app.terrain.toY(Math.max(g, lvl)) + 20);
  }

  _updateDirected(dt) {
    const tour = this.active; const app = this.app; const cam = app.camera;
    if (!this.started && this.t > 2.5) { this.started = true; app.sim.playing = false; app.toggleDrain(); }
    const lvl = app.sim.levelFt;
    let idx = 0;
    tour.shots.forEach((sh, i) => { if (lvl <= sh.at) idx = i; });
    if (idx !== this.shot) {
      this.shot = idx; this.shotT = 0;
      this.fromPos = cam.position.clone(); this.fromQ = cam.quaternion.clone();
      this.phase0 = Math.random() * Math.PI * 2; this.flip = Math.random() < 0.5 ? -1 : 1;
    }
    this.shotT += dt;
    const pos = new THREE.Vector3(); const look = new THREE.Vector3();
    this._shotPose(tour.shots[idx], this.shotT, pos, look);
    const q = new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().lookAt(pos, look, new THREE.Vector3(0, 1, 0)));
    const b = Math.min(1, this.shotT / 3.2); const bs = b * b * (3 - 2 * b);
    cam.position.lerpVectors(this.fromPos, pos, bs);
    cam.quaternion.slerpQuaternions(this.fromQ, q, bs);
    cam.updateMatrixWorld();
    if (this.started && !app.sim.playing && this.endT === null) this.endT = this.t;
    if (this.endT !== null && this.t - this.endT > 10) {
      app.sim.daysOverride = null;
      this.active = null;
      app.mode = 'tour-done';
      app.setMode('earth');
      app.ui.toast('Tap Refill (⟲) to bring the lake back', 3500);
    }
  }

  stop() {
    this.active = null;
    this.app.sim.playing = false;
    this.app.sim.daysOverride = null;
  }

  update(dt) {
    const tour = this.active;
    const app = this.app;
    this.t += dt;
    if (tour.directed) { this._updateDirected(dt); return; }
    const u = Math.min(1, this.t / tour.duration);
    for (const [i, [at, ev]] of (tour.events || []).entries()) {
      if (this.t >= at && !this.fired.has(i)) {
        this.fired.add(i);
        if (ev.level !== undefined) app.setLevel(ev.level);
        if (ev.speed !== undefined) { app.sim.speed = ev.speed; }
        if (ev.drain) { app.sim.playing = false; app.toggleDrain(); }
        if (ev.refill) app.refill();
      }
    }
    const cam = app.camera;
    const pos = new THREE.Vector3(); const look = new THREE.Vector3();
    if (tour.orbit) {
      const o = tour.orbit;
      const [cx, cz] = lonLatToWorld(o.lon, o.lat);
      const g = app.terrain.heightAt(cx, cz) ?? 175;
      const a = -Math.PI * 0.6 + u * o.turns * Math.PI * 2;
      pos.set(cx + Math.cos(a) * o.radius, app.terrain.toY(g) + o.height, cz + Math.sin(a) * o.radius);
      look.set(cx, app.terrain.toY(Math.min(g, app.sim.levelFt * 0.3048)), cz);
    } else {
      const s = u * u * (3 - 2 * u) * 0.98 + u * 0.02;
      this.camCurve.getPointAt(s, pos);
      this.lookCurve.getPointAt(Math.min(1, s + 0.01), look);
      // never below ground
      const g = app.terrain.heightAt(pos.x, pos.z);
      if (g !== null) pos.y = Math.max(pos.y, app.terrain.toY(g) + 15);
    }
    const m = new THREE.Matrix4().lookAt(pos, look, new THREE.Vector3(0, 1, 0));
    const q = new THREE.Quaternion().setFromRotationMatrix(m);
    // blend in from where the camera was for the first 2.5 s
    const b = Math.min(1, this.t / 2.5);
    const bs = b * b * (3 - 2 * b);
    cam.position.lerpVectors(this.startPos, pos, bs);
    cam.quaternion.slerpQuaternions(this.startQ, q, bs);
    cam.updateMatrixWorld();
    if (u >= 1) {
      if (tour.era) app.ui.setEra('all');
      this.active = null;
      app.mode = 'tour-done';
      app.setMode('earth');
    }
  }
}

import * as THREE from 'three';
import { G, RT } from './render/common.js';
import { Pipeline } from './render/Pipeline.js';
import { Shadows } from './render/Shadows.js';
import { makeNoiseTexture, makeWaterNormalTexture } from './render/textures.js';
import { TileStore } from './terrain/TileStore.js';
import { Imagery } from './terrain/Imagery.js';
import { Terrain } from './terrain/Terrain.js';
import { Atmosphere } from './sky/Atmosphere.js';
import { EarthControls } from './controls/EarthControls.js';
import { FirstPerson } from './controls/FirstPerson.js';
import { Joystick } from './controls/Joystick.js';
import { UI } from './ui/UI.js';
import { ABOUT_HTML } from './ui/about.js';
import { TOURS, TourPlayer } from './tours.js';
import { FishPanel } from './fishing/FishPanel.js';
import { Vegetation } from './veg/Vegetation.js';
import { loadGroundTextures } from './render/groundTextures.js';
import { HDLoader } from './terrain/HDLoader.js';
import { Reflection } from './water/Reflection.js';
import { Clouds } from './sky/Clouds.js';
import { Underwater } from './objects/Underwater.js';
import { Dial } from './ui/Dial.js';
import { QUALITY, LAKE, FT, DATA_URL } from './config.js';
import { LAT0, LON0, lonLatToWorld, worldToLonLat, localDate, sunPosition, formatLatLon, REGION_MERC, mercToWorld } from './geo.js';
import { gunzipSync } from 'fflate';

const WEATHER = {
  clear: { turbidity: 0.8, cloud: 0.0, haze: 0.7, valleyFog: 0 },
  fair: { turbidity: 1.0, cloud: 0.28, haze: 1.0, valleyFog: 0 },
  cloudy: { turbidity: 1.2, cloud: 0.55, haze: 1.15, valleyFog: 0 },
  overcast: { turbidity: 1.7, cloud: 0.95, haze: 1.6, valleyFog: 0 },
  fog: { turbidity: 1.2, cloud: 0.12, haze: 1.5, valleyFog: 1 },
  haze: { turbidity: 2.4, cloud: 0.15, haze: 2.3, valleyFog: 0 },
};

const SPEEDS = [
  { label: '1×', days: 2 },
  { label: '5×', days: 10 },
  { label: '25×', days: 50 },
];
const RELEASE_CFS = 10000;   // all outlets open (illustrative)
const INFLOW_CFS = 2500;     // refill rate (wet-season inflow, illustrative)
const ACFT_PER_CFS_DAY = 1.98347;
const DRY_BINS = 512;
const DRY_MIN = 100; const DRY_MAX = 190;

export class App {
  constructor(params) {
    this.params = params;
    const canvas = document.getElementById('c');
    this.canvas = canvas;
    this.renderer = new THREE.WebGLRenderer({
      canvas, antialias: false, powerPreference: 'high-performance', alpha: false, stencil: false,
      reversedDepthBuffer: true, preserveDrawingBuffer: params.has('shot'),
    });
    const r = this.renderer;
    r.outputColorSpace = THREE.LinearSRGBColorSpace;
    r.toneMapping = THREE.NoToneMapping;
    r.autoClear = false;
    this.reversed = r.capabilities.reversedDepthBuffer;
    const ext = r.extensions;
    if (!ext.has('EXT_color_buffer_float') && !ext.has('EXT_color_buffer_half_float')) RT.type = THREE.UnsignedByteType;
    this.isMobile = matchMedia('(pointer: coarse)').matches || /Android|iPhone|iPad/i.test(navigator.userAgent);
    this.qualityName = params.get('q') || (this.isMobile ? 'medium' : 'high');
    this.Q = QUALITY[this.qualityName];

    G.uNoiseTex.value = makeNoiseTexture();
    this.waterNormal = makeWaterNormalTexture();
    this.dryData = new Float32Array(DRY_BINS * 4);
    this.dryTex = new THREE.DataTexture(this.dryData, DRY_BINS, 1, THREE.RGBAFormat, THREE.FloatType);
    this.dryTex.minFilter = this.dryTex.magFilter = THREE.NearestFilter; // float linear filtering is optional on phones
    this.dryTex.needsUpdate = true;
    G.uDryTime.value = this.dryTex;
    G.uDryRange.value.set(DRY_MIN, DRY_MAX);
    this.exposeDay = new Float32Array(DRY_BINS).fill(Infinity);

    this.pipeline = new Pipeline(r);
    this.shadows = new Shadows(r);
    this.shadows.setSize(this.Q.shadow || 1);
    this.atmosphere = new Atmosphere(r);
    this.store = new TileStore();
    this.store.maxTiles = this.isMobile ? 110 : 220;
    this.imagery = new Imagery(r, { provider: params.get('img') || 'esri', bias: this.isMobile ? 0 : 1, maxTextures: this.isMobile ? 120 : 220 });
    this.camera = new THREE.PerspectiveCamera(55, 1, 1, 400000);
    this.scene = new THREE.Scene();
    this.waterScene = new THREE.Scene();
    this.scene.add(this.atmosphere.sky);
    this.ui = new UI(this);
    this.frustum = new THREE.Frustum();
    this.projView = new THREE.Matrix4();
    this.resScale = 1;
    this.mode = 'earth';
    this.frame = 0;
    this.sim = { levelFt: LAKE.fullPoolFt, targetFt: LAKE.fullPoolFt, playing: false, dir: -1, speed: 0, simDays: 0 };
    const now = new Date();
    this.timeState = { year: now.getFullYear(), month: now.getMonth(), day: 15, hour: 16.5 };
    this.weather = { ...WEATHER.fair, wind: 0.35, name: 'fair' };
    this.settings = { sonar: false, contours: false, attractors: true, trees: true, clouds: true, hd: true, exag: 1 };
    this.last = performance.now();
    this.fpsAcc = { frames: 0, t: 0, fps: 60 };
  }

  async start() {
    const ui = this.ui;
    ui.setLoading(0.05, 'Loading lidar terrain…');
    const [manifest, hyp, pois, trails] = await Promise.all([
      this.store.init(),
      fetch(`${DATA_URL}/hypsometry.json?v=${__BUILD__}`).then((r) => r.json()),
      fetch(`${DATA_URL}/pois.json?v=${__BUILD__}`).then((r) => r.json()),
      fetch(`${DATA_URL}/trails.json?v=${__BUILD__}`).then((r) => r.json()).catch(() => null),
    ]);
    this.manifest = manifest;
    this.hyp = hyp;
    this.poiData = pois;
    ui.setHypsometry(hyp);
    ui.setPOIs(pois.pois);
    if (trails) ui.setTrails(trails.trails);
    // general-area glows for Native history markers
    this.areaPois = pois.pois.filter((p) => p.kind === 'native').slice(0, 8);
    this.areaPois.forEach((p, k) => G.uAreas.value[k].set(p.x, p.z, p.id === 'nat-overview' ? 4200 : 1600, 1));
    this.areaTarget = 1;
    ui.setAbout(ABOUT_HTML(manifest, pois));
    ui.setTours(TOURS, (t) => this.playTour(t));

    this.terrain = new Terrain({ store: this.store, imagery: this.imagery, quality: this.Q });
    this.terrain.reversedDepth = this.reversed;
    this.hd = new HDLoader(this.store);
    { const [x0, z0] = mercToWorld(REGION_MERC[0], REGION_MERC[3]); const [x1, z1] = mercToWorld(REGION_MERC[2], REGION_MERC[1]); G.uRegionRect.value.set(x0, z0, x1, z1); }
    this.oldMapTarget = 0;
    this.reflection = new Reflection(this.renderer);
    this.clouds = new Clouds(this.renderer, this.reversed);
    this.clouds.setQuality(this.Q.clouds);
    this.underwater = new Underwater();
    this.terrain.waterUniforms = {
      uSceneTex: { value: null },
      uWaterNormal: { value: this.waterNormal },
      uReflTex: { value: null },
      uReflMat: { value: new THREE.Matrix4() },
      uReflOn: { value: 0 },
      uViewport: G.uViewport,
      uWind: { value: this.weather.wind },
      uClarity: { value: 1.0 },
    };
    this.scene.add(this.terrain.group);
    this.waterScene.add(this.terrain.waterGroup);

    const hfn = (x, z) => this.terrain.heightAt(x, z);
    this.controls = new EarthControls(this.camera, this.canvas, hfn);
    this.controls.toY = (h) => this.terrain.toY(h);
    this.controls.onTap = (x, y) => this.onTap(x, y);
    this.fp = new FirstPerson(this.camera, this.canvas, hfn, (x, z) => this.waterSurfaceAt(x, z));
    this.fp.toY = (h) => this.terrain.toY(h);
    this.fp.onTapGround = () => this.ui.hint('Walking…', 900);
    const uiRoot = document.getElementById('ui');
    this.joyMove = new Joystick(uiRoot, 'left', 'move');
    this.joyLook = new Joystick(uiRoot, 'right', 'look');
    this.joyMove.show(false); this.joyLook.show(false);
    this._bindVertical();
    this._bindProbe();
    this.tour = new TourPlayer(this);
    this.dial = new Dial(this);
    document.getElementById('btnDial').addEventListener('click', () => this.dial.toggle());
    this.objects = new Vegetation(this);
    this.objects.setSeason(this.timeState.month);
    this.scene.add(this.objects.group);
    this.waterScene.add(this.underwater.group);
    this.objects.init().catch((e) => console.warn('vegetation', e));
    loadGroundTextures().catch((e) => console.warn('ground textures', e));
    this.loadCanopy();

    // initial view
    this.applyURLView();
    this.setTimeOfDay();
    if (!this.params.has('hour') && this.sunTimes?.set) { this.timeState.hour = Math.min(this.sunTimes.set - 1.6, 15.5); this.setTimeOfDay(); }
    this.setMonth(this.timeState.month);
    window.addEventListener('resize', () => this.resize());
    this.resize();
    this.ui.setSegment('segImagery', this.imagery.providerName);
    this.ui.setSegment('segExag', 1);
    this.ui.setSegment('segQuality', this.qualityName);
    document.querySelector(`#weather [data-w="${this.weather.name}"]`)?.classList.add('on');

    // warm-up: wait for root tiles + first imagery before revealing
    const t0 = performance.now();
    const loop = (t) => this.loop(t);
    requestAnimationFrame(loop);
    await new Promise((res) => {
      const check = () => {
        const n = this.store.tiles.size; const im = this.imagery.cache.size;
        const frac = Math.min(1, 0.1 + n / 60 * 0.5 + im / 60 * 0.4);
        ui.setLoading(frac, n < 9 ? 'Loading lidar terrain…' : im < 20 ? 'Streaming aerial imagery…' : 'Filling the lake…');
        if ((n >= 20 && im >= 30) || performance.now() - t0 > 12000) res(); else setTimeout(check, 150);
      };
      check();
    });
    ui.doneLoading();
    this.fetchToday();
    const tourId = this.params.get('tour');
    const autoTour = tourId && TOURS.find((t) => t.id === tourId);
    const poiId = this.params.get('poi');
    const linked = poiId && pois.pois.find((p) => p.id === poiId);
    if (linked) this.selectPOI(linked);
    else if (autoTour) this.playTour(autoTour);
    else if (!this.params.has('view') && !this.params.has('noIntro')) this.intro();
    this.fish = new FishPanel(this);
    const panel = this.params.get('panel');
    if (panel === 'fish') setTimeout(() => this.fish.open(), 600);
    if (panel === 'photos') setTimeout(() => this.ui.openGallery(null), 600);
    window.__app = this;
  }

  // ------------------------------------------------------------------ views
  applyURLView() {
    const c = this.controls;
    const [dx, dz] = lonLatToWorld(-93.243, 34.588);
    c.target.set(dx, 175, dz);
    c.range = 14000; c.heading = 0.75; c.tilt = 1.2;
    const p = this.params;
    if (p.has('view')) {
      const [lon, lat, range, heading, tilt] = p.get('view').split(',').map(Number);
      const [x, z] = lonLatToWorld(lon, lat);
      c.target.set(x, 180, z); c.range = range; c.heading = heading; c.tilt = tilt;
    }
    if (p.has('level')) this.sim.levelFt = this.sim.targetFt = Number(p.get('level'));
    if (p.has('hour')) this.timeState.hour = Number(p.get('hour'));
    if (p.has('month')) this.timeState.month = Number(p.get('month'));
    if (p.has('w') && WEATHER[p.get('w')]) this.weather = { ...WEATHER[p.get('w')], wind: this.weather.wind, name: p.get('w') };
    if (p.has('sonar')) this.setSonar(true);
    if (p.has('mode')) setTimeout(() => this.setMode(p.get('mode')), Number(p.get('modeDelay') || 6000));
    c.update(0, true);
  }

  intro() {
    // a gentle establishing move toward the main basin
    const c = this.controls;
    const [x, z] = lonLatToWorld(-93.262, 34.596);
    c.flyTo({ target: new THREE.Vector3(x, 175, z), range: 7500, heading: 0.45, tilt: 1.16, duration: 6 });
    setTimeout(() => this.ui.hint('Drag to move · pinch to zoom · two fingers to tilt and turn', 4200), 1500);
  }

  resize() {
    const dpr = Math.min(window.devicePixelRatio || 1, this.Q.pixelRatio[1]) * this.resScale;
    this.renderer.setPixelRatio(dpr);
    this.renderer.setSize(window.innerWidth, window.innerHeight, false);
    const sz = this.renderer.getDrawingBufferSize(new THREE.Vector2());
    this.camera.aspect = window.innerWidth / window.innerHeight;
    this.camera.updateProjectionMatrix();
    this.pipeline.setup(sz.x, sz.y, this.Q.msaa, this.Q.bloom, this.reversed);
  }

  // ------------------------------------------------------------------ water
  waterSurfaceAt(x, z) {
    const wi = this.store.waterInfo(x, z);
    if (!wi) return -1e4;
    if (wi.basin) return Math.max(G.uWater.value.x, wi.staticLevel);
    if (wi.fixed) return wi.staticLevel;
    return -1e4;
  }

  setLevel(ft, user = false) {
    const s = this.sim;
    s.targetFt = THREE.MathUtils.clamp(ft, 385, 592);
    if (user) {
      s.playing = false;
      // jumping the level also advances simulated time (so newly exposed mud is wet, older mud dry)
      const dv = Math.abs(this.ui.volAt(s.levelFt) - this.ui.volAt(s.targetFt));
      s.simDays += dv / (RELEASE_CFS * ACFT_PER_CFS_DAY) * 0.25;
      s.levelFt = s.targetFt;
    }
  }

  toggleDrain() {
    const s = this.sim;
    if (s.playing) { s.playing = false; return; }
    if (s.levelFt <= 385.5) { this.refill(); return; }
    s.playing = true; s.dir = -1;
    this.ui.setFact(`Opening the outlets: releasing about ${RELEASE_CFS.toLocaleString()} cfs with no inflow. Watch the old Ouachita valley appear.`);
  }

  refill() {
    const s = this.sim;
    s.playing = true; s.dir = 1;
    this.ui.setFact(`Refilling with about ${INFLOW_CFS.toLocaleString()} cfs of inflow — roughly a wet-season Ouachita.`);
  }

  cycleSpeed() {
    const s = this.sim;
    s.speed = (s.speed + 1) % SPEEDS.length;
    this.ui.setSpeedLabel(SPEEDS[s.speed].label);
  }

  _levelForVolume(v) {
    const L = this.hyp.levels_ft; const V = this.hyp.volume_acft;
    if (v <= V[0]) return L[0];
    for (let i = 1; i < V.length; i++) {
      if (V[i] >= v) { const t = (v - V[i - 1]) / Math.max(1, V[i] - V[i - 1]); return L[i - 1] + t; }
    }
    return L[L.length - 1];
  }

  updateDrain(dt) {
    const s = this.sim;
    if (s.playing) {
      const days = (s.daysOverride ?? SPEEDS[s.speed].days) * dt;
      s.simDays += days;
      const v = this.ui.volAt(s.levelFt);
      const dv = (s.dir < 0 ? -RELEASE_CFS : INFLOW_CFS) * ACFT_PER_CFS_DAY * days;
      let nl = this._levelForVolume(Math.max(0, v + dv));
      if (s.dir < 0 && nl <= 385) { nl = 385; s.playing = false; }
      if (s.dir > 0 && nl >= LAKE.fullPoolFt) { nl = LAKE.fullPoolFt; s.playing = false; this.ui.setFact('Back to full pool: 578 ft.'); }
      s.levelFt = s.targetFt = nl;
    } else {
      const d = s.targetFt - s.levelFt;
      s.levelFt += Math.sign(d) * Math.min(Math.abs(d), Math.max(0.6, Math.abs(d) * 2.5) * dt);
      // resting below full pool: the exposed bed keeps drying (a day every ~2.5 s)
      if (Math.abs(d) < 0.01 && s.levelFt < LAKE.fullPoolFt - 0.2) s.simDays += dt * 0.4;
    }
    const prevFt = this._prevLevelFt ?? s.levelFt;
    const rate = Math.abs(s.levelFt - prevFt) / Math.max(dt, 1e-3); // ft per real second
    this._prevLevelFt = s.levelFt;
    G.uDrainRate.value += (Math.min(1, rate / 3) * (s.levelFt < prevFt ? 1 : 0) - G.uDrainRate.value) * Math.min(1, dt * 3);
    const levelM = s.levelFt * FT;
    this.terrain.levelM = levelM;
    G.uWater.value.x = levelM;
    G.uWater.value.y = LAKE.fullPoolM;
    // exposure history -> dryness texture (hours since each elevation came out of the water)
    for (let i = 0; i < DRY_BINS; i++) {
      const e = DRY_MIN + ((i + 0.5) / DRY_BINS) * (DRY_MAX - DRY_MIN);
      if (e < levelM) this.exposeDay[i] = Infinity;
      else if (this.exposeDay[i] === Infinity) this.exposeDay[i] = s.simDays;
      const hrs = this.exposeDay[i] === Infinity ? 0 : (s.simDays - this.exposeDay[i]) * 24 + (e > LAKE.fullPoolM + 0.5 ? 1e5 : 0);
      this.dryData[i * 4] = hrs;
      // rest lines: where the level paused, exposure time jumps between neighbouring bins
      const lo = i > 0 ? this.exposeDay[i - 1] : Infinity; const here = this.exposeDay[i];
      this.dryData[i * 4 + 1] = (lo !== Infinity && here !== Infinity) ? Math.min(1, Math.max(0, (lo - here) / 3)) : 0;
    }
    this.dryTex.needsUpdate = true;
    this.ui.updateLevel(s.levelFt, s.playing, s.simDays);
  }

  async fetchToday() {
    try {
      const r = await fetch('/api/level');
      if (!r.ok) return;
      const info = await r.json();
      if (!(info.ft > 385 && info.ft < 600)) return;
      this.today = info;
      this.ui.setToday(info, () => {
        this.setLevel(info.ft, true);
        const when = info.time ? info.time.replace(/^(\d+)\/(\d+)\/(\d+)\s+/, (m, mo, d, y) => `${['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'][+mo - 1]} ${+d}, `) : '';
        this.ui.toast(`Real level from the Corps: ${info.ft.toFixed(2)} ft${when ? ` (${when} CT)` : ''}`, 4500);
      });
      // open at today's real level unless a link or tour asked for something else
      if (!this.params.has('level') && !this.tour?.active && !this.sim.playing && Math.abs(this.sim.levelFt - LAKE.fullPoolFt) < 0.01) this.setLevel(info.ft, true);
    } catch { /* offline or local dev without functions */ }
  }

  // ------------------------------------------------------------------ time & weather
  setHour(h) { this.timeState.hour = h; this.setTimeOfDay(); }
  setMonth(m) { this.timeState.month = m; this.setTimeOfDay(); if (this.objects) this.objects.setSeason(m); G.uLitter.value = (m >= 9 || m <= 2) ? 1 : 0; }
  setNow() {
    const n = new Date();
    this.timeState.year = n.getFullYear(); this.timeState.month = n.getMonth(); this.timeState.day = n.getDate();
    const off = (n.getUTCHours() + n.getUTCMinutes() / 60);
    void off;
    const loc = new Intl.DateTimeFormat('en-US', { timeZone: 'America/Chicago', hour: 'numeric', minute: 'numeric', hour12: false }).formatToParts(n);
    const hh = +loc.find((p) => p.type === 'hour').value % 24; const mm = +loc.find((p) => p.type === 'minute').value;
    this.timeState.hour = hh + mm / 60;
    document.getElementById('hour').value = this.timeState.hour;
    document.getElementById('month').value = this.timeState.month;
    this.setTimeOfDay();
  }

  setTimeOfDay() {
    const t = this.timeState;
    this.date = localDate(t.year, t.month, t.day, t.hour);
    // sunrise / sunset labels
    const fmtH = (h) => { const hh = Math.floor(h); const mm = Math.round((h - hh) * 60); const ap = hh >= 12 ? 'pm' : 'am'; return `${((hh + 11) % 12) + 1}:${String(mm).padStart(2, '0')} ${ap}`; };
    let rise = null; let set = null; let prev = null;
    for (let h = 0; h <= 24; h += 0.05) {
      const alt = sunPosition(localDate(t.year, t.month, t.day, h), LAT0, LON0).altitude;
      if (prev !== null) {
        if (prev < -0.0145 && alt >= -0.0145 && rise === null) rise = h;
        if (prev >= -0.0145 && alt < -0.0145) set = h;
      }
      prev = alt;
    }
    this.sunTimes = { rise, set };
    const months = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
    this.ui.setTimeLabels(fmtH(t.hour), rise ? fmtH(rise) : '—', set ? fmtH(set) : '—', months[t.month]);
    document.getElementById('hour').value = t.hour;
    document.getElementById('month').value = t.month;
  }

  setWeather(name) {
    this.weather = { ...WEATHER[name], wind: this.weather.wind, name };
    if (name === 'fog' && this.sunTimes?.rise) { this.timeState.hour = this.sunTimes.rise + 0.6; this.setTimeOfDay(); }
  }

  setWind(w) { this.weather.wind = w; this.terrain.waterUniforms.uWind.value = w; }

  updateEnvironment(dt) {
    const w = this.weather;
    this.atmosphere.update(this.date, LAT0, LON0, w);
    // clouds dim the direct light; overcast lifts ambient
    const dim = 1 - 0.8 * THREE.MathUtils.smoothstep(w.cloud, 0.55, 1.0);
    const amb = 1 + 0.35 * THREE.MathUtils.smoothstep(w.cloud, 0.5, 1.0);
    this.atmosphere.applyLights(dim, amb);
    G.uFog.value.set(0.000016 * w.haze * (0.7 + w.turbidity * 0.3), 1400, w.valleyFog * 0.0011, 262);
    G.uCloud.value.x = this.settings.clouds ? w.cloud : 0;
    G.uCloud.value.y += dt * 0.0016; G.uCloud.value.z += dt * 0.0009;
  }

  // ------------------------------------------------------------------ layers
  setImagery(v) { this.imagery.setProvider(v); }
  setExaggeration(x) { G.uExag.value.x = x; this.settings.exag = x; }
  setQuality(name) {
    this.qualityName = name;
    this.Q = QUALITY[name];
    this.terrain.setQuality(this.Q);
    this.shadows.setSize(this.Q.shadow || 1);
    this.clouds.setQuality(this.Q.clouds);
    this.resize();
  }
  /** Neon highlight layers: 0 bike trails, 1 hiking trails, 2 main roads. */
  setTrail(i, on) {
    this.trailTarget = this.trailTarget || new THREE.Vector3();
    this.trailTarget.setComponent(i, on ? 1 : 0);
    if (on && !G.uTrails.value && !this._trailsLoading) {
      this._trailsLoading = true;
      new THREE.TextureLoader().load(`/tex/trails.png?v=${__BUILD__}`, (t) => {
        t.colorSpace = THREE.NoColorSpace; t.flipY = false; t.generateMipmaps = false;
        t.minFilter = THREE.LinearFilter; t.magFilter = THREE.LinearFilter; t.needsUpdate = true;
        G.uTrails.value = t;
      });
    }
  }

  setOldMap(v) {
    if (v && !G.uOldMap.value) {
      new THREE.TextureLoader().load('/tex/oldmap.jpg', (t) => {
        t.colorSpace = THREE.NoColorSpace; t.flipY = false; t.needsUpdate = true; t.anisotropy = 4; t.minFilter = THREE.LinearMipmapLinearFilter;
        G.uOldMap.value = t; this.oldMapTarget = 1;
        this.ui.toast('1890s USGS survey: the Ouachita valley before the lake — Buckville and Cedar Glades are on it', 5000);
      });
    }
    this.oldMapTarget = v ? 1 : 0;
  }

  async loadCanopy() {
    try {
      const r = await fetch(`${DATA_URL}/canopy.bin?v=${__BUILD__}`);
      if (!r.ok) return;
      const raw = gunzipSync(new Uint8Array(await r.arrayBuffer()));
      const dv = new DataView(raw.buffer, raw.byteOffset);
      const w = dv.getUint16(4, true); const h = dv.getUint16(6, true);
      const data = raw.slice(8, 8 + w * h);
      const t = new THREE.DataTexture(data, w, h, THREE.RedFormat, THREE.UnsignedByteType);
      t.minFilter = t.magFilter = THREE.LinearFilter; t.needsUpdate = true;
      t.flipY = false;
      G.uCanopy.value = t; G.uCanopyOn.value = 1;
      this.canopy = { w, h, data };
    } catch (e) { console.warn('canopy', e); }
  }

  /** Measured canopy height (m) at a world point, or -1 outside the data. */
  canopyAt(x, z) {
    const c = this.canopy; if (!c) return -1;
    const R = G.uRegionRect.value;
    const u = (x - R.x) / (R.z - R.x); const v = (z - R.y) / (R.w - R.y);
    if (u < 0 || v < 0 || u >= 1 || v >= 1) return -1;
    return c.data[Math.floor(v * c.h) * c.w + Math.floor(u * c.w)] * 0.25;
  }

  setSonar(v) { this.settings.sonar = v; G.uSonar.value = v ? 1 : 0; }
  setContours(v) { this.settings.contours = v; G.uContours.value = v ? 1 : 0; }
  setAttractors(v) { this.settings.attractors = v; if (this.objects) this.objects.setAttractors(v); }
  setTrees(v) { this.settings.trees = v; if (this.objects) this.objects.setTrees(v); }
  setClouds(v) { this.settings.clouds = v; }
  setHD(v) { this.settings.hd = v; this.terrain.hdEnabled = v; }

  // ------------------------------------------------------------------ modes
  setMode(mode) {
    if (this.tour.active && mode !== 'tour') this.tour.stop();
    const prev = this.mode;
    if (mode === prev) return;
    this.ui.setMode(mode);
    const touch = this.isMobile;
    this.fp.lock = null; this.ui.setLock(null);
    if (mode === 'earth') {
      this.fp.enabled = false;
      this.fp.enableGyro(false);
      this.controls.fromCamera(this.camera);
      this.controls.enabled = true;
      this.joyMove.show(false); this.joyLook.show(false);
      this.mode = mode;
      return;
    }
    this.controls.enabled = false;
    if (mode === 'drone') {
      this.fp.mode = 'drone';
      this.fp.setFromCamera(this.camera);
      this.fp.enabled = true;
      this.fp.moveStick = touch ? this.joyMove : null;
      this.fp.lookStick = touch ? this.joyLook : null;
      this.joyMove.show(touch); this.joyLook.show(touch);
      this.ui.hint(touch ? 'Left stick to fly · right stick or drag to look' : 'WASD to fly · Q/E down/up · drag to look · Shift = fast', 3500);
    } else if (mode === 'walk' || mode === 'dive') {
      // drop to street level at the point the camera is looking at
      let p = this.mode === 'earth' ? this.controls.target.clone() : this.camera.position.clone();
      if (mode === 'walk') {
        const surf = this.waterSurfaceAt(p.x, p.z);
        const g = this.terrain.heightAt(p.x, p.z);
        if (g !== null && surf - g > 0.4) {
          const dry = this.findDry(p);
          if (dry) { p = dry; this.ui.toast('Dropped you on the nearest shore — lower the lake to walk the bed'); }
        }
      }
      if (mode === 'dive') {
        const surf = this.waterSurfaceAt(p.x, p.z);
        const g = this.terrain.heightAt(p.x, p.z);
        if (surf < -999 || g === null || surf - g < 2) {
          // find nearby water
          const found = this.findWater(p);
          if (!found) { this.ui.toast('No water here — raise the level or look at the lake first'); this.ui.setMode(this.mode); return; }
          p = found;
        }
      }
      this.fp.mode = mode;
      this.fp.moveStick = touch ? this.joyMove : null;
      this.fp.lookStick = null;
      this.joyMove.show(touch); this.joyLook.show(false);
      this.flyDownTo(p, mode);
      this.ui.hint(mode === 'walk'
        ? (touch ? 'Tap the ground to walk there · drag to look around' : 'Click the ground to walk · WASD · drag to look')
        : 'Use ▲ ▼ to swim up and down', 3500);
    }
    this.mode = mode;
  }

  findDry(p) {
    for (let r = 20; r < 8000; r *= 1.35) {
      let best = null;
      for (let a = 0; a < 16; a++) {
        const x = p.x + Math.cos(a / 16 * Math.PI * 2) * r; const z = p.z + Math.sin(a / 16 * Math.PI * 2) * r;
        const s = this.waterSurfaceAt(x, z); const g = this.terrain.heightAt(x, z);
        if (g !== null && s - g < 0.1) { best = new THREE.Vector3(x, 0, z); break; }
      }
      if (best) {
        // step a few metres further inland so we are not standing in the surf
        return best;
      }
    }
    return null;
  }

  findWater(p) {
    for (let r = 50; r < 6000; r *= 1.5) {
      for (let a = 0; a < 12; a++) {
        const x = p.x + Math.cos(a / 12 * Math.PI * 2) * r; const z = p.z + Math.sin(a / 12 * Math.PI * 2) * r;
        const s = this.waterSurfaceAt(x, z); const g = this.terrain.heightAt(x, z);
        if (s > -999 && g !== null && s - g > 4) return new THREE.Vector3(x, 0, z);
      }
    }
    return null;
  }

  /** Animated descent from the current camera to eye level at p. */
  flyDownTo(p, mode) {
    const g = this.terrain.heightAt(p.x, p.z) ?? 180;
    const surf = this.waterSurfaceAt(p.x, p.z);
    let y = this.terrain.toY(g) + 1.7;
    if (mode === 'dive') y = Math.max(this.terrain.toY(g) + 2, this.terrain.toY(surf) - 4);
    const from = this.camera.position.clone();
    const fromQ = this.camera.quaternion.clone();
    const dir = new THREE.Vector3(); this.camera.getWorldDirection(dir);
    const yaw = Math.atan2(-dir.x, -dir.z);
    const to = new THREE.Vector3(p.x, y, p.z);
    const toQ = new THREE.Quaternion().setFromEuler(new THREE.Euler(mode === 'dive' ? -0.25 : 0.02, yaw, 0, 'YXZ'));
    this.fp.enabled = false;
    this.transition = { from, fromQ, to, toQ, t: 0, dur: THREE.MathUtils.clamp(from.distanceTo(to) / 2500, 1.2, 3.2), done: () => {
      this.fp.setFromCamera(this.camera);
      this.fp.pos.copy(to);
      this.fp.enabled = true;
    } };
  }

  updateTransition(dt) {
    const tr = this.transition;
    if (!tr) return false;
    tr.t = Math.min(1, tr.t + dt / tr.dur);
    const s = tr.t < 0.5 ? 4 * tr.t ** 3 : 1 - (-2 * tr.t + 2) ** 3 / 2;
    this.camera.position.lerpVectors(tr.from, tr.to, s);
    // keep a little altitude until the end so we swoop rather than clip hills
    this.camera.position.y += Math.sin(Math.PI * s) * Math.min(400, tr.from.distanceTo(tr.to) * 0.15);
    this.camera.quaternion.slerpQuaternions(tr.fromQ, tr.toQ, Math.min(1, s * 1.2));
    this.camera.updateMatrixWorld();
    if (tr.t >= 1) { this.transition = null; tr.done && tr.done(); }
    return true;
  }

  async toggleGyro() {
    const on = !this.fp.gyro;
    if (on && typeof DeviceOrientationEvent !== 'undefined' && DeviceOrientationEvent.requestPermission) {
      try {
        const r = await DeviceOrientationEvent.requestPermission();
        if (r !== 'granted') { this.ui.toast('Motion access was not allowed'); return; }
      } catch { this.ui.toast('Motion sensors are not available'); return; }
    }
    this.fp.enableGyro(on);
    document.getElementById('btnGyro').classList.toggle('on', on);
    this.ui.hint(on ? 'Move your phone to look around' : 'Drag to look around', 1800);
  }

  resetNorth() {
    if (this.mode === 'earth') this.controls.flyTo({ heading: 0, duration: 0.8 });
    else this.fp.yaw = 0;
  }

  // ------------------------------------------------------------------ POIs
  selectPOI(p) {
    this.selected = p;
    const lv = G.uWater.value.x;
    let meta = `<b>${formatLatLon(p.lon, p.lat)}</b><br/>Ground ${Math.round(p.ground / FT)} ft`;
    if (p.depthFullFt) {
      const now = (lv - p.ground) / FT;
      meta += ` · ≈${Math.round(p.depthFullFt)} ft deep at full pool (modelled bed)<br/>${now > 0 ? `Now under ≈${now.toFixed(0)} ft of water` : 'Now exposed — high and dry'}`;
    }
    if (p.depthDocFt) meta += `<br/><b>Documented:</b> ${p.docNote}, ${Math.round(p.depthDocFt)} ft below full pool`;
    this.ui.showCard(p, meta);
    this.flyToPOI(p);
  }

  flyToPOI(p) {
    if (this.mode !== 'earth') this.setMode('earth');
    const gy = this.terrain.toY(p.ground);
    const c = this.controls;
    c.flyTo({ target: new THREE.Vector3(p.x, gy, p.z), range: p.kind === 'dam' ? 1800 : p.kind === 'history' ? 1400 : 2600, tilt: 1.12 });
  }

  flyToLonLat(lon, lat) {
    const [x, z] = lonLatToWorld(lon, lat);
    if (this.mode !== 'earth') this.setMode('earth');
    const h = this.terrain.heightAt(x, z) ?? 180;
    this.controls.flyTo({ target: new THREE.Vector3(x, this.terrain.toY(h), z), range: 2500, tilt: 1.0 });
  }

  walkTo(p) {
    this.ui.hideCard();
    if (this.mode !== 'earth') this.setMode('earth');
    this.controls.target.set(p.x, this.terrain.toY(p.ground), p.z);
    this.setMode('walk');
  }

  locateMe() {
    if (!navigator.geolocation) { this.ui.toast('Location is not available'); return; }
    navigator.geolocation.getCurrentPosition((pos) => {
      const { latitude, longitude } = pos.coords;
      const [x, z] = lonLatToWorld(longitude, latitude);
      const d = Math.hypot(x, z);
      if (d > 60000) { this.ui.toast(`You are ${Math.round(d / 1609)} miles from the lake`); return; }
      this.flyToLonLat(longitude, latitude);
    }, () => this.ui.toast('Could not get your location'), { enableHighAccuracy: true, timeout: 8000 });
  }

  // ------------------------------------------------------------------ probe
  _bindProbe() {
    let timer = null; let sx = 0; let sy = 0;
    this.canvas.addEventListener('pointerdown', (e) => {
      sx = e.clientX; sy = e.clientY;
      clearTimeout(timer);
      if (this.mode === 'drone') { timer = setTimeout(() => this.lockAt(sx, sy), 550); return; }
      if (this.mode !== 'earth') return;
      timer = setTimeout(() => this.probeAt(sx, sy), 550);
    });
    window.addEventListener('pointermove', (e) => { if (Math.hypot(e.clientX - sx, e.clientY - sy) > 8) clearTimeout(timer); });
    window.addEventListener('pointerup', () => clearTimeout(timer));
    this.canvas.addEventListener('contextmenu', (e) => { e.preventDefault(); this.probeAt(e.clientX, e.clientY); });
  }

  probeAt(x, y) {
    const p = this.controls.pickTerrain(x, y, new THREE.Vector3());
    if (!p) return;
    const [lon, lat] = worldToLonLat(p.x, p.z);
    const wi = this.store.waterInfo(p.x, p.z);
    const g = this.terrain.heightAt(p.x, p.z);
    let html = `<b>${formatLatLon(lon, lat)}</b><br/>Ground ${(g / FT).toFixed(0)} ft above sea level`;
    if (wi && wi.basin && g < LAKE.fullPoolM) {
      html += `<br/>${((LAKE.fullPoolM - g) / FT).toFixed(0)} ft deep at full pool`;
      const surf = this.waterSurfaceAt(p.x, p.z);
      html += surf > g ? `<br/>Water now ${((surf - g) / FT).toFixed(1)} ft deep` : '<br/>Exposed lake bed';
      if (wi.reconstructed) html += '<br/><small>bed shape modelled</small>';
    }
    this.ui.probe(x, y, html);
    if (wi && (wi.basin || wi.fixed) && this.waterSurfaceAt(p.x, p.z) > g + 0.5) this.sonarPing(p.x, p.z);
  }

  /** Drone: long-press a place to keep it framed while you fly around it. */
  lockAt(x, y) {
    const poi = this.ui.labelAt(x, y);
    let p = poi ? new THREE.Vector3(poi.x, this.terrain.toY(poi.ground) + 5, poi.z) : this.controls.pickTerrain(x, y, new THREE.Vector3());
    if (!p) return;
    this.fp.lock = p;
    this.ui.setLock(poi ? poi.name : 'this spot', () => { this.fp.lock = null; });
    if (navigator.vibrate) navigator.vibrate(15);
  }

  /** Sonar sweep: the water clears inside a growing ring and the bed lights up. */
  sonarPing(x, z) {
    this.ping = { x, z, t: 0 };
    try {
      this.audio = this.audio || new (window.AudioContext || window.webkitAudioContext)();
      const a = this.audio; if (a.state === 'suspended') a.resume();
      const o = a.createOscillator(); const gn = a.createGain();
      o.type = 'sine'; o.frequency.setValueAtTime(1500, a.currentTime); o.frequency.exponentialRampToValueAtTime(420, a.currentTime + 1.2);
      gn.gain.setValueAtTime(0.25, a.currentTime); gn.gain.exponentialRampToValueAtTime(0.001, a.currentTime + 1.6);
      o.connect(gn).connect(a.destination); o.start(); o.stop(a.currentTime + 1.7);
    } catch { /* audio blocked */ }
  }

  updatePing(dt) {
    const p = this.ping; const u = G.uPing.value;
    if (!p) { u.w = 0; return; }
    p.t += dt;
    const R = Math.min(320, 40 + this.controls.range * 0.12);
    u.set(p.x, p.z, R * Math.min(1, p.t / 2.2), p.t < 6 ? 1 : Math.max(0, 1 - (p.t - 6) / 2));
    if (p.t > 8) this.ping = null;
  }

  onTap(x, y) {
    const p = this.ui.labelAt(x, y);
    if (p) this.selectPOI(p);
  }

  _bindVertical() {
    const set = (v) => () => { this.fp.vertical = v; };
    for (const [id, v] of [['btnUp', 1], ['btnDown', -1]]) {
      const el = document.getElementById(id);
      el.addEventListener('pointerdown', set(v));
      el.addEventListener('pointerup', set(0));
      el.addEventListener('pointerleave', set(0));
      el.addEventListener('pointercancel', set(0));
    }
  }

  // ------------------------------------------------------------------ photo
  photo() {
    document.body.classList.add('photo');
    let exit = document.getElementById('btnPhotoExit');
    if (!exit) {
      exit = document.createElement('div');
      exit.id = 'btnPhotoExit';
      exit.className = 'row';
      exit.innerHTML = '<button class="chip acc" id="btnSnap">Photo</button><button class="chip rec" id="btnRec">● Record</button><button class="chip" id="btnCine">Cinema bars</button><button class="chip" id="btnDone">Done</button>';
      document.getElementById('ui').appendChild(exit);
      exit.querySelector('#btnDone').addEventListener('click', () => { if (this.rec) this.toggleRecord(); document.body.classList.remove('photo'); });
      exit.querySelector('#btnSnap').addEventListener('click', () => { this.snapRequested = true; });
      exit.querySelector('#btnRec').addEventListener('click', () => this.toggleRecord());
      exit.querySelector('#btnCine').addEventListener('click', (e) => {
        const u = this.pipeline.compMat.uniforms.uLetterbox;
        u.value = u.value ? 0 : (window.innerWidth > window.innerHeight ? 2.39 : 0.8);
        e.target.classList.toggle('on', !!u.value);
      });
    }
  }

  /** Record the canvas to a video file (full resolution while recording). */
  toggleRecord() {
    const btn = document.getElementById('btnRec');
    if (this.rec) {
      this.rec.stop();
      return;
    }
    if (!this.canvas.captureStream || typeof MediaRecorder === 'undefined') { this.ui.toast('Video recording is not supported in this browser'); return; }
    const types = ['video/mp4;codecs=avc1.640028', 'video/mp4', 'video/webm;codecs=vp9', 'video/webm;codecs=vp8', 'video/webm'];
    const mime = types.find((t) => MediaRecorder.isTypeSupported(t)) || '';
    const stream = this.canvas.captureStream(30);
    const rec = new MediaRecorder(stream, { mimeType: mime, videoBitsPerSecond: 12e6 });
    const chunks = [];
    rec.ondataavailable = (e) => { if (e.data.size) chunks.push(e.data); };
    this.recPrevScale = this.resScale; this.resScale = 1; this.resize();
    this.recording = true;
    const t0 = performance.now();
    const tick = setInterval(() => { const s = Math.round((performance.now() - t0) / 1000); btn.textContent = `■ Stop ${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`; }, 500);
    rec.onstop = async () => {
      clearInterval(tick);
      this.recording = false; this.rec = null;
      btn.textContent = '● Record'; btn.classList.remove('on');
      this.resScale = this.recPrevScale || 1; this.resize();
      const type = mime.split(';')[0] || 'video/webm';
      const blob = new Blob(chunks, { type });
      const file = new File([blob], `lake-ouachita-${Date.now()}.${type.includes('mp4') ? 'mp4' : 'webm'}`, { type });
      if (navigator.canShare && navigator.canShare({ files: [file] })) {
        try { await navigator.share({ files: [file], title: 'Lake Ouachita' }); return; } catch { /* fall back to download */ }
      }
      const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = file.name; a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 8000);
    };
    rec.start(1000);
    this.rec = rec;
    btn.classList.add('on');
  }

  _saveSnapshot() {
    this.canvas.toBlob(async (blob) => {
      if (!blob) return;
      const file = new File([blob], `lake-ouachita-${Date.now()}.png`, { type: 'image/png' });
      if (navigator.canShare && navigator.canShare({ files: [file] })) {
        try { await navigator.share({ files: [file], title: 'Lake Ouachita' }); return; } catch { /* fall through */ }
      }
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob); a.download = file.name; a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 4000);
    }, 'image/png');
  }

  playTour(t) {
    this.ui.setMode('tour');
    this.fp.enabled = false;
    this.controls.enabled = false;
    this.joyMove.show(false); this.joyLook.show(false);
    this.mode = 'tour';
    this.tour.play(t);
  }

  // ------------------------------------------------------------------ frame
  loop() {
    requestAnimationFrame(() => this.loop());
    const now = performance.now();
    const dt = Math.min(0.1, (now - this.last) / 1000);
    this.last = now;
    this.frame++;
    G.uTime.value += dt;
    const fa = this.fpsAcc; fa.frames++; fa.t += dt;
    if (fa.t > 0.5) {
      fa.fps = fa.frames / fa.t; fa.frames = 0; fa.t = 0;
      this.ui.setFps(`${fa.fps.toFixed(0)} fps · ${this.terrain.stats.nodes} tiles · ${(this.store.loadedBytes / 1e6 + this.imagery.bytes / 1e6).toFixed(0)} MB · ${(this.resScale * 100).toFixed(0)}%`);
      this.adaptResolution(fa.fps);
    }

    this.updateDrain(dt);
    this.updatePing(dt);
    G.uOldMapOn.value += ((G.uOldMap.value ? this.oldMapTarget : 0) - G.uOldMapOn.value) * Math.min(1, dt * 2.5);
    if (this.trailTarget && G.uTrails.value) G.uTrailOn.value.lerp(this.trailTarget, Math.min(1, dt * 3));
    { const era = this.ui.era; const eraNative = era && era[0] > -1e11 && era[1] < 1e11 && era[1] >= -20000 && era[0] <= 1835;
      const show = this.ui.kindOff && !this.ui.kindOff.has('native') && (eraNative || (this.selected?.kind === 'native' && !document.getElementById('card').classList.contains('hidden')));
      G.uAreaOn.value += ((show ? 1 : 0) * (this.areaTarget || 0) - G.uAreaOn.value) * Math.min(1, dt * 2);
      // each glow follows its own marker: hidden by the period filter means no glow
      (this.areaPois || []).forEach((p, k) => {
        const on = this.selected === p || (eraNative && !(p.era.to != null && p.era.to < era[0]) && !(p.era.from > era[1]));
        const A = G.uAreas.value[k]; A.w += ((on ? 1 : 0) - A.w) * Math.min(1, dt * 3);
      }); }
    G.uCanopyFade.value.set(this.Q.treeRadius * 0.9, this.Q.treeRadius * 1.6);
    if (this.frame % 3 === 0 && this.dial) this.dial.refresh();
    this.updateEnvironment(dt);

    // camera
    if (this.tour.active) this.tour.update(dt);
    else if (!this.updateTransition(dt)) {
      if (this.mode === 'earth') this.controls.update(dt);
      else this.fp.update(dt);
    }
    const cam = this.camera;
    const gh = this.terrain.heightAt(cam.position.x, cam.position.z);
    const agl = gh === null ? 1000 : Math.max(0.5, cam.position.y - this.terrain.toY(gh));
    cam.near = this.reversed ? THREE.MathUtils.clamp(agl * 0.02, 0.15, 50) : THREE.MathUtils.clamp(agl * 0.1, 0.3, 300);
    cam.far = THREE.MathUtils.clamp(agl * 300 + 150000, 150000, 600000);
    cam.updateProjectionMatrix();
    cam.updateMatrixWorld();
    this.projView.multiplyMatrices(cam.projectionMatrix, cam.matrixWorldInverse);
    this.frustum.setFromProjectionMatrix(this.projView, THREE.WebGLCoordinateSystem, cam.reversedDepth);
    this.atmosphere.updateCamera(cam);
    this.terrain.update(cam, this.frustum, { hdLoader: this.settings.hd && this.Q.hd ? this.hd : null });
    if (this.objects) this.objects.update(cam, dt, { quality: this.Q });

    // underwater?
    const surf = this.waterSurfaceAt(cam.position.x, cam.position.z);
    const under = cam.position.y < this.terrain.toY(surf) - 0.05;
    G.uWater.value.z = under ? 1 : 0;
    G.uWater.value.w = surf;
    const bedH = gh === null ? surf - 10 : gh;
    this.underwater.update(cam, under, this.terrain.toY(bedH), this.terrain.toY(surf));

    // heading for the compass
    const dir = new THREE.Vector3(); cam.getWorldDirection(dir);
    this.ui.setCompass(Math.atan2(-dir.x, -dir.z));
    if (this.frame % 2 === 0) this.ui.updateLabels(cam, (x, z) => this.terrain.heightAt(x, z), (h) => this.terrain.toY(h), G.uWater.value.x, this.frame);

    this.render();
    if (this.snapRequested) { this.snapRequested = false; this._saveSnapshot(); }
  }

  adaptResolution(fps) {
    if (this.params.has('fixedres') || this.recording) return;
    const [lo, hi] = this.Q.pixelRatio;
    const dpr = Math.min(window.devicePixelRatio || 1, hi);
    const minScale = lo / dpr;
    let s = this.resScale;
    if (fps < 26 && s > minScale) s = Math.max(minScale, s * 0.85);
    else if (fps > 52 && s < 1) s = Math.min(1, s * 1.08);
    if (Math.abs(s - this.resScale) > 0.01) { this.resScale = s; this.resize(); }
  }

  render() {
    const r = this.renderer;
    const T = this.pipeline.targets;
    const cam = this.camera;
    // sun shadows centred on what we look at
    const focus = this.mode === 'earth' ? this.controls.target.clone() : cam.position.clone().add(new THREE.Vector3(0, 0, -1).applyQuaternion(cam.quaternion).multiplyScalar(80));
    const casters = [{ group: this.terrain.depthGroup }];
    if (this.objects) casters.push({ group: this.objects.depthGroup, nearOnly: true });
    const range = this.mode === 'earth' ? this.controls.range : 300;
    this.shadows.update(cam, focus, casters, {
      enabled: this.Q.shadow > 0, far: true,
      nearRadius: THREE.MathUtils.clamp(range * 0.55, 120, 2500), farRadius: 24000,
    });
    // planar reflection of the lake surface
    const wu = this.terrain.waterUniforms;
    wu.uReflOn.value = 0;
    if (this.Q.reflection && G.uWater.value.z < 0.5 && this.terrain.stats.water > 0) {
      const wy = this.terrain.toY(G.uWater.value.x);
      if (cam.position.y > wy + 0.5) {
        const veg = this.objects && this.objects.group.visible;
        if (this.objects && this.qualityName !== 'ultra') this.objects.group.visible = false;
        wu.uReflTex.value = this.reflection.render(this.scene, cam, wy, this.atmosphere, this.terrain.uClipY, this.pipeline.size);
        if (this.objects) this.objects.group.visible = veg;
        wu.uReflMat.value.copy(this.reflection.matrix);
        wu.uReflOn.value = 1;
      }
    }
    r.setRenderTarget(T.main);
    r.setClearColor(0x000000, 1);
    r.clear(true, true, false);
    r.render(this.scene, cam);
    this.terrain.waterUniforms.uSceneTex.value = this.pipeline.copyScene();
    r.setRenderTarget(T.main);
    r.render(this.waterScene, cam);
    const comp = this.pipeline.compMat.uniforms;
    comp.uUnder.value = G.uWater.value.z;
    comp.uBloom.value = this.Q.bloom ? 0.045 : 0;
    comp.uExposure.value = 1.0 + 1.2 * G.uNight.value;
    this.pipeline.finish(this.clouds && this.settings.clouds ? this.clouds.render(cam, T) : null);
  }
}

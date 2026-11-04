import * as THREE from 'three';
import { formatLatLon, worldToLonLat } from '../geo.js';
import { FT, LAKE } from '../config.js';

const $ = (id) => document.getElementById(id);
const fmt = (n) => Math.round(n).toLocaleString('en-US');
const fmtM = (n) => (n >= 1e6 ? `${(n / 1e6).toFixed(2)}M` : n >= 1e4 ? `${Math.round(n / 1e3)}k` : fmt(n));

export const MILESTONES = [
  { ft: 592, text: 'Spillway crest — top of the flood pool (592 ft)' },
  { ft: 590.1, text: 'Record high: 590.1 ft on Dec 5, 1982' },
  { ft: 578, text: 'Full pool: 578 ft, about 40,100 acres' },
  { ft: 535.86, text: 'Record low 535.9 ft — Jan 1954, while the lake was still filling' },
  { ft: 535, text: 'Top of the inactive pool (535 ft): below here the turbines can’t draw water' },
  { ft: 500, text: 'The old Ouachita valley is taking shape — ridges and coves are dry land again' },
  { ft: 450, text: 'Mostly river now: the old channel winds through the mud flats' },
  { ft: 404.2, text: 'Level of the old 1923–50 river gauge datum (404 ft)' },
  { ft: 385, text: 'Original streambed at the dam (385 ft). The Ouachita runs free again.' },
];

const KIND_LABEL = {
  dam: 'Dam', feature: 'Lake bed', history: 'History', park: 'Park', marina: 'Marina', recreation: 'Recreation area',
  overlook: 'Overlook', trail: 'Trail', bridge: 'Bridge', river: 'River',
  geology: 'Deep time', town: 'Town', landmark: 'Historic landmark', museum: 'Museum', native: 'Native history',
};
const CONF_LABEL = { documented: 'documented', approximate: 'approximate location', modelled: 'modelled' };

export class UI {
  constructor(app) {
    this.app = app;
    this.pois = [];
    this.labels = [];
    this.hyp = null;
    this.toastTimer = 0;
    this.lastMilestoneFt = LAKE.fullPoolFt;
    this.drainCollapsed = false;
    this._bind();
  }

  setLoading(frac, msg) {
    $('ldBar').style.width = `${Math.round(frac * 100)}%`;
    if (msg) $('ldMsg').textContent = msg;
  }

  doneLoading() {
    $('loading').classList.add('done');
    setTimeout(() => $('loading').remove(), 1200);
  }

  toast(text, ms = 3200) {
    const t = $('toast');
    t.textContent = text;
    t.classList.remove('hidden');
    clearTimeout(this.toastTimer);
    this.toastTimer = setTimeout(() => t.classList.add('hidden'), ms);
  }

  hint(text, ms = 2600) {
    const h = $('hint');
    h.textContent = text;
    h.classList.add('show');
    clearTimeout(this.hintTimer);
    this.hintTimer = setTimeout(() => h.classList.remove('show'), ms);
  }

  // ------------------------------------------------------------- setup
  _bind() {
    const app = this.app;
    // sheets
    const sheets = { btnLayers: 'sheetLayers', btnTime: 'sheetTime' };
    for (const [b, s] of Object.entries(sheets)) {
      $(b).addEventListener('click', () => this.openSheet(s));
    }
    $('btnMenu').addEventListener('click', () => this.openSheet('sheetLayers'));
    document.querySelectorAll('[data-close]').forEach((el) => el.addEventListener('click', () => this.closeSheets()));
    $('btnAbout').addEventListener('click', () => this.openSheet('sheetAbout'));
    $('btnGallery').addEventListener('click', () => this.openGallery(null));
    $('galFilter').querySelectorAll('button').forEach((b) => b.addEventListener('click', () => {
      this.galF = b.dataset.f; this._renderGallery();
    }));
    $('lbClose').addEventListener('click', () => $('lightbox').classList.add('hidden'));
    $('lightbox').addEventListener('click', (e) => { if (e.target.id === 'lightbox') $('lightbox').classList.add('hidden'); });
    $('lbPrev').addEventListener('click', () => this._lb(this.lbIdx - 1));
    $('lbNext').addEventListener('click', () => this._lb(this.lbIdx + 1));
    addEventListener('keydown', (e) => {
      if ($('lightbox').classList.contains('hidden')) return;
      if (e.key === 'Escape') $('lightbox').classList.add('hidden');
      if (e.key === 'ArrowLeft') this._lb(this.lbIdx - 1);
      if (e.key === 'ArrowRight') this._lb(this.lbIdx + 1);
    });

    // search
    const q = $('q');
    q.addEventListener('input', () => this.search(q.value));
    q.addEventListener('focus', () => this.search(q.value));
    q.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') { const b = $('results').querySelector('button'); if (b) b.click(); }
      if (e.key === 'Escape') { q.blur(); $('results').classList.add('hidden'); }
    });
    document.addEventListener('pointerdown', (e) => {
      if (!$('search').contains(e.target) && !$('results').contains(e.target)) $('results').classList.add('hidden');
    });

    // compass
    $('btnCompass').addEventListener('click', () => app.resetNorth());
    $('btnLocate').addEventListener('click', () => app.locateMe());
    $('btnPhoto').addEventListener('click', () => app.photo());
    $('btnGyro').addEventListener('click', () => app.toggleGyro());

    // card
    $('cardClose').addEventListener('click', () => this.hideCard());

    // drain panel
    const lvl = $('level');
    lvl.addEventListener('input', () => { app.setLevel(parseFloat(lvl.value), true); });
    $('btnPlay').addEventListener('click', () => app.toggleDrain());
    $('btnRefill').addEventListener('click', () => app.refill());
    $('btnSpeed').addEventListener('click', () => app.cycleSpeed());
    $('drainHead').addEventListener('click', (e) => {
      if (e.target.closest('button')) return;
      const d = $('drain');
      if (d.classList.contains('collapsed')) { d.classList.remove('collapsed'); this.drainCollapsed = false; return; }
      if (window.innerWidth <= 560 && !d.classList.contains('expanded')) { d.classList.add('expanded'); return; }
      d.classList.remove('expanded');
      this.drainCollapsed = true;
      d.classList.add('collapsed');
    });
    // ticks
    const ticks = [[385, 'River bed'], [535, 'Inactive'], [578, 'Full'], [592, '']];
    const tk = $('ticks');
    for (const [ft, name] of ticks) {
      const s = document.createElement('span');
      s.style.left = `${((ft - 385) / (592 - 385)) * 100}%`;
      s.textContent = name || `${ft}`;
      if (!name) s.style.display = 'none';
      if (ft === 385) s.classList.add('first');
      if (ft > 585) s.classList.add('last');
      tk.appendChild(s);
    }

    // modes
    $('modes').querySelectorAll('button').forEach((b) => b.addEventListener('click', () => {
      if (b.dataset.mode === 'tour') { this.openSheet('sheetTours'); return; }
      app.setMode(b.dataset.mode);
    }));

    // layers
    const seg = (id, cb) => {
      const el = $(id);
      el.querySelectorAll('button').forEach((b) => b.addEventListener('click', () => {
        el.querySelectorAll('button').forEach((x) => x.classList.toggle('on', x === b));
        cb(b.dataset.v);
      }));
    };
    seg('segImagery', (v) => app.setImagery(v));
    seg('segExag', (v) => app.setExaggeration(parseFloat(v)));
    seg('segQuality', (v) => app.setQuality(v));
    const tg = (id, cb) => $(id).addEventListener('change', (e) => cb(e.target.checked));
    tg('tgLabels', (v) => { this.showLabels = v; $('labels').style.display = v ? '' : 'none'; });
    tg('tgSonar', (v) => app.setSonar(v));
    tg('tgOldMap', (v) => app.setOldMap(v));
    tg('tgContours', (v) => app.setContours(v));
    tg('tgAttractors', (v) => app.setAttractors(v));
    tg('tgTrees', (v) => app.setTrees(v));
    tg('tgClouds', (v) => app.setClouds(v));
    tg('tgHD', (v) => app.setHD(v));
    tg('tgBike', (v) => app.setTrail(0, v));
    tg('tgHike', (v) => app.setTrail(1, v));
    tg('tgRoads', (v) => app.setTrail(2, v));
    // era filter: show markers whose era overlaps the chosen period (undated = today)
    const ERAS = this.ERAS = { firstpeoples: [-20000, 1835], all: [-1e12, 1e12], deep: [-1e12, -20000], native: [-20000, 1540], frontier: [1541, 1835], valley: [1836, 1951], lake: [1952, 1e12] };
    this.era = ERAS.all;
    $('eraFilter').querySelectorAll('button').forEach((b) => b.addEventListener('click', () => {
      $('eraFilter').querySelectorAll('button').forEach((x) => x.classList.toggle('on', x === b));
      this.era = ERAS[b.dataset.e];
      if (b.dataset.e === 'valley' && !$('tgOldMap').checked) { $('tgOldMap').checked = true; app.setOldMap(true); }
      if (b.dataset.e === 'valley' || b.dataset.e === 'native') this.toast(b.dataset.e === 'valley' ? 'The valley before the lake: try Drain to see it, with the 1890s survey map on the ground' : 'Native history: markers show general areas only; sites are protected', 4500);
    }));
    // marker filter: each chip covers a family of kinds
    this.kindOff = new Set();
    const FAM = { history: ['history', 'feature'], native: ['native'], geology: ['geology'], landmark: ['landmark', 'museum'], town: ['town'],
      recreation: ['recreation', 'marina', 'bridge'], park: ['park', 'trail', 'overlook'], dam: ['dam', 'river'] };
    $('kindFilter').querySelectorAll('button').forEach((b) => b.addEventListener('click', () => {
      const on = !b.classList.contains('on'); b.classList.toggle('on', on);
      for (const k of FAM[b.dataset.k]) { if (on) this.kindOff.delete(k); else this.kindOff.add(k); }
    }));
    tg('tgFps', (v) => $('fps').classList.toggle('hidden', !v));
    this.showLabels = true;

    // time & weather
    $('hour').addEventListener('input', (e) => app.setHour(parseFloat(e.target.value)));
    $('month').addEventListener('input', (e) => app.setMonth(parseInt(e.target.value, 10)));
    $('btnNow').addEventListener('click', () => app.setNow());
    $('weather').querySelectorAll('button').forEach((b) => b.addEventListener('click', () => {
      $('weather').querySelectorAll('button').forEach((x) => x.classList.toggle('on', x === b));
      app.setWeather(b.dataset.w);
    }));
    $('wind').addEventListener('input', (e) => app.setWind(parseFloat(e.target.value)));

    // probe dismiss
    $('probe').addEventListener('click', () => $('probe').classList.add('hidden'));
  }

  openSheet(id) {
    const el = $(id);
    const wasOpen = !el.classList.contains('hidden');
    this.closeSheets();
    if (!wasOpen) el.classList.remove('hidden');
  }

  closeSheets() {
    document.querySelectorAll('.sheet').forEach((s) => s.classList.add('hidden'));
  }

  setSegment(id, v) {
    $(id).querySelectorAll('button').forEach((x) => x.classList.toggle('on', x.dataset.v === String(v)));
  }

  setMode(mode) {
    $('modes').querySelectorAll('button').forEach((b) => b.classList.toggle('on', b.dataset.mode === mode));
    // keep the view clear while flying / walking
    this.drainCollapsed = mode !== 'earth';
    $('drain').classList.toggle('collapsed', this.drainCollapsed);
    $('updown').classList.toggle('hidden', !(mode === 'drone' || mode === 'dive'));
    $('btnGyro').classList.toggle('hidden', !(this.app.isMobile && (mode === 'walk' || mode === 'dive' || mode === 'drone')));
  }

  // ------------------------------------------------------------- search & POIs
  setPOIs(pois) {
    this.pois = pois;
    const box = $('labels');
    for (const p of pois) {
      const el = document.createElement('div');
      el.className = `lbl ${p.kind}${p.kind === 'recreation' || p.kind === 'bridge' ? ' small' : ''}`;
      el.innerHTML = `<span class="t"></span><span class="stem"></span><i></i>`;
      el.querySelector('.t').textContent = p.name;
      box.appendChild(el);
      this.labels.push({ p, el, vis: false, occ: false, occT: 0 });
    }
  }

  setEra(key) {
    this.era = this.ERAS[key] || this.ERAS.all;
    $('eraFilter').querySelectorAll('button').forEach((x) => x.classList.toggle('on', x.dataset.e === key));
  }

  setTrails(list) {
    this.trailList = list.map((t) => ({ id: `trail:${t.name}`, name: t.name, kind: t.cls, trail: true, x: t.x, z: t.z, km: t.km,
      desc: `${t.cls === 'bike' ? 'Mountain-bike' : 'Hiking'} trail, ${t.km} km mapped in OpenStreetMap` }));
  }

  search(text) {
    const res = $('results');
    const t = text.trim().toLowerCase();
    let list = this.pois;
    if (t) {
      list = this.pois.filter((p) => p.name.toLowerCase().includes(t) || (KIND_LABEL[p.kind] || '').toLowerCase().includes(t) || p.desc.toLowerCase().includes(t) || (p.body || '').toLowerCase().includes(t) || (p.era?.label || '').toLowerCase().includes(t));
      // coordinates "lat, lon"
      const m = t.match(/^\s*(-?\d+(?:\.\d+)?)\s*[, ]\s*(-?\d+(?:\.\d+)?)\s*$/);
      if (m) list = [{ id: 'coord', name: `${m[1]}, ${m[2]}`, kind: 'feature', lat: +m[1], lon: +m[2], desc: 'Coordinates', coord: true }, ...list];
    }
    if (t && this.trailList) list = [...list, ...this.trailList.filter((p) => p.name.toLowerCase().includes(t) || p.kind.includes(t) || (t.includes('trail') && t.length < 7) || (t.includes('bike') && p.kind === 'bike'))];
    res.innerHTML = '';
    for (const p of list.slice(0, 12)) {
      const b = document.createElement('button');
      b.innerHTML = `<span class="dot ${p.kind}"></span><span><span class="n"></span><small>${p.trail ? `${p.kind === 'bike' ? 'Bike' : 'Hiking'} trail · ${p.km} km` : KIND_LABEL[p.kind] || ''}${p.depthFullFt ? ` · ${Math.round(p.depthFullFt)} ft deep at full pool` : ''}</small></span>`;
      b.querySelector('.n').textContent = p.name;
      b.addEventListener('click', () => {
        res.classList.add('hidden');
        $('q').value = '';
        $('q').blur();
        if (p.coord) this.app.flyToLonLat(p.lon, p.lat);
        else if (p.trail) { this.app.setTrail(p.kind === 'bike' ? 0 : 1, true); $(p.kind === 'bike' ? 'tgBike' : 'tgHike').checked = true; this.app.flyToPOI({ ...p, ground: 180 }); this.toast(`${p.name}: ${p.desc}`, 4000); }
        else this.app.selectPOI(p);
      });
      res.appendChild(b);
    }
    res.classList.toggle('hidden', list.length === 0);
  }

  showCard(p, info) {
    $('cardKind').textContent = (KIND_LABEL[p.kind] || p.kind) + (p.conf ? ` · ${CONF_LABEL[p.conf] || p.conf}` : p.approx ? ' · approximate' : '');
    $('cardEra').textContent = p.era?.label || '';
    $('cardEra').classList.toggle('hidden', !p.era?.label);
    $('cardBody').textContent = p.body || '';
    $('cardBody').classList.toggle('hidden', !p.body);
    const sl = $('cardSrcList'); sl.innerHTML = '';
    for (const s of p.sources || []) {
      const li = document.createElement('li'); const a = document.createElement('a');
      a.href = s.u; a.target = '_blank'; a.rel = 'noopener'; a.textContent = s.t; li.appendChild(a); sl.appendChild(li);
    }
    $('cardSources').classList.toggle('hidden', !(p.sources && p.sources.length));
    this._askFor(p);
    this._photos().then((all) => {
      const n = all.filter((it) => this._near(p, it)).length;
      $('cardPhotos').textContent = `Photos (${n})`;
      $('cardPhotos').classList.toggle('hidden', !n);
      $('cardPhotos').onclick = () => this.openGallery(p);
    });
    requestAnimationFrame(() => this._fitCard());
    if (!this._fitBound) {
      this._fitBound = true;
      addEventListener('resize', () => this._fitCard());
      new ResizeObserver(() => this._fitCard()).observe(document.querySelector('.drain'));
    }
    $('cardTitle').textContent = p.name;
    $('cardDesc').textContent = p.desc;
    $('cardMeta').innerHTML = info;
    const src = $('cardSrc');
    if (p.src) { src.href = p.src; src.classList.remove('hidden'); } else src.classList.add('hidden');
    $('card').classList.remove('hidden');
    $('cardFly').onclick = () => this.app.flyToPOI(p);
    $('cardWalk').onclick = () => this.app.walkTo(p);
    $('cardShare').onclick = async () => {
      const url = `${location.origin}/?poi=${encodeURIComponent(p.id)}`;
      try {
        if (navigator.share) await navigator.share({ title: p.name, text: p.desc, url });
        else { await navigator.clipboard.writeText(url); this.toast('Link copied', 1800); }
      } catch { /* cancelled */ }
    };
  }

  /** Keep the card clear of the drain panel (they share the left edge). */
  _fitCard() {
    const card = $('card'); const dr = document.querySelector('.drain');
    card.style.maxHeight = '';
    if (!dr || card.classList.contains('hidden')) return;
    const c = card.getBoundingClientRect(); const d = dr.getBoundingClientRect();
    const overlapX = c.left < d.right && d.left < c.right;
    if (overlapX && d.top > c.top) card.style.maxHeight = `${Math.max(180, d.top - c.top - 10)}px`;
  }

  // ------------------------------------------------------------- photos & newspapers
  async _photos() {
    if (!this.photoData) {
      try { this.photoData = (await (await fetch(`/data/photos.json?v=${__BUILD__}`)).json()).items; } catch { this.photoData = []; }
    }
    return this.photoData;
  }

  _near(p, it) {
    if (it.anchor === p.id) return true;
    if (it.lon == null) return false;
    return Math.hypot((it.lat - p.lat) * 111320, (it.lon - p.lon) * 111320 * Math.cos(p.lat * Math.PI / 180)) < 1800;
  }

  async openGallery(p) {
    await this._photos();
    this.galPoi = p;
    this.galF = p ? 'here' : (this.galF === 'here' ? 'all' : this.galF || 'all');
    $('galTitle').textContent = p ? `Photos · ${p.name}` : 'Photos & newspapers';
    $('galFilter').querySelector('[data-f="here"]').classList.toggle('hidden', !p);
    this._renderGallery();
    this.openSheet('sheetGallery');
  }

  _renderGallery() {
    const all = this.photoData || [];
    const f = this.galF || 'all'; const p = this.galPoi;
    $('galFilter').querySelectorAll('button').forEach((b) => b.classList.toggle('on', b.dataset.f === f));
    let list = all;
    if (f === 'old') list = all.filter((i) => i.year && i.year < 1970);
    if (f === 'news') list = all.filter((i) => i.src === 'newspaper');
    if (f === 'here' && p) list = all.filter((i) => this._near(p, i));
    if (f === 'all') list = [...all.filter((i) => i.year && i.year < 1970), ...all.filter((i) => !(i.year && i.year < 1970)).reverse()];
    this.galList = list;
    const g = $('galGrid'); g.innerHTML = '';
    if (!list.length) { g.innerHTML = '<p class="fine">No openly licensed photos found for this yet.</p>'; return; }
    list.slice(0, 400).forEach((it, i) => {
      const b = document.createElement('button');
      const im = document.createElement('img'); im.loading = 'lazy'; im.decoding = 'async'; im.alt = it.title; im.src = it.thumb;
      im.referrerPolicy = 'no-referrer';
      im.onload = () => im.classList.add('ld'); im.onerror = () => { b.remove(); };
      b.appendChild(im);
      if (it.year) { const y = document.createElement('span'); y.className = 'y'; y.textContent = it.year; b.appendChild(y); }
      if (it.src === 'newspaper') { const n = document.createElement('span'); n.className = 'np'; n.textContent = 'NEWS'; b.appendChild(n); }
      b.addEventListener('click', () => this._lb(i));
      g.appendChild(b);
    });
  }

  _lb(i) {
    const list = this.galList || []; if (!list.length) return;
    this.lbIdx = (i + list.length) % list.length;
    const it = list[this.lbIdx];
    $('lbImg').src = it.src === 'newspaper' ? it.full : it.thumb; $('lbImg').alt = it.title;
    $('lbTitle').textContent = it.title;
    $('lbMeta').textContent = `${it.date || 'Date unknown'} · ${it.credit} · ${it.lic}`;
    $('lbDesc').textContent = it.src === 'newspaper' ? `Machine-read text (may contain errors): …${it.desc}…` : it.desc;
    $('lbSrc').href = it.page || it.full;
    const canMap = it.lon != null;
    $('lbMap').classList.toggle('hidden', !canMap);
    $('lbMap').onclick = () => { $('lightbox').classList.add('hidden'); this.closeSheets(); this.app.flyToLonLat(it.lon, it.lat); };
    $('lightbox').classList.remove('hidden');
  }

  hideCard() { $('card').classList.add('hidden'); $('askIn').blur(); }

  // ------------------------------------------------------------- ask about this place
  _askFor(p) {
    this.askPoi = p; this.askHist = [];
    $('askLog').innerHTML = '';
    $('askIn').value = '';
    $('askIn').placeholder = `Ask about ${p.name}…`;
    const sg = $('askSugg'); sg.innerHTML = '';
    const qs = p.id === 'nat-removal' ? ['What did the 1835 treaty do?', 'Where is the Caddo Nation today?'] : p.kind === 'native' ? ['What did people eat here?', 'How do we know this?', 'What happened to them?']
      : p.kind === 'geology' ? ['How did this form?', 'How old is it?', 'Where can I see it?']
      : p.era ? ['What happened here?', 'What is left today?', 'Who lived here?'] : ['What is this place?', 'What was here before the lake?'];
    for (const q of qs) {
      const b = document.createElement('button'); b.className = 'chip'; b.type = 'button'; b.textContent = q;
      b.onclick = () => { $('askIn').value = q; this._ask(); sg.innerHTML = ''; };
      sg.appendChild(b);
    }
    if (this._askBound) return;
    this._askBound = true;
    $('askForm').addEventListener('submit', (e) => { e.preventDefault(); this._ask(); });
    $('askIn').addEventListener('keydown', (e) => e.stopPropagation());
  }

  async _ask() {
    const q = $('askIn').value.trim();
    const p = this.askPoi;
    if (!q || this.asking) return;
    this.asking = true;
    $('askIn').value = '';
    const log = $('askLog');
    const add = (cls, text) => { const d = document.createElement('div'); d.className = `m ${cls}`; d.textContent = text; log.appendChild(d); d.scrollIntoView({ block: 'nearest' }); return d; };
    add('u', q);
    const w = add('a wait', 'Looking through the sources…');
    try {
      const ctl = new AbortController(); const tm = setTimeout(() => ctl.abort(), 32000);
      const r = await fetch('/api/ask', { method: 'POST', signal: ctl.signal, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id: p?.id, q, history: this.askHist }) });
      clearTimeout(tm);
      const j = await r.json();
      w.classList.remove('wait');
      w.textContent = j.answer || j.error || 'No answer.';
      const note = document.createElement('small');
      note.textContent = j.offline ? (j.note || 'AI offline; showing the map’s notes.') : 'AI answer from this map’s cited sources. Check the sources before relying on it.';
      w.appendChild(note);
      if (!j.offline) this.askHist.push({ role: 'user', content: q }, { role: 'assistant', content: j.answer });
    } catch {
      w.classList.remove('wait'); w.textContent = 'Could not reach the guide. Check your connection.';
    }
    this.asking = false;
  }

  // ------------------------------------------------------------- drain readouts
  setHypsometry(h) {
    this.hyp = h;
    this.fullVol = this.volAt(LAKE.fullPoolFt);
    this.fullArea = this.areaAt(LAKE.fullPoolFt);
    this.drawChart();
  }

  _interp(arr, ft) {
    const L = this.hyp.levels_ft;
    if (ft <= L[0]) return arr[0];
    if (ft >= L[L.length - 1]) return arr[arr.length - 1];
    const i = Math.floor(ft - L[0]);
    const t = ft - L[0] - i;
    return arr[i] * (1 - t) + arr[i + 1] * t;
  }

  volAt(ft) { return this._interp(this.hyp.volume_acft, ft); }
  areaAt(ft) { return this._interp(this.hyp.area_acres, ft); }

  drawChart() {
    const h = this.hyp;
    const svg = $('chart');
    const L = h.levels_ft; const V = h.volume_acft;
    const vmax = V[V.length - 1];
    const x = (ft) => ((ft - 385) / (592 - 385)) * 300;
    const y = (v) => 86 - (v / vmax) * 80;
    let d = `M ${x(Math.max(385, L[0]))} 86`;
    for (let i = 0; i < L.length; i++) if (L[i] >= 385) d += ` L ${x(L[i]).toFixed(1)} ${y(V[i]).toFixed(1)}`;
    const dLine = d.replace(/^M [\d.]+ 86/, `M ${x(385)} ${y(this.volAt(385)).toFixed(1)}`);
    d += ` L 300 86 Z`;
    svg.innerHTML = `
      <defs><linearGradient id="gv" x1="0" x2="0" y1="0" y2="1"><stop offset="0" stop-color="#4fd1c5" stop-opacity="0.55"/><stop offset="1" stop-color="#4fd1c5" stop-opacity="0.05"/></linearGradient></defs>
      <path d="${d}" fill="url(#gv)"/>
      <path d="${dLine}" fill="none" stroke="#4fd1c5" stroke-width="1.5" vector-effect="non-scaling-stroke"/>
      <line id="chartCur" x1="0" x2="0" y1="0" y2="90" stroke="#f6b04a" stroke-width="1.5" vector-effect="non-scaling-stroke"/>
      <circle id="chartDot" r="3.2" fill="#f6b04a"/>
      <text x="4" y="11" font-size="9" fill="#9fb0bc">storage (acre-ft) vs. water level</text>`;
    this._chartX = x; this._chartY = y;
  }

  updateLevel(ft, playing, simDays) {
    if (!this.hyp) return;
    $('lvlFt').textContent = ft.toFixed(1);
    const lvl = $('level');
    if (document.activeElement !== lvl) lvl.value = ft.toFixed(1);
    const vol = this.volAt(ft); const area = this.areaAt(ft);
    const pct = (vol / this.fullVol) * 100;
    $('stVol').textContent = fmtM(vol);
    $('stPct').textContent = `${pct < 10 ? pct.toFixed(1) : Math.round(pct)}%`;
    $('stArea').textContent = fmt(area);
    $('stDry').textContent = fmt(Math.max(0, this.fullArea - area));
    const d = ft - LAKE.fullPoolFt;
    const sub = $('lvlSub');
    const today = this.app.today?.ft;
    if (Math.abs(d) < 0.15) { sub.textContent = 'Full pool'; sub.classList.remove('warn'); }
    else if (today != null && !playing && Math.abs(ft - today) < 0.15) { sub.textContent = `Today's real level · ${(-d).toFixed(1)} ft ${d < 0 ? 'below' : 'above'} full pool`; sub.classList.remove('warn'); }
    else if (d > 0) { sub.textContent = `${d.toFixed(1)} ft above full pool — flood storage`; sub.classList.add('warn'); }
    else {
      sub.textContent = `${(-d).toFixed(1)} ft down · ${fmtM(this.fullVol - vol)} acre-ft drained${simDays > 0.05 ? ` · day ${simDays.toFixed(0)}` : ''}`;
      sub.classList.add('warn');
    }
    $('btnPlay').classList.toggle('playing', playing);
    $('playIco').textContent = playing ? '❚❚' : '▼';
    if (this._chartX) {
      const cx = this._chartX(ft);
      const c = $('chartCur'); const dot = $('chartDot');
      if (c) { c.setAttribute('x1', cx); c.setAttribute('x2', cx); dot.setAttribute('cx', cx); dot.setAttribute('cy', this._chartY(vol)); }
    }
    // milestones when crossing
    for (const m of MILESTONES) {
      if ((this.lastMilestoneFt > m.ft && ft <= m.ft) || (this.lastMilestoneFt < m.ft && ft >= m.ft)) {
        this.toast(m.text, 4200);
        $('fact').textContent = m.text;
      }
    }
    this.lastMilestoneFt = ft;
  }

  setFact(text) { $('fact').textContent = text; }

  setLock(name, onRelease) {
    let el = $('lockChip');
    if (!name) { if (el) el.classList.add('hidden'); return; }
    if (!el) {
      el = document.createElement('button');
      el.id = 'lockChip'; el.className = 'chip lockchip glass';
      $('ui').appendChild(el);
    }
    el.textContent = `◎ Framing ${name} — tap to release`;
    el.classList.remove('hidden');
    el.onclick = () => { onRelease && onRelease(); el.classList.add('hidden'); };
    this.hint('Sticks now orbit and dolly around it', 2200);
  }

  setToday(info, onClick) {
    const b = $('btnToday');
    $('todayLbl').textContent = `Today ${info.ft.toFixed(1)} ft`;
    b.classList.remove('hidden');
    b.onclick = (e) => { e.stopPropagation(); onClick(); };
    // a tick on the slider for the real level
    const s = document.createElement('span');
    s.style.left = `${((info.ft - 385) / (592 - 385)) * 100}%`;
    s.className = 'today-tick';
    s.title = `Today ${info.ft.toFixed(1)} ft`;
    $('ticks').appendChild(s);
  }

  setSpeedLabel(t) { $('speedLbl').textContent = t; }

  // ------------------------------------------------------------- labels in 3D
  updateLabels(camera, heightFn, toY, levelM, frame) {
    if (!this.showLabels) return;
    const w = window.innerWidth; const h = window.innerHeight;
    const v = new THREE.Vector3();
    const camPos = camera.position;
    const placed = [];
    // sort near first
    for (const L of this.labels) {
      const p = L.p;
      const gy = toY(p.ground);
      v.set(p.x, gy, p.z);
      const dist = v.distanceTo(camPos);
      L.dist = dist;
    }
    if (!this._uiRectsT || frame - this._uiRectsT > 10) {
      this._uiRectsT = frame;
      this._uiRects = ['card', 'search'].map((id) => document.getElementById(id)).concat([document.querySelector('.drain'), document.querySelector('.modes')])
        .filter((el) => el && !el.classList.contains('hidden') && el.offsetParent !== null).map((el) => el.getBoundingClientRect());
    }
    const PRIO = { dam: 2.2, town: 1.8, history: 1.6, native: 1.6, geology: 1.5, landmark: 1.4, museum: 1.3, feature: 1.4, park: 1.1, trail: 1.0, overlook: 1.0, river: 1.0, marina: 0.8, recreation: 0.65, bridge: 0.5 };
    const sel = this.app.selected;
    const order = [...this.labels].sort((a, b) => (a.p === sel ? -1 : b.p === sel ? 1 : a.dist / (PRIO[a.p.kind] || 1) - b.dist / (PRIO[b.p.kind] || 1)));
    for (const L of order) {
      const p = L.p;
      const under = p.depthFullFt !== null && p.ground < levelM && (p.kind === 'history' || p.kind === 'feature');
      const maxD = p.kind === 'recreation' || p.kind === 'bridge' ? 16000 : 45000;
      const gy = toY(p.ground);
      v.set(p.x, gy + 2, p.z).project(camera);
      // undated start: settler-era places begin ~1800 if they have an end date, otherwise count as present day
      const e0 = p.era?.from ?? (p.era?.to ? 1800 : 1952); const e1 = p.era?.to ?? 1e12;
      const eraHide = this.era && (e1 < this.era[0] || e0 > this.era[1]);
      if (((this.kindOff && this.kindOff.has(p.kind)) || eraHide) && p !== sel) { L.el.style.display = 'none'; L.vis = false; continue; }
      let show = v.z < 1 && v.z > -1 && Math.abs(v.x) < 1.1 && Math.abs(v.y) < 1.1 && L.dist < maxD && L.dist > 3;
      if (camera.reversedDepth) show = v.z > 0 && v.z < 1 && Math.abs(v.x) < 1.1 && Math.abs(v.y) < 1.1 && L.dist < maxD && L.dist > 3;
      let sx = 0; let sy = 0;
      if (show) {
        sx = (v.x * 0.5 + 0.5) * w; sy = (-v.y * 0.5 + 0.5) * h;
        // occlusion by terrain (checked every few frames)
        if ((frame + L.p.x) % 6 < 1) {
          L.occ = false;
          const a = camPos; const b = new THREE.Vector3(p.x, gy + 3, p.z);
          for (let i = 1; i < 14; i++) {
            const t = i / 14;
            const x = a.x + (b.x - a.x) * t; const z = a.z + (b.z - a.z) * t; const y = a.y + (b.y - a.y) * t;
            const hh = heightFn(x, z);
            if (hh !== null && toY(hh) > y + 2) { L.occ = true; break; }
          }
        }
        if (L.occ) show = false;
        // declutter
        L.w = L.mw || Math.min(280, 16 + 6.9 * (p.name.length + (under ? 15 : 0)));
        // keep labels on screen and off the panels
        if (sx - L.w / 2 < 4 || sx + L.w / 2 > w - 4) show = false;
        for (const r of this._uiRects || []) { if (sx + L.w / 2 > r.left && sx - L.w / 2 < r.right && sy > r.top - 4 && sy - 24 < r.bottom) { show = false; break; } }
        for (const q of placed) { if (Math.abs(q[0] - sx) < (q[2] + L.w) / 2 + 6 && Math.abs(q[1] - sy) < 24) { show = false; break; } }
      }
      L.sx = sx; L.sy = sy; L.vis = show;
      if (show) {
        placed.push([sx, sy, L.w || 90]);
        L.el.style.display = '';
        L.el.style.transform = `translate(${sx.toFixed(1)}px, ${sy.toFixed(1)}px) translate(-50%, -100%)`;
        const t = L.el.querySelector('.t');
        const underFt = p.depthDocFt ? p.depthDocFt - (LAKE.fullPoolFt - levelM / FT) : (levelM - p.ground) / FT;
        const txt = under ? `${p.name} · ${p.depthDocFt ? '' : '≈'}${Math.round(underFt)} ft under` : p.name;
        if (t.textContent !== txt) { t.textContent = txt; L.mw = 0; }
        if (!L.mw) L.mw = t.offsetWidth + 8;
      } else L.el.style.display = 'none';
    }
  }

  /** Label under a tap (labels don't capture pointer events, so drags pass through). */
  labelAt(x, y) {
    if (!this.showLabels) return null;
    let best = null; let bd = 34;
    for (const L of this.labels) {
      if (!L.vis) continue;
      // the anchor dot sits at (sx, sy); the text is ~20 px above it
      const d = Math.min(Math.hypot(L.sx - x, L.sy - y), Math.hypot(L.sx - x, L.sy - 24 - y) * 1.2);
      if (d < bd) { bd = d; best = L.p; }
    }
    return best;
  }

  probe(screenX, screenY, info) {
    const el = $('probe');
    el.innerHTML = info;
    el.style.left = `${screenX}px`; el.style.top = `${screenY}px`;
    el.classList.remove('hidden');
    clearTimeout(this.probeT);
    this.probeT = setTimeout(() => el.classList.add('hidden'), 6000);
  }

  setCompass(heading) {
    $('needle').style.transform = `rotate(${(-heading * 180) / Math.PI}deg)`;
  }

  setFps(text) { $('fps').textContent = text; }

  setTimeLabels(hourText, sunrise, sunset, monthText) {
    $('timeLbl').textContent = hourText;
    $('sunrise').textContent = `☀ ${sunrise}`;
    $('sunset').textContent = `${sunset} ☾`;
    $('monthLbl').textContent = monthText;
  }

  setTours(tours, onPick) {
    const list = $('tourList');
    list.innerHTML = '';
    for (const t of tours) {
      const b = document.createElement('button');
      b.innerHTML = `<b></b><span></span>`;
      b.querySelector('b').textContent = t.name;
      b.querySelector('span').textContent = t.desc;
      b.addEventListener('click', () => { this.closeSheets(); onPick(t); });
      list.appendChild(b);
    }
  }

  setAbout(html) { $('about').innerHTML = html; }

  coordsLine(x, z) {
    const [lon, lat] = worldToLonLat(x, z);
    return formatLatLon(lon, lat);
  }
}

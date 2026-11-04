import { worldToLonLat, formatLatLon } from '../geo.js';
import { moonPhase, solunar } from './solunar.js';

const FT = 0.3048;
const LIDAR_WATER_M = 173.64;   // lake surface when the 3DEP lidar was flown: ground above this was measured
const $ = (id) => document.getElementById(id);
const fmtT = (d) => d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });

/** Live fishing conditions + an AI guide that scouts the spot under the crosshair. */
export class FishPanel {
  constructor(app) {
    this.app = app; this.cond = null; this.hist = [];
    $('btnFish').addEventListener('click', () => this.open());
    $('tgAttractors2').addEventListener('change', (e) => { app.setAttractors(e.target.checked); const t = $('tgAttractors'); if (t) t.checked = e.target.checked; });
    $('fishForm').addEventListener('submit', (e) => { e.preventDefault(); this.ask(); });
    $('fishIn').addEventListener('keydown', (e) => e.stopPropagation());
    const sg = $('fishSugg');
    for (const q of ['Where should I fish around here today?', 'What depth should I target right now?', 'How does today’s wind set up this spot?']) {
      const b = document.createElement('button'); b.type = 'button'; b.className = 'chip'; b.textContent = q;
      b.onclick = () => { $('fishIn').value = q; this.ask(); };
      sg.appendChild(b);
    }
    // the crosshair and spot readout follow the map while the panel is open
    new MutationObserver(() => this._visible()).observe($('sheetFish'), { attributes: true, attributeFilter: ['class'] });
  }

  _visible() {
    const open = !$('sheetFish').classList.contains('hidden');
    $('crosshair').classList.toggle('hidden', !open);
    clearInterval(this.timer);
    if (open) { this.timer = setInterval(() => this.renderSpot(), 400); this.renderSpot(); }
  }

  async open() {
    this.app.ui.openSheet('sheetFish');
    if (!this.cond || Date.now() - this.condAt > 10 * 6e4) {
      try { this.cond = await (await fetch('/api/conditions')).json(); this.condAt = Date.now(); } catch { this.cond = null; }
    }
    this.renderConditions();
  }

  renderConditions() {
    const c = this.cond; const g = $('fishGrid');
    if (!c) { g.innerHTML = '<p class="fine">Live conditions are unavailable right now.</p>'; return; }
    const w = c.weather?.west || c.weather?.east; const e = c.weather?.east;
    const sgn = (v, u) => (v == null ? '' : `${v > 0 ? '+' : ''}${v}${u}`);
    const card = (label, big, small) => `<div class="fc"><span>${label}</span><b>${big}</b>${small ? `<small>${small}</small>` : ''}</div>`;
    const press = w?.pressureInHg ?? e?.pressureInHg; const trend = w?.pressureTrend3h ?? e?.pressureTrend3h;
    g.innerHTML = [
      card('Lake level', c.lake ? `${c.lake.ft.toFixed(2)} ft` : '—', c.lake ? `${sgn(c.lake.change24, ' ft')} in 24 h · ${(c.lake.ft - 578).toFixed(1)} ft vs full pool` : ''),
      card('River inflow', c.inflow ? `${Math.round(c.inflow.cfs)} cfs` : '—', c.inflow ? `${sgn(Math.round(c.inflow.change24), ' cfs')} in 24 h (near Mount Ida)` : ''),
      card('Wind', w?.windMph != null ? `${Math.round(w.windMph)} mph` : '—', w ? `${w.windFrom ? `from ${w.windFrom}` : 'direction n/a'}${w.gustMph ? ` · gusts ${Math.round(w.gustMph)}` : ''}` : ''),
      card('Air', w?.tempF != null ? `${Math.round(w.tempF)}°F` : '—', w ? `${w.name}${w.humidity != null ? ` · ${w.humidity}% RH` : ''}` : ''),
      card('Pressure', press != null ? `${press.toFixed(2)} inHg` : '—', trend != null ? `${trend > 0.02 ? 'rising' : trend < -0.02 ? 'falling' : 'steady'} (${sgn(trend, '')} in 3 h)` : 'trend n/a'),
      (() => { const wt = c.waterTemp || {}; const est = wt.estimate; const lv = wt.nearestLive;
        return card('Water temp (est.)', est ? `≈${est.estimateF}°F` : '—', `${est ? `model ±${est.rangeF}°F` : 'estimate unavailable'}`); })(),
    ].join('');
    const fc = $('fishFc');
    fc.innerHTML = (c.forecast || []).map((p) => `<div>${new Date(p.t).toLocaleTimeString([], { hour: 'numeric' })}<br/><b>${p.tempF}°</b><br/>${(p.wind || '').replace(' mph', '')}${p.windFrom ? ` ${p.windFrom}` : ''}${p.rain ? `<br/>${p.rain}%☂` : ''}</div>`).join('');
    const now = new Date(); const ph = moonPhase(now);
    const wins = solunar(now, 34.60, -93.35);
    $('fishMoon').innerHTML = `<b>${ph.name}</b>, ${Math.round(ph.frac * 100)}% lit · solunar windows today:<br/>` +
      (wins.map((p) => `<span class="win ${now >= p.from && now <= p.to ? 'now' : ''}">${p.kind === 'major' ? 'Major' : 'Minor'} ${fmtT(p.from)}–${fmtT(p.to)}</span>`).join('') || 'none') +
      `<div class="fine">Solunar windows are computed from the moon's position; how much they matter is debated among anglers.</div>`;
  }

  /** Facts about the spot under the crosshair, from the terrain data and the AGFC attractor list. */
  spot() {
    const a = this.app; const t = a.controls.target;
    const x = t.x, z = t.z;
    const g = a.terrain.heightAt(x, z);
    if (g === null) return null;
    const levelM = a.sim.levelFt * FT;
    const depthFt = (levelM - g) / FT;
    let steep = 0;
    for (let k = 0; k < 8; k++) {
      const ang = k * Math.PI / 4; const h = a.terrain.heightAt(x + Math.cos(ang) * 60, z + Math.sin(ang) * 60);
      if (h !== null) steep = Math.max(steep, Math.abs(h - g) / FT);
    }
    const att = (a.poiData?.attractors || []).map(([ax, az, ag, name]) => ({ d: Math.hypot(ax - x, az - z), depth: (levelM - ag) / FT, name }))
      .filter((q) => q.d < 600).sort((p, q) => p.d - q.d).slice(0, 5);
    const [lon, lat] = worldToLonLat(x, z);
    return {
      lat: +lat.toFixed(5), lon: +lon.toFixed(5), water: depthFt > 0.5,
      depthFt: Math.round(depthFt), groundFt: Math.round(g / FT),
      measured: g >= LIDAR_WATER_M, dropFt60m: Math.round(steep),
      attractors: att.map((q) => ({ m: Math.round(q.d), depthFt: Math.round(q.depth), name: q.name })),
      levelFt: +a.sim.levelFt.toFixed(1),
    };
  }

  async report() {
    this._repT = null;
    const s = this.spot(); if (!s || !this.cond) return;
    const key = `${s.lat.toFixed(3)},${s.lon.toFixed(3)},${s.levelFt}`;
    if (key === this._repKey) return; this._repKey = key;
    const c = this.cond;
    const cond = { lake: c.lake, weather: c.weather, waterTemp: c.waterTemp, solunar: solunar(new Date(), 34.6, -93.35).map((p) => `${p.kind} ${fmtT(p.from)}-${fmtT(p.to)}`) };
    try {
      const j = await (await fetch('/api/ask', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ mode: 'fish', q: '__report__', spot: s, cond }) })).json();
      if (key !== this._repKey) return;
      $('fishReport').innerHTML = (j.report || []).map((t) => `<li>${t.replace(/&/g, '&amp;').replace(/</g, '&lt;')}</li>`).join('');
    } catch { /* offline */ }
  }

  renderSpot() {
    const s = this.spot(); const el = $('fishSpot');
    // refresh the scout report once the crosshair has settled on a new spot
    const k = s ? `${s.lat.toFixed(3)},${s.lon.toFixed(3)},${s.levelFt}` : '';
    if (k !== this._lastSpot) { this._lastSpot = k; clearTimeout(this._repT); this._repT = setTimeout(() => this.report(), 650); }
    else if (this.cond && k !== this._repKey && !this._repT) this.report();
    if (!s) { el.textContent = 'Move the map over the lake.'; return; }
    this.cur = s;
    const src = s.measured ? 'measured by lidar' : 'modelled bed';
    el.innerHTML = `<b>${formatLatLon(s.lon, s.lat)}</b><br/>` + (s.water
      ? `Depth here ${s.measured ? '' : '≈'}${s.depthFt} ft at today's ${s.levelFt} ft level (${src}) · bottom changes up to ${s.dropFt60m} ft within 60 m`
      : `Dry ground at today's level (${s.groundFt} ft)`) +
      (s.attractors.length ? `<br/>${s.attractors.length} AGFC brush pile${s.attractors.length > 1 ? 's' : ''} within 600 m; nearest ${s.attractors[0].m} m away, ≈${s.attractors[0].depthFt} ft deep` : '<br/>No AGFC brush piles within 600 m');
  }

  async ask() {
    const q = $('fishIn').value.trim(); if (!q || this.busy) return;
    this.busy = true; $('fishIn').value = '';
    const log = $('fishLog');
    const add = (cls, t) => { const d = document.createElement('div'); d.className = `m ${cls}`; d.textContent = t; log.appendChild(d); d.scrollIntoView({ block: 'nearest', behavior: 'smooth' }); return d; };
    add('u', q); const w = add('a', 'Reading the conditions and the bottom…');
    try {
      const ctl = new AbortController(); const tm = setTimeout(() => ctl.abort(), 32000);
      const c = this.cond || {};
      const cond = { lake: c.lake, inflow: c.inflow, weather: c.weather, waterTemp: c.waterTemp, forecast: (c.forecast || []).slice(0, 8), moon: moonPhase(new Date()), solunar: solunar(new Date(), 34.6, -93.35).map((p) => `${p.kind} ${fmtT(p.from)}-${fmtT(p.to)}`), month: new Date().toLocaleString('en-US', { month: 'long' }) };
      const r = await fetch('/api/ask', { method: 'POST', signal: ctl.signal, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ mode: 'fish', q, spot: this.spot(), cond, history: this.hist }) });
      clearTimeout(tm);
      const j = await r.json();
      w.textContent = j.answer || 'No answer.';
      const n = document.createElement('small');
      n.textContent = j.offline ? (j.note || 'The AI guide is offline; showing the spot data.') : 'AI guide using live conditions and this spot’s data. Your own knowledge of the water comes first.';
      w.appendChild(n);
      if (!j.offline) this.hist.push({ role: 'user', content: q }, { role: 'assistant', content: j.answer });
    } catch { w.textContent = 'Could not reach the guide. Check your connection.'; }
    this.busy = false;
  }
}

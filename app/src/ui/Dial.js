// One-thumb "time scrub" dial: outer ring = water level, inner ring = time of day,
// long-press the centre to step through the seasons, tap the centre to close.
const NS = 'http://www.w3.org/2000/svg';
const LV0 = 385; const LV1 = 592;
const ARC0 = -150; const ARC1 = 150; // degrees from 12 o'clock

function polar(cx, cy, r, deg) { const a = (deg - 90) * Math.PI / 180; return [cx + r * Math.cos(a), cy + r * Math.sin(a)]; }
function arcPath(cx, cy, r, d0, d1) {
  const [x0, y0] = polar(cx, cy, r, d0); const [x1, y1] = polar(cx, cy, r, d1);
  return `M ${x0} ${y0} A ${r} ${r} 0 ${d1 - d0 > 180 ? 1 : 0} 1 ${x1} ${y1}`;
}

export class Dial {
  constructor(app) {
    this.app = app;
    const el = document.createElement('div');
    el.className = 'dial hidden';
    el.innerHTML = `<svg viewBox="0 0 260 260" width="260" height="260">
      <defs><linearGradient id="dg" x1="0" x2="1"><stop offset="0" stop-color="#8b6b48"/><stop offset="0.75" stop-color="#2a7f8c"/><stop offset="1" stop-color="#9fe7ff"/></linearGradient>
      <linearGradient id="hg" x1="0" x2="1" y1="0" y2="1"><stop offset="0" stop-color="#ffb35a"/><stop offset="0.5" stop-color="#8ec5ff"/><stop offset="1" stop-color="#1d2c55"/></linearGradient></defs>
      <circle cx="130" cy="130" r="126" fill="rgba(12,18,24,0.72)" stroke="rgba(255,255,255,0.1)"/>
      <path d="${arcPath(130, 130, 108, ARC0, ARC1)}" stroke="url(#dg)" stroke-width="20" fill="none" stroke-linecap="round"/>
      <circle cx="130" cy="130" r="72" fill="none" stroke="url(#hg)" stroke-width="16" opacity="0.85"/>
      <circle class="kL" r="13" fill="#fff" stroke="#0e1a22" stroke-width="3"/>
      <circle class="kH" r="10" fill="#ffd27a" stroke="#0e1a22" stroke-width="3"/>
      <text class="t1" x="130" y="124" text-anchor="middle" font-size="26" font-weight="750" fill="#eef3f6"></text>
      <text class="t2" x="130" y="146" text-anchor="middle" font-size="12" fill="#9fb0bc"></text>
      <text class="t3" x="130" y="164" text-anchor="middle" font-size="11" fill="#7fe6db"></text>
    </svg>`;
    document.getElementById('ui').appendChild(el);
    this.el = el; this.svg = el.querySelector('svg');
    this.kL = el.querySelector('.kL'); this.kH = el.querySelector('.kH');
    this.t1 = el.querySelector('.t1'); this.t2 = el.querySelector('.t2'); this.t3 = el.querySelector('.t3');
    this.drag = null;
    this.svg.addEventListener('pointerdown', (e) => this.down(e));
    this.svg.addEventListener('pointermove', (e) => this.move(e));
    this.svg.addEventListener('pointerup', (e) => this.up(e));
    this.svg.addEventListener('pointercancel', (e) => this.up(e));
  }

  toggle() { this.el.classList.toggle('hidden'); this.refresh(); }

  local(e) {
    const r = this.svg.getBoundingClientRect();
    const x = (e.clientX - r.left) / r.width * 260 - 130; const y = (e.clientY - r.top) / r.height * 260 - 130;
    let deg = Math.atan2(x, -y) * 180 / Math.PI;
    return { d: Math.hypot(x, y), deg };
  }

  down(e) {
    e.preventDefault(); e.stopPropagation();
    this.svg.setPointerCapture(e.pointerId);
    const p = this.local(e);
    if (p.d > 92) this.drag = 'level';
    else if (p.d > 52) this.drag = 'hour';
    else {
      this.drag = 'center';
      this.pressT = setTimeout(() => { this.drag = null; this.season(); }, 550);
      return;
    }
    this.move(e);
  }

  move(e) {
    if (!this.drag || this.drag === 'center') return;
    e.preventDefault();
    const p = this.local(e);
    if (this.drag === 'level') {
      const deg = Math.max(ARC0, Math.min(ARC1, p.deg));
      this.app.setLevel(LV0 + (deg - ARC0) / (ARC1 - ARC0) * (LV1 - LV0), true);
    } else {
      const h = ((p.deg + 360) % 360) / 15;
      this.app.setHour(h);
    }
    this.refresh();
  }

  up() {
    if (this.drag === 'center') { clearTimeout(this.pressT); this.toggle(); }
    this.drag = null;
  }

  season() {
    const m = (this.app.timeState.month + 3) % 12;
    this.app.setMonth(m);
    this.app.ui.toast(['Winter', 'Winter', 'Spring', 'Spring', 'Spring', 'Summer', 'Summer', 'Summer', 'Autumn', 'Autumn', 'Autumn', 'Winter'][m], 1500);
    if (navigator.vibrate) navigator.vibrate(20);
    this.refresh();
  }

  refresh() {
    if (this.el.classList.contains('hidden')) return;
    const lv = this.app.sim.levelFt;
    const dl = ARC0 + (lv - LV0) / (LV1 - LV0) * (ARC1 - ARC0);
    const [lx, ly] = polar(130, 130, 108, dl); this.kL.setAttribute('cx', lx); this.kL.setAttribute('cy', ly);
    const h = this.app.timeState.hour;
    const [hx, hy] = polar(130, 130, 72, h * 15); this.kH.setAttribute('cx', hx); this.kH.setAttribute('cy', hy);
    this.t1.textContent = `${lv.toFixed(0)} ft`;
    const hh = Math.floor(h); const mm = Math.round((h - hh) * 60);
    this.t2.textContent = `${((hh + 11) % 12) + 1}:${String(mm).padStart(2, '0')} ${hh >= 12 ? 'pm' : 'am'}`;
    this.t3.textContent = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][this.app.timeState.month] + ' · hold to change';
  }
}

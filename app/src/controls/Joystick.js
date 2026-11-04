/** On-screen thumb stick for touch devices. value: {x, y} in [-1, 1] (y up = forward). */
export class Joystick {
  constructor(parent, side = 'left', label = '') {
    this.value = { x: 0, y: 0 };
    this.el = document.createElement('div');
    this.el.className = `joy joy-${side}`;
    this.el.innerHTML = `<div class="joy-ring"></div><div class="joy-knob"></div>${label ? `<span class="joy-label">${label}</span>` : ''}`;
    parent.appendChild(this.el);
    this.knob = this.el.querySelector('.joy-knob');
    this.active = null;
    const R = 46;
    const set = (e) => {
      const r = this.el.getBoundingClientRect();
      const cx = r.left + r.width / 2; const cy = r.top + r.height / 2;
      let dx = e.clientX - cx; let dy = e.clientY - cy;
      const l = Math.hypot(dx, dy);
      if (l > R) { dx *= R / l; dy *= R / l; }
      this.knob.style.transform = `translate(${dx}px, ${dy}px)`;
      this.value.x = dx / R; this.value.y = -dy / R;
    };
    this.el.addEventListener('pointerdown', (e) => {
      e.preventDefault(); e.stopPropagation();
      this.active = e.pointerId;
      this.el.setPointerCapture(e.pointerId);
      this.el.classList.add('on');
      set(e);
    });
    this.el.addEventListener('pointermove', (e) => { if (e.pointerId === this.active) { e.stopPropagation(); set(e); } });
    const end = (e) => {
      if (e.pointerId !== this.active) return;
      this.active = null;
      this.value.x = this.value.y = 0;
      this.knob.style.transform = '';
      this.el.classList.remove('on');
    };
    this.el.addEventListener('pointerup', end);
    this.el.addEventListener('pointercancel', end);
  }

  show(v) { this.el.style.display = v ? '' : 'none'; }
}

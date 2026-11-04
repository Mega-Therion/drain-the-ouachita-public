// Moon phase and solunar windows from a low-precision lunar ephemeris (about 0.3° / a few minutes),
// good enough for fishing timetables. Major periods: moon overhead / underfoot (±1 h).
// Minor periods: moonrise / moonset (±30 min).
const D2R = Math.PI / 180;

function jd(date) { return date.getTime() / 864e5 + 2440587.5; }

/** Moon right ascension/declination (radians) for a Date. */
function moonRaDec(date) {
  const d = jd(date) - 2451545.0;
  const L = (218.316 + 13.176396 * d) * D2R;          // mean longitude
  const M = (134.963 + 13.064993 * d) * D2R;          // mean anomaly
  const F = (93.272 + 13.229350 * d) * D2R;           // mean distance from node
  const lon = L + 6.289 * D2R * Math.sin(M);
  const lat = 5.128 * D2R * Math.sin(F);
  const e = 23.4397 * D2R;
  const ra = Math.atan2(Math.sin(lon) * Math.cos(e) - Math.tan(lat) * Math.sin(e), Math.cos(lon));
  const dec = Math.asin(Math.sin(lat) * Math.cos(e) + Math.cos(lat) * Math.sin(e) * Math.sin(lon));
  return { ra, dec };
}

function siderealRad(date, lonDeg) {
  const d = jd(date) - 2451545.0;
  return ((280.16 + 360.9856235 * d) * D2R) + lonDeg * D2R;
}

export function moonAltitude(date, lat, lon) {
  const { ra, dec } = moonRaDec(date);
  const H = siderealRad(date, lon) - ra;
  const phi = lat * D2R;
  return Math.asin(Math.sin(phi) * Math.sin(dec) + Math.cos(phi) * Math.cos(dec) * Math.cos(H)) / D2R;
}

/** Illuminated fraction and phase name. */
export function moonPhase(date) {
  const d = jd(date) - 2451545.0;
  const Ls = (280.46 + 0.9856474 * d) * D2R; const Ms = (357.528 + 0.9856003 * d) * D2R;
  const sunLon = Ls + (1.915 * Math.sin(Ms) + 0.020 * Math.sin(2 * Ms)) * D2R;
  const L = (218.316 + 13.176396 * d) * D2R; const M = (134.963 + 13.064993 * d) * D2R;
  const moonLon = L + 6.289 * D2R * Math.sin(M);
  let el = (moonLon - sunLon) % (2 * Math.PI); if (el < 0) el += 2 * Math.PI;
  const frac = (1 - Math.cos(el)) / 2;
  const age = el / (2 * Math.PI) * 29.53;
  const names = ['New moon', 'Waxing crescent', 'First quarter', 'Waxing gibbous', 'Full moon', 'Waning gibbous', 'Last quarter', 'Waning crescent'];
  return { frac, age, name: names[Math.round(el / (Math.PI / 4)) % 8] };
}

/** Solunar windows for the local day containing `date`. */
export function solunar(date, lat, lon) {
  const start = new Date(date); start.setHours(0, 0, 0, 0);
  const step = 6 * 6e4; const N = 24 * 60 / 6;
  const alt = []; for (let i = 0; i <= N; i++) alt.push(moonAltitude(new Date(start.getTime() + i * step), lat, lon));
  const out = [];
  for (let i = 1; i < N; i++) {
    const t = new Date(start.getTime() + i * step);
    if (alt[i] > alt[i - 1] && alt[i] >= alt[i + 1]) out.push({ kind: 'major', what: 'Moon overhead', t });
    if (alt[i] < alt[i - 1] && alt[i] <= alt[i + 1]) out.push({ kind: 'major', what: 'Moon underfoot', t });
    if (alt[i - 1] < -0.3 && alt[i] >= -0.3) out.push({ kind: 'minor', what: 'Moonrise', t });
    if (alt[i - 1] >= -0.3 && alt[i] < -0.3) out.push({ kind: 'minor', what: 'Moonset', t });
  }
  return out.sort((a, b) => a.t - b.t).map((p) => ({ ...p, from: new Date(p.t - (p.kind === 'major' ? 36e5 : 18e5)), to: new Date(p.t.getTime() + (p.kind === 'major' ? 36e5 : 18e5)) }));
}

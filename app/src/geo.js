import { R, ORIGIN_SHIFT, REGION, TIMEZONE } from './config.js';

export function tileSize(z) {
  return (2 * ORIGIN_SHIFT) / 2 ** z;
}

export function tileBoundsMerc(z, x, y) {
  const s = tileSize(z);
  const minx = -ORIGIN_SHIFT + x * s;
  const maxy = ORIGIN_SHIFT - y * s;
  return [minx, maxy - s, minx + s, maxy];
}

export function lonLatToMerc(lon, lat) {
  const x = (lon * Math.PI / 180) * R;
  const y = R * Math.log(Math.tan(Math.PI / 4 + (lat * Math.PI / 180) / 2));
  return [x, y];
}

export function mercToLonLat(x, y) {
  const lon = (x / R) * 180 / Math.PI;
  const lat = (2 * Math.atan(Math.exp(y / R)) - Math.PI / 2) * 180 / Math.PI;
  return [lon, lat];
}

const r0 = tileBoundsMerc(12, REGION.z12x[0], REGION.z12y[0]);
const r1 = tileBoundsMerc(12, REGION.z12x[1], REGION.z12y[1]);
export const REGION_MERC = [r0[0], r1[1], r1[2], r0[3]];
export const CENTER_MX = (REGION_MERC[0] + REGION_MERC[2]) / 2;
export const CENTER_MY = (REGION_MERC[1] + REGION_MERC[3]) / 2;
export const [LON0, LAT0] = mercToLonLat(CENTER_MX, CENTER_MY);
export const SCALE = Math.cos(LAT0 * Math.PI / 180);

export function mercToWorld(mx, my) {
  return [(mx - CENTER_MX) * SCALE, -(my - CENTER_MY) * SCALE];
}

export function worldToMerc(wx, wz) {
  return [wx / SCALE + CENTER_MX, -wz / SCALE + CENTER_MY];
}

export function lonLatToWorld(lon, lat) {
  const [mx, my] = lonLatToMerc(lon, lat);
  return mercToWorld(mx, my);
}

export function worldToLonLat(wx, wz) {
  const [mx, my] = worldToMerc(wx, wz);
  return mercToLonLat(mx, my);
}

/** World-space rectangle [x0, z0, x1, z1] (z0 = north edge) of an XYZ tile. */
export function tileWorldRect(z, x, y) {
  const [minx, miny, maxx, maxy] = tileBoundsMerc(z, x, y);
  const [x0, z0] = mercToWorld(minx, maxy);
  const [x1, z1] = mercToWorld(maxx, miny);
  return [x0, z0, x1, z1];
}

export function worldToTile(wx, wz, z) {
  const [mx, my] = worldToMerc(wx, wz);
  const s = tileSize(z);
  return [Math.floor((mx + ORIGIN_SHIFT) / s), Math.floor((ORIGIN_SHIFT - my) / s)];
}

export function formatLatLon(lon, lat) {
  const ns = lat >= 0 ? 'N' : 'S';
  const ew = lon >= 0 ? 'E' : 'W';
  return `${Math.abs(lat).toFixed(5)}° ${ns}, ${Math.abs(lon).toFixed(5)}° ${ew}`;
}

// ---------------------------------------------------------------- sun & moon
// Standard low-precision astronomical formulas (Meeus / Astronomy Answers).
const rad = Math.PI / 180;
const dayMs = 86400000;
const J1970 = 2440588;
const J2000 = 2451545;
const e = rad * 23.4397;

function toDays(date) { return date.valueOf() / dayMs - 0.5 + J1970 - J2000; }
function rightAscension(l, b) { return Math.atan2(Math.sin(l) * Math.cos(e) - Math.tan(b) * Math.sin(e), Math.cos(l)); }
function declination(l, b) { return Math.asin(Math.sin(b) * Math.cos(e) + Math.cos(b) * Math.sin(e) * Math.sin(l)); }
function azimuthOf(H, phi, dec) { return Math.atan2(Math.sin(H), Math.cos(H) * Math.sin(phi) - Math.tan(dec) * Math.cos(phi)); }
function altitudeOf(H, phi, dec) { return Math.asin(Math.sin(phi) * Math.sin(dec) + Math.cos(phi) * Math.cos(dec) * Math.cos(H)); }
function siderealTime(d, lw) { return rad * (280.16 + 360.9856235 * d) - lw; }
function solarMeanAnomaly(d) { return rad * (357.5291 + 0.98560028 * d); }
function eclipticLongitude(M) {
  const C = rad * (1.9148 * Math.sin(M) + 0.02 * Math.sin(2 * M) + 0.0003 * Math.sin(3 * M));
  return M + C + rad * 102.9372 + Math.PI;
}

/** Returns {azimuth, altitude} in radians; azimuth measured from south, positive west. */
export function sunPosition(date, lat, lon) {
  const lw = rad * -lon;
  const phi = rad * lat;
  const d = toDays(date);
  const M = solarMeanAnomaly(d);
  const L = eclipticLongitude(M);
  const dec = declination(L, 0);
  const ra = rightAscension(L, 0);
  const H = siderealTime(d, lw) - ra;
  return { azimuth: azimuthOf(H, phi, dec), altitude: altitudeOf(H, phi, dec) };
}

export function moonPosition(date, lat, lon) {
  const lw = rad * -lon;
  const phi = rad * lat;
  const d = toDays(date);
  const L = rad * (218.316 + 13.176396 * d);
  const M = rad * (134.963 + 13.064993 * d);
  const F = rad * (93.272 + 13.22935 * d);
  const l = L + rad * 6.289 * Math.sin(M);
  const b = rad * 5.128 * Math.sin(F);
  const ra = rightAscension(l, b);
  const dec = declination(l, b);
  const H = siderealTime(d, lw) - ra;
  let h = altitudeOf(H, phi, dec);
  h += rad * 0.017 / Math.tan(h + rad * 10.26 / (h + rad * 5.10));
  // illuminated fraction
  const s = sunPosition(date, lat, lon);
  const sd = d; const sM = solarMeanAnomaly(sd); const sL = eclipticLongitude(sM);
  const sdec = declination(sL, 0); const sra = rightAscension(sL, 0);
  const phiA = Math.acos(Math.sin(sdec) * Math.sin(dec) + Math.cos(sdec) * Math.cos(dec) * Math.cos(sra - ra));
  const inc = Math.atan2(149598000 * Math.sin(phiA), 385001 - 149598000 * Math.cos(phiA));
  const fraction = (1 + Math.cos(inc)) / 2;
  void s;
  return { azimuth: azimuthOf(H, phi, dec), altitude: h, fraction };
}

/** Convert astronomical az/alt to a world direction (x east, y up, z south). */
export function altAzToDir(azimuth, altitude, out) {
  // azimuth from south, positive toward west
  const cosA = Math.cos(altitude);
  out.set(-Math.sin(azimuth) * cosA, Math.sin(altitude), Math.cos(azimuth) * cosA);
  return out;
}

/** UTC offset (minutes) of America/Chicago at a given instant. */
export function tzOffsetMinutes(date) {
  try {
    const fmt = new Intl.DateTimeFormat('en-US', {
      timeZone: TIMEZONE, hour12: false, year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', second: '2-digit',
    });
    const p = Object.fromEntries(fmt.formatToParts(date).map((x) => [x.type, x.value]));
    const asUTC = Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour % 24, +p.minute, +p.second);
    return Math.round((asUTC - date.valueOf()) / 60000);
  } catch {
    return -360;
  }
}

/** Date for a local (Arkansas) wall-clock time on the given local calendar day. */
export function localDate(year, month, day, hours) {
  const guess = new Date(Date.UTC(year, month, day, 0, 0, 0) + hours * 3600000);
  const off = tzOffsetMinutes(guess);
  return new Date(guess.valueOf() - off * 60000);
}

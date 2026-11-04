// Live lake + weather conditions for fishing: one call, cached at the edge for 10 minutes.
// Sources (all free, no keys): USACE CWMS (pool level), USGS NWIS (Ouachita River inflow above the
// lake), NOAA National Weather Service (observations at Mount Ida and Hot Springs, hourly forecast).
// Lake water temperature is not published live by any of these, so it is reported as unavailable.

const UA = { 'User-Agent': 'drain-the-ouachita/1.0 (https://drain-the-ouachita.vercel.app)', Accept: 'application/geo+json, application/json' };
const CWMS = 'https://cwms-data.usace.army.mil/cwms-data/timeseries';

async function j(url, headers = UA, ms = 9000) {
  const ctl = new AbortController(); const t = setTimeout(() => ctl.abort(), ms);
  try { const r = await fetch(url, { headers, signal: ctl.signal }); if (!r.ok) throw new Error(`${r.status}`); return await r.json(); }
  finally { clearTimeout(t); }
}

const C = (k) => (k == null ? null : Math.round(k * 10) / 10);
const toF = (c) => (c == null ? null : C(c * 9 / 5 + 32));
const toMph = (kmh) => (kmh == null ? null : C(kmh * 0.621371));
const toInHg = (pa) => (pa == null ? null : Math.round(pa / 3386.389 * 100) / 100);
const COMPASS = ['N', 'NNE', 'NE', 'ENE', 'E', 'ESE', 'SE', 'SSE', 'S', 'SSW', 'SW', 'WSW', 'W', 'WNW', 'NW', 'NNW'];
const dir = (d) => (d == null ? null : COMPASS[Math.round(d / 22.5) % 16]);

async function lake() {
  const begin = new Date(Date.now() - 8 * 864e5).toISOString();
  const d = await j(`${CWMS}?office=MVK&name=Blakely.Elev.Inst.1Hour.0.DCP-rev&unit=EN&begin=${begin}`, { ...UA, Accept: 'application/json;version=2' });
  const v = (d.values || []).filter((x) => x[1] != null);
  if (!v.length) return null;
  const last = v[v.length - 1];
  const at = (h) => { const t = last[0] - h * 36e5; let best = v[0]; for (const x of v) if (Math.abs(x[0] - t) < Math.abs(best[0] - t)) best = x; return best[1]; };
  return { ft: C(last[1] * 100) / 100, time: new Date(last[0]).toISOString(), change24: C((last[1] - at(24)) * 100) / 100, change7d: C((last[1] - at(168)) * 100) / 100, source: 'USACE CWMS Blakely Mountain Dam' };
}

async function inflow() {
  const d = await j('https://waterservices.usgs.gov/nwis/iv/?format=json&sites=07356000&parameterCd=00060&period=P2D');
  const ts = d.value.timeSeries[0]; const v = ts.values[0].value;
  if (!v.length) return null;
  const last = v[v.length - 1]; const day = v.find((x) => Date.parse(x.dateTime) >= Date.parse(last.dateTime) - 864e5) || v[0];
  return { cfs: +last.value, change24: +last.value - +day.value, time: last.dateTime, source: 'USGS 07356000 Ouachita River near Mount Ida (inflow above the lake)' };
}

async function station(id) {
  const start = new Date(Date.now() - 4.5 * 36e5).toISOString().replace(/\.\d+Z$/, 'Z');
  const d = await j(`https://api.weather.gov/stations/${id}/observations?start=${start}`);
  const obs = (d.features || []).map((f) => f.properties).filter((p) => p.temperature);
  if (!obs.length) return null;
  const o = obs[0];
  const pr = (p) => p.barometricPressure?.value ?? p.seaLevelPressure?.value ?? null;
  // tendency per 3 hours, from the oldest usable reading at least ~1.75 h back (stations report 5–60 min apart)
  const older = [...obs].reverse().find((p) => pr(p) != null && Date.parse(o.timestamp) - Date.parse(p.timestamp) >= 1.75 * 36e5);
  const p0 = pr(o); const p1 = older ? pr(older) : null;
  const hrs = older ? (Date.parse(o.timestamp) - Date.parse(older.timestamp)) / 36e5 : 3;
  return {
    station: id, name: o.stationName || id, time: o.timestamp, text: o.textDescription,
    tempF: toF(o.temperature.value), windMph: toMph(o.windSpeed?.value), gustMph: toMph(o.windGust?.value), windFrom: dir(o.windDirection?.value),
    pressureInHg: toInHg(p0), pressureTrend3h: p0 != null && p1 != null ? Math.round((p0 - p1) / 3386.389 * (3 / hrs) * 100) / 100 : null,
    humidity: o.relativeHumidity?.value != null ? Math.round(o.relativeHumidity.value) : null, cloud: (o.cloudLayers || [])[0]?.amount || null,
  };
}

async function forecast() {
  const d = await j('https://api.weather.gov/gridpoints/LZK/45,66/forecast/hourly');
  return (d.properties?.periods || []).slice(0, 12).map((p) => ({
    t: p.startTime, tempF: p.temperature, wind: p.windSpeed, windFrom: p.windDirection, rain: p.probabilityOfPrecipitation?.value ?? null, sky: p.shortForecast,
  }));
}

// Surface water temperature ESTIMATE (no live lake sensor exists): a big reservoir's surface follows the
// last couple of weeks of weather, smoothed: exponentially weighted daily air temperature (time constant
// 12 days, 60-day window) plus +2.5 °C, fitted to 23 Arkansas DEQ surface measurements at Lake Ouachita
// (2011–2026; RMSE 1.07 °C = 1.9 °F, 90% within 3 °F). A sunshine term did not improve the fit.
async function waterTempEstimate() {
  const d = await j('https://api.open-meteo.com/v1/forecast?latitude=34.60&longitude=-93.35&daily=temperature_2m_mean,shortwave_radiation_sum,wind_speed_10m_mean&past_days=60&forecast_days=1&timezone=America%2FChicago', { 'User-Agent': UA['User-Agent'] });
  const T = d.daily.temperature_2m_mean; const SW = d.daily.shortwave_radiation_sum;
  void SW;
  const tau = 12; const k = 1 - Math.exp(-1 / tau);
  let tw = T.slice(0, 10).reduce((a, b) => a + b, 0) / 10;
  for (let i = 0; i < T.length - 1; i++) tw += (T[i] - tw) * k;
  const c = Math.min(33, Math.max(4, tw + 2.5));
  return { estimateF: Math.round(c * 9 / 5 + 32), estimateC: Math.round(c * 10) / 10, rangeF: 3, method: 'Estimated from 60 days of air temperature at the lake (Open-Meteo), smoothed over ~12 days the way a large lake surface responds. Backtested against 23 Arkansas DEQ measurements (2011–2026): typical error 1.9°F, 90% within 3°F.' };
}

async function riverTemp() {
  const d = await j('https://waterservices.usgs.gov/nwis/iv/?format=json&sites=07359002&parameterCd=00010');
  const v = d.value.timeSeries[0]?.values[0]?.value; if (!v?.length) return null;
  const c = +v[v.length - 1].value; if (!(c > -50)) return null;
  return { c, f: Math.round((c * 9 / 5 + 32) * 10) / 10, time: v[v.length - 1].dateTime, source: 'USGS 07359002 Ouachita River at Remmel Dam (downstream of the lake chain)' };
}

export default async function handler(req, res) {
  const pick = (r) => (r.status === 'fulfilled' ? r.value : null);
  const [lv, inf, west, east, fc, wte, rt] = await Promise.allSettled([lake(), inflow(), station('KMWT'), station('KHOT'), forecast(), waterTempEstimate(), riverTemp()]);
  res.setHeader('Cache-Control', 'public, s-maxage=600, stale-while-revalidate=1800');
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.status(200).json({
    lake: pick(lv), inflow: pick(inf), weather: { west: pick(west), east: pick(east) }, forecast: pick(fc),
    waterTemp: { estimate: pick(wte), nearestLive: pick(rt), note: 'No live sensor reports Lake Ouachita surface temperature; this is a model estimate. A boat sonar reading beats it.' },
    updated: new Date().toISOString(),
  });
}

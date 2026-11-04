// "Ask about this place": grounded Q&A over the map's anchor text.
// Uses free OpenRouter models only (":free" ids cost nothing); with no key or no free
// model available it falls back to the anchor's own text. Key stays server-side.

const FREE_MODELS = (process.env.ASK_MODELS || 'recursive/flint-v1.0:free,google/gemma-4-31b-it:free,google/gemma-4-26b-a4b-it:free')
  .split(',').map((s) => s.trim()).filter((m) => m.endsWith(':free'));

// Places kept off public surfaces: comma-separated names in the ASK_BLOCKLIST env var.
const BLOCK = (process.env.ASK_BLOCKLIST || '').split(',').map((s) => s.trim()).filter(Boolean);
const BLOCK_RE = BLOCK.length
  ? new RegExp(`\\b(?:(?:town|community|hamlet|village|settlement) of )?(?:${BLOCK.join('|')})(?:,?\\s+(?:Arkansas|AR))?\\b(?=[^a-z]|$)`, 'g')
  : null;
// Replace place-name uses (qualified, or capitalised mid-sentence); leave the common word alone.
const scrub = (t) => (BLOCK_RE ? t.replace(BLOCK_RE, (m, off, s) => {
  const qualified = /(of |,|Arkansas|AR)/.test(m);
  const midSentence = off > 0 && !/[.!?]\s*$/.test(s.slice(Math.max(0, off - 3), off));
  return /[A-Z]/.test(m[m.search(/[A-Za-z]/) >= 0 ? m.length - m.replace(/^.*of /, '').length : 0]) && (qualified || midSentence) ? 'a nearby community' : m;
}).replace(/\b(the|a) a nearby community/gi, 'a nearby community') : t);

export const config = { maxDuration: 30 };

const HOUR = 3600e3;
const answers = new Map(); // per-instance cache: free models allow only a small daily quota
const norm = (q) => q.toLowerCase().replace(/[^a-z0-9 ]+/g, ' ').replace(/\s+/g, ' ').trim();
const perIp = new Map();
let day = { start: Date.now(), n: 0 };
const DAILY_CAP = +(process.env.ASK_DAILY_CAP || 1500);
const PER_HOUR = +(process.env.ASK_PER_HOUR || 25);

let poiCache = null;
async function loadPois(origin) {
  if (poiCache && Date.now() - poiCache.t < 600e3) return poiCache.pois;
  const r = await fetch(`${origin}/data/pois.json`);
  const j = await r.json();
  poiCache = { t: Date.now(), pois: j.pois };
  return j.pois;
}

function anchorText(p) {
  const era = p.era?.label ? ` [${p.era.label}]` : '';
  const conf = p.conf || (p.approx ? 'approximate' : 'documented');
  const src = (p.sources || (p.src ? [{ t: 'Source', u: p.src }] : [])).map((s) => `${s.t} <${s.u}>`).join('; ');
  const depth = p.depthFullFt ? ` Under ${Math.round(p.depthFullFt)} ft of water at full pool (lake bed is a reconstructed model).` : '';
  return `### ${p.name}${era} (confidence: ${conf})\n${p.body || p.desc}${depth}\nSources: ${src}`;
}

const SYSTEM = `You are the guide inside "Drain the Ouachita", a 3D map of Lake Ouachita and the Ouachita River valley in Arkansas.
Answer the visitor's question using ONLY the reference notes provided. Rules:
- If the notes don't cover it, say it isn't documented in this map's sources and suggest the Heritage House Museum, the Encyclopedia of Arkansas, or local records. Never guess names, dates or numbers.
- Do not name any town, community, person or business that does not appear in the notes.
- The lake bed shown under the water is a reconstructed model, not a survey. Say so if depth or the old valley comes up.
- Be warm and plain-spoken, 2–5 short sentences, no markdown headings. End with the source title you relied on, like "(Source: Encyclopedia of Arkansas: Mount Ida)".`;

const STOP = new Set('the a an of and or to in on at for is was were are be by it its this that what who when where how why did does do with from as here there about'.split(' '));
function relevant(text, q) {
  const words = norm(q).split(' ').filter((w) => w.length > 2 && !STOP.has(w));
  const sents = text.match(/[^.!?]+[.!?]+/g) || [text];
  if (!words.length) return sents.slice(0, 2).join(' ').trim();
  const scored = sents.map((s, i) => [s, i, words.reduce((n, w) => n + (norm(s).includes(w.replace(/s$/, '')) ? 1 : 0), 0)]);
  const best = scored.filter((x) => x[2] > 0).sort((a, b) => b[2] - a[2] || a[1] - b[1]).slice(0, 2).sort((a, b) => a[1] - b[1]);
  return (best.length ? best.map((x) => x[0]) : sents.slice(0, 2)).join(' ').trim();
}
// Kept short on purpose: the free reasoning model deliberates in proportion to prompt length.
const FISH_SYSTEM = `You are a concise Lake Ouachita fishing guide. The notes apply angling rules of thumb to today's live data for the spot the angler is scouting. Answer in 3-5 sentences, specific to this spot and today. Their own knowledge of the water comes first; combine it with the notes. Say estimates are estimates and modelled depths are approximate. Never promise fish. Mention safety only if wind or cold makes it relevant.`;

// Rules of thumb (general angling knowledge for southern highland reservoirs) applied to today's data.
// Every line says what it is based on, so the guide never passes an estimate off as a measurement.
const OPP = { N: 'south', NNE: 'south-southwest', NE: 'southwest', ENE: 'west-southwest', E: 'west', ESE: 'west-northwest', SE: 'northwest', SSE: 'north-northwest', S: 'north', SSW: 'north-northeast', SW: 'northeast', WSW: 'east-northeast', W: 'east', WNW: 'east-southeast', NW: 'southeast', NNW: 'south-southeast' };
function scoutNotes(sp = {}, c = {}) {
  const out = [];
  const wtF = c.waterTemp?.estimate?.estimateF;
  const month = new Date().getMonth() + 1;
  const fall = month >= 9 && month <= 12; const spring = month >= 2 && month <= 5;
  let band = null;
  if (wtF != null) {
    if (wtF < 50) { band = [20, 40]; out.push(`Water ≈${wtF}°F (estimated): winter pattern, so fish hold deep, about 20–40 ft, near channel drops and bluffs; slow presentations.`); }
    else if (wtF < 60) { band = spring ? [8, 20] : [10, 25]; out.push(`Water ≈${wtF}°F (estimated): ${spring ? 'pre-spawn, with fish staging on secondary points and in warming pockets about 8–20 ft' : 'late fall cooling, fish grouping on main points and channel swings about 10–25 ft'}.`); }
    else if (wtF < 70) { band = fall ? [2, 15] : [3, 12]; out.push(`Water ≈${wtF}°F (estimated): ${fall ? 'fall transition, when shad push into creek arms and bass chase them shallow, about 2–15 ft, on flats and points' : 'spawn range, with bass shallow on protected banks, about 3–12 ft'}.`); }
    else if (wtF < 80) { band = [8, 25]; out.push(`Water ≈${wtF}°F (estimated): fish on points, humps and brush about 8–25 ft, shallower early and late.`); }
    else { band = [15, 30]; out.push(`Water ≈${wtF}°F (estimated): summer pattern, so deep brush and ledges about 15–30 ft through midday, with topwater at dawn and dusk.`); }
  }
  if (sp.water) {
    const src = sp.measured ? 'lidar-measured' : 'modelled bed';
    if (band) out.push(`This spot is ${sp.measured ? '' : '≈'}${sp.depthFt} ft (${src}): ${sp.depthFt < band[0] ? 'shallower than today\'s band, so look to the deeper edge nearby' : sp.depthFt > band[1] ? 'deeper than today\'s band, so work the shallower shelf or the nearest point' : 'right in today\'s band'}.`);
    if (sp.dropFt60m >= 12) out.push(`The bottom drops up to ${sp.dropFt60m} ft within 60 m: a ledge or channel edge, the kind of break fish use to move between depths.`);
    const inBand = (sp.attractors || []).filter((a) => !band || (a.depthFt >= band[0] - 3 && a.depthFt <= band[1] + 5));
    if (inBand.length) out.push(`AGFC brush pile ${inBand[0].name || ''} is ${inBand[0].m} m away at ≈${inBand[0].depthFt} ft, ${band ? 'inside today\'s depth band' : 'worth a look'}${inBand.length > 1 ? `, with ${inBand.length - 1} more nearby` : ''}.`);
  } else out.push('The crosshair is on dry ground at today\'s level; move it over the water.');
  const w = c.weather?.west || c.weather?.east;
  if (w?.windMph != null) {
    if (w.windMph >= 6 && w.windFrom) out.push(`Wind ${Math.round(w.windMph)} mph from the ${w.windFrom}: it drives baitfish onto the banks and points on the ${OPP[w.windFrom] || 'downwind'} side; fish the windblown side first.`);
    else out.push(`Light wind (${Math.round(w.windMph)} mph): calm surface, so lighter line and longer casts help; shade and cover matter more.`);
  }
  const tr = w?.pressureTrend3h ?? c.weather?.east?.pressureTrend3h;
  if (tr != null) out.push(tr < -0.03 ? `Pressure falling (${tr} inHg in 3 h): often a feeding window ahead of a front.` : tr > 0.03 ? `Pressure rising (+${tr} inHg in 3 h): typical after a front, when fish tighten to cover; slow down.` : `Pressure steady (${tr >= 0 ? '+' : ''}${tr} inHg in 3 h): normal behaviour.`);
  if (c.lake?.change24 != null && Math.abs(c.lake.change24) >= 0.1) out.push(`Lake ${c.lake.change24 > 0 ? 'rising' : 'falling'} ${Math.abs(c.lake.change24)} ft a day${c.lake.change24 > 0 ? ': fresh shoreline cover is flooding, and fish move up into it' : ': fish slide out toward deeper edges'}.`);
  if (c.solunar?.length) out.push(`Solunar windows today: ${c.solunar.join(', ')}.`);
  return out;
}

function fishContext(body) {
  const clip = (o, n) => JSON.stringify(o ?? null).slice(0, n);
  void clip;
  return `Notes: ${scoutNotes(body.spot, body.cond).join(' ')}`;
}

function fallback(anchor, why, q = '') {
  const body = anchor ? relevant(anchor.body || anchor.desc, q) : 'Tap a marker on the map to read about it.';
  return { answer: body, offline: true, note: why };
}

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });
  const ip = (req.headers['x-forwarded-for'] || '').split(',')[0].trim() || 'anon';
  const now = Date.now();
  if (now - day.start > 24 * HOUR) day = { start: now, n: 0 };
  let body = {};
  try { body = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : (req.body || {}); } catch { return res.status(400).json({ error: 'bad request' }); }
  const q = String(body.q || '').slice(0, 400).trim();
  if (!q) return res.status(400).json({ error: 'empty question' });
  // instant scout report: no AI call, so it neither waits on a busy model nor counts against any limit
  if (body.mode === 'fish' && q === '__report__') return res.status(200).json({ report: scoutNotes(body.spot, body.cond) });
  const rec = perIp.get(ip) || { start: now, n: 0 };
  if (now - rec.start > HOUR) { rec.start = now; rec.n = 0; }
  rec.n++; perIp.set(ip, rec);
  if (perIp.size > 5000) perIp.clear();
  const origin = `https://${req.headers['x-forwarded-host'] || req.headers.host}`;
  let pois = [];
  try { pois = await loadPois(origin); } catch { /* answer without context */ }
  const anchor = pois.find((p) => p.id === body.id) || null;
  const fish = body.mode === 'fish';
  const fishFallback = (why) => {
    const notes = scoutNotes(body.spot, body.cond);
    if (notes.length) return { answer: notes.join(' '), offline: true, note: `${why} This scout report applies standard angling rules of thumb to today's data.` };
    const sp = body.spot || {}; const c = body.cond || {};
    const bits = [sp.water ? `This spot is about ${sp.depthFt} ft deep at today's level${sp.measured ? ' (lidar-measured)' : ' (modelled bed)'}, with the bottom changing up to ${sp.dropFt60m} ft within 60 m.` : 'The crosshair is on dry ground at today\'s level.'];
    if (sp.attractors?.length) bits.push(`${sp.attractors.length} AGFC brush piles lie within 600 m; the nearest is ${sp.attractors[0].m} m away at about ${sp.attractors[0].depthFt} ft.`);
    const w = c.weather?.west || c.weather?.east; if (w) bits.push(`Wind ${Math.round(w.windMph ?? 0)} mph${w.windFrom ? ` from the ${w.windFrom}` : ''}, pressure ${w.pressureInHg ?? '?'} inHg.`);
    return { answer: bits.join(' '), offline: true, note: why };
  };
  const limited = (why) => res.status(200).json(fish ? fishFallback(why) : fallback(anchor, `${why} Here is what the map’s notes say.`, q));
  if (rec.n > PER_HOUR) return limited('Hourly question limit reached.');
  if (++day.n > DAILY_CAP) return limited('Daily question limit reached.');
  const key = process.env.OPENROUTER_API_KEY;
  if (fish && !key) return res.status(200).json(fishFallback('The AI guide is offline.'));
  if (!key) return res.status(200).json(fallback(anchor, 'AI chat is offline. Here is what the map’s notes say.', q));

  // Context: the chosen anchor plus its nearest neighbours, plus lake facts.
  const ref = anchor || { x: 0, z: 0 };
  const near = pois.filter((p) => p !== anchor && (p.body || p.desc))
    .map((p) => [p, Math.hypot(p.x - ref.x, p.z - ref.z)]).sort((a, b) => a[1] - b[1]).slice(0, anchor ? 7 : 14).map((a) => a[0]);
  // plus the anchors whose text best matches the question's words, wherever they are
  const qw = norm(q).split(' ').filter((w) => w.length > 3 && !STOP.has(w)).map((w) => w.replace(/s$/, ''));
  const topical = qw.length ? pois.filter((p) => p !== anchor && !near.includes(p))
    .map((p) => [p, qw.reduce((n, w) => n + (norm(`${p.name} ${p.body || p.desc}`).includes(w) ? 1 : 0), 0)])
    .filter((x) => x[1] > 0).sort((a, b) => b[1] - a[1]).slice(0, 4).map((x) => x[0]) : [];
  near.push(...topical);
  const lake = pois.find((p) => p.id === 'dam');
  const ctx = [anchor, ...near, lake].filter(Boolean).filter((p, i, a) => a.indexOf(p) === i).map(anchorText).join('\n\n');
  const hist = Array.isArray(body.history) ? body.history.slice(-4).map((m) => ({ role: m.role === 'assistant' ? 'assistant' : 'user', content: String(m.content || '').slice(0, 600) })) : [];
  const messages = fish ? [
    { role: 'system', content: FISH_SYSTEM },
    ...hist.slice(-2),
    { role: 'user', content: `${fishContext(body)}\nQuestion: ${q}` },
  ] : [
    { role: 'system', content: SYSTEM },
    { role: 'user', content: `Reference notes:\n\n${ctx}\n\nThe visitor is looking at: ${anchor ? anchor.name : 'the map in general'}.` },
    { role: 'assistant', content: 'Understood. I will answer only from these notes.' },
    ...hist,
    { role: 'user', content: q },
  ];

  const ck = fish ? `fish|${body.spot?.lat}|${body.spot?.lon}|${body.cond?.lake?.ft}|${norm(q)}` : `${anchor ? anchor.id : '-'}|${norm(q)}`;
  if (!hist.length && answers.has(ck)) return res.status(200).json(answers.get(ck));
  const t0 = Date.now();
  for (const model of FREE_MODELS) {
    if (Date.now() - t0 > 22000) break;
    try {
      const ctl = new AbortController();
      const timer = setTimeout(() => ctl.abort(), Math.max(1000, 26000 - (Date.now() - t0)));
      const r = await fetch('https://openrouter.ai/api/v1/chat/completions', {
        method: 'POST', signal: ctl.signal,
        headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json', 'HTTP-Referer': origin, 'X-Title': 'Drain the Ouachita' },
        body: JSON.stringify({ model, messages, max_tokens: 1600, temperature: 0.3, reasoning: { effort: 'minimal', exclude: true } }),
      });
      clearTimeout(timer);
      const j = await r.json();
      const text = j?.choices?.[0]?.message?.content;
      if (process.env.ASK_DEBUG) console.error('model', model, r.status, Date.now() - t0, text ? 'ok' : JSON.stringify({ fin: j?.choices?.[0]?.finish_reason, usage: j?.usage, msg: j?.choices?.[0]?.message }).slice(0, 400));
      if (r.ok && text) {
        const out = { answer: scrub(text.trim()), model };
        if (!hist.length) { answers.set(ck, out); if (answers.size > 500) answers.delete(answers.keys().next().value); }
        return res.status(200).json(out);
      }
    } catch (e) { if (process.env.ASK_DEBUG) console.error('model', model, e?.name, Date.now() - t0); }
  }
  if (fish) return res.status(200).json(fishFallback('The free AI guide is busy right now.'));
  return res.status(200).json(fallback(anchor, 'The free AI guide is busy right now. Here is what the map’s notes say.', q));
}

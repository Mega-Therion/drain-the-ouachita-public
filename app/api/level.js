// Latest Lake Ouachita pool elevation from the USACE RiverGages station page
// (Ouachita River @ Blakely Mountain Dam, CE418B32). Cached at the edge for 15 min.
const SRC = 'https://rivergages.mvr.usace.army.mil/WaterControl/stationinfo2.cfm?dt=S&sid=CE418B32';

export default async function handler(req, res) {
  try {
    const r = await fetch(SRC, { headers: { 'User-Agent': 'drain-the-ouachita/1.0 (lake level display)' } });
    if (!r.ok) throw new Error(`upstream ${r.status}`);
    const html = await r.text();
    const text = html.replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ');
    const lvl = text.match(/Latest Pool Level\s+([\d.]+)\s*Ft/i);
    const when = text.match(/Latest Data\s+(\d{2}\/\d{2}\/\d{4}\s+\d{2}:\d{2})\s+Central/i);
    const chg = text.match(/24 Hr\. Change\s+([+-]?[\d.]+)\s*Ft/i);
    if (!lvl) throw new Error('level not found');
    res.setHeader('Cache-Control', 'public, s-maxage=900, stale-while-revalidate=3600');
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.status(200).json({
      ft: parseFloat(lvl[1]),
      time: when ? when[1] : null,
      change24: chg ? parseFloat(chg[1]) : null,
      source: 'USACE RiverGages, Blakely Mountain Dam (CE418B32)',
    });
  } catch (e) {
    res.setHeader('Cache-Control', 'public, s-maxage=120');
    res.status(502).json({ error: String(e.message || e) });
  }
}

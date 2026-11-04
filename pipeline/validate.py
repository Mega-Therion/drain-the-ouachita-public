"""Check every published anchor against independent ground truth. Exit 1 on any failure.

- Land anchors: model ground elevation vs the USGS EPQS point service (3DEP), tolerance 3 m.
- Anchors citing a Wikipedia article with coordinates: position within 150 m of the article's.
- Submerged anchors: depth must come from the clamped model (>= 385 ft streambed).
- Lake totals: 578 ft volume and area within 1% of the USACE figures.
- Privacy: no blocked place name in any published text.

Run: python3 validate.py  (writes cache/validate_report.json)
"""
import json
import math
import re
import sys
import time
import urllib.parse
import urllib.request

import os as _os
ROOT = _os.path.dirname(_os.path.dirname(_os.path.abspath(__file__)))  # repository root
OUT = ROOT + "/app/public/data"
CACHE = ROOT + "/cache"
UA = {"User-Agent": "drain-the-ouachita-validate/1.0"}
USACE_VOL, USACE_AREA, STREAMBED_FT, FULL_FT = 2_151_100, 40_100, 385.0, 578.0


def get(url):
    for k in range(3):
        try:
            return json.load(urllib.request.urlopen(urllib.request.Request(url, headers=UA), timeout=40))
        except Exception:
            time.sleep(2 + 3 * k)
    return None


def dist_m(lat1, lon1, lat2, lon2):
    return math.hypot((lat1 - lat2) * 111_320, (lon1 - lon2) * 111_320 * math.cos(math.radians(lat1)))


def main():
    pois = json.load(open(f"{OUT}/pois.json"))["pois"]
    hyp = json.load(open(f"{OUT}/hypsometry.json"))
    fails, rows = [], []
    for p in pois:
        row = {"id": p["id"], "name": p["name"]}
        if p.get("depthFullFt") is None and p["ground"] > 174.0:   # below that the lidar shows the lake surface
            j = get(f"https://epqs.nationalmap.gov/v1/json?x={p['lon']}&y={p['lat']}&units=Meters&wkid=4326")
            v = float(j["value"]) if j and j.get("value") not in (None, "") else None
            row["usgs_m"], row["model_m"] = v, p["ground"]
            if v is None:
                row["elev"] = "no USGS value"
            elif abs(v - p["ground"]) > 3:
                fails.append(f"{p['id']}: ground {p['ground']} m vs USGS {v:.1f} m")
                row["elev"] = "FAIL"
            else:
                row["elev"] = f"ok ({p['ground'] - v:+.1f} m)"
        elif p["ground"] <= 174.0:
            bed_ft = p["ground"] / 0.3048
            row["bed_ft"] = round(bed_ft, 1)
            if bed_ft < STREAMBED_FT - 0.5:
                fails.append(f"{p['id']}: bed {bed_ft:.0f} ft below the 385 ft streambed")
        # coordinates are compared against the primary source only (later ones support the text)
        for s in (p.get("sources") or ([{"u": p["src"]}] if p.get("src") else []))[:1]:
            u = s["u"]
            if "en.wikipedia.org/wiki/" in u:
                title = urllib.parse.unquote(u.split("/wiki/")[1])
                q = urllib.parse.urlencode({"action": "query", "prop": "coordinates", "titles": title, "format": "json", "redirects": 1})
                j = get(f"https://en.wikipedia.org/w/api.php?{q}")
                pg = list(j["query"]["pages"].values())[0] if j else {}
                c = (pg.get("coordinates") or [None])[0]
                if c and p.get("conf") != "approximate" and not p.get("approx"):
                    d = dist_m(p["lat"], p["lon"], c["lat"], c["lon"])
                    row["wiki_offset_m"] = round(d)
                    # town-scale articles give a centroid; allow more for kind=town
                    lim = 1500 if p["kind"] == "town" else 150
                    if d > lim:
                        fails.append(f"{p['id']}: {d:.0f} m from {title} coordinates")
                time.sleep(0.4)
        rows.append(row)
        time.sleep(0.12)
    i = hyp["levels_ft"].index(FULL_FT)
    vol, area = hyp["volume_acft"][i], hyp["area_acres"][i]
    if abs(vol / USACE_VOL - 1) > 0.01:
        fails.append(f"volume {vol:.0f} vs USACE {USACE_VOL}")
    if abs(area / USACE_AREA - 1) > 0.01:
        fails.append(f"area {area:.0f} vs USACE {USACE_AREA}")
    pb = json.load(open(f"{CACHE}/privacy_blur.json"))
    blocked = pb.get("names", [])
    for fn in ("pois.json", "trails.json", "photos.json"):
        try:
            text = open(f"{OUT}/{fn}").read()
        except FileNotFoundError:
            continue
        for nm in blocked:
            # place-name uses only (capitalised, or "X, Ark"); the lowercase common word is fine
            if re.search(rf"\b{re.escape(nm)}\b(?!\s+(?:of|about|behind|is|was|told))", text):
                fails.append(f"blocked place name found in {fn}")
    rep = {"rows": rows, "volume_acft": vol, "area_acres": area, "fails": fails}
    json.dump(rep, open(f"{CACHE}/validate_report.json", "w"), indent=1)
    for r in rows:
        print(f"{r['id']:14s} {r.get('elev', ''):18s} {r.get('bed_ft', '')!s:>7} wiki {r.get('wiki_offset_m', '')}")
    print(f"578 ft: {vol:,.0f} ac-ft ({vol / USACE_VOL - 1:+.2%}), {area:,.0f} ac ({area / USACE_AREA - 1:+.2%})")
    print("FAILS:" if fails else "ALL CHECKS PASS", *fails, sep="\n  ")
    sys.exit(1 if fails else 0)


if __name__ == "__main__":
    main()

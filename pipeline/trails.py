"""Trails and main roads -> distance-field mask for the neon trail layers.

Input: OpenStreetMap ways (Overpass; ODbL), saved by the fetch step to cache/trails_osm.json.
Output:
  app/public/tex/trails.png   RGB distance field over the region rect
                              R = mountain-bike trails, G = hiking trails, B = main roads
                              value 255 = on the line, falling to 0 at DMAX metres away
  app/public/data/trails.json names, class, length and a label point for each trail

Lines are drawn unbroken (a gap would point at the private spot); trail label points inside the
private radius (cache/privacy_blur.json) are left out.
"""
import json
import math
import sys
import urllib.parse
import urllib.request

import numpy as np
from PIL import Image, ImageDraw
from scipy import ndimage as ndi

import geo

import os as _os
ROOT = _os.path.dirname(_os.path.dirname(_os.path.abspath(__file__)))  # repository root
CACHE = ROOT + "/cache"
OUT_TEX = ROOT + "/app/public/tex/trails.png"
OUT_JSON = ROOT + "/app/public/data/trails.json"
W = 3072            # texture width; height follows the region aspect
DMAX = 64.0         # metres encoded by the field
SS = 2              # supersample for rasterising before the distance transform

BIKE = ("womble", "lake ouachita vista", "lovit", "little blakely")
HIKE_HW = ("path", "footway", "bridleway", "cycleway")
ROAD_HW = ("trunk", "primary", "secondary")


def fetch():
    minx, miny, maxx, maxy = geo.region_merc_bounds()
    lo0, la0 = geo.merc_to_lonlat(minx, miny)
    lo1, la1 = geo.merc_to_lonlat(maxx, maxy)
    b = f"{la0:.3f},{lo0:.3f},{la1:.3f},{lo1:.3f}"
    q = (f'[out:json][timeout:120];(way["highway"~"^(path|footway|cycleway|bridleway)$"]["name"]({b});'
         f'way["highway"~"^(trunk|primary|secondary)$"]({b}););out geom tags;')
    req = urllib.request.Request("https://overpass-api.de/api/interpreter", data=urllib.parse.urlencode({"data": q}).encode(),
                                 headers={"User-Agent": "drain-the-ouachita/1.0"})
    json.dump(json.load(urllib.request.urlopen(req, timeout=200)), open(f"{CACHE}/trails_osm.json", "w"))


def classify(t):
    hw, name = t.get("highway", ""), (t.get("name") or "")
    n = name.lower()
    if hw in ROAD_HW:
        return 2
    if not name or "closed" in n:
        return None
    if any(k in n for k in BIKE) or t.get("mtb") == "yes" or t.get("bicycle") == "designated":
        return 0
    if hw in HIKE_HW:
        return 1
    return None


def main():
    if "fetch" in sys.argv:
        fetch()
    els = json.load(open(f"{CACHE}/trails_osm.json"))["elements"]
    pb = json.load(open(f"{CACHE}/privacy_blur.json"))
    private = [geo.lonlat_to_world(p[0], p[1]) for p in pb["points"]]
    prad = max(3000.0, 2 * float(pb["radius_m"]))
    minx, miny, maxx, maxy = geo.region_merc_bounds()
    x0, z0 = geo.merc_to_world(minx, maxy)
    x1, z1 = geo.merc_to_world(maxx, miny)
    Hh = int(round(W * (z1 - z0) / (x1 - x0)))
    mpp = (x1 - x0) / W
    imgs = [Image.new("L", (W * SS, Hh * SS), 0) for _ in range(3)]
    draws = [ImageDraw.Draw(im) for im in imgs]
    trails = {}
    for e in els:
        if e["type"] != "way" or "geometry" not in e:
            continue
        c = classify(e.get("tags", {}))
        if c is None:
            continue
        pts = [geo.lonlat_to_world(g["lon"], g["lat"]) for g in e["geometry"]]
        # Linework is drawn unbroken: lines carry no names, and a gap would point at the private spot.
        # Only the name label points (trails.json) are kept out of the private radius.
        for s in [pts]:
            uv = [((x - x0) / mpp * SS, (z - z0) / mpp * SS) for x, z in s]
            draws[c].line(uv, fill=255, width=1)
            if c < 2:
                name = e["tags"]["name"]
                L = sum(math.hypot(b[0] - a[0], b[1] - a[1]) for a, b in zip(s, s[1:]))
                tr = trails.setdefault(name, {"name": name, "cls": ["bike", "hike"][c], "len_m": 0.0, "pts": []})
                tr["len_m"] += L
                mid = s[len(s) // 2]
                if not any(math.hypot(mid[0] - px, mid[1] - pz) < prad for px, pz in private):
                    tr["pts"].append(mid)
    tex = np.zeros((Hh, W, 3), np.uint8)
    for c in range(3):
        m = np.array(imgs[c]) > 0
        if not m.any():
            continue
        d = ndi.distance_transform_edt(~m) * (mpp / SS)          # metres
        d = d.reshape(Hh, SS, W, SS).min(axis=(1, 3))
        tex[..., c] = np.clip(255 * (1 - d / DMAX), 0, 255).astype(np.uint8)
    Image.fromarray(tex).save(OUT_TEX, optimize=True)
    out = []
    for t in trails.values():
        if not t["pts"]:
            continue
        px, pz = t["pts"][len(t["pts"]) // 2]
        out.append({"name": t["name"], "cls": t["cls"], "km": round(t["len_m"] / 1000, 1), "x": round(px, 1), "z": round(pz, 1)})
    out.sort(key=lambda t: -t["km"])
    json.dump({"dmax": DMAX, "rect": [x0, z0, x1, z1], "trails": out,
               "source": "OpenStreetMap contributors (ODbL)"}, open(OUT_JSON, "w"), separators=(",", ":"))
    print(f"trails.png {W}x{Hh} at {mpp:.1f} m/px;", len(out), "named trails")
    for t in out:
        print(f"  {t['cls']:4s} {t['km']:6.1f} km  {t['name']}")


if __name__ == "__main__":
    main()

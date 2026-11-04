"""Historical photos + newspaper clippings -> app/public/data/photos.json

Only items whose rights are machine-readable and open are embedded:
  - Wikimedia Commons files (public domain / CC0 / CC BY / CC BY-SA), credit + licence kept per item
  - Library of Congress Chronicling America newspaper pages (LoC: no known copyright restrictions),
    cropped to the article around the search term with IIIF using the page's OCR word coordinates
Images are hotlinked (thumbnails), never copied into the repo.
Privacy: items inside the private radius, or naming a private place, are dropped.

Run: python3 photos.py   (network; ~5-10 min)
"""
import json
import math
import re
import time
import urllib.parse
import urllib.request
import html as htmlmod

import geo

import os as _os
ROOT = _os.path.dirname(_os.path.dirname(_os.path.abspath(__file__)))  # repository root
CACHE = ROOT + "/cache"
OUT = ROOT + "/app/public/data/photos.json"
UA = {"User-Agent": "drain-the-ouachita/1.0 (https://drain-the-ouachita.vercel.app; educational historical photo viewer)"}
OPEN_LIC = re.compile(r"^(public domain|pd|cc0|cc by(-sa)? [0-9.]+|cc-by(-sa)?-[0-9.]+|no restrictions)", re.I)
REL = re.compile(r"lake ouachita|blakely|mount ida|mt\\.? ida|montgomery county,? ark|ouachita national forest|ouachita mountains|womble|buckville|cedar glades", re.I)
CATS = ["Lake Ouachita", "Blakely Mountain Dam", "Mount Ida, Arkansas", "Montgomery County, Arkansas", "Ouachita River",
        "Lake Ouachita State Park", "Ouachita National Forest"]
NEWS = [  # (query, exact phrases one of which must appear, context words needed near it (or None), place, tags)
    ("Blakely dam", ("blakely dam", "blakely mountain"), None, "dam", ["dam", "pre-lake"]),
    ("Blakely Mountain dam", ("blakely mountain", "blakely dam"), None, "dam", ["dam"]),
    ("Blakely Mountain reservoir", ("blakely mountain", "blakely reservoir"), None, "dam", ["dam"]),
    ("Lake Ouachita", ("lake ouachita", "ouachita lake", "ouachita reservoir"), None, "dam", ["lake"]),
    ("Buckville", ("buckville",), None, "buckville", ["community"]),
    ("Cedar Glades", ("cedar glades",), None, "cedarglades", ["community"]),
    ("Mount Ida", ("mount ida", "mt. ida"), None, "mountida", ["town"]),
    ("Silver City Montgomery", ("silver city",), ("montgomery", "ouachita", "mine", "mining", "ore"), "silvercity", ["mining"]),
    ("quartz crystal Mount Ida", ("crystal",), ("mount ida", "montgomery", "quartz"), "crystalmines", ["quartz"]),
]


import hashlib
import os
import socket

socket.setdefaulttimeout(40)
HTTP_CACHE = f"{CACHE}/http_cache"
os.makedirs(HTTP_CACHE, exist_ok=True)


def get(url, tries=5, raw=False):
    """GET with an on-disk cache so reruns are fast and a stalled run can resume."""
    fn = f"{HTTP_CACHE}/{hashlib.sha1(url.encode()).hexdigest()}"
    if os.path.exists(fn):
        b = open(fn, "rb").read()
    else:
        b = None
        for k in range(tries):
            try:
                b = urllib.request.urlopen(urllib.request.Request(url, headers=UA), timeout=40).read()
                open(fn, "wb").write(b)
                break
            except Exception as e:
                print(f"  retry {k + 1}: {url[:90]} ({e})", flush=True)
                time.sleep((30 if "429" in str(e) else 3) * (k + 1))
        if b is None:
            return None
    try:
        return b.decode("utf-8", "replace") if raw else json.loads(b)
    except Exception:
        return None


def strip(x):
    return htmlmod.unescape(re.sub(r"<[^>]+>", "", x or "")).strip()


def privacy():
    pb = json.load(open(f"{CACHE}/privacy_blur.json"))
    pts = [(p[0], p[1]) for p in pb["points"]]
    rad = max(3000.0, 2 * float(pb["radius_m"]))
    names = pb.get("names", [])
    # place-name uses only: "X, Ark", "X, Arkansas", "X, AR", "of X", "at X", "near X" (capitalised)
    pat = re.compile(r"\b(?:of|at|near|in|to|from)\s+(?:" + "|".join(map(re.escape, names)) + r")\b|\b(?:"
                     + "|".join(map(re.escape, names)) + r"),?\s+(?:Ark\b|Arkansas|AR\b)") if names else None

    def bad(text, lon=None, lat=None):
        if lon is not None and lat is not None:
            for plo, pla in pts:
                if math.hypot((lat - pla) * 111_320, (lon - plo) * 111_320 * math.cos(math.radians(pla))) < rad:
                    return True
        return bool(pat and pat.search(text or ""))
    return bad


def year_of(s):
    m = re.search(r"(1[6-9]\d\d|20[0-3]\d)", s or "")
    return int(m.group(1)) if m else None


def nearest_anchor(pois, lon, lat, maxd=2500):
    best, bd = None, maxd
    for p in pois:
        d = math.hypot((lat - p["lat"]) * 111_320, (lon - p["lon"]) * 111_320 * math.cos(math.radians(lat)))
        if d < bd:
            best, bd = p["id"], d
    return best


def commons(bad, pois):
    minx, miny, maxx, maxy = geo.region_merc_bounds()
    lo0, la0 = geo.merc_to_lonlat(minx, miny)
    lo1, la1 = geo.merc_to_lonlat(maxx, maxy)
    files = {}
    for lat in [la0 + (la1 - la0) * k / 4 for k in range(5)]:
        for lon in [lo0 + (lo1 - lo0) * k / 7 for k in range(8)]:
            q = urllib.parse.urlencode(dict(action="query", list="geosearch", gscoord=f"{lat}|{lon}", gsradius=10000,
                                            gsnamespace=6, gslimit=500, format="json"))
            for g in (get(f"https://commons.wikimedia.org/w/api.php?{q}") or {}).get("query", {}).get("geosearch", []):
                files[g["title"]] = (g["lon"], g["lat"])
            time.sleep(1.2)
    for c in CATS:
        q = urllib.parse.urlencode(dict(action="query", list="categorymembers", cmtitle="Category:" + c, cmtype="file",
                                        cmlimit=500, format="json"))
        for m in (get(f"https://commons.wikimedia.org/w/api.php?{q}") or {}).get("query", {}).get("categorymembers", []):
            files.setdefault(m["title"], None)
        time.sleep(0.3)
    titles = list(files)
    out = []
    for i in range(0, len(titles), 40):
        q = urllib.parse.urlencode(dict(action="query", prop="imageinfo|coordinates", titles="|".join(titles[i:i + 40]),
                                        iiprop="url|extmetadata|mime", iiurlwidth=900, format="json"))
        r = get(f"https://commons.wikimedia.org/w/api.php?{q}") or {}
        for pg in r.get("query", {}).get("pages", {}).values():
            ii = (pg.get("imageinfo") or [{}])[0]
            md = ii.get("extmetadata", {})
            g = lambda k: strip(md.get(k, {}).get("value"))
            if ii.get("mime") not in ("image/jpeg", "image/png", "image/tiff"):
                continue
            lic = g("LicenseShortName")
            if not OPEN_LIC.match(lic):
                continue
            c = (pg.get("coordinates") or [{}])[0]
            ll = (c.get("lon"), c.get("lat")) if c else (files.get(pg["title"]) or (None, None))
            lon, lat = ll
            if lon is not None and not (lo0 <= lon <= lo1 and la0 <= lat <= la1):
                continue
            title = re.sub(r"^File:|\.[a-z]{3,4}$", "", pg["title"], flags=re.I).replace("_", " ")
            desc = g("ImageDescription")[:500]
            text = f"{title} {desc} {g('Categories')}"
            if bad(text, lon, lat):
                continue
            # no coordinates: keep only items that name this area (the "Ouachita River" category spans Louisiana)
            if lon is None and not REL.search(text):
                continue
            if re.match(r"ISS\d|STS\d", title):   # astronaut frames geotagged to the region but showing other states
                continue
            date = g("DateTimeOriginal") or g("DateTime")
            out.append(dict(
                id="c" + str(pg.get("pageid")), src="commons", title=title, desc=desc, year=year_of(date), date=date[:40],
                thumb=ii.get("thumburl"), full=ii.get("url"), page=ii.get("descriptionurl"),
                credit=(g("Artist") or g("Credit") or "Unknown")[:160], lic=lic, licUrl=g("LicenseUrl"),
                lon=lon, lat=lat, anchor=nearest_anchor(pois, lon, lat) if lon is not None else None,
                tags=[t.strip() for t in g("Categories").split("|")][:8]))
        time.sleep(1.2)
    return out


def news(bad, pois):
    out, seen, seen_text = [], set(), []
    byid = {p["id"]: p for p in pois}
    for query, need, ctx, anchor, tags in NEWS:
        q = urllib.parse.urlencode({"q": query, "fa": "location_state:arkansas", "fo": "json", "c": 25})
        res = (get(f"https://www.loc.gov/collections/chronicling-america/?{q}") or {}).get("results", [])
        kept = 0
        for it in res:
            m = re.search(r"/resource/(sn\d+)/(\d{4}-\d{2}-\d{2})/ed-(\d+)/\?sp=(\d+)", it.get("id", ""))
            if not m or kept >= 6:
                continue
            lccn, date, ed, seq = m.groups()
            key = (lccn, date[:7])   # one clipping per paper per month: weekly papers reran notices and ads
            if key in seen:
                continue
            # current loc.gov route: resource JSON -> word-coordinates service (text + word boxes)
            rj = get(f"https://www.loc.gov/resource/{lccn}/{date}/ed-{ed}/?sp={seq}&st=text&fo=json") or {}
            ft = (rj.get("resource") or {}).get("fulltext_file") or rj.get("fulltext_service")
            if not ft:
                continue
            tj = get(ft) or {}
            ocr = next(iter(tj.values()), {}).get("full_text", "") if tj else ""
            low = ocr.lower()
            norm = re.sub(r"\s+", " ", low)
            hit = -1
            for w in need:
                for m2 in re.finditer(re.escape(w), norm):
                    win = norm[max(0, m2.start() - 350): m2.end() + 350]
                    if ctx is None or any(c in win for c in ctx):
                        hit = m2.start(); break
                if hit >= 0:
                    break
            if hit < 0:
                continue
            excerpt = re.sub(r"\s+", " ", ocr)[max(0, hit - 420): hit + 520].strip()
            if bad(excerpt):
                continue
            # the same advertisement often ran for weeks: keep the first printing only
            import difflib
            core = re.sub(r"[^a-z ]", "", excerpt.lower())[300:700]
            if any(difflib.SequenceMatcher(None, core, k).ratio() > 0.6 for k in seen_text):
                continue
            seen_text.append(core)
            coords = get(ft.replace("&full_text=1", "")) or {}
            boxes = []
            for v in coords.values():
                for term, lst in (v.get("coords") or {}).items():
                    if any(term.lower().startswith(w.split()[0]) for w in need):
                        boxes += [c["coordinates"] for c in lst]
            img = ((rj.get("resource") or {}).get("image") or "")
            iiif = re.match(r"(https://tile\.loc\.gov/image-services/iiif/[^/]+)", img)
            crop = None
            if boxes and iiif:
                x, y, w, h = boxes[0]
                cx, cy = x + w / 2, y + h / 2
                crop = f"{iiif.group(1)}/{int(max(0, cx - 1500))},{int(max(0, cy - 1100))},3000,2400/900,/0/default.jpg"
            title = strip(it.get("title", "")).replace("Image ", "Page ")
            seen.add(key)
            kept += 1
            a = byid.get(anchor)
            print(f"  clip {date} {title[:60]}", flush=True)
            out.append(dict(
                id=f"n{lccn}{date}{seq}", src="newspaper", title=title, desc=excerpt, year=int(date[:4]), date=date,
                thumb=crop or img, full=crop.replace("/900,/", "/1800,/") if crop else img, page=it.get("id"),
                credit="Library of Congress, Chronicling America", lic="No known copyright restrictions",
                licUrl="https://www.loc.gov/collections/chronicling-america/about-this-collection/rights-and-access/",
                lon=a["lon"] if a else None, lat=a["lat"] if a else None, anchor=anchor, tags=tags + ["newspaper"],
                ocr=True))
            time.sleep(0.6)
        print(f"news '{query}': {kept} clippings")
        time.sleep(1.5)
    return out


def main():
    pois = json.load(open(ROOT + "/app/public/data/pois.json"))["pois"]
    bad = privacy()
    c = commons(bad, pois)
    print("commons:", len(c))
    import sys as _s
    n = [] if "--no-news" in _s.argv else news(bad, pois)
    if not n:  # keep clippings from an earlier successful run
        try:
            n = [i for i in json.load(open(OUT))["items"] if i["src"] == "newspaper"]
        except Exception:
            n = []
    items = sorted(c + n, key=lambda x: (x["year"] is None, x["year"] or 0))
    for it in items:   # percent-encode brackets so the whole URL survives every parser
        for k in ("page", "full", "thumb", "licUrl"):
            if isinstance(it.get(k), str):
                it[k] = it[k].replace("(", "%28").replace(")", "%29")
    json.dump({"items": items, "note": "Thumbnails are hotlinked from Wikimedia Commons and the Library of Congress. "
               "Each item keeps its own credit and licence."}, open(OUT, "w"), separators=(",", ":"))
    hist = [i for i in items if i["year"] and i["year"] < 1970]
    print(len(items), "items;", len(hist), "dated before 1970")


if __name__ == "__main__":
    main()

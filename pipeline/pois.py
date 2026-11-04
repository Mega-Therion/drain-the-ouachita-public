"""Curated points of interest + AGFC fish attractors -> app/public/data/pois.json.

Coordinates: OpenStreetMap / NID / USGS / AGFC as noted (see sources in each entry).
Ground elevation and full-pool depth are sampled from the merged model grid.
"""
import json
import xml.etree.ElementTree as ET

import numpy as np

import geo
from anchors_west import WEST
from anchors_native import NATIVE

import os as _os
ROOT = _os.path.dirname(_os.path.dirname(_os.path.abspath(__file__)))  # repository root
CACHE = ROOT + "/cache"
OUT = ROOT + "/app/public/data"

EOA_DAM = "https://encyclopediaofarkansas.net/entries/blakely-mountain-dam-5815/"
EOA_BUCK = "https://encyclopediaofarkansas.net/entries/buckville-garland-county-7346/"
EOA_CEDAR = "https://encyclopediaofarkansas.net/entries/cedar-glades-garland-county-7345/"
CWMS = "https://cwms-data.usace.army.mil/cwms-data/levels?office=MVK&name=Blakely.*&unit=EN&format=json"
OSM = "https://www.openstreetmap.org/"

POIS = [
    # id, name, kind, lat, lon, desc, source, approx
    ("dam", "Blakely Mountain Dam", "dam", 34.57300841, -93.19501188,
     "Earth-and-rock-fill dam on the Ouachita River built by the U.S. Army Corps of Engineers. "
     "About 231 ft high and 1,100 ft long with its crest at 616 ft. The lake began filling in 1952–53; "
     "first power came in 1955 (2 units, 75 MW).", EOA_DAM, False),
    ("deepest", "Deepest point (modelled)", "feature", None, None,
     "Lowest point of the reconstructed lake bed, in the old river channel just above the dam. The model is held to the "
     "Corps' original streambed elevation of 385 ft here, 193 ft below full pool. ", CWMS, True),
    ("gauge", "Pre-dam river gauge (1923–1950)", "history", 34.60009, -93.20574,
     "USGS gauge 07357000 measured the free-flowing Ouachita River for 27 years before the dam. Its gage datum was "
     "404.16 ft, so the old riverbed here lay about 174 ft under today's full pool. Marker at the coordinates USGS lists "
     "for the site; the modelled channel passes about 1.4 km south, and the model is shallower "
     "than the documented datum at this exact spot.", "https://waterdata.usgs.gov/monitoring-location/07357000/", True),
    ("buckville", "Buckville (submerged townsite)", "history", 34.6106478, -93.3451887,
     "A Garland County community inundated by the lake. Its church was moved in 1951; the cemetery stayed "
     "and is now reached by boat. Marker placed at the Buckville landing — the exact townsite is not documented.", EOA_BUCK, True),
    ("buckcem", "Buckville Cemetery", "history", 34.6129391, -93.3419265,
     "Listed on the National Register of Historic Places. Left in place when the valley flooded.", "https://en.wikipedia.org/wiki/Buckville_Cemetery", False),
    ("cedarglades", "Cedar Glades (submerged)", "history", 34.612592, -93.297410,
     "Former community covered by Lake Ouachita. Location from the GNIS place record.", EOA_CEDAR, True),
    ("statepark", "Lake Ouachita State Park", "park", 34.6159243, -93.1846292,
     "Arkansas state park at the lake's east end with a marina, campground and trails.", OSM + "node/359008562", False),
    ("sisters", "Three Sisters Springs", "park", 34.6234714, -93.1706611,
     "Spring site inside Lake Ouachita State Park.", OSM + "node/14309518846", False),
    ("mtnharbor", "Mountain Harbor Resort", "marina", 34.5714770, -93.4378445,
     "Resort and full-service marina on the south shore.", OSM + "way/997167665", False),
    ("brady", "Brady Mountain", "recreation", 34.5883728, -93.2646709,
     "Corps of Engineers use area with marina and campground in the eastern basin.", OSM + "way/923979001", False),
    ("crystal", "Crystal Springs", "recreation", 34.5470359, -93.3613000,
     "Corps of Engineers recreation area on the south shore.", OSM + "node/358996988", False),
    ("joplin", "Joplin", "recreation", 34.5753707, -93.4404675, "Corps of Engineers recreation area.", OSM + "node/359012351", False),
    ("littlefir", "Little Fir", "recreation", 34.6322387, -93.4703425, "Corps of Engineers recreation area on the north side.", OSM + "node/358995315", False),
    ("bigfir", "Big Fir", "recreation", 34.6062040, -93.4096339, "Corps of Engineers recreation area.", OSM + "node/359012274", False),
    ("denby", "Denby Point", "recreation", 34.5520377, -93.4935234, "Corps of Engineers recreation area.", OSM + "node/359011895", False),
    ("tompkins", "Tompkins Bend", "recreation", 34.5731488, -93.4690789, "Corps of Engineers recreation area.", OSM + "node/359022175", False),
    ("twincreek", "Twin Creek", "recreation", 34.5503714, -93.5099125, "Corps of Engineers recreation area.", OSM + "node/358995767", False),
    ("cedarfourche", "Cedar Fourche", "recreation", 34.6575922, -93.2790764, "Corps of Engineers recreation area.", OSM + "node/358996981", False),
    ("ironsfork", "Irons Fork", "recreation", 34.6878713, -93.3724112, "Corps of Engineers recreation area at the head of the Irons Fork arm.", OSM + "node/359012328", False),
    ("lena", "Lena Landing", "recreation", 34.6670364, -93.2299084, "Corps of Engineers recreation area.", OSM + "node/359012398", False),
    ("spillway", "Spillway Recreation Area", "recreation", 34.5695348, -93.2143530,
     "Corps area beside the dam. The uncontrolled spillway crest sits at 592 ft — the top of the flood pool.", OSM + "node/358997045", False),
    ("hickorynut", "Hickory Nut Mountain Vista", "overlook", 34.5644077, -93.4069679,
     "Scenic overlook above the central basin.", OSM + "node/7956290524", False),
    ("lovit", "Lake Ouachita Vista Trail", "trail", 34.5662361, -93.1954583,
     "Hiking and biking trail along the south shore (about 40 mi); eastern trailhead near the dam.", OSM + "way/1117814932", False),
    ("ar27a", "AR 27 bridge", "bridge", 34.6261497, -93.5472471, "Highway 27 crossing of the lake's west arm.", OSM + "way/1189065322", False),
    ("us270", "US 270 bridge", "bridge", 34.5428973, -93.4837131, "US 270 crossing of a southern arm.", OSM + "way/886233815", False),
    ("inflow", "Ouachita River inflow", "river", None, None,
     "Where the Ouachita River enters the head of the lake's northwest arm. Upstream, at the USGS gauge near Mount Ida, the river drains 414 sq mi of the Ouachita Mountains.",
     "https://waterdata.usgs.gov/monitoring-location/07356000/", True),
    ("sfinflow", "South Fork inflow", "river", None, None,
     "Head of the southwest arm, where the South Fork of the Ouachita River comes in.",
     "https://encyclopediaofarkansas.net/entries/ouachita-river-2392/", True),
]

BANNED = tuple(n.lower() for n in json.load(open(f"{CACHE}/privacy_blur.json")).get("names", []))
assert BANNED, "privacy names missing from cache/privacy_blur.json"
import re
_BAN_RE = re.compile(r"\b(" + "|".join(BANNED) + r")\b", re.I)


def banned(text):
    return bool(_BAN_RE.search(text))


def main():
    H = np.load(f"{CACHE}/H_final.npy")
    cls = np.load(f"{CACHE}/cls_final.npy")
    minx, miny, maxx, maxy = geo.region_merc_bounds()
    step = geo.tile_size_m(geo.Z_DETAIL) / geo.TILE_N

    def idx(lon, lat):
        mx, my = geo.lonlat_to_merc(lon, lat)
        return int(round((maxy - my) / step)), int(round((mx - minx) / step))

    def lonlat_of(j, i):
        return geo.merc_to_lonlat(minx + i * step, maxy - j * step)

    st = json.load(open(f"{CACHE}/bathy_stats.json"))
    basin = (cls & 1) > 0
    # deepest point of the model
    Hb = np.where(basin, H, 1e9)
    # the bed is clamped flat at the 385 ft streambed near the dam: take the floor cell nearest the dam
    floor = np.argwhere(Hb <= Hb.min() + 0.01)
    dj, di = idx(-93.1946, 34.5735)
    j, i = floor[np.argmin(np.hypot(floor[:, 0] - dj, floor[:, 1] - di))]
    deep_ll = lonlat_of(j, i)
    # inflow: westernmost reconstructed-bed pixel
    bed = (cls & 4) > 0
    ys, xs = np.nonzero(bed)
    lat_of_row = np.array([lonlat_of(j, 0)[1] for j in range(H.shape[0])])
    north = lat_of_row[ys] > 34.60
    kn = np.argmin(np.where(north, xs, 10**9))
    inflow_ll = lonlat_of(ys[kn], xs[kn])
    ks = np.argmin(np.where(~north, xs, 10**9))
    sf_ll = lonlat_of(ys[ks], xs[ks])
    out = []
    for pid, name, kind, lat, lon, desc, src, approx in POIS:
        assert not banned(name + " " + desc)
        if pid == "deepest":
            lon, lat = deep_ll
        if pid == "inflow":
            lon, lat = inflow_ll
        if pid == "sfinflow":
            lon, lat = sf_ll
        jj, ii = idx(lon, lat)
        g = float(H[jj, ii])
        x, z = geo.lonlat_to_world(lon, lat)
        under = bool(basin[jj, ii]) and g < geo.FULL_POOL_M
        out.append(dict(id=pid, name=name, kind=kind, lon=round(lon, 6), lat=round(lat, 6), x=round(x, 1), z=round(z, 1),
                        ground=round(g, 2), depthFullFt=round((geo.FULL_POOL_M - g) / geo.FT, 1) if under else None,
                        desc=desc, src=src, approx=approx))
    for o in out:
        if o["id"] == "gauge":
            o["depthDocFt"] = round(geo.FULL_POOL_FT - 404.16, 1)
            o["docNote"] = "USGS gage datum 404.16 ft"
    # west-end history anchors (v2 schema); skip anything inside the private radius
    pb = json.load(open(f"{CACHE}/privacy_blur.json"))
    keep_out = [(pt[0], pt[1]) for pt in pb["points"]]
    rad = max(3000.0, float(pb["radius_m"]) * 2)
    for a in WEST + NATIVE:
        assert not banned(a["name"] + " " + a["desc"] + " " + a["body"] + " " + str(a["sources"])), a["id"]
        x, z = geo.lonlat_to_world(a["lon"], a["lat"])
        if any(np.hypot(*(np.array(geo.lonlat_to_world(lo, la)) - (x, z))) < rad for lo, la in keep_out):
            print("skip (private radius)", a["id"]); continue
        jj, ii = idx(a["lon"], a["lat"])
        g = float(H[jj, ii])
        # general-area markers don't get a depth: the number would describe an arbitrary point
        under = bool(basin[jj, ii]) and g < geo.FULL_POOL_M and a not in NATIVE
        out.append(dict(id=a["id"], name=a["name"], kind=a["kind"], lon=round(a["lon"], 6), lat=round(a["lat"], 6),
                        x=round(x, 1), z=round(z, 1), ground=round(g, 2),
                        depthFullFt=round((geo.FULL_POOL_M - g) / geo.FT, 1) if under else None,
                        desc=a["desc"], body=a["body"], era=a["era"], sources=a["sources"], conf=a["conf"],
                        src=a["sources"][0]["u"], approx=a["conf"] != "documented", region="native" if a in NATIVE else "west"))
    # percent-encode brackets in links so every viewer and link checker reads the whole URL
    enc = lambda u: u.replace("(", "%28").replace(")", "%29") if isinstance(u, str) else u
    for o in out:
        o["src"] = enc(o.get("src"))
        for s_ in o.get("sources") or []:
            s_["u"] = enc(s_["u"])
    # AGFC fish attractors (brush piles)
    att = []
    root = ET.parse(f"{CACHE}/OUA.gpx").getroot()
    ns = {"g": "http://www.topografix.com/GPX/1/1"}
    for w in root.findall("g:wpt", ns):
        lat = float(w.get("lat")); lon = float(w.get("lon"))
        jj, ii = idx(lon, lat)
        g = float(H[jj, ii])
        x, z = geo.lonlat_to_world(lon, lat)
        att.append([round(x, 1), round(z, 1), round(g, 2), w.findtext("g:name", "", ns)])
    json.dump({"pois": out, "attractors": att, "attractorSource": "https://agfc-publicusemaps.s3.amazonaws.com/OUA.gpx",
               "bathy": st.get("stats")}, open(f"{OUT}/pois.json", "w"), separators=(",", ":"))
    print(len(out), "pois,", len(att), "attractors; deepest", deep_ll, "inflow", inflow_ll)
    for p in out:
        print(p["name"], p["ground"], p["depthFullFt"])


if __name__ == "__main__":
    main()

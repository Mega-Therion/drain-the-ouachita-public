"""Assemble the Lake Ouachita OSM multipolygon (relation 1909083) into closed rings."""
import json
import xml.etree.ElementTree as ET

import os as _os
ROOT = _os.path.dirname(_os.path.dirname(_os.path.abspath(__file__)))  # repository root
CACHE = ROOT + "/cache"


def assemble(ways):
    """Join way node-lists into closed rings."""
    rings = []
    pool = [list(w) for w in ways]
    while pool:
        ring = pool.pop()
        changed = True
        while ring[0] != ring[-1] and changed:
            changed = False
            for k, w in enumerate(pool):
                if w[0] == ring[-1]:
                    ring += w[1:]
                elif w[-1] == ring[-1]:
                    ring += w[::-1][1:]
                elif w[-1] == ring[0]:
                    ring = w[:-1] + ring
                elif w[0] == ring[0]:
                    ring = w[::-1][:-1] + ring
                else:
                    continue
                pool.pop(k)
                changed = True
                break
        rings.append(ring)
    return rings


def main():
    root = ET.parse(f"{CACHE}/lake_full.osm").getroot()
    nodes = {n.get("id"): (float(n.get("lon")), float(n.get("lat"))) for n in root.iter("node")}
    ways = {w.get("id"): [nd.get("ref") for nd in w.iter("nd")] for w in root.iter("way")}
    rel = next(r for r in root.iter("relation") if r.get("id") == "1909083")
    outer, inner = [], []
    for m in rel.iter("member"):
        if m.get("type") != "way":
            continue
        (outer if m.get("role") == "outer" else inner).append(ways[m.get("ref")])
    res = {"outer": [], "inner": []}
    for role, ws in (("outer", outer), ("inner", inner)):
        for ring in assemble(ws):
            closed = ring[0] == ring[-1]
            res[role].append({"closed": closed, "coords": [nodes[i] for i in ring]})
    for role in res:
        print(role, len(res[role]), "rings; open:", sum(not r["closed"] for r in res[role]),
              "max pts", max(len(r["coords"]) for r in res[role]))
    json.dump(res, open(f"{CACHE}/lake_rings.json", "w"))


if __name__ == "__main__":
    main()

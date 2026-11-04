"""Cut the merged elevation (lidar land + reconstructed lake bed) into the app's
terrain tile pyramid, plus manifest, hypsometry, outline.

Tile file (gzip of):
  'DTO1', u8 z, u8 ver, u16 x, u16 y, u16 n, u16 flags, u16 reserved
  heights: n*n uint16 zigzag residuals of planar predictor on dm=(h+100)*10 (lo plane, hi plane)
  if flags&1: static water level dm (0=none) lo/hi planes, then class plane u8
n = 259: 257 core samples on tile corners + 1-sample border for seamless normals.
class bits: 1 basin (lake water allowed), 2 river channel, 4 reconstructed bed,
            8 other water (fixed level), 16 pond
"""
import gzip
import json
import time
import os
import struct
import sys

import numpy as np
from scipy import ndimage as ndi

import geo

import os as _os
ROOT = _os.path.dirname(_os.path.dirname(_os.path.abspath(__file__)))  # repository root
CACHE = ROOT + "/cache"
OUT = ROOT + "/app/public/data"
N = geo.TILE_N
NB = N + 3          # 259 samples incl. border
L_MAX_FT = 590.0
L_MAX = L_MAX_FT * geo.FT

C_BASIN, C_CHAN, C_BED, C_OTHER, C_POND = 1, 2, 4, 8, 16


def flat_water(h, min_px, tol=0.005):
    """Hydro-flattened water bodies: connected areas of (near) constant height."""
    mx = ndi.maximum_filter(h, 3)
    mn = ndi.minimum_filter(h, 3)
    flat = (mx - mn) < tol
    lab, n = ndi.label(flat)
    if n == 0:
        return np.zeros(h.shape, bool)
    sizes = ndi.sum(flat, lab, np.arange(1, n + 1))
    keep = np.zeros(n + 1, bool)
    keep[1:] = sizes >= min_px
    m = keep[lab]
    # grow by one pixel so shorelines are covered
    return ndi.binary_dilation(m, iterations=1) & (h <= ndi.maximum_filter(np.where(m, h, -1e9), 3) + 0.05)


STREAMBED_M = 385.0 * geo.FT


def build_region():
    dem = np.load(f"{CACHE}/dem_z14.npy")
    z = np.load(f"{CACHE}/bathy_out.npz")
    y0, y1, x0, x1 = [int(v) for v in z["window"]]
    B = z["B"]; lake = z["lake"]; chan = z["chan"]; static_w = z["static"]; pond = z["pond"]
    # Corps: original streambed at the dam is 385 ft, the lowest point of the valley.
    # No modelled cell may be deeper than that.
    B = np.maximum(B, STREAMBED_M)
    H = dem.copy()
    H[y0:y1, x0:x1] = np.where(lake, B, H[y0:y1, x0:x1])
    cls = np.zeros(H.shape, np.uint8)
    static = np.full(H.shape, -1000, np.float32)
    static[y0:y1, x0:x1] = static_w
    cls[y0:y1, x0:x1] |= np.where(lake, C_BED, 0).astype(np.uint8)
    cls[y0:y1, x0:x1] |= np.where(chan, C_CHAN, 0).astype(np.uint8)
    cls[y0:y1, x0:x1] |= np.where(pond, C_POND, 0).astype(np.uint8)

    lakefull = np.zeros(H.shape, bool)
    lakefull[y0:y1, x0:x1] = lake
    # basin: everything connected to the lake below L_MAX
    below = H < L_MAX
    lab, _ = ndi.label(below)
    ids = np.unique(lab[lakefull])
    ids = ids[ids > 0]
    basin = np.isin(lab, ids)
    # sanity: the basin must not reach Lake Hamilton (flattened at ~120 m) downstream
    ham = np.abs(dem - 120.05) < 0.02
    leak = (basin & ham).sum()
    print("basin px", basin.sum(), "leak px into downstream water:", leak, flush=True)
    if leak:
        raise SystemExit("basin leaks past the dam; add a barrier")
    cls |= np.where(basin, C_BASIN, 0).astype(np.uint8)

    # other water bodies (fixed level): flattened areas outside the basin
    other = flat_water(dem, min_px=40) & ~basin
    static = np.where(other, dem + 0.03, static)
    cls |= np.where(other, C_OTHER, 0).astype(np.uint8)
    print("other water px", other.sum(), flush=True)
    return H.astype(np.float32), static.astype(np.float32), cls, basin, lakefull


def encode_tile(z, x, y, h, static=None, cls=None):
    n = h.shape[0]
    v = np.round((h.astype(np.float64) + 100.0) * 10.0).astype(np.int32)
    pred = np.zeros_like(v)
    pred[1:, 1:] = v[1:, :-1] + v[:-1, 1:] - v[:-1, :-1]
    pred[0, 1:] = v[0, :-1]
    pred[1:, 0] = v[:-1, 0]
    res = v - pred
    zz = ((res << 1) ^ (res >> 31)).astype(np.uint32)
    assert zz.max() < 65536, zz.max()
    zz = zz.astype(np.uint16)
    has_water = static is not None and (cls.any() or (static > -999).any())
    flags = 1 if has_water else 0
    parts = [b"DTO1", struct.pack("<BBHHHHH", z, 1, x, y, n, flags, 0),
             (zz & 0xFF).astype(np.uint8).tobytes(), (zz >> 8).astype(np.uint8).tobytes()]
    if has_water:
        w = np.where(static > -999, np.round((static + 100.0) * 10.0), 0).astype(np.uint16)
        parts += [(w & 0xFF).astype(np.uint8).tobytes(), (w >> 8).astype(np.uint8).tobytes(), cls.astype(np.uint8).tobytes()]
    return gzip.compress(b"".join(parts), 9), has_water


def window(arr, r0, c0, fill_edge=True):
    """(NB x NB) window whose core starts at (r0, c0); border replicated at edges."""
    hgt, wid = arr.shape
    rr = np.clip(np.arange(r0 - 1, r0 - 1 + NB), 0, hgt - 1)
    cc = np.clip(np.arange(c0 - 1, c0 - 1 + NB), 0, wid - 1)
    return arr[np.ix_(rr, cc)]


def downsample(arr, f, mode):
    """Decimate a corner-sampled grid by factor f (keeps corner alignment)."""
    if f == 1:
        return arr
    if mode == "height":
        a = ndi.gaussian_filter(arr, 0.45 * f)
    elif mode == "max":
        a = ndi.maximum_filter(arr, size=f + 1)
    elif mode == "mean":
        a = ndi.uniform_filter(arr.astype(np.float32), size=f + 1)
    else:
        a = arr
    return a[::f, ::f]


def downsample_height(H, cls, f):
    """Smooth heights, but inside the lake bed keep the cell's lowest bed sample, so narrow arms
    and channels stay below the waterline at coarse zoom (averaging lifts them onto their banks)."""
    if f == 1:
        return H
    g = ndi.gaussian_filter(H, 0.45 * f)
    bed = (cls & C_BED) > 0
    m = ndi.minimum_filter(np.where(bed, H, np.float32(1e9)), size=f + 1)
    out = np.where(m < 1e8, np.minimum(g, m), g)
    return out[::f, ::f]


def write_pyramid(H, static, cls, manifest):
    os.makedirs(OUT + "/t", exist_ok=True)
    x14, y14 = geo.Z12_X[0] * 4, geo.Z12_Y[0] * 4
    ntx = (geo.Z12_X[1] - geo.Z12_X[0] + 1) * 4
    nty = (geo.Z12_Y[1] - geo.Z12_Y[0] + 1) * 4
    total = 0
    for z in (14, 13, 12):
        f = 2 ** (14 - z)
        Hz = downsample_height(H, cls, f)
        Sz = downsample(static, f, 'max') if f > 1 else static  # keep narrow rivers at coarse levels
        basin_frac = downsample((cls & C_BASIN).astype(np.float32), f, "mean")
        Cz = cls[::f, ::f].copy()
        Cz = (Cz & ~np.uint8(C_BASIN)) | np.where(basin_frac > 0.001, C_BASIN, 0).astype(np.uint8)
        # coarse levels: keep fixed water only where the sample itself is water
        for ty in range(nty // f):
            for tx in range(ntx // f):
                r0, c0 = ty * N, tx * N
                h = window(Hz, r0, c0)
                s = window(Sz, r0, c0)
                c = window(Cz, r0, c0)
                X, Y = x14 // f + tx, y14 // f + ty
                data, hw = encode_tile(z, X, Y, h, s, c)
                open(f"{OUT}/t/{z}_{X}_{Y}.bin", "wb").write(data)
                total += len(data)
                core = h[1:-1, 1:-1]
                manifest.setdefault(str(z), {})[f"{X},{Y}"] = [round(float(core.min()), 1), round(float(core.max()), 1), int(hw)]
        print("z", z, "cumulative MB", total / 1e6, flush=True)
    return total


def build_wide(H, static, cls, manifest):
    """z11..z9 from the wide 3DEP grid with the region pasted in."""
    W = np.load(f"{CACHE}/dem_wide11.npy").astype(np.float32)
    W = np.where(np.isfinite(W) & (W > -100), W, np.nan)
    if np.isnan(W).any():
        W = np.where(np.isnan(W), np.nanmedian(W), W)
    x11, y11 = geo.Z9_X[0] * 4, geo.Z9_Y[0] * 4
    # region (z14 grid) decimated by 8 into the wide z11 grid
    Hr = downsample_height(H, cls, 8)
    Sr = downsample(static, 8, 'max')
    bas = downsample((cls & C_BASIN).astype(np.float32), 8, "mean")
    Cr = cls[::8, ::8].copy()
    Cr = (Cr & ~np.uint8(C_BASIN)) | np.where(bas > 0.001, C_BASIN, 0).astype(np.uint8)
    r_off = (geo.Z12_Y[0] * 4 // 8 - y11) * N + 0
    c_off = (geo.Z12_X[0] * 4 // 8 - x11) * N + 0
    # region z14 origin = z12 tile origin; z12 tile = 2 z11 tiles... use exact sample offsets
    r_off = (geo.Z12_Y[0] - y11 * 2) * (N // 2)
    c_off = (geo.Z12_X[0] - x11 * 2) * (N // 2)
    hr, wr = Hr.shape
    # feathered paste
    wgt = np.ones((hr, wr), np.float32)
    e = 6
    ramp = np.clip(np.minimum.reduce([np.arange(hr)[:, None] * np.ones((1, wr)), (hr - 1 - np.arange(hr))[:, None] * np.ones((1, wr)),
                                      np.ones((hr, 1)) * np.arange(wr)[None], np.ones((hr, 1)) * (wr - 1 - np.arange(wr))[None]]) / e, 0, 1)
    wgt = ramp.astype(np.float32)
    sub = W[r_off:r_off + hr, c_off:c_off + wr]
    W[r_off:r_off + hr, c_off:c_off + wr] = sub * (1 - wgt) + Hr * wgt
    S = np.full(W.shape, -1000, np.float32)
    C = np.zeros(W.shape, np.uint8)
    other = flat_water(W, min_px=30, tol=0.02)
    S = np.where(other, W + 0.05, S)
    C |= np.where(other, C_OTHER, 0).astype(np.uint8)
    S[r_off:r_off + hr, c_off:c_off + wr] = np.where(wgt > 0.999, Sr, S[r_off:r_off + hr, c_off:c_off + wr])
    C[r_off:r_off + hr, c_off:c_off + wr] = np.where(wgt > 0.999, Cr, C[r_off:r_off + hr, c_off:c_off + wr])
    total = 0
    nt = (geo.Z9_X[1] - geo.Z9_X[0] + 1) * 4
    for z in (11, 10, 9):
        f = 2 ** (11 - z)
        Wz = downsample(W, f, "height")
        Sz = S[::f, ::f]
        Cz = C[::f, ::f]
        for ty in range(nt // f):
            for tx in range(nt // f):
                r0, c0 = ty * N, tx * N
                h = window(Wz, r0, c0)
                s = window(Sz, r0, c0)
                c = window(Cz, r0, c0)
                X, Y = x11 // f + tx, y11 // f + ty
                data, hw = encode_tile(z, X, Y, h, s, c)
                open(f"{OUT}/t/{z}_{X}_{Y}.bin", "wb").write(data)
                total += len(data)
                core = h[1:-1, 1:-1]
                manifest.setdefault(str(z), {})[f"{X},{Y}"] = [round(float(core.min()), 1), round(float(core.max()), 1), int(hw)]
        print("wide z", z, "MB", total / 1e6, flush=True)
    return total


def hypsometry(H, static, cls):
    basin = (cls & C_BASIN) > 0
    b = H[basin].astype(np.float64)
    s = static[basin].astype(np.float64)
    cell = (geo.tile_size_m(14) / N * geo.SCALE) ** 2
    lev_ft = np.arange(355.0, L_MAX_FT + 0.01, 1.0)
    lev = lev_ft * geo.FT
    has = s > -999
    b0 = np.sort(b[~has])
    cs = np.concatenate([[0], np.cumsum(b0)])
    bs = b[has]; ss = s[has]
    area, vol = [], []
    for L in lev:
        k = np.searchsorted(b0, L)
        v = k * L - cs[k]
        a = k
        eff = np.maximum(L, ss)
        d = eff - bs
        v += d[d > 0].sum()
        a += (d > 0).sum()
        area.append(a * cell / 4046.86)
        vol.append(v * cell / 1233.48)
    return {"levels_ft": lev_ft.tolist(), "area_acres": [round(x, 1) for x in area],
            "volume_acft": [round(x) for x in vol]}


def outline():
    rings = json.load(open(f"{CACHE}/lake_rings.json"))

    def simplify(pts, tol):
        pts = np.array(pts)
        if len(pts) < 3:
            return pts
        keep = np.zeros(len(pts), bool)
        keep[0] = keep[-1] = True
        stack = [(0, len(pts) - 1)]
        while stack:
            a, b = stack.pop()
            if b <= a + 1:
                continue
            p, q = pts[a], pts[b]
            seg = q - p
            L = np.hypot(*seg) + 1e-12
            rel = pts[a + 1:b] - p
            dd = np.abs(seg[0] * rel[:, 1] - seg[1] * rel[:, 0]) / L
            i = int(np.argmax(dd))
            if dd[i] > tol:
                keep[a + 1 + i] = True
                stack += [(a, a + 1 + i), (a + 1 + i, b)]
        return pts[keep]

    out = {"outer": [], "inner": []}
    for role in ("outer", "inner"):
        for r in rings[role]:
            w = np.array([geo.lonlat_to_world(lon, lat) for lon, lat in r["coords"]])
            if np.allclose(w[0], w[-1]):
                w = w[:-1]
            k = len(w) // 2
            sw = np.concatenate([simplify(w[:k + 1], 12.0)[:-1], simplify(np.concatenate([w[k:], w[:1]]), 12.0)])
            if len(sw) >= 4:
                out[role].append([[round(float(x), 1), round(float(z), 1)] for x, z in sw])
    return out


def main():
    if len(sys.argv) > 1 and sys.argv[1] == "outline":
        json.dump(outline(), open(f"{OUT}/outline.json", "w"), separators=(",", ":"))
        return
    H, static, cls, basin, lakefull = build_region()
    manifest = {}
    t1 = write_pyramid(H, static, cls, manifest)
    t2 = build_wide(H, static, cls, manifest)
    print("tiles MB total", (t1 + t2) / 1e6)
    hyp = hypsometry(H, static, cls)
    stats = json.load(open(f"{CACHE}/bathy_stats.json"))
    bed = H[(cls & C_BED) > 0]
    tgt = stats["stats"] if "stats" in stats else stats
    tgt["bed_min_m"] = float(bed.min())
    tgt["max_depth_ft"] = float((geo.FULL_POOL_M - bed.min()) / geo.FT)
    i578 = hyp["levels_ft"].index(578.0)
    tgt["volume_acft"] = float(hyp["volume_acft"][i578]); tgt["area_acres"] = float(hyp["area_acres"][i578])
    i535 = hyp["levels_ft"].index(535.0)
    tgt["v535_acft"] = float(hyp["volume_acft"][i535])
    json.dump(stats, open(f"{CACHE}/bathy_stats.json", "w"))
    meta = {
        "version": 1, "n": NB, "core": N + 1,
        "zooms": {"region": [12, 14], "wide": [9, 11]},
        "lmax_ft": L_MAX_FT, "full_pool_ft": geo.FULL_POOL_FT,
        "tiles": manifest, "bathy": stats,
        "built": int(time.time()),   # data version: tile URLs carry it, so caches refresh only when tiles change
    }
    json.dump(meta, open(f"{OUT}/manifest.json", "w"), separators=(",", ":"))
    json.dump(hyp, open(f"{OUT}/hypsometry.json", "w"), separators=(",", ":"))
    json.dump(outline(), open(f"{OUT}/outline.json", "w"), separators=(",", ":"))
    np.save(f"{CACHE}/H_final.npy", H)
    np.save(f"{CACHE}/cls_final.npy", cls)
    i = hyp["levels_ft"].index(578.0)
    print("at 578 ft: area", hyp["area_acres"][i], "acres; volume", hyp["volume_acft"][i], "acft")


if __name__ == "__main__":
    main()

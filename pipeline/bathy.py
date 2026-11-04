"""Reconstruct a plausible pre-impoundment valley under Lake Ouachita.

There is no public bathymetric survey for the lake, so the bed is MODELLED:
  1. walls:   valley sides keep the slope of the land just above the shore
              (drowned-valley model), deepening with distance from shore;
  2. floor:   an alluvial floor descending toward the dam along the drowned
              river network (weighted geodesic distance: wide valley = gentle
              big-river gradient, narrow arm = steeper creek gradient);
  3. relief:  low east-west ridges in wide basins (Ouachita fold trend);
  4. grading: pits are filled (priority-flood + epsilon) like alluvial valley fill;
  5. channel: the old Ouachita River and its creeks traced by D8 flow on the
              graded valley, smoothed, given meanders and carved in;
  6. calibrated so full-pool volume / max depth match published USACE figures.
Everything here is a reconstruction for visualisation, not survey data.
"""
import heapq
import json
import math
import sys

import numpy as np
from scipy import ndimage as ndi
from scipy.sparse import csr_matrix
from scipy.sparse.csgraph import dijkstra

import geo

import os as _os
ROOT = _os.path.dirname(_os.path.dirname(_os.path.abspath(__file__)))  # repository root
CACHE = ROOT + "/cache"
STEP = geo.tile_size_m(geo.Z_DETAIL) / geo.TILE_N * geo.SCALE   # ~7.865 m true

P = dict(
    dam_lonlat=(-93.1946, 34.5735),
    floor_dam=118.4,          # valley-floor elevation at the dam (m), before channel
    g0=0.0016,                # floor gradient for a 100 m half-width valley
    g_exp=0.85,               # gradient ~ (halfwidth/100)^-g_exp
    g_min=0.001, g_max=0.02,
    wall_k=0.5,               # multiplier on shore slope
    shelf_k=0.5, shelf_d=80.0, # gentler near-shore shelf
    wall_min=0.10, wall_max=0.55,
    relief_amp=1.15,          # submerged ridges, fraction of depth
    channel_depth=4.0, channel_width=60.0,   # main river at the dam end
    river_water=1.8,          # river depth when the lake is gone (m)
    chan_area_km2=0.8,        # drainage area (inside lake) that starts a channel
    seed=7,
)

HIST_DR = None
NB8 = [(-1, -1), (-1, 0), (-1, 1), (0, -1), (0, 1), (1, -1), (1, 0), (1, 1)]


def grid_index(lon, lat):
    minx, miny, maxx, maxy = geo.region_merc_bounds()
    mx, my = geo.lonlat_to_merc(lon, lat)
    step_m = geo.tile_size_m(geo.Z_DETAIL) / geo.TILE_N
    return int(round((maxy - my) / step_m)), int(round((mx - minx) / step_m))


def value_noise(shape, scale_px, rng, aniso=(1.0, 1.0)):
    h, w = shape
    gh = int(h / (scale_px * aniso[0])) + 4
    gw = int(w / (scale_px * aniso[1])) + 4
    lat = rng.standard_normal((gh, gw)).astype(np.float32)
    up = ndi.zoom(lat, (h / (gh - 3), w / (gw - 3)), order=3)[:h, :w]
    return up / (up.std() + 1e-6)


def fbm(shape, base_px, octaves, rng, aniso=(1.0, 1.0), gain=0.5):
    out = np.zeros(shape, np.float32)
    amp, tot, s = 1.0, 0.0, base_px
    for _ in range(octaves):
        out += amp * value_noise(shape, s, rng, aniso)
        tot += amp
        amp *= gain
        s /= 2.0
    return out / tot


def geodesic(mask, cost, seeds):
    idx = -np.ones(mask.shape, np.int64)
    ys, xs = np.nonzero(mask)
    idx[ys, xs] = np.arange(len(ys))
    rows, cols, wts = [], [], []
    h, w = mask.shape
    for dy, dx in ((0, 1), (1, 0), (1, 1), (1, -1)):
        ln = math.hypot(dy, dx) * STEP
        y0, y1 = max(0, -dy), h - max(0, dy)
        x0, x1 = max(0, -dx), w - max(0, dx)
        a = idx[y0:y1, x0:x1]
        b = idx[y0 + dy:y1 + dy, x0 + dx:x1 + dx]
        ok = (a >= 0) & (b >= 0)
        ca = cost[y0:y1, x0:x1][ok]
        cb = cost[y0 + dy:y1 + dy, x0 + dx:x1 + dx][ok]
        rows.append(a[ok]); cols.append(b[ok]); wts.append(0.5 * (ca + cb) * ln)
    r = np.concatenate(rows); c = np.concatenate(cols); wv = np.concatenate(wts)
    g = csr_matrix((wv, (r, c)), shape=(len(ys), len(ys)))
    sidx = idx[seeds[:, 0], seeds[:, 1]]
    sidx = sidx[sidx >= 0]
    dist = dijkstra(g, directed=False, indices=sidx, min_only=True)
    out = np.full(mask.shape, np.inf, np.float32)
    out[ys, xs] = dist
    return out


def priority_flood(z, mask, seeds, eps=0.0):
    """Fill depressions so every mask cell drains to a seed. eps>0 adds a tiny
    gradient across filled flats (Barnes et al. 2014)."""
    h, w = z.shape
    out = z.astype(np.float64).copy()
    done = ~mask.copy()
    heap = []
    for y, x in seeds:
        if not done[y, x]:
            done[y, x] = True
            heapq.heappush(heap, (out[y, x], int(y), int(x)))
    zf = out
    while heap:
        v, y, x = heapq.heappop(heap)
        for dy, dx in NB8:
            ny, nx = y + dy, x + dx
            if ny < 0 or nx < 0 or ny >= h or nx >= w or done[ny, nx]:
                continue
            done[ny, nx] = True
            nv = zf[ny, nx]
            if nv <= v + eps:
                nv = v + eps
                zf[ny, nx] = nv
            heapq.heappush(heap, (nv, ny, nx))
    return zf.astype(np.float32)


def d8(z, mask):
    h, w = z.shape
    zp = np.pad(np.where(mask, z, np.inf), 1, constant_values=np.inf)
    best = np.zeros((h, w), np.float32)
    dirn = -np.ones((h, w), np.int8)
    for k, (dy, dx) in enumerate(NB8):
        zn = zp[1 + dy:1 + dy + h, 1 + dx:1 + dx + w]
        drop = (z - zn) / math.hypot(dy, dx)
        better = (drop > best) & mask
        best[better] = drop[better]
        dirn[better] = k
    order = np.argsort(-np.where(mask, z, -np.inf), axis=None)
    acc = np.where(mask, 1.0, 0.0).astype(np.float32).ravel()
    dflat = dirn.ravel()
    nbo = np.array([dy * w + dx for dy, dx in NB8])
    for cell in order[:int(mask.sum())]:
        d = dflat[cell]
        if d >= 0:
            acc[cell + nbo[d]] += acc[cell]
    return dirn, acc.reshape(h, w)


def trace_channels(dirn, acc, chan, rng, hw):
    """Vectorise the D8 channel network into smoothed, meandering polylines.
    Returns list of (points[N,2] (y,x float px), width[N] m, depth[N] m)."""
    h, w = dirn.shape
    amax = acc[chan].max()
    # heads: channel cells with no channel cell flowing into them
    inflow = np.zeros((h, w), np.int32)
    ys, xs = np.nonzero(chan)
    for y, x in zip(ys, xs):
        d = dirn[y, x]
        if d >= 0:
            ny, nx = y + NB8[d][0], x + NB8[d][1]
            if 0 <= ny < h and 0 <= nx < w and chan[ny, nx]:
                inflow[ny, nx] += 1
    heads = [(y, x) for y, x in zip(ys, xs) if inflow[y, x] == 0]
    visited = np.zeros((h, w), bool)
    lines = []
    for hy, hx in sorted(heads, key=lambda p: -acc[p]):
        pts = []
        y, x = hy, hx
        while True:
            pts.append((y, x))
            if visited[y, x]:
                break
            visited[y, x] = True
            d = dirn[y, x]
            if d < 0:
                break
            ny, nx = y + NB8[d][0], x + NB8[d][1]
            if not (0 <= ny < h and 0 <= nx < w) or not chan[ny, nx]:
                break
            y, x = ny, nx
        if len(pts) < 6:
            continue
        p = np.array(pts, np.float32)
        a = np.array([acc[int(q[0]), int(q[1])] for q in p], np.float32)
        lines.append((p, a))
    out = []
    for p, a in lines:
        n = len(p)
        # resample by arc length, then gaussian-smooth (ends pinned) to remove D8 stair-steps
        seg = np.hypot(*np.diff(p, axis=0).T)
        s_ = np.concatenate([[0], np.cumsum(seg)])
        if s_[-1] < 4:
            continue
        m = max(4, int(s_[-1] / 0.75))
        st = np.linspace(0, s_[-1], m)
        p = np.stack([np.interp(st, s_, p[:, 0]), np.interp(st, s_, p[:, 1])], 1)
        a = np.interp(st, s_, a)
        sig = float(np.clip((5.0 + 32.0 * np.sqrt(a[-1] / amax)) / 0.75, 6.0, 48.0))
        if HIST_DR is not None:
            hd = np.array([HIST_DR[int(q[0]), int(q[1])] for q in p], np.float32)
            if np.median(hd) < 250:
                sig = 4.0   # already following the surveyed river: keep its bends
        p0 = p.copy()
        ps = np.stack([ndi.gaussian_filter1d(p[:, 0], sig, mode="nearest"),
                       ndi.gaussian_filter1d(p[:, 1], sig, mode="nearest")], 1)
        tw = np.clip(np.minimum(np.arange(m), m - 1 - np.arange(m)) / (2 * sig), 0, 1)[:, None]
        p = ps * tw + p0 * (1 - tw)
        frac = np.sqrt(np.clip(a / amax, 0, 1))
        width = 5 + (P["channel_width"] - 5) * frac
        depth = 0.6 + (P["channel_depth"] - 0.6) * frac
        # meanders: perpendicular sinusoid, wavelength ~ 11 widths, amplitude limited by valley
        seg = np.diff(p, axis=0, prepend=p[:1])
        s = np.cumsum(np.hypot(seg[:, 0], seg[:, 1])) * STEP
        tang = np.gradient(p, axis=0)
        tang /= np.maximum(np.linalg.norm(tang, axis=1, keepdims=True), 1e-6)
        perp = np.stack([-tang[:, 1], tang[:, 0]], 1)
        lam = 11 * width
        phase = np.cumsum(np.diff(s, prepend=0) / lam) * 2 * math.pi
        hwv = np.array([hw[int(q[0]), int(q[1])] for q in p], np.float32)
        amp = np.minimum(1.3 * width, 0.28 * hwv)
        if HIST_DR is not None:
            hdv = np.array([HIST_DR[min(int(q[0]), HIST_DR.shape[0] - 1), min(int(q[1]), HIST_DR.shape[1] - 1)] for q in p], np.float32)
            amp = amp * np.clip((hdv - 250.0) / 600.0, 0, 1)
        wob = np.sin(phase + rng.uniform(0, 6.28)) + 0.35 * np.sin(2.3 * phase + rng.uniform(0, 6.28))
        taper = np.clip(np.minimum(s, s[-1] - s) / (3 * lam + 1), 0, 1)  # pin both ends
        off = (amp * wob * taper / STEP)[:, None] * perp
        p = p + off
        out.append((p, width, depth))
    return out


def rasterize_channels(lines, shape):
    """Distance-to-centreline field with per-pixel width/depth of nearest point."""
    h, w = shape
    seedmask = np.zeros(shape, bool)
    wid = np.zeros(shape, np.float32)
    dep = np.zeros(shape, np.float32)
    for p, width, depth in lines:
        # densify to ~0.5 px spacing
        seg = np.hypot(*np.diff(p, axis=0).T)
        reps = np.maximum(1, np.ceil(seg / 0.5)).astype(int)
        for i in range(len(p) - 1):
            t = np.linspace(0, 1, reps[i], endpoint=False)
            q = p[i][None] * (1 - t[:, None]) + p[i + 1][None] * t[:, None]
            yy = np.clip(np.round(q[:, 0]).astype(int), 0, h - 1)
            xx = np.clip(np.round(q[:, 1]).astype(int), 0, w - 1)
            newer = width[i] > wid[yy, xx]
            seedmask[yy, xx] = True
            wid[yy[newer], xx[newer]] = width[i]
            dep[yy[newer], xx[newer]] = depth[i]
    d, (iy, ix) = ndi.distance_transform_edt(~seedmask, return_indices=True)
    return d.astype(np.float32) * STEP, wid[iy, ix], dep[iy, ix], seedmask


def main(params=P, save=True, quick=False):
    P.update(params)
    rng = np.random.default_rng(P["seed"])
    dem_full = np.load(f"{CACHE}/dem_z14.npy")
    lake_full = np.load(f"{CACHE}/lake_lidar_mask.npy")
    ys_, xs_ = np.nonzero(lake_full)
    M = 400
    y0, y1 = max(0, ys_.min() - M), min(dem_full.shape[0], ys_.max() + M)
    x0, x1 = max(0, xs_.min() - M), min(dem_full.shape[1], xs_.max() + M)
    WIN = (int(y0), int(y1), int(x0), int(x1))
    dem_full_shape = dem_full.shape
    dem = dem_full[y0:y1, x0:x1].copy()
    lake = lake_full[y0:y1, x0:x1].copy()
    del dem_full, lake_full
    H, W = dem.shape
    top = geo.LIDAR_LAKE_M
    print("lake px", lake.sum(), "area km2", lake.sum() * STEP ** 2 / 1e6, flush=True)

    d, (iy, ix) = ndi.distance_transform_edt(lake, return_indices=True)
    d = d.astype(np.float32) * STEP

    gy, gx = np.gradient(dem.astype(np.float32), STEP)
    slope = np.hypot(gx, gy).astype(np.float32)
    del gx, gy
    dland = ndi.distance_transform_edt(~lake).astype(np.float32) * STEP
    band = (~lake) & (dland > 15) & (dland < 150)
    k = ndi.gaussian_filter(band.astype(np.float32), 6)
    s_band = ndi.gaussian_filter(np.where(band, slope, 0).astype(np.float32), 6) / np.maximum(k, 1e-4)
    inval = k < 1e-3
    _, (jy, jx) = ndi.distance_transform_edt(inval, return_indices=True)
    s_band = s_band[jy, jx]
    S = s_band[iy, ix]
    del iy, ix, jy, jx
    S = ndi.gaussian_filter(np.where(lake, S, 0).astype(np.float32), 12) / np.maximum(
        ndi.gaussian_filter(lake.astype(np.float32), 12), 1e-4)
    S = np.clip(S * P["wall_k"], P["wall_min"], P["wall_max"])

    hw = ndi.grey_dilation(np.where(lake, d, 0), size=(21, 21))
    hw = np.maximum(ndi.gaussian_filter(hw, 10), 20.0)
    G = np.clip(P["g0"] * (hw / 100.0) ** (-P["g_exp"]), P["g_min"], P["g_max"]).astype(np.float32)

    dj, di = grid_index(*P["dam_lonlat"])
    dj -= y0; di -= x0
    yy, xx = np.nonzero(lake[dj - 60:dj + 60, di - 60:di + 60])
    yy += dj - 60; xx += di - 60
    near = np.hypot(yy - dj, xx - di) * STEP < 250
    seeds = np.stack([yy[near], xx[near]], 1)
    T = P["floor_dam"] + geodesic(lake, G, seeds)
    T = np.where(np.isfinite(T), T, top)

    # near-shore shelf: slope ramps from shelf_k*S at the shore to S beyond shelf_d
    D = P.get('shelf_d', 1.0); sk = P.get('shelf_k', 1.0)
    ramp = np.where(d <= D, sk * d + (1 - sk) * d * d / (2 * D), sk * D + (1 - sk) * D / 2 + (d - D))
    # gorges: walls must still reach the valley floor at the valley axis (no sills at constrictions)
    hwr = np.where(hw <= D, sk * hw + (1 - sk) * hw * hw / (2 * D), sk * D + (1 - sk) * D / 2 + (hw - D))
    S = np.maximum(S, (top - T) / np.maximum(hwr, 25.0) * 1.03)
    wall = top - S * ramp
    Bs = np.maximum(wall, T)
    # soften the distance-field creases further from shore (U-shaped valley bottoms)
    w1 = ndi.gaussian_filter(Bs, 3); w2 = ndi.gaussian_filter(Bs, 9)
    t1 = np.clip((d - 40) / 120, 0, 1); t2 = np.clip((d - 200) / 400, 0, 1)
    Bs = Bs * (1 - t1) + (w1 * (1 - t2) + w2 * t2) * t1
    Bs = np.maximum(Bs, T)
    depth0 = top - Bs
    # submerged ridges/humps continuing the east-west Ouachita fold ridges
    warp_y = fbm((H, W), 160, 2, rng) * 18
    warp_x = fbm((H, W), 160, 2, rng) * 18
    base = fbm((H, W), 110, 3, rng, aniso=(1.0, 4.0))
    yy_, xx_ = np.mgrid[0:H, 0:W].astype(np.float32)
    rel = ndi.map_coordinates(base, [np.clip(yy_ + warp_y, 0, H - 1), np.clip(xx_ + warp_x, 0, W - 1)], order=1)
    del yy_, xx_, warp_x, warp_y, base
    rel = 1.0 - np.abs(rel)                    # ridged: peaks along lines
    rel = np.clip((rel - 0.35) / 0.65, 0, 1) ** 1.6
    wide = np.clip((hw - 120) / 350, 0, 1)
    hump = P["relief_amp"] * depth0 * wide * rel
    # keep the main valleys open: no ridges across the drowned river network (water gaps)
    zf0 = ndi.gaussian_filter(np.where(lake, Bs, top + 50), 2)
    _, acc0 = d8(zf0, lake)
    main = lake & (acc0 * STEP ** 2 / 1e6 > P.get("gap_area_km2", 3.0))
    dmain = ndi.distance_transform_edt(~main).astype(np.float32) * STEP
    hump = hump * np.clip((dmain - 120.0) / 450.0, 0, 1)
    del acc0, zf0
    Bs = np.minimum(Bs + hump, np.maximum(Bs, top - 4.0))
    # rock texture on the walls (scaled by wall steepness), silt-smooth floor
    rough = fbm((H, W), 24, 4, rng)
    onwall = np.clip((Bs - T) / 6.0, 0, 1)
    fade = np.clip(d / 40.0, 0, 1)
    Bs = Bs + rough * (0.25 + 9.0 * S * onwall) * fade
    Bs = np.minimum(Bs, top - 0.3 * fade)
    Bs = np.where(lake, Bs, top + 100).astype(np.float32)
    # 1890s USGS survey: the drawn Ouachita River course guides where the old channel runs
    try:
        from PIL import Image
        a = np.array(Image.open(ROOT + '/app/public/tex/oldmap.jpg')).astype(np.int16)
        blue = (a[..., 2] > a[..., 0] + 2) & (a[..., 2] > 90)
        blue = ndi.binary_closing(blue, iterations=2)
        lab_, n_ = ndi.label(blue)
        sz0 = ndi.sum(blue, lab_, np.arange(1, n_ + 1))
        k0 = np.zeros(n_ + 1, bool); k0[1:] = sz0 > 120
        blue = ndi.binary_closing(k0[lab_], iterations=6)   # bridge gaps where labels cut the line
        lab_, n_ = ndi.label(blue)
        sz_ = ndi.sum(blue, lab_, np.arange(1, n_ + 1))
        keep_ = np.zeros(n_ + 1, bool); keep_[1:] = sz_ > 120
        riv = keep_[lab_]
        fh, fw = dem_full_shape
        iy_ = (np.arange(fh) * riv.shape[0] / fh).astype(int); ix_ = (np.arange(fw) * riv.shape[1] / fw).astype(int)
        rivw = riv[np.ix_(iy_[y0:y1], ix_[x0:x1])]
        dr = ndi.distance_transform_edt(~rivw).astype(np.float32) * STEP
        # valley floor along the surveyed river: graded from the dam upstream along the river's own length
        rv = ndi.binary_dilation(rivw, iterations=2) & lake
        sy, sx = np.nonzero(rv)
        near_dam = np.hypot(sy - dj, sx - di) * STEP < 900
        if near_dam.any():
            rseeds = np.stack([sy[near_dam], sx[near_dam]], 1)
            # walk the lake preferring the drawn river (bridges gaps where labels break the line)
            along = geodesic(lake, np.where(rv, 1.0, 4.0).astype(np.float32), rseeds)
            along = np.where(rv, along, np.inf)
            _, (ky, kx) = ndi.distance_transform_edt(~rv, return_indices=True)
            al = along[ky, kx]
            al = np.where(np.isfinite(al), al, np.nan)
            zr = P["floor_dam"] + P.get("hist_grad", 0.00135) * al
            zr = np.minimum(zr, top - 1.5)
            # river sits a few metres below the local valley floor (T), banks rise away from it
            corridor = np.minimum(zr, T - 2.5) + np.maximum(0.0, dr - 100.0) * P.get("corr_slope", 0.45)
            ok = lake & np.isfinite(corridor) & (dr < 900)
            # the floodplain rises gently away from the river so flow keeps to the surveyed channel
            lift = P.get("plain_lift", 4.0) * np.clip((dr - 120.0) / 600.0, 0, 1) * (dr < 4000)
            Bs = np.where(lake, np.minimum(Bs + lift, top - 0.3), Bs)
            Bs = np.where(ok, np.minimum(Bs, corridor), Bs).astype(np.float32)
            print("historic corridor applied, river length km", float(np.nanmax(np.where(np.isfinite(along), along, np.nan))) / 1000, flush=True)
        print("historic river px", int(rivw.sum()), flush=True)
        global HIST_DR
        HIST_DR = dr
    except Exception as e:  # noqa: BLE001
        print("no historic guide:", e, flush=True)
    print("grading...", flush=True)
    Bg = priority_flood(Bs, lake, seeds, eps=0.0004)

    print("flow...", flush=True)
    dirn, acc = d8(Bg, lake)
    area_km2 = acc * STEP ** 2 / 1e6
    chan = lake & (area_km2 > P["chan_area_km2"])
    lines = trace_channels(dirn, acc, chan, rng, hw)
    print("channel lines", len(lines), flush=True)
    dc, wn, dn, cl = rasterize_channels(lines, (H, W))
    prof = np.clip(1 - (dc / np.maximum(wn * 0.5, 1)) ** 2, 0, 1)
    if HIST_DR is not None:
        # main stem = the surveyed 1890s river: carve it directly, drop flow-traced stems beside it
        near = np.clip((HIST_DR - 250.0) / 300.0, 0, 1)
        prof = prof * near
        ph = np.clip(1 - (HIST_DR / 32.0) ** 2, 0, 1) * lake
        wn = np.where(ph > prof, P["channel_width"], wn)
        dn = np.where(ph > prof, P["channel_depth"], dn)
        prof = np.maximum(prof, ph)
    inside = lake & (d > 6)
    B = Bg - (dn * prof) * inside
    B = np.minimum(B, top - 0.25 * fade)
    B = np.where(lake, B, dem).astype(np.float32)
    chan_mask = (prof > 0.02) & inside

    # pools: whatever depressions the carving left (mostly in-channel scour pools)
    Fp = priority_flood(np.where(lake, B, top + 100), lake, seeds, eps=0.0)
    pond = lake & (Fp - B > 0.2)
    lab, n = ndi.label(pond)
    if n:
        sz = ndi.sum(pond, lab, np.arange(1, n + 1))
        keep = np.zeros(n + 1, bool); keep[1:] = sz >= 6
        pond = keep[lab]
    riv_depth = P["river_water"] * np.clip(dn / P["channel_depth"], 0.15, 1)
    cen_bed = ndi.grey_erosion(np.where(chan_mask, B, 1e4), size=(5, 5))
    river_level = np.where(chan_mask, cen_bed + riv_depth, -1000)
    static = np.full((H, W), -1000, np.float32)
    static = np.where(pond, Fp, static)
    static = np.maximum(static, river_level).astype(np.float32)
    print("pond px", int(pond.sum()), "river px", int(chan_mask.sum()), flush=True)

    stats = report(B, lake, dem)
    if save:
        np.savez_compressed(f"{CACHE}/bathy_out.npz", B=B, lake=lake, chan=chan_mask, static=static,
                            pond=pond, d=d, window=np.array(WIN))
        json.dump({"params": {k: v for k, v in P.items()}, "stats": stats, "window": list(WIN),
                   "dam_px": [int(dj + y0), int(di + x0)]},
                  open(f"{CACHE}/bathy_stats.json", "w"), indent=1)
        preview(B, lake, chan_mask, static)
    return stats


def report(B, lake, dem):
    L = geo.FULL_POOL_M
    basin_land = (~lake) & (dem < L)
    lab, _ = ndi.label(lake | basin_land)
    ids = np.unique(lab[lake])
    basin = np.isin(lab, ids)
    dep = np.where(basin, np.maximum(L - B, 0), 0)
    vol_m3 = float(dep.sum()) * STEP ** 2
    area = float((dep > 0).sum()) * STEP ** 2
    L2 = 535 * geo.FT
    dep2 = np.where(basin, np.maximum(L2 - B, 0), 0)
    v535 = float(dep2.sum()) * STEP ** 2 / 1233.48
    st = dict(volume_acft=vol_m3 / 1233.48, v535_acft=v535, area_acres=area / 4046.86,
              max_depth_ft=float(dep.max() / geo.FT), mean_depth_ft=vol_m3 / area / geo.FT,
              bed_min_m=float(B[lake].min()))
    print(json.dumps(st), flush=True)
    return st


def preview(B, lake, chan, static):
    from PIL import Image
    s = B[::3, ::3]
    gy, gx = np.gradient(s, STEP * 3)
    hs = np.clip((-gx * 0.6 + gy * 0.6 + 1) / np.sqrt(gx ** 2 + gy ** 2 + 1) * 0.85, 0, 1)
    rgb = np.stack([hs, hs * 0.97, hs * 0.92], -1)
    lk = lake[::3, ::3]
    tint = np.array([0.82, 0.74, 0.62])
    rgb[lk] = rgb[lk] * tint
    rgb[(static[::3, ::3] > -999)] = [0.15, 0.35, 0.6]
    Image.fromarray((np.clip(rgb, 0, 1) * 255).astype(np.uint8)).save(f"{CACHE}/bathy_preview.png")
    # zoomed crop near the dam end
    Image.fromarray((np.clip(rgb, 0, 1) * 255).astype(np.uint8)).crop((900, 150, 1450, 560)).resize((1100, 820)).save(f"{CACHE}/bathy_zoom.png")


if __name__ == "__main__":
    if len(sys.argv) > 1:
        P.update(json.loads(sys.argv[1]))
    main()

"""Download USGS 3DEP elevation (public domain) on the exact Web Mercator sample grid.

Outputs (cache/):
  dem_z14.npy   float32 [H, W] samples at z14 tile corners over the detailed region
  dem_wide.npy  float32 samples at z10 tile corners over the wide horizon area
Samples sit on tile *corners* (i * tile/256), so adjacent tiles share edge samples.
"""
import io
import sys
import time
import urllib.request
from concurrent.futures import ThreadPoolExecutor

import numpy as np
from PIL import Image

import geo

URL = "https://elevation.nationalmap.gov/arcgis/rest/services/3DEPElevation/ImageServer/exportImage"
import os as _os
ROOT = _os.path.dirname(_os.path.dirname(_os.path.abspath(__file__)))  # repository root
CACHE = ROOT + "/cache"


def fetch_grid(minx, maxy, step, w, h, tries=6):
    """Fetch w*h samples centred at (minx + i*step, maxy - j*step)."""
    bx0 = minx - step / 2
    bx1 = minx + (w - 0.5) * step
    by1 = maxy + step / 2
    by0 = maxy - (h - 0.5) * step
    q = (f"?bbox={bx0},{by0},{bx1},{by1}&bboxSR=3857&imageSR=3857&size={w},{h}"
         "&format=tiff&pixelType=F32&interpolation=RSP_BilinearInterpolation&f=image")
    for k in range(tries):
        try:
            req = urllib.request.Request(URL + q, headers={"User-Agent": "drain-the-ouachita/0.1"})
            with urllib.request.urlopen(req, timeout=240) as r:
                data = r.read()
            a = np.array(Image.open(io.BytesIO(data)), dtype=np.float32)
            assert a.shape == (h, w), a.shape
            return a
        except Exception as e:  # noqa: BLE001
            print("retry", k, e, file=sys.stderr)
            time.sleep(2 + 3 * k)
    raise RuntimeError("fetch failed")


def fetch_region():
    z = geo.Z_DETAIL
    step = geo.tile_size_m(z) / geo.TILE_N
    nx = (geo.Z12_X[1] - geo.Z12_X[0] + 1)
    ny = (geo.Z12_Y[1] - geo.Z12_Y[0] + 1)
    per = 4 * geo.TILE_N  # samples per z12 tile at z14 density
    W, H = nx * per + 1, ny * per + 1
    out = np.full((H, W), np.nan, np.float32)
    jobs = []
    for j in range(ny):
        for i in range(nx):
            minx, _, _, maxy = geo.tile_bounds(12, geo.Z12_X[0] + i, geo.Z12_Y[0] + j)
            jobs.append((i, j, minx, maxy))

    def run(job):
        i, j, minx, maxy = job
        a = fetch_grid(minx, maxy, step, per + 1, per + 1)
        print("got", i, j, float(np.nanmin(a)), float(np.nanmax(a)), flush=True)
        return job, a

    with ThreadPoolExecutor(4) as ex:
        for (i, j, _, _), a in ex.map(run, jobs):
            out[j * per:(j + 1) * per + 1, i * per:(i + 1) * per + 1] = a
    np.save(f"{CACHE}/dem_z14.npy", out)
    print("region", out.shape, np.nanmin(out), np.nanmax(out), "nan", int(np.isnan(out).sum()))


def fetch_wide():
    z = 11
    step = geo.tile_size_m(z) / geo.TILE_N
    nx9 = geo.Z9_X[1] - geo.Z9_X[0] + 1
    ny9 = geo.Z9_Y[1] - geo.Z9_Y[0] + 1
    per = 4 * geo.TILE_N
    out = np.full((ny9 * per + 1, nx9 * per + 1), np.nan, np.float32)
    jobs = []
    for j in range(ny9):
        for i in range(nx9):
            minx, _, _, maxy = geo.tile_bounds(9, geo.Z9_X[0] + i, geo.Z9_Y[0] + j)
            jobs.append((i, j, minx, maxy))

    def run(job):
        i, j, minx, maxy = job
        a = fetch_grid(minx, maxy, step, per + 1, per + 1)
        print("wide got", i, j, float(np.nanmin(a)), float(np.nanmax(a)), flush=True)
        return job, a

    with ThreadPoolExecutor(3) as ex:
        for (i, j, _, _), a in ex.map(run, jobs):
            out[j * per:(j + 1) * per + 1, i * per:(i + 1) * per + 1] = a
    np.save(f"{CACHE}/dem_wide11.npy", out)
    print("wide", out.shape, np.nanmin(out), np.nanmax(out), "nan", int(np.isnan(out).sum()))


if __name__ == "__main__":
    what = sys.argv[1] if len(sys.argv) > 1 else "all"
    if what in ("wide", "all"):
        fetch_wide()
    if what in ("region", "all"):
        fetch_region()

"""Meta/WRI 1 m global canopy height (CC BY 4.0, Tolan et al. 2024) resampled to ~16 m
over the detailed region -> app/public/data/canopy.bin (gzip): 'CH01', u16 w, u16 h, then
w*h bytes of canopy height in 0.25 m units (0 = no canopy). Run with the cache venv (rasterio)."""
import gzip, math, struct, sys
import numpy as np
import rasterio
from rasterio.warp import reproject, Resampling
from rasterio.transform import from_bounds
import os as _os
ROOT = _os.path.dirname(_os.path.dirname(_os.path.abspath(__file__)))  # repository root
sys.path.insert(0, ROOT + '/pipeline')
import geo

BASE = '/vsicurl/https://dataforgood-fb-data.s3.amazonaws.com/forests/v1/alsgedi_global_v6_float/chm/'
OUT = ROOT + '/app/public/data/canopy.bin'

def quadkey(x, y, z):
    q = ''
    for i in range(z, 0, -1):
        m = 1 << (i - 1); d = (1 if x & m else 0) + (2 if y & m else 0); q += str(d)
    return q

minx, miny, maxx, maxy = geo.region_merc_bounds()
W, H = 3584, 2048  # ~16 m true
dst = np.zeros((H, W), np.float32)
tr = from_bounds(minx, miny, maxx, maxy, W, H)
lon0, lat0 = geo.merc_to_lonlat(minx, maxy); lon1, lat1 = geo.merc_to_lonlat(maxx, miny)
n = 512
def tx(lon): return int((lon + 180) / 360 * n)
def ty(lat): return int((1 - math.log(math.tan(math.radians(lat)) + 1 / math.cos(math.radians(lat))) / math.pi) / 2 * n)
import os
os.environ.setdefault('GDAL_DISABLE_READDIR_ON_OPEN', 'EMPTY_DIR')
for x in range(tx(lon0), tx(lon1) + 1):
    for y in range(ty(lat0), ty(lat1) + 1):
        q = quadkey(x, y, 9)
        with rasterio.Env(GDAL_HTTP_MULTIRANGE='YES', CPL_VSIL_CURL_ALLOWED_EXTENSIONS='.tif'):
            with rasterio.open(BASE + q + '.tif') as src:
                print(q, src.crs, src.res, src.overviews(1), flush=True)
                tmp = np.zeros((H, W), np.float32)
                reproject(rasterio.band(src, 1), tmp, dst_transform=tr, dst_crs='EPSG:3857', resampling=Resampling.average,
                          src_nodata=src.nodata, dst_nodata=0)
                dst = np.maximum(dst, tmp)
q = np.clip(np.round(dst * 4), 0, 255).astype(np.uint8)
open(OUT, 'wb').write(gzip.compress(b'CH01' + struct.pack('<HH', W, H) + q.tobytes(), 9))
print('canopy', W, H, 'mean m', float(dst[dst > 0].mean()), 'cover', float((dst > 3).mean()))

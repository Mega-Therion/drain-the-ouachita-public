"""1890s USGS 1:125,000 topographic quads (public domain), mosaicked and reprojected onto the
detailed region in Web Mercator -> app/public/tex/oldmap.jpg. Collars are cropped to each
quad's neatline (whole 30' cells). A small area is blurred for privacy."""
import sys, numpy as np
import rasterio
from rasterio.warp import reproject, Resampling, transform_bounds
from rasterio.transform import from_bounds
from PIL import Image, ImageFilter, ImageDraw
import os as _os
ROOT = _os.path.dirname(_os.path.dirname(_os.path.abspath(__file__)))  # repository root
sys.path.insert(0, ROOT + '/pipeline')
import geo
T = ROOT + '/cache/topo/'
QUADS = [('AR_Mount_Ida_260539_1890_125000_geo.tif', (-94.0, 34.5, -93.5, 35.0)),
         ('AR_Hot_Springs_260501_1894_125000_geo.tif', (-93.5, 34.5, -93.0, 35.0)),
         ('AR_Caddo_Gap_260444_1906_125000_geo.tif', (-94.0, 34.0, -93.5, 34.5))]
minx, miny, maxx, maxy = geo.region_merc_bounds()
W, H = 4096, 2340
tr = from_bounds(minx, miny, maxx, maxy, W, H)
out = np.zeros((3, H, W), np.uint8); have = np.zeros((H, W), bool)
for f, (lo0, la0, lo1, la1) in QUADS:
    with rasterio.open(T + f) as src:
        print(f, src.crs, src.count, src.width, src.height)
        bands = src.read()
        if bands.shape[0] == 1 and src.colormap(1):
            cmap = src.colormap(1); lut = np.zeros((256, 3), np.uint8)
            for k, v in cmap.items(): lut[k] = v[:3]
            bands = lut[bands[0]].transpose(2, 0, 1)
        bands = bands[:3]
        # neatline mask: only inside the quad's lon/lat cell
        for b in range(3):
            tmp = np.zeros((H, W), np.uint8)
            reproject(bands[b], tmp, src_transform=src.transform, src_crs=src.crs, dst_transform=tr, dst_crs='EPSG:3857', resampling=Resampling.bilinear)
            if b == 0: first = tmp
            cell = np.zeros((H, W), bool)
            # pixel -> lon/lat for the mask
            xs = minx + (np.arange(W) + 0.5) * (maxx - minx) / W
            ys = maxy - (np.arange(H) + 0.5) * (maxy - miny) / H
            lon = np.degrees(xs / geo.R); lat = np.degrees(2 * np.arctan(np.exp(ys / geo.R)) - np.pi / 2)
            m = ((lon >= lo0) & (lon < lo1))[None, :] & ((lat >= la0) & (lat < la1))[:, None]
            out[b][m] = tmp[m]
        have |= m
img = Image.fromarray(out.transpose(1, 2, 0))
# privacy blur around points listed in the (untracked) cache/privacy_blur.json
import json
pb = json.load(open(ROOT + '/cache/privacy_blur.json'))
lon_s, lat_s = pb['points'][0]
mx, my = geo.lonlat_to_merc(lon_s, lat_s)
px = (mx - minx) / (maxx - minx) * W; py = (maxy - my) / (maxy - miny) * H
r = pb['radius_m'] / geo.SCALE / ((maxx - minx) / W)
mask = Image.new('L', img.size, 0); ImageDraw.Draw(mask).ellipse([px - r, py - r, px + r, py + r], fill=255)
mask = mask.filter(ImageFilter.GaussianBlur(r * 0.15))
img = Image.composite(img.filter(ImageFilter.GaussianBlur(14)), img, mask)
img.save(ROOT + '/app/public/tex/oldmap.jpg', quality=82, optimize=True)
img.crop((int(px - 3 * r), int(py - 3 * r), int(px + 3 * r), int(py + 3 * r))).save('/tmp/claude-1000/-home-mega/6a3df807-fbb3-4433-84e5-abd55758e975/scratchpad/oldmap_check.jpg')
img.resize((1024, 585)).save('/tmp/claude-1000/-home-mega/6a3df807-fbb3-4433-84e5-abd55758e975/scratchpad/oldmap_prev.jpg')
print('coverage', have.mean())

"""NLCD 2021 land cover (MRLC WMS) for the detailed region -> app/public/data/landcover.bin (gzip).
Layout: 'LC01', u16 w, u16 h, then w*h class bytes (row 0 = north). Pixel (i,j) covers
merc x in [minx + i*dx, minx + (i+1)*dx], y in [maxy - (j+1)*dy, maxy - j*dy].
Classes: 0 water/none, 1 developed open, 2 developed, 3 barren, 4 deciduous, 5 evergreen,
6 mixed forest, 7 shrub, 8 grassland, 9 pasture, 10 crops, 11 woody wetland, 12 herbaceous wetland."""
import gzip
import struct
import numpy as np
from PIL import Image

import os as _os
ROOT = _os.path.dirname(_os.path.dirname(_os.path.abspath(__file__)))  # repository root
CACHE = ROOT + "/cache"
OUT = ROOT + "/app/public/data"
COLORS = {
    (71, 107, 160): 0, (209, 222, 248): 0, (221, 201, 201): 1, (216, 147, 130): 2, (237, 0, 0): 2, (170, 0, 0): 2,
    (178, 173, 163): 3, (104, 170, 99): 4, (28, 99, 48): 5, (181, 201, 142): 6, (165, 140, 48): 7, (204, 186, 124): 7,
    (226, 226, 193): 8, (219, 216, 61): 9, (171, 108, 40): 10, (186, 216, 234): 11, (112, 163, 186): 12,
}
a = np.array(Image.open(f"{CACHE}/nlcd.png").convert("RGB"))
h, w, _ = a.shape
out = np.zeros((h, w), np.uint8)
key = a[..., 0].astype(np.int32) * 65536 + a[..., 1].astype(np.int32) * 256 + a[..., 2]
for (r, g, b), c in COLORS.items():
    out[key == r * 65536 + g * 256 + b] = c
unk = ~np.isin(key, [r * 65536 + g * 256 + b for (r, g, b) in COLORS])
print("unknown px", int(unk.sum()))
data = b"LC01" + struct.pack("<HH", w, h) + out.tobytes()
open(f"{OUT}/landcover.bin", "wb").write(gzip.compress(data, 9))
print(w, h, np.bincount(out.ravel(), minlength=13))

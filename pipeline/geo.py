"""Shared geodesy + region config for the Drain-the-Ouachita data pipeline.

World frame used everywhere (pipeline and app): Web Mercator (EPSG:3857) metres,
scaled by cos(lat0) so one world unit ~= one true metre near the lake, with the
origin at the region centre, +x east, +z south (three.js: -z is north), +y up.
Mercator tiles are therefore exact axis-aligned squares in world space.
"""
import math

R = 6378137.0
ORIGIN_SHIFT = math.pi * R  # 20037508.342789244

# Detailed region = union of these z12 tiles (inclusive ranges).
Z_DETAIL = 14            # deepest baked zoom
Z12_X = (982, 988)
Z12_Y = (1626, 1629)
# Wide horizon area = these z9 tiles (inclusive).
Z9_X = (122, 124)
Z9_Y = (202, 204)

TILE_N = 256             # intervals per tile; files hold (TILE_N+1)^2 samples

# Lake constants (metres). Full pool 578 ft NGVD29; NAVD88-NGVD29 here is ~0.
FT = 0.3048
FULL_POOL_FT = 578.0
FULL_POOL_M = FULL_POOL_FT * FT       # 176.174
LIDAR_LAKE_M = 173.64                 # hydro-flattened lake surface in 3DEP lidar


def tile_size_m(z):
    return 2 * ORIGIN_SHIFT / (2 ** z)


def tile_bounds(z, x, y):
    """Mercator bounds (minx, miny, maxx, maxy) of XYZ tile."""
    s = tile_size_m(z)
    minx = -ORIGIN_SHIFT + x * s
    maxy = ORIGIN_SHIFT - y * s
    return minx, maxy - s, minx + s, maxy


def lonlat_to_merc(lon, lat):
    x = math.radians(lon) * R
    y = R * math.log(math.tan(math.pi / 4 + math.radians(lat) / 2))
    return x, y


def merc_to_lonlat(x, y):
    lon = math.degrees(x / R)
    lat = math.degrees(2 * math.atan(math.exp(y / R)) - math.pi / 2)
    return lon, lat


def region_merc_bounds():
    x0, y0 = Z12_X[0], Z12_Y[0]
    x1, y1 = Z12_X[1], Z12_Y[1]
    minx, _, _, maxy = tile_bounds(12, x0, y0)
    _, miny, maxx, _ = tile_bounds(12, x1, y1)
    return minx, miny, maxx, maxy


def wide_merc_bounds():
    minx, _, _, maxy = tile_bounds(9, Z9_X[0], Z9_Y[0])
    _, miny, maxx, _ = tile_bounds(9, Z9_X[1], Z9_Y[1])
    return minx, miny, maxx, maxy


# Region centre defines the world origin and the metric scale.
_minx, _miny, _maxx, _maxy = region_merc_bounds()
CENTER_MX = (_minx + _maxx) / 2
CENTER_MY = (_miny + _maxy) / 2
LON0, LAT0 = merc_to_lonlat(CENTER_MX, CENTER_MY)
SCALE = math.cos(math.radians(LAT0))   # mercator metres -> true metres


def merc_to_world(mx, my):
    """Mercator metres -> world (x east, z south) in ~true metres."""
    return (mx - CENTER_MX) * SCALE, -(my - CENTER_MY) * SCALE


def lonlat_to_world(lon, lat):
    return merc_to_world(*lonlat_to_merc(lon, lat))


if __name__ == "__main__":
    print("region merc", region_merc_bounds())
    print("center lon/lat", LON0, LAT0, "scale", SCALE)
    print("z14 tile true size", tile_size_m(14) * SCALE, "sample", tile_size_m(14) * SCALE / TILE_N)
    minx, miny, maxx, maxy = region_merc_bounds()
    print("region SW", merc_to_lonlat(minx, miny), "NE", merc_to_lonlat(maxx, maxy))
    print("region size km", (maxx - minx) * SCALE / 1000, (maxy - miny) * SCALE / 1000)
    minx, miny, maxx, maxy = wide_merc_bounds()
    print("wide SW", merc_to_lonlat(minx, miny), "NE", merc_to_lonlat(maxx, maxy))

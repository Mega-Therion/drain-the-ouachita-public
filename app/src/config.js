// Central configuration. World frame: Web Mercator metres scaled by cos(lat0),
// origin at the region centre, +x east, +z south, +y up (metres above sea level).

export const R = 6378137.0;
export const ORIGIN_SHIFT = Math.PI * R;

// Must match pipeline/geo.py
export const REGION = {
  z12x: [982, 988],
  z12y: [1626, 1629],
  z9x: [122, 124],
  z9y: [202, 204],
  detailZoom: 14,
  wideZoom: 10,
};

export const TILE_N = 256; // intervals per tile; data tiles carry (N+1)^2 samples

export const FT = 0.3048;
export const LAKE = {
  fullPoolFt: 578,
  fullPoolM: 578 * FT,
};

export const DATA_URL = '/data';

export const IMAGERY = {
  usgs: {
    name: 'USGS NAIP (public domain)',
    url: (z, x, y) => `https://basemap.nationalmap.gov/arcgis/rest/services/USGSImageryOnly/MapServer/tile/${z}/${y}/${x}`,
    maxZoom: 16,
    attribution: 'Imagery: USGS The National Map',
  },
  esri: {
    name: 'Esri World Imagery (high-res)',
    url: (z, x, y) => `https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/${z}/${y}/${x}`,
    maxZoom: 18,
    attribution: 'Imagery: Esri, Maxar, Earthstar Geographics',
  },
};

export const HD_TERRAIN = {
  url: 'https://elevation.nationalmap.gov/arcgis/rest/services/3DEPElevation/ImageServer/exportImage',
  minZoom: 15,
  maxZoom: 17,
};

export const QUALITY = {
  low: {
    label: 'Battery', gridRes: 32, lodK: 2.2, maxZoom: 16, shadow: 0, reflection: false,
    trees: 0.35, treeRadius: 260, clouds: 0, bloom: false, pixelRatio: [0.55, 1.0], msaa: 0, hd: false,
  },
  medium: {
    label: 'Balanced', gridRes: 48, lodK: 2.6, maxZoom: 17, shadow: 1024, reflection: false,
    trees: 0.6, treeRadius: 420, clouds: 1, bloom: true, pixelRatio: [0.6, 1.5], msaa: 0, hd: true,
  },
  high: {
    label: 'High', gridRes: 64, lodK: 3.0, maxZoom: 17, shadow: 2048, reflection: true,
    trees: 1.0, treeRadius: 650, clouds: 2, bloom: true, pixelRatio: [0.7, 2.0], msaa: 4, hd: true,
  },
  ultra: {
    label: 'Ultra', gridRes: 64, lodK: 3.6, maxZoom: 17, shadow: 4096, reflection: true,
    trees: 1.6, treeRadius: 900, clouds: 3, bloom: true, pixelRatio: [1.0, 2.0], msaa: 4, hd: true,
  },
};

export const TIMEZONE = 'America/Chicago';

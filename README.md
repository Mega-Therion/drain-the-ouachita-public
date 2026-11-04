# Drain the Ouachita

A 3D model of Lake Ouachita, Arkansas, that runs in a phone browser and lets you drain the lake. Fly over it like Google Earth, walk the shore at street level, dive under the surface, then lower the water to the old riverbed and walk the valley that has been underwater since the 1950s.

**Live:** https://drain-the-ouachita.vercel.app

## What's real and what's modelled

| Layer | Source |
|---|---|
| Land elevation | USGS 3DEP lidar (public domain), baked at about 8 m and streamed live at 1 m up close |
| Aerial imagery | Esri World Imagery or USGS NAIP, streamed |
| Lake outline, places | OpenStreetMap contributors (ODbL) |
| Pool levels, storage, dam facts | USACE Vicksburg District (CWMS), Encyclopedia of Arkansas |
| Fish attractors (288) | Arkansas Game & Fish Commission GPX |
| Land cover (where trees grow) | NLCD 2021 (MRLC) |
| Tree heights | Meta/WRI 1 m canopy height (CC BY 4.0) |
| Local history markers | Encyclopedia of Arkansas, Wikipedia (CC BY-SA, summarised), USGS GNIS, ARGenWeb |
| Native American history | Arkansas Archeological Survey (Trubitt), Encyclopedia of Arkansas; general areas only |
| Trails, main roads | OpenStreetMap contributors (ODbL) |
| Historical photos | Wikimedia Commons (per-photo licence), Library of Congress Chronicling America |
| Fishing conditions | USACE CWMS, USGS NWIS, NOAA NWS, Open-Meteo (CC BY 4.0) weather history |
| **Lake bed below the water** | **Reconstructed model**, calibrated to USACE storage (see below) |

No public bathymetric survey of Lake Ouachita exists, so the bed is modelled from the lidar shoreline:

- The valley walls continue underwater at the slope of the hills above the shore.
- An alluvial floor descends to the dam along the drowned river network. It is pinned to the 385 ft streambed at the dam and the 404 ft datum of the pre-dam river gauge.
- Gorges keep a channel open, and east-west ridges sit in the wide basins.
- The main river channel follows the Ouachita River as drawn on the 1890/1894 USGS surveys; creeks are traced by flow routing.

The model is calibrated so that full-pool area and storage match the Corps' figures (40,100 acres, 2,151,100 acre-ft at 578 ft). The calibration numbers are shown in the app under *About*. The shapes of individual hills and channels under the water are plausible, not surveyed. Not for navigation.

## Features

- **Earth, Fly, Walk and Dive** views with anchored pinch, twist and tilt gestures, momentum, and smooth wheel or trackpad zoom.
- **Drain** the lake along the real storage curve, or open it at today's Corps level.
- **History markers**: 51 sourced anchors, among them the west end, Mount Ida, the quartz crystals' deep time, and a Native history layer drawn from the Arkansas Archeological Survey (general areas only). Each opens a panel with dates, sources, photos and an AI "Ask" box that answers only from those sources.
- **Travel in time**: filter markers by period, from 280 million years ago to the lake era. Tours: `?tour=doc`, `?tour=west`, `?tour=native`.
- **Photos and newspapers**: openly licensed Wikimedia Commons photos and Library of Congress newspaper clippings, each credited.
- **Glowing trails**: mountain-bike trails, hiking trails and main roads light up from the ground, so trees and hills hide them naturally.
- **Fishing**: live conditions, an estimated water temperature, solunar windows, a crosshair scout report for any spot, and an AI fishing guide.
- **Share links**: `?poi=<id>`, `?panel=fish`, `?panel=photos`, `?view=lon,lat,range,heading,tilt`.

## Layout

- `pipeline/`: Python data pipeline. It fetches the DEM, outline, land cover and POIs, then runs the bathymetry reconstruction and cuts the tile pyramid.
- `app/`: Vite + three.js app with custom terrain LOD, water, atmosphere, clouds, vegetation and UI. It deploys to Vercel.

### Rebuild the data

```bash
cd pipeline
python3 fetch_dem.py all      # USGS 3DEP -> cache/
python3 osm_lake.py           # lake outline (needs cache/lake_full.osm from the OSM API)
python3 bathy.py              # reconstruct + calibrate the lake bed
python3 tiles.py              # tile pyramid, hypsometry, outline -> app/public/data
python3 landcover.py          # NLCD -> app/public/data/landcover.bin
python3 trails.py             # OSM trails/roads -> glowing highlight texture (add 'fetch' to refresh)
cache/venv/bin/python pois.py # places, history anchors, fish attractors -> pois.json
python3 photos.py             # openly licensed photos + newspaper clippings -> photos.json
python3 validate.py           # checks elevations, positions, storage; exits 1 on any failure
```

### Run the app

```bash
cd app && npm install && npm run dev
```

### Deploy

The Vercel project is connected to this repo with `app/` as its root folder, so every push to `main` deploys to production automatically.

## Licence

Code: Apache License 2.0 (see `LICENSE` and `NOTICE`). Data, imagery, text summaries and photos keep their own licences, listed above and in the app's About panel.

Created by R.W. Yett.

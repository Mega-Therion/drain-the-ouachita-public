# Public release checklist

The app is live at https://drain-the-ouachita.vercel.app. Every push to `main` deploys it. The GitHub repo is private. Work through this list before making the repo public, or before promoting the app widely.

## Data integrity (run every time the data changes)

- [x] `python3 pipeline/validate.py` passes. It checks:
  - every land marker against the USGS elevation service (3 m tolerance);
  - each marker's position against its primary source (150 m);
  - 578 ft storage and area against the USACE figures (1%);
  - privacy names in `pois.json`, `trails.json` and `photos.json`.
- [x] Every source link opens (link audit).
- [x] New history text quotes or summarises its cited source and claims nothing the source doesn't say.
- [x] Native history markers are general areas only, carry no depth readout, and say so on screen.

## Privacy

- [x] The private place names and radius live only in the untracked `cache/privacy_blur.json` and in the `ASK_BLOCKLIST` env var on Vercel. Nothing in the tracked code names them.
- [x] Published from a fresh history on 2026-11-04: https://github.com/Mega-Therion/drain-the-ouachita-public (this development repo stays private; earlier commits here contained the names).
- [x] No personal contact details anywhere on the site or in the repo.

## Licences and credits

- [x] About lists: USGS 3DEP and GNIS, Esri/USGS imagery, OpenStreetMap (ODbL), NLCD, the Meta/WRI canopy map (CC BY 4.0), USACE, AGFC, Encyclopedia of Arkansas, Wikipedia (CC BY-SA, summarised), the Arkansas Archeological Survey booklets, Wikimedia Commons (per-photo licence) and the Library of Congress.
- [x] Every photo shows its own author and licence in the viewer.
- [x] Code licence: Apache-2.0 (`LICENSE`, `NOTICE`). Data keeps its own licences, which are listed in the README.

## Product

- [x] Phone test at about 400 px wide (Chrome's real touch pipeline at 400×860; pinch, tilt, twist, flick, double-tap-drag, panel scroll):
  - info panel, ask box, gallery and viewer;
  - all tours, including `?tour=doc`, `?tour=west` and `?tour=native`;
  - share links (`?poi=<id>`).
- [x] The AI chat answers on the live site, or degrades to the map's own notes. The free tier allows about 50 AI answers a day.
- [x] Native history review by the Caddo Nation's historic preservation office: dropped from this release by RY (2026-11-04). The text is fully sourced to the Arkansas Archeological Survey and the Encyclopedia of Arkansas; a review can still be requested later.

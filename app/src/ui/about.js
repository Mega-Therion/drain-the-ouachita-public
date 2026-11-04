export function ABOUT_HTML(manifest, pois) {
  const st = (manifest && manifest.bathy && manifest.bathy.stats) || {};
  const n = (x) => (x ? Math.round(x).toLocaleString('en-US') : '—');
  return `
<p><b>Drain the Ouachita</b> is a 3D model of Lake Ouachita, Arkansas, that you can drain. Fly over it like Google Earth, walk the shore at street level, dive under the surface, then lower the water and walk the old Ouachita River valley that has been under the lake since the 1950s.</p>

<h4>What is real</h4>
<ul>
  <li>All land is <b>USGS 3DEP lidar</b> elevation, resampled to about 8 m (and streamed at 1 m up close).</li>
  <li>Aerial imagery is streamed live from Esri World Imagery or USGS NAIP.</li>
  <li>Lake levels, storage and dam facts come from the U.S. Army Corps of Engineers (Vicksburg District).</li>
  <li>The 288 fish-attractor brush piles are the Arkansas Game &amp; Fish Commission's published GPS points.</li>
  <li>Forests use measured tree heights from a 1 m satellite/lidar canopy map, and the 1890s layer is the original USGS survey of the valley before the dam.</li>
</ul>

<h4>What is reconstructed</h4>
<p>There is no public survey of the lake bottom, so the bed under the water is a <b>model</b>, not a measurement. It was built from the lidar shoreline:</p>
<ul>
  <li>The valley walls continue underwater at the slope of the hills just above the shore.</li>
  <li>An alluvial valley floor descends to the dam along the drowned river network.</li>
  <li>Low east-west ridges, following the Ouachita fold belt, sit in the wide basins.</li>
  <li>The main river channel follows the Ouachita River as drawn on the 1890 and 1894 USGS surveys; creeks are traced by water-flow routing.</li>
</ul>
<p>The model is calibrated to the Corps' published storage:</p>
<table style="width:100%;font-size:12.5px;border-collapse:collapse">
  <tr><td></td><td><b>USACE</b></td><td><b>Model</b></td></tr>
  <tr><td>Area at 578 ft</td><td>40,100 ac</td><td>${n(st.area_acres)} ac</td></tr>
  <tr><td>Storage at 578 ft</td><td>2,151,100 ac-ft</td><td>${n(st.volume_acft)} ac-ft</td></tr>
  <tr><td>Streambed at dam</td><td>385 ft</td><td>${st.bed_min_m ? Math.round(st.bed_min_m / 0.3048) : '—'} ft (model held to it)</td></tr>
</table>
<p>Individual hills, coves and channels under the water are plausible, not surveyed. Stumps, standing timber and foundation ruins on the bed are illustrative. Records describe the basin as cut over before filling, with stump fields left in most areas. <b>Not for navigation.</b></p>

<h4>How the numbers are checked</h4>
<p>Every marker's ground elevation is checked against the USGS elevation service (all within 1 m), marker positions against their sources, and the lake's storage against the Corps' figures. Depths under the water come from the modelled bed and are shown with "≈". Where a real measurement exists, such as the old river gauge's datum, the card shows it as documented.</p>

<h4>Fishing tools</h4>
<p>The fishing panel shows live lake level, inflow, wind, air temperature and barometric pressure, an hourly forecast, moon phase and solunar windows. No agency publishes Lake Ouachita's surface water temperature live, so the app <b>estimates</b> it from the last 60 days of air temperature the way a large lake responds (about a 12-day lag). Backtested against 23 Arkansas Division of Environmental Quality measurements of the lake (2011–2026), the estimate is typically within 1.9°F and within 3°F on 90% of dates. The scout report applies widely used angling rules of thumb to those numbers and to the spot under the crosshair. Depths in the shallow ring above about 570 ft were measured by lidar; deeper water uses the modelled bed. Commercial sonar charts are licensed products and are not used.</p>

<h4>Drain physics</h4>
<p>"Drain" releases about 10,000 cfs with no inflow, and "Refill" adds about 2,500 cfs. The water level follows the storage curve, so it drops slowly at first, while the lake is wide, and faster as it narrows. Low spots on the bed keep their own pools and the old river keeps flowing.</p>

<h4>Data &amp; credits</h4>
<ul>
  <li>Elevation: <a href="https://www.usgs.gov/3d-elevation-program" target="_blank" rel="noopener">USGS 3D Elevation Program</a> (public domain)</li>
  <li>Imagery: Esri, Maxar, Earthstar Geographics · USGS The National Map / USDA NAIP</li>
  <li>Lake outline &amp; places: © <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap contributors</a> (ODbL)</li>
  <li>Pool &amp; storage: USACE CWMS, Vicksburg District · History: Encyclopedia of Arkansas</li>
  <li>Fish attractors: Arkansas Game &amp; Fish Commission</li>
  <li>Tree heights: Meta &amp; World Resources Institute 1 m global canopy height map (Tolan et al. 2024, CC BY 4.0)</li>
  <li>1890s map layer: USGS Historical Topographic Map Collection (Mount Ida 1890, Hot Springs 1894, Caddo Gap 1906)</li>
  <li>Native American history: Arkansas Archeological Survey, <i>Indian History in the Lake Ouachita Region</i> (M. B. Trubitt) and <i>What's for Supper?</i> (Ouachita Chapter, Arkansas Archeological Society); Encyclopedia of Arkansas. Sites are shown as general areas only; they are protected by law.</li>
  <li>Local history: Encyclopedia of Arkansas (CALS), Wikipedia (text summarised, CC BY-SA), USGS GNIS place names, ARGenWeb Montgomery County</li>
  <li>Trails and roads: © OpenStreetMap contributors (ODbL)</li>
  <li>Historical photos: Wikimedia Commons contributors (each photo shows its own author and licence) · Newspapers: Library of Congress, Chronicling America</li>
  <li>Ground-truth checks: USGS Elevation Point Query Service; USGS NWIS gauges 07356000 and 07357000</li>
  <li>Fishing conditions: USACE CWMS (pool level), USGS NWIS (inflow; river temperature at Remmel Dam), NOAA National Weather Service (observations and forecast), weather history for the water-temperature estimate by <a href="https://open-meteo.com/" target="_blank" rel="noopener">Open-Meteo.com</a> (CC BY 4.0). Fish attractor locations: Arkansas Game &amp; Fish Commission.</li>
  <li>Ask feature: free AI models via OpenRouter, answering only from the sources above</li>
  <li>Rendering: three.js; trees adapted from ez-tree (MIT)</li>
</ul>
<p style="margin-top:14px;color:#9fb0bc">Created by R.W. Yett.</p>
`;
}

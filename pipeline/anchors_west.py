"""West-end history anchors (v2 schema): Washita, Mount Ida, the upper Ouachita arm.

Each anchor: id, name, kind, lat, lon, desc (one line), body (panel text), era, sources, conf.
  era:  {"from": year, "to": year|None, "label": str}; calendar years, negative = BC.
  conf: "documented" (place and facts sourced), "approximate" (fact sourced, exact spot not),
        "modelled" (derived from the reconstruction).
Text is our own summary of the cited sources; Wikipedia is CC BY-SA, so attribution is shown.
Coordinates: USGS GNIS (National Map geonames service), OpenStreetMap, or the cited Wikipedia article.
"""

EOA = "https://encyclopediaofarkansas.net/entries/"
WP = "https://en.wikipedia.org/wiki/"
AGS_QZ = "https://www.geology.arkansas.gov/docs/pdf/education/arkansas-quartz-crystals.pdf"
GNIS = "https://carto.nationalmap.gov/arcgis/rest/services/geonames/MapServer"


def S(title, url):
    return {"t": title, "u": url}


WEST = [
    dict(id="quartzveins", name="Quartz crystal veins form", kind="geology", lat=34.4891, lon=-93.6217,
         desc="Ouachita quartz grew from hot water in rock fractures about 280–245 million years ago.",
         body=("The quartz this area is famous for crystallised from hot, mineral-rich water that rose through fractures "
               "during the closing stages of the Ouachita mountain-building event, roughly 280 to 245 million years ago "
               "(Late Pennsylvanian to Permian). Radiometric dating of adularia, a feldspar that grew in some veins, supports "
               "that window. Most mined veins fill cracks in two Ordovician sandstones, the Crystal Mountain and Blakely "
               "sandstones, and the quartz belt runs about 30–40 miles long and 15 miles wide from near Little Rock to "
               "Oklahoma. Marker placed on the Crystal Mountains ridge (GNIS)."),
         era={"from": -280_000_000, "to": -245_000_000, "label": "≈280–245 million years ago"},
         sources=[S("Arkansas Geological Survey: Arkansas Quartz Crystals", AGS_QZ),
                  S("Arkansas Geological Survey: Quartz (Industrial)", "https://geology.arkansas.gov/minerals/industrial/Quartz-(Industrial).html"),
                  S("Encyclopedia of Arkansas: Official State Mineral", EOA + "official-state-mineral-3138/")],
         conf="approximate"),
    dict(id="washita", name="Washita", kind="history", lat=34.6529, lon=-93.5335,
         desc="Montgomery County community near the head of the lake's Ouachita River arm.",
         body=("Washita is a small Montgomery County community near the head of the lake's northwest arm, where the "
               "Ouachita River comes in. 'Washita' is the phonetic spelling of 'Ouachita', the French rendering of a Native "
               "American name. East and West Washita cemeteries sit beside the settlement. Little of its history is "
               "documented in published sources; local records, family papers and photos are the best way to fill it in."),
         era={"from": None, "to": None, "label": "Settlement date not documented"},
         sources=[S("USGS GNIS place record (Washita)", GNIS),
                  S("Encyclopedia of Arkansas: Ouachita County (name)", "https://encyclopediaofarkansas.net/explore-county/ouachita/"),
                  S("OpenStreetMap: East/West Washita cemeteries", "https://www.openstreetmap.org/node/358995204")],
         conf="documented"),
    dict(id="mountida", name="Mount Ida", kind="town", lat=34.5568, lon=-93.6341,
         desc="Montgomery County seat since 1842; known as the quartz crystal capital.",
         body=("Granville Whittington opened a post office here in June 1842 and named it Mount Ida after a hill near his "
               "former Massachusetts home. The county seat was first called Montgomery and briefly Salem (July 1850) before "
               "becoming Mount Ida in October 1850. The 'County House' log courthouse went up in 1846, and county records "
               "survive from July 1845. The Montgomery Hunters marched out to war on 17 July 1861, and Union troops held the "
               "town for several days in late 1863. Mount Ida incorporated on 30 May 1890 and had an all-woman city council in "
               "1931–32. Lake Ouachita brought tourists in the 1950s; today it is billed as the Quartz Crystal Capital of the World."),
         era={"from": 1842, "to": None, "label": "1842 – today"},
         sources=[S("Encyclopedia of Arkansas: Mount Ida", EOA + "mount-ida-943/"),
                  S("Wikipedia: Mount Ida, Arkansas (CC BY-SA)", WP + "Mount_Ida,_Arkansas")],
         conf="documented"),
    dict(id="courthouse", name="Montgomery County Courthouse", kind="landmark", lat=34.557778, lon=-93.632222,
         desc="1923 fieldstone courthouse; National Register of Historic Places, 1976.",
         body=("The current courthouse on Court Square was built in 1923 to a design by Clyde A. Ferrel. Its randomly laid "
               "fieldstone walls mix local rustic character with Classical Revival styling, including a pedimented entry "
               "with an oriel window. It replaced an 1873 frame building, which had replaced the 1846 log 'County House'. "
               "It holds the county's complete records from 1845 and was listed on the National Register in 1976."),
         era={"from": 1923, "to": None, "label": "Built 1923"},
         sources=[S("Wikipedia: Montgomery County Courthouse (Arkansas) (CC BY-SA)", WP + "Montgomery_County_Courthouse_(Arkansas)"),
                  S("Encyclopedia of Arkansas: Mount Ida", EOA + "mount-ida-943/")],
         conf="documented"),
    dict(id="citiesservice", name="Cities Service Filling Station", kind="landmark", lat=34.556389, lon=-93.633611,
         desc="Five-sided 1925 gas station on Whittington Street; NRHP 2001.",
         body=("Cities Service built this small five-sided station at 204 Whittington Street in 1925. Its hip roof extends "
               "into a canopy over the pumps on brick piers. It sold gas until 1966 and has since housed small businesses; "
               "it played a gas station again in the film White River Kid, shot here in 1998. National Register, 2001."),
         era={"from": 1925, "to": 1966, "label": "1925 – 1966 as a station"},
         sources=[S("Wikipedia: Mount Ida Cities Service Filling Station (CC BY-SA)", WP + "Mount_Ida_Cities_Service_Filling_Station")],
         conf="documented"),
    dict(id="heritagehouse", name="Heritage House Museum", kind="museum", lat=34.5471, lon=-93.6439,
         desc="Free-admission museum of Montgomery County history.",
         body=("The Heritage House Museum of Montgomery County is a not-for-profit, free-admission museum in Mount Ida, and "
               "the best place to see local artifacts, photographs and family histories of the valley."),
         era={"from": None, "to": None, "label": "Open today"},
         sources=[S("Encyclopedia of Arkansas: Mount Ida", EOA + "mount-ida-943/"),
                  S("OpenStreetMap", "https://www.openstreetmap.org/way/1002538485")],
         conf="documented"),
    dict(id="crystalmines", name="Crystal mining", kind="geology", lat=34.5141, lon=-93.6413,
         desc="From a 1904 claim to WWII radio crystals to dig-your-own mines.",
         body=("Crystal hunting here was mostly unregulated until 1942. The first quartz mining claim came in 1904. In World "
               "War II, Ouachita quartz suitable for radio oscillators was found at Fisher Mountain, and a quartz-buying "
               "office opened in Hot Springs in 1943. Synthetic crystals ended most industrial demand after the war. "
               "Production reached about 44,000 lb in 1987, and industrial lascas mining continued to 1997. Arkansas made "
               "quartz crystal its state mineral in 1967, and the World Championship Quartz Crystal Dig is held here each "
               "October. Today, fee mines let visitors dig and keep what they find. Marker at Wegner Crystal Mines (OSM)."),
         era={"from": 1904, "to": None, "label": "1904 – today"},
         sources=[S("Encyclopedia of Arkansas: Official State Mineral", EOA + "official-state-mineral-3138/"),
                  S("Encyclopedia of Arkansas: Montgomery County", EOA + "montgomery-county-793/"),
                  S("Encyclopedia of Arkansas: World Championship Quartz Crystal Dig", EOA + "world-championship-quartz-crystal-dig-4414/")],
         conf="documented"),
    dict(id="silvercity", name="Silver City boom (1876–1882)", kind="history", lat=34.5348, lon=-93.5102,
         desc="An 1880s silver rush brought 1,000+ people; every mine had closed by 1882.",
         body=("Lead and silver prospecting began before 1840 near Gap Creek. From 1874–75, miners from Colorado and "
               "California drifted in, and by 1880 the crossroads called Silver City reportedly had over 1,000 people. "
               "Hundreds of claims were worked, about three dozen shipped ore, and by the end of 1882 every mine had closed. "
               "The best known were the Minnesota, owned by riverboat magnate 'Diamond Jo' Reynolds, and the Walnut, owned by "
               "Joplin, Missouri's 'Lead King' Elliott Moffet. A brief revival followed the 1888 Bear gold rush, which turned "
               "out to be a fraud by crooked assayers. Marker at the GNIS place 'Silver'; the exact townsite is not confirmed."),
         era={"from": 1876, "to": 1882, "label": "Boom 1876 – 1882"},
         sources=[S("Encyclopedia of Arkansas: Silver Mining", EOA + "silver-mining-3182/"),
                  S("USGS GNIS place record (Silver)", GNIS)],
         conf="approximate"),
    dict(id="fir", name="Fir (vanished community)", kind="history", lat=34.5876, lon=-93.4391,
         desc="Big Fir and Little Fir died out; their names live on as lake recreation areas.",
         body=("GNIS lists 'Fir (historical)' here. The Encyclopedia of Arkansas notes that the Big Fir and Little Fir "
               "communities died out as farms and lumber companies sold land to the national forest, then came back as "
               "popular Lake Ouachita recreation areas. Big Fir and Little Fir cemeteries are still mapped near the lake (OpenStreetMap)."),
         era={"from": None, "to": 1952, "label": "Before the lake"},
         sources=[S("Encyclopedia of Arkansas: Montgomery County", EOA + "montgomery-county-793/"),
                  S("USGS GNIS historical place (Fir)", GNIS),
                  S("OpenStreetMap: Big Fir Cemetery", "https://www.openstreetmap.org/way/1326404139"),
                  S("OpenStreetMap: Little Fir Cemetery", "https://www.openstreetmap.org/way/1326404157")],
         conf="approximate"),
    dict(id="oakwood", name="Oakwood (Chalybeate Spring)", kind="history", lat=34.7109, lon=-93.3933,
         desc="Listed among the communities lost to Lake Ouachita.",
         body=("A Montgomery County history page lists Oakwood, also called Chalybeate Spring, with Old Buckville, Cedar "
               "Glades, Flea Bend and White Plains as communities under Lake Ouachita. GNIS places the historical Oakwood "
               "at the head of the north arm, beside today's Oakwood Cemetery and Mount Zion Church, so parts of the old "
               "community may have been above the waterline. 'Chalybeate' means iron-bearing spring water."),
         era={"from": None, "to": 1952, "label": "Before the lake"},
         sources=[S("ARGenWeb Montgomery County: Blakely Mountain Dam", "https://argenweb.net/montgomery/dam.htm"),
                  S("USGS GNIS historical place (Oakwood)", GNIS)],
         conf="approximate"),
    dict(id="murphycem", name="Murphy Cemetery", kind="history", lat=34.5259, lon=-93.4238,
         desc="Graves moved up from the valley floor before the flood were reburied here.",
         body=("The Corps of Engineers' 1951 'Relocation Plan of Cemeteries' for the Blakely Mountain Reservoir records 518 "
               "graves removed from sixteen cemeteries and reburied at Murphy Cemetery, about 14 miles east of Mount Ida near "
               "US 270. Relocations ran in mid-1952 as the gates closed. Family accounts note that some markers were never "
               "moved and that only recent graves were fully exhumed."),
         era={"from": 1951, "to": 1952, "label": "Relocations 1951 – 1952"},
         sources=[S("ARGenWeb: Relocated cemeteries (1951 COE plan)", "https://argenweb.net/montgomery/relocatedcem.htm")],
         conf="documented"),
    dict(id="mauldin", name="Mauldin (ghost town)", kind="history", lat=34.594, lon=-93.666,
         desc="Logging town of 300 that was dismantled and hauled away by rail in 1937.",
         body=("The Caddo River Lumber Company's railroad reached the Mauldin logging camp in the early 1920s, making it the "
               "county's logging centre. In 1936 a commissary and post office served about 300 people. In 1937, almost "
               "overnight, the town was dismantled and carried off by rail as the company pulled up its tracks; the virgin "
               "timber was gone. Much of the cut-over land became Ouachita National Forest."),
         era={"from": 1922, "to": 1937, "label": "≈1922 – 1937"},
         sources=[S("Encyclopedia of Arkansas: Montgomery County", EOA + "montgomery-county-793/"),
                  S("Wikipedia: Guinn Dipping Vat (CC BY-SA)", WP + "Guinn_Dipping_Vat")],
         conf="documented"),
    dict(id="guinnvat", name="Guinn Dipping Vat", kind="landmark", lat=34.5925, lon=-93.674444,
         desc="c.1940 concrete cattle-dipping vat from the fight against Texas tick fever; NRHP 2006.",
         body=("Mack Guinn built this U-shaped concrete vat around 1940 so local farmers could dip cattle to kill the ticks "
               "that spread Texas tick fever. It sits in the ghost town of Mauldin, south of Forest Road 37, and was listed "
               "on the National Register in 2006."),
         era={"from": 1940, "to": None, "label": "Built c.1940"},
         sources=[S("Wikipedia: Guinn Dipping Vat (CC BY-SA)", WP + "Guinn_Dipping_Vat")],
         conf="documented"),
    dict(id="womblehouse", name="Womble District Administration House", kind="landmark", lat=34.539444, lon=-93.6025,
         desc="CCC-built c.1940 ranger headquarters on US 270; NRHP 1993.",
         body=("A Civilian Conservation Corps crew built this one-and-a-half-floor frame house about 1940 as headquarters of the national "
               "forest's Womble District, on US 270 just west of Williams Stream. Theodore Roosevelt created the Arkansas "
               "National Forest in 1907; it was renamed the Ouachita National Forest in 1926, and 63% of the county "
               "eventually became forest land. National Register, 1993."),
         era={"from": 1940, "to": None, "label": "Built c.1940"},
         sources=[S("Wikipedia: Womble District Administration House No. 1 (CC BY-SA)", WP + "Womble_District_Administration_House_No._1"),
                  S("Encyclopedia of Arkansas: Montgomery County", EOA + "montgomery-county-793/")],
         conf="documented"),
    dict(id="ccc741", name="CCC Company 741 powder magazines", kind="landmark", lat=34.482222, lon=-93.608333,
         desc="Explosives stores of Arkansas's first CCC camp, c.1936; NRHP 2007.",
         body=("Camp 741 of the Civilian Conservation Corps, the first CCC camp established in Arkansas, built these two "
               "stone-and-concrete magazines around 1936 to store explosives for road and bridge building. The main "
               "magazine is 8 × 16 ft; the blasting-cap store is about 113 m to its northwest, off Forest Road 177M."),
         era={"from": 1936, "to": None, "label": "Built c.1936"},
         sources=[S("Wikipedia: CCC Company 741 Powder Magazine Historic District (CC BY-SA)", WP + "CCC_Company_741_Powder_Magazine_Historic_District")],
         conf="documented"),
    dict(id="collier", name="Collier Springs Shelter", kind="landmark", lat=34.483611, lon=-93.5925,
         desc="1939 CCC stone-and-log shelter built over a spring.",
         body=("CCC crews built this open stone shelter with hewn log beams in 1939. It covers the spring itself, which is "
               "piped to the nearby creek. It is one of the CCC works in the county listed on the National Register."),
         era={"from": 1939, "to": None, "label": "Built 1939"},
         sources=[S("Wikipedia: Collier Springs Picnic Area (CC BY-SA)", WP + "Collier_Springs_Picnic_Area"),
                  S("Encyclopedia of Arkansas: Montgomery County", EOA + "montgomery-county-793/")],
         conf="documented"),
    dict(id="womble", name="Womble Trail", kind="trail", lat=34.623433, lon=-93.554228,
         desc="37-mile IMBA Epic singletrack along the Ouachita River bluffs.",
         body=("This Forest Service singletrack runs more than 37 miles from North Fork Lake to the Ouachita National "
               "Recreation Trail, partly along bluffs above the Ouachita River. It is open to hikers and mountain bikers "
               "(no horses), marked with white triangles, and rated an IMBA Epic for about 6,000 ft of climbing."),
         era={"from": None, "to": None, "label": "Open today"},
         sources=[S("Wikipedia: Womble Trail (CC BY-SA)", WP + "Womble_Trail")],
         conf="documented"),
]

"""Native American history of the Lake Ouachita region (v2 anchors).

Primary source: Mary Beth Trubitt, "Indian History in the Lake Ouachita Region", Arkansas Archeological
Survey (AAS). Supporting: Encyclopedia of Arkansas (EOA) entries cited per anchor.

Respect and accuracy rules for this file:
- Every statement must come from a cited source; no tribe, date, artifact or place is inferred.
- Archaeological sites are protected by federal law and are never pinpointed. Each marker sits at a
  general point in the valley and says so; named excavated sites (Adair, Poole) are described, not located.
- Native history does not end at contact: the last marker carries it through removal to the Caddo Nation today.
"""

AAS = "https://archeology.uark.edu/wp-content/uploads/2026/04/Ouachita-Indians_acc.pdf"
AAS_T = "Arkansas Archeological Survey: Indian History in the Lake Ouachita Region (M. B. Trubitt)"
AAS_FOOD = "https://archeology.uark.edu/wp-content/uploads/2017/08/WhatsForSupper_NAFoods_OuachitaBooklet.pdf"
AAS_FOOD_T = "Arkansas Archeological Society, Ouachita Chapter: What's for Supper? Native American Foods in the Ouachita Mountains"
EOA = "https://encyclopediaofarkansas.net/entries/"
GEN = " This marker shows the general area only; archaeological sites are protected and are not mapped."


def S(t, u):
    return {"t": t, "u": u}


NATIVE = [
    dict(id="nat-overview", name="13,500 years in the Ouachita valley", kind="native", lat=34.598, lon=-93.345,
         desc="People lived in this valley for some 13,500 years before the lake; traces lie beneath the water.",
         body=("Before Blakely Mountain Dam, rural communities such as Buckville, Avant and Cedar Glades grew up in the "
               "Ouachita River valley between the 1880s and 1950. Beneath the lake are traces of much older communities: "
               "places where Native people lived over the past 13,500 years. That history is known from oral traditions, "
               "from explorers' written accounts, and from archaeology. Archaeological sites at Lake Ouachita are protected "
               "under federal historic preservation law; please do not dig into sites or remove artifacts." + GEN),
         era={"from": -11500, "to": 1835, "label": "≈11,500 BC – 1830s; descendants today"},
         sources=[S(AAS_T, AAS)], conf="approximate"),
    dict(id="nat-clovis", name="Ice Age hunters: Clovis and Dalton", kind="native", lat=34.578, lon=-93.205,
         desc="A quartz-crystal Clovis spear point was found during Blakely Mountain Dam construction.",
         body=("The earliest artifacts from this area date to the Paleoindian period, about 11,500–10,500 BC, when people "
               "across North America hunted mammoth, mastodon and bison with Clovis-tipped spears. Distinctive Clovis and "
               "Dalton points show small groups living in the Lake Ouachita region near the end of the Ice Age; Dalton "
               "hunters relied on deer as the climate changed. A Clovis point chipped from quartz crystal was discovered "
               "during construction of Blakely Mountain Dam (Arkansas Archeological Survey, Sargent Collection; described "
               "by Julie Morrow in 2002). Marker near the dam, where the source says it was found; no exact findspot is given."),
         era={"from": -11500, "to": -8500, "label": "≈11,500 – 8500 BC"},
         sources=[S(AAS_T, AAS), S("Encyclopedia of Arkansas: Montgomery County (Dalton culture)", EOA + "montgomery-county-793/")],
         conf="approximate"),
    dict(id="nat-archaic", name="Archaic river life and novaculite trade", kind="native", lat=34.567, lon=-93.30,
         desc="Net fishing, hickory nuts and novaculite tools traded as far as Louisiana and Mississippi.",
         body=("Rich game, fish and plants drew people to the Ouachita River valley. In the Middle Archaic, riverside "
               "settlements may have been lived in year-round. Notched pebble net weights show net fishing, especially in "
               "spring and early summer when catfish, gar, buffalo and largemouth bass gathered to spawn. Hickory nuts were "
               "a key food: archaeologists find nut-cracking anvil stones and charred nutshell on Archaic sites here. "
               "Novaculite, a hard, fine-grained stone like chert, was the preferred toolstone of the Ouachita Mountains. It "
               "was quarried from ridge-top outcrops, leaving pits, trenches and debris piles that are among the largest "
               "archaeological sites in Arkansas, many protected in the Ouachita National Forest and Hot Springs National "
               "Park. Novaculite tools reached Louisiana and Mississippi through long-distance trade, especially in the "
               "Middle and Late Archaic, about 6000–1000 BC." + GEN),
         era={"from": -6000, "to": -1000, "label": "≈6000 – 1000 BC (Middle–Late Archaic)"},
         sources=[S(AAS_T, AAS), S("Encyclopedia of Arkansas: Novaculite", EOA + "novaculite-2220/")],
         conf="approximate"),
    dict(id="nat-fourche", name="Fourche Maline villages (Woodland period)", kind="native", lat=34.62, lon=-93.265,
         desc="Woodland-period pottery makers, studied at the Poole site before the lake flooded it.",
         body=("Between about 1000 BC and AD 1000, people of the Fourche Maline culture (named for a creek in eastern "
               "Oklahoma) lived in the Lake Ouachita region; they were probably ancestral to the later Caddo. The Poole site, "
               "excavated by WPA crews before the lake was built, shows Fourche Maline communities making pottery and "
               "chipping dart points and tools from local stone, and a pattern of wall posts read as a long rectangular "
               "house. Native crops such as goosefoot, squash and sunflower likely supplemented hunting, fishing and "
               "gathering. Squash from recent excavations in Montgomery County is radiocarbon dated to AD 715–940, an early "
               "clue to farming in the Ouachita River valley." + GEN),
         era={"from": -1000, "to": 1000, "label": "≈1000 BC – AD 1000"},
         sources=[S(AAS_T, AAS)], conf="approximate"),
    dict(id="nat-caddo", name="Caddo farming villages and the Adair mounds", kind="native", lat=34.605, lon=-93.41,
         desc="Caddo farmers grew maize, squash and beans here; a Caddo mound center now lies under the lake.",
         body=("Caddo people were farmers. In Caddo oral tradition, the first Caddo woman came up onto the earth carrying "
               "corn and pumpkin seeds. Archaeologists find Caddo farming villages along the Ouachita River, with charred "
               "maize, squash, beans and goosefoot on sites dating from the 1300s to 1600s. The Adair site, a Caddo mound "
               "center excavated by WPA crews in 1939, now lies under Lake Ouachita. Crews mapped several mounds there, one "
               "14 ft high; a trench through it showed a series of burned and rebuilt buildings, and elsewhere they found "
               "the posts of large circular houses and a cemetery area. Caddo communities were usually farmsteads spread "
               "out around a mound center, with thatched round houses that early observers likened to beehives." + GEN),
         era={"from": 1300, "to": 1700, "label": "≈1300s – 1600s on sites here"},
         sources=[S(AAS_T, AAS), S("Encyclopedia of Arkansas: Caddo Nation", EOA + "caddo-nation-549/")],
         conf="approximate"),
    dict(id="nat-food", name="What was for supper, 600 years ago", kind="native", lat=34.585, lon=-93.545,
         desc="Deer, turkey, fish, turtles, river mussels and hickory nuts, from excavations in the national forest.",
         body=("Excavations in the Ouachita National Forest have recovered animal bone, mussel shell and charred nuts and "
               "seeds from old refuse pits. Caddo people living here about 600 years ago hunted deer, turkeys, rabbits and "
               "squirrels with bows and arrows (earlier people used spears), caught turtles and fish, collected mussels from "
               "the Ouachita River, and gathered large quantities of nuts. Survey researchers have published foodways "
               "results from 2013–14 excavations at a Montgomery County site." + GEN),
         era={"from": 1400, "to": 1500, "label": "≈600 years ago"},
         sources=[S(AAS_FOOD_T, AAS_FOOD), S(AAS_T, AAS)], conf="approximate"),
    dict(id="nat-removal", name="Removal, and the Caddo Nation today", kind="native", lat=34.635, lon=-93.455,
         desc="The 1835 treaty took Caddo land in Arkansas; the Caddo Nation's government is in Oklahoma today.",
         body=("Caddo people enter written history with the de Soto–Moscoso expedition in 1542. By the time settlers reached "
               "the Ouachita River in the early 1800s, no Native people were living in the valley. The final loss of Caddo "
               "homelands in Arkansas came in 1835, when Caddo headmen were coerced into signing a treaty ceding all Caddo "
               "land, never again to live there as a group. After a long journey, the Caddo Nation's seat of government is "
               "now in Caddo County, Oklahoma, five miles east of Binger, where the Caddo Heritage Museum is located. In 2006 "
               "the federally recognized Caddo Nation of Oklahoma listed 4,774 members, all lineal descendants of the "
               "ancient Caddo Nation. Caddo names remain on Arkansas maps, and Caddo people remember these homelands."),
         era={"from": 1542, "to": None, "label": "1542 – today"},
         sources=[S("Encyclopedia of Arkansas: Caddo Nation", EOA + "caddo-nation-549/"), S(AAS_T, AAS),
                  S("Encyclopedia of Arkansas: Indian Removal", EOA + "indian-removal-2595/")],
         conf="documented"),
]

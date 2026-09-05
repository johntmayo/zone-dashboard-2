# Map Basemap Roadmap

**Created:** August 27, 2026  
**Status:** Approved branded-map phases implemented September 2026.
**Companion docs:** `MAPS.md` (how maps work today), `ZONE_DASHBOARD_STYLE_GUIDE.md` (brand)

This records the implemented architecture and remaining non-goals. Esri is
still the automatic street fallback and the Satellite provider.

---

## 1) Current implementation

The main `zoneMap`, Home `homeMap`, and Lot Weeding Command Center map use one
local CARTO Voyager-derived vector style rendered with MapLibre GL through the
MapLibre-GL-Leaflet bridge. Leaflet remains the controller. Batch Tagging and
other incidental maps retain the existing Esri streets.

The style is warm and editorial, reduces POIs, shows restrained OSM-derived
building outlines as historical/reference context at Leaflet z18+, and keeps
collision-aware house numbers subordinate at Leaflet z18+. A runtime CARTO key
is used when configured; currently available unkeyed vector access avoids
blocking startup. MapLibre/WebGL/style startup failures fall back to Esri
streets. Satellite remains Esri imagery hybrid where an existing toggle is
present (Main and Home); no Lot Weeding satellite mode was added.

The three approved maps use one lifecycle-safe factory with style/key reuse,
visibility-aware startup, resize hooks, generation/map/layer guards, startup
timeout and post-load failure handling, and clean MapLibre/WebGL teardown.

The main map also has automatic, non-toggleable viewport-loaded LA County
assessor lot lines at Leaflet z17+.

---

## 2) Constraints the map must respect

**Post-fire Altadena.** About half the structures burned. Commercial basemaps
(CARTO, Mapbox Streets, Esri Streets, Google) may draw **pre-fire building
footprints**. The main map therefore presents OSM-derived mapped structures only
as restrained historical/reference context. The exact visible Layers wording is:
**Structure shapes update periodically and may be inaccurate.**

**House numbers are contextual, not authoritative.** They are visible but
quiet and collision-aware from Leaflet z18+. The MapLibre style uses minzoom 17
to account for the bridge's `Leaflet zoom - 1` offset. Spreadsheet pins remain the addresses
that count.

**Lot lines remain the operational geometry.** The house can be gone; the parcel
(APN) is not. Captains already work in APNs (EPIC, lot weeding). Lot geometry
comes from **LA County parcels**. Building outlines are secondary reference
context only and never current-condition or damage data.

**Geography and scale are small.** ~170 volunteers today, maybe 500. Occasional use, not all-day GIS. Only Altadena and bits of Pasadena. Mapbox’s free **50,000 map loads/month** (GL JS / MapLibre) is plenty at this scale. The gray map after one day was almost certainly a bad Leaflet raster recipe, not a blown free tier.

**Brand.** Altogether is warm paper (`#FDFBF7`), navy structure (`#314059`), gold CTAs, Altagether green, earthy teal **only** for map markers and data — see the style guide. The map should eventually feel like the rest of the product, not like a generic GIS export.

---

## 3) Target architecture

Split the map into two jobs:

| Layer | Job | Source |
|---|---|---|
| **Basemap** | Quiet streets, labels, and secondary historical/reference structure outlines. Canvas only. | Local CARTO Voyager-derived style and existing CARTO/OpenMapTiles source, rendered with MapLibre; optional CARTO key |
| **Operational overlays** | Truth for captains | Existing pins/boundaries/VectorGrid overlays plus viewport-loaded **county lot lines** |

Do **not** bake county lot lines or restricted LARIAC footprints into the
basemap style. The only structure geometry in the style is the existing
OSM-derived CARTO/OpenMapTiles `building` source-layer.

Do **not** use deprecated CARTO raster tiles. The implementation uses CARTO's
vector source and a local customized style with restrained reference buildings.

Do **not** put Mapbox styles into Leaflet as PNG tiles (`Static Tiles API`). That is per-tile billing and is the path that went gray. Mapbox is fine **as a vector style** (MapLibre / Mapbox GL), where a map load includes tiles.

---

## 4) Phases

### Phase 0 — Fallback foundation (done)

- Esri street basemap with fallbacks
- Service worker no longer caches dashboard HTML
- Document this plan and stop

### Phase 1 — Altogether basemap (done)

1. Maintain the local CARTO-derived style:
   - Paper-colored land, navy labels, quiet roads
   - OSM-derived buildings as faint, solid historical/reference outlines from
     Leaflet z18+, below roads, labels, and house numbers
   - House numbers quiet and collision-aware at Leaflet z18+
   - Teal reserved for our markers, not for roads/water
2. Render with **MapLibre** under existing Leaflet markers/overlays.
3. Keep Esri as automatic backup if MapLibre/WebGL/style startup fails.
4. Recheck satellite imagery recency over Altadena. If Esri World Imagery is still pre-fire, aerial mode has the same ghost-building problem as footprints.

Expected look: a street map that reads as Altogether, with pins as the address
layer and mapped structures clearly secondary.

### Phase 2 — Lot lines (done)

- LA County assessor parcels are automatic operational context and cannot be
  disabled from desktop, mobile, or the public map-controls bridge.
- Render/fetch only at Leaflet z17+ with solid, subtle, no-fill lines that ramp
  from opacity/weight `0.175/0.4375` at z17 to `0.28/0.70` at z20.
- Use ID-first viewport queries, URL-bounded batches (150 IDs and less than
  1,800 encoded characters), at most three concurrent geometry requests,
  abort/stale protection, and a 7,500-feature reuse cache.
- A dedicated Leaflet canvas renderer draws every current-viewport parcel; no
  feature cap silently removes lines from dense views. Do not persist a
  countywide copy.
- County attribution is registered when the main map initializes and remains
  registered even below z17 when no parcel geometry is drawn.
- APN labels and parcel interactions are intentionally absent by default.

This is the operational geometry that matches how the work is done; structure
outlines remain reference context rather than parcel or condition data.

### Phase 3 — Optional polish (only if captains ask)

- Mapbox Studio tweaks after real use (label density, park color, contrast with teal pins)
- If aerials are post-fire and captains prefer them, consider aerial-as-default with a street toggle instead of the reverse
- Full MapLibre migration of overlays so Leaflet is no longer in the stack

---

## 5) Explicit non-goals

- Paid Mapbox / Google / MapTiler contracts. Scale does not justify them.
- Public OpenStreetMap tile server as the primary basemap (usage policy).
- Hiding CARTO watermarks or scraping tiles without a key.
- Treating any vendor’s building outlines as current conditions in the fire area.
- Exposing the researched 2023 LARIAC structure-footprint endpoint while its
  metadata says **“LARIAC Members only.”**
- Using dotted/dashed structure footprints as a generic reference layer:
  post-fire, that treatment could falsely imply fire loss.

---

## 6) Operational follow-up

1. Configure `CARTO_API_KEY` or `CARTO_BASEMAP_KEY` in production. Unkeyed
   access is graceful behavior, not a long-term credential plan.
2. Periodically verify CARTO source/glyph/sprite URLs and LA County service
   metadata/terms.
3. Recheck Esri aerial recency over Altadena.
4. Keep branded-map changes scoped to `zoneMap`, `homeMap`, and the Lot Weeding
   Command Center. Batch Tagging, Add Record, Move Pin, and other incidental
   maps remain outside the approved scope.

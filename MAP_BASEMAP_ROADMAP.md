# Map Basemap Roadmap

**Created:** August 27, 2026  
**Status:** Current street map is **good enough**. Do not prioritize this over other work.  
**Companion docs:** `MAPS.md` (how maps work today), `ZONE_DASHBOARD_STYLE_GUIDE.md` (brand)

This is the plan for what the map *should* become. The live app stays on Esri until someone has time to do the later phases on purpose.

---

## 1) What “good enough” is right now

Street view uses **Esri World Street Map** (same host as satellite). If those tiles fail, the map automatically tries a second Esri host, Esri World Topo, then OpenStreetMap. No CARTO key. No Mapbox raster tiles.

That exists because:

1. CARTO Voyager started watermarking unauthenticated raster tiles (`API KEY REQUIRED`).
2. The follow-up used Mapbox Streets as Leaflet PNG tiles. Pins and zone outlines still loaded; the background went gray. That path is **not** how we should use Mapbox.
3. The service worker no longer caches `index.html`, and a new worker reloads once so deploys apply without a manual cache clear.

Satellite (Esri imagery hybrid) is unchanged.

This is reliable. It is not the long-term look.

---

## 2) Constraints that any future map must respect

**Post-fire Altadena.** About half the structures burned. Commercial basemaps (Carto, Mapbox Streets, Esri Streets, Google) draw **pre-fire building footprints**. At captain zoom those look official and they are wrong: ghosts of burned houses, empty lots that look occupied.

**House numbers on basemaps are not trustworthy.** Voyager was already missing numbers or placing them wrong. In a burn zone that gets worse. The spreadsheet pins are the addresses that count. A future style should keep house numbers off or very faint.

**Lot lines matter; building outlines do not.** The house can be gone; the parcel (APN) is not. Captains already work in APNs (EPIC, lot weeding). Lot geometry should come from **LA County parcels**, not from a vendor’s decorative “lots.”

**Geography and scale are small.** ~170 volunteers today, maybe 500. Occasional use, not all-day GIS. Only Altadena and bits of Pasadena. Mapbox’s free **50,000 map loads/month** (GL JS / MapLibre) is plenty at this scale. The gray map after one day was almost certainly a bad Leaflet raster recipe, not a blown free tier.

**Brand.** Altogether is warm paper (`#FDFBF7`), navy structure (`#314059`), gold CTAs, Altagether green, earthy teal **only** for map markers and data — see the style guide. The map should eventually feel like the rest of the product, not like a generic GIS export.

---

## 3) Target architecture

Split the map into two jobs:

| Layer | Job | Source |
|---|---|---|
| **Basemap** | Quiet streets + labels. Canvas only. | Custom Mapbox Studio style, rendered with MapLibre, using the existing Mapbox token |
| **Operational overlays** | Truth for captains | Existing: pins, zone boundary, fire perimeter, water districts. Later: **county lot lines** joined on APN |

Do **not** bake lot lines or building footprints into the basemap style.

Do **not** go back to CARTO Voyager (even with a free key). It failed on buildings and addresses, and CARTO is retiring those raster tiles.

Do **not** put Mapbox styles into Leaflet as PNG tiles (`Static Tiles API`). That is per-tile billing and is the path that went gray. Mapbox is fine **as a vector style** (MapLibre / Mapbox GL), where a map load includes tiles.

---

## 4) Phases

### Phase 0 — Now (done)

- Esri street basemap with fallbacks
- Service worker no longer caches dashboard HTML
- Document this plan and stop

### Phase 1 — Altogether basemap (when map work is actually the priority)

1. In Mapbox Studio, create a style owned by the `altagether` account:
   - Paper-colored land, navy labels, quiet roads
   - **Buildings off**
   - **House numbers off** (or barely there)
   - Teal reserved for our markers, not for roads/water
2. Render that style with **MapLibre** under the existing Leaflet markers/overlays (keep Leaflet for pins and GeoJSON until a later migration, or move markers if that is simpler).
3. Keep Esri (or the current fallback chain) as an automatic backup if the Mapbox token or style fails.
4. Recheck satellite imagery recency over Altadena. If Esri World Imagery is still pre-fire, aerial mode has the same ghost-building problem as footprints.

Expected look: a street map that reads as Altogether, with pins as the address layer.

### Phase 2 — Lot lines (after Phase 1, or in parallel if parcels are needed sooner)

- Add LA County assessor parcels as a **toggle overlay**, same family as water districts / fire perimeter.
- Join on APN (already on sheet rows, EPIC, lot weeding).
- Default off or on by zoom — lot lines at z16+ are useful; at city-scale they are noise.
- Click/hover can show APN; do not duplicate the whole details panel on the polygon.

This is the “nice map that matches how the work is done” step: parcel, not footprint.

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

---

## 6) How to pick this up later

When map work is the priority again:

1. Read this file and `MAPS.md`.
2. Confirm `MAPBOX_PUBLIC_TOKEN` still works in Mapbox Studio.
3. Build the Studio style with buildings and house numbers off.
4. Swap only the street basemap; leave pin/overlay behavior alone until the new canvas is trusted.
5. Then add county parcels.

Until then, Esri streets + satellite toggle is the supported map.

# Maps Documentation (Zone Dashboard)

This document explains all map-related behavior in the app: where maps live, how they are initialized, what layers/controls exist, where map data comes from, and how users interact with map features.

**Basemap / lot-line decision record:** see `MAP_BASEMAP_ROADMAP.md`. Its approved main-map phases are now implemented.

## Map stack and dependencies

- Rendering engine: **Leaflet** (`leaflet.css` + `leaflet.js` loaded from CDN).
- Main-map street renderer: **MapLibre GL JS 5.6.2** through
  **@maplibre/maplibre-gl-leaflet 0.1.4**. Both CDN URLs are version-pinned.
  Leaflet remains the controller for all markers, overlays, popups, and controls.
- Vector tile overlays: **Leaflet.VectorGrid** (`Leaflet.VectorGrid.bundled.js`).
- KML conversion: **@mapbox/togeojson** (`toGeoJSON.kml(...)`).
- Optional/legacy load: **leaflet-kml** is included, but KML rendering in active flows uses `toGeoJSON` + `L.geoJSON`.
- External map services:
  - **Mapbox Datasets API** for zone boundary and additional polygon data.
  - **Mapbox vector tiles API** (`/v4/...vector.pbf`) for thematic overlays.
  - **Mapbox tilequery API** for overlay label enrichment where configured.
  - **Mapbox geocoding API** for address geocoding in add-record flows.

## Map contexts in the app

The app has three distinct map contexts:

1. **Main Map View (`zoneMap`)**
   - Full map shown when navigating to the `Map` view.
   - Created in `initializeMap()`.
   - This is where the full overlays/layers control lives.

2. **Home Dashboard Map (`homeMap`)**
   - Embedded map on Home.
   - Created in `initializeHomeMap()`.
   - Shows address markers and zone boundary, with a satellite toggle.

3. **Batch Tagging Map (Tools view)**
   - Temporary map used when clicking “Draw on map” in Batch Tagging.
   - Supports custom polygon drawing and in-polygon address selection.

## View integration and lifecycle

- Navigation is controlled by `switchView(viewName)`.
- When entering `map` view:
  - `.map-container` is shown.
  - `initializeMap()` runs if needed.
  - `loadZoneBoundary()` runs (Mapbox first, then KML fallback).
  - `refreshAdditionalMapboxLayer()` runs.
  - Marker rendering updates after map invalidate/visibility checks.
- When leaving `map` view:
  - `.map-container` is hidden.
  - map-specific watchdog behavior is stopped.

## Base maps

All map contexts have Street and Satellite modes, but only the main map uses the new vector street style:

- **Main-map Street (`zoneMap`)**: the local, versioned
  `public/map-styles/altagether-voyager-v1.json`, derived from CARTO Voyager and
  rendered by MapLibre under Leaflet. It keeps CARTO vector source, glyph, and
  sprite URLs; buildings are removed; commercial POI clutter is reduced; and
  house numbers are collision-aware and subordinate from z17 through z24.
  The local house-number layer starts at style zoom 16 because the Leaflet
  bridge evaluates MapLibre at `Leaflet zoom - 1`; its size stops are shifted
  the same way so apparent sizing remains 9/11/12px at Leaflet z17/z20/z24.
  The runtime `cartoBasemapKey` is appended to the CARTO TileJSON request when
  `/api/mapbox-token` provides one. Current unkeyed vector access is allowed to
  start so map initialization never waits for a key.
- **Home and batch Street**: unchanged Esri World Street Map fallback chain.
- **Satellite**: Esri World Imagery hybrid (imagery + place names + roads)

If MapLibre, WebGL, the local style, or style startup fails, `zoneMap`
automatically falls back to the existing Esri street chain. Street/Satellite
switches destroy and reconstruct the MapLibre layer, and generation checks
prevent a late street failure from replacing Satellite.

The warm civic/editorial style uses paper `#F8F3E9`, navy labels `#314059`,
quiet numbers `#6F6A61`, and restrained green/water colors. Operational teal
`#347072` is not used for roads or water. Chivo is not available from CARTO's
glyph endpoint, so the style uses the closest existing supported stack:
Montserrat (with Open Sans and Noto Sans fallbacks). This avoids hosting a
large glyph archive.

### Where base map toggles exist

- Main map: in the custom Layers control (`setBaseMapMode('street'|'satellite')`).
- Home map: custom top-left toggle in `initializeHomeMap()`.
- Batch tagging map: custom top-left toggle in `initializeBatchTagging()`.

## Address marker layers

### Main map markers

- Built in `updateMapMarkers()`.
- Source: parsed `Sheet1` rows grouped into `sheetData.addressMap`.
- Requires latitude + longitude columns (header matching is tolerant, e.g. `lat`, `latitude`, `lon`, `lng`, `longitude`).
- Marker color/icon can be changed by active color mode (Contact, Damage, Build Status, Captain).
- Selecting an address in list or map updates marker highlighting (`highlightSelectedMarker`).

### Home map markers

- Built in `updateHomeMapMarkers()`.
- Same coordinate source model as main map.
- Fits map bounds to available points.

## Boundary layers (zone boundary)

Zone boundary is loaded with a **Mapbox-first, KML-fallback** strategy:

1. If Mapbox is enabled and `currentZoneName` exists:
   - `loadMapboxBoundary(...)` / `loadMapboxBoundaryForHome(...)`
   - Pulls features from Mapbox dataset and finds feature by `ZoneName` (or aliases).
   - Renders with `L.geoJSON(...)`.
2. If not available or no match:
   - `loadKMLBoundary(...)` / `loadHomeKMLBoundary(...)`
   - Uses `zoneKmlUrl` from the `Zone Notes` sheet metadata.
   - Fetches KML directly, then via proxy fallbacks if needed.
   - Converts KML -> GeoJSON with `toGeoJSON.kml(...)`.
   - Renders with `L.geoJSON(...)`.

### Boundary data key dependencies

- `currentZoneName` is extracted from `Sheet1` (`ZoneName` or `Zone name` column).
- `zoneKmlUrl` is extracted from `Zone Notes` tab (`A1:B10`) where keys include KML/boundary labels.

## Additional overlays on main map

There are three overlay systems on the main map:

1. **Additional Mapbox GeoJSON layer**
   - Config: `MAPBOX_ADDITIONAL_LAYER_CONFIG`
   - Display name: **Altagether Zones**
   - Loaded by fetching dataset features and rendering as `L.geoJSON`.
   - Supports hover style, permanent tooltips, and feature popup cards (captain info fields).
   - Visibility toggled from custom Layers panel.

2. **Dataset vector-tile overlays**
   - Config: `MAPBOX_DATASET_OVERLAY_CONFIG`
   - Rendered with `L.vectorGrid.protobuf(...)`
   - Ordered by `MAPBOX_DATASET_OVERLAY_ORDER`
   - Visibility tracked in `datasetOverlayVisibility`

3. **LA County lot lines**
   - Public source:
     `LACounty_Cache/LACounty_Parcel/MapServer/0`
   - Toggle label: **LA County lot lines**; default on.
   - Main map only; no request or rendering below z17 or while hidden.
   - Solid, no-fill, subtle parcel outlines; no APN labels.
   - Debounced viewport envelope query asks for IDs first, deduplicates them,
     then retrieves minimal GeoJSON in 250-ID batches (at most three requests
     concurrently) with `outSR=4326`.
   - `AbortController`, generation checks, partial-batch isolation, and a
     bounded in-memory reuse cache prevent stale updates and limit traffic.
     A separate per-refresh map retains every current-viewport feature even
     when reuse-cache eviction occurs.
   - Attribution/help wording: **Los Angeles County Office of the Assessor;
     informational, not survey-grade.**
   - Live ArcGIS responses are never service-worker cached and no countywide
     parcel copy is stored or redistributed.

### Configured dataset overlays

- `censusTracts`
  - Fill layer, click popup, badge labels (`censusBadge`) using tilequery/metadata helpers.
- `eatonFirePerimeter`
  - Fill layer.
- `altadenaWaterDistricts`
  - Single combined tileset for Lincoln Ave / Las Flores / Rubio Cañon water service areas; fill layer with **interactive hover** (darker fill via VectorGrid `getFeatureId` + `setFeatureStyle`). Badge labels use **`AGENCYNAME`** from tile features; tilequery sampling is approximate—optional **`label.manualPlacementsByObjectId`** / **`manualPlacementsByAgency`** in `MAPBOX_DATASET_OVERLAY_CONFIG.altadenaWaterDistricts` fix label positions (lat/lng).
- `soldProperties`
  - Circle-style overlay config exists, but inclusion is gated by `ENABLE_SOLD_PROPERTIES_OVERLAY = false` (currently hidden from active order unless flag is changed).

## Layer controls and map UI controls

### Main map custom Layers control

Created by `ensureAdditionalMapboxLayerControl()` and includes:

- Expand/collapse panel.
- Base map buttons: Street / Satellite.
- Overlays section:
  - Altagether Zones toggle.
  - LA County lot lines toggle.
  - One toggle per configured dataset overlay in active order.

### Color-by controls

- Main map control: `ColorFilterControl` (top-left).
- Home map has corresponding home color control creation flow.
- Color modes influence marker styling, not basemap or boundary geometry.

### Other map UI behavior

- Main map enforces minimum zoom in map tab (`ZONE_MAP_MIN_ZOOM = 16`).
- Map invalidate/reflow logic runs after view switches and panel state changes.
- CSS classes in `public/css/styles.css` style map controls/tooltips/badges:
  - `.map-container`
  - `.map-layers-control`, `.map-layers-panel`, `.map-layer-item-btn`
  - `.additional-zone-tooltip`
  - `.overlay-census-badge`, `.overlay-water-badge`

## Batch Tagging map behavior

The Tools “Draw on map” flow in `initializeBatchTagging()`:

- Requires detectable Latitude/Longitude columns.
- Builds a dedicated Leaflet map with address points as `L.circleMarker`.
- User clicks to add vertices; polygon preview updates live.
- Polygon closure methods:
  - Click near first vertex (distance threshold), or
  - Click “Close polygon & select”.
- Selection algorithm:
  - Custom ray-casting `pointInPolygon(lat, lng, ring)`.
  - Selected addresses are checked in list and highlighted on map.
- “Clear shape” resets geometry and selections.

## Map data sources and where they come from

## 1) Runtime backend endpoints

- `GET /api/mapbox-token`
  - Source: server environment (`MAPBOX_PUBLIC_TOKEN` or `MAPBOX_ACCESS_TOKEN`, plus optional `CARTO_API_KEY` / `CARTO_BASEMAP_KEY`).
  - Used by `initializeMapboxAccessToken()` for Mapbox-backed overlays and the
    optional CARTO vector basemap key.
- `POST /api/sheets/values`
  - Used by `fetchViaOAuth(...)` to read `Sheet1` and `Zone Notes`.

## 2) Spreadsheet tabs and fields

- `Sheet1`:
  - Address records, lat/lon, status fields, zone name.
  - Powers marker placement and marker color logic.
- `Zone Notes`:
  - Zone notes text and KML URL metadata.
  - KML URL used as boundary fallback source.

## 3) Mapbox APIs (browser-side)

- Datasets API:
  - Zone boundary feature lookup by `ZoneName`.
  - Additional “Altagether Zones” features.
- Vector tile API:
  - Overlay geometry for configured tilesets/source layers.
- Tilequery API:
  - Overlay label/content support where configured.
- Geocoding API:
  - Address -> coordinates for add-record flows.

## 4) KML URLs

- Pulled from `Zone Notes`.
- Can be Google Drive links; app attempts direct and proxy-based retrieval.
- Converted in-browser to GeoJSON for rendering.

## 5) LA County ArcGIS parcels

- Browser requests go directly to the public parcel feature layer.
- Only viewport IDs and the geometry/`OBJECTID` fields needed to draw the
  current view are requested.
- Fetches begin at z17 and are discarded if superseded.

## Structure-footprint licensing and semantics

The building/structure footprint layer is intentionally not implemented or
exposed. Live metadata for the researched 2023 LARIAC endpoint says **“LARIAC
Members only”**, so permission must be established before any use.

Independently of licensing, generic dotted or dashed footprints are prohibited
for this post-fire reference map: they could falsely imply fire loss. A future
authorized structure layer would need explicit, accurate semantics and must
never use dotted/dashed styling merely as a generic reference treatment.

## Mapbox configuration model

`MAPBOX_CONFIG` contains:

- `username`
- `datasetId`
- `accessToken` (empty in source; set at runtime from `/api/mapbox-token`)

Mapbox functionality is considered enabled only when all required fields are present.

## Feature interactions summary

- Click address marker -> popup and/or detailed right-panel context.
- Click address in list/table -> corresponding marker highlight.
- Toggle base map mode (street/satellite).
- Toggle overlay visibility from Layers panel.
- Click interactive overlays (e.g., census tracts) -> popup cards.
- Use Color by modes to recolor markers by selected status domain.
- Draw polygon on Batch Tagging map to bulk-select addresses spatially.

## Important implementation notes

- Map implementation is centralized in `index.html` (single-page script architecture).
- Testable parcel request, batching, gating, style, and stale-request behavior
  lives in `public/js/main-map.js`.
- Backend (`server.js`) mainly provides token/config and Sheets API proxy routes.
- No clustering or heatmap plugin behavior is active in current code paths.
- `leaflet-kml` library is loaded, but active KML rendering uses `toGeoJSON` + `L.geoJSON`.

## Quick file map (for maintainers)

- `index.html` - all primary map logic, controls, layers, and data orchestration.
- `server.js` - token endpoint and Sheets data routes used by map flows.
- `public/css/styles.css` - map UI/control/label styling.
- `public/js/main-map.js` - main-map parcel loader helpers (browser + Node).
- `public/map-styles/altagether-voyager-v1.json` - local CARTO-derived vector style.
- `SETUP.md` - operational notes including Mapbox boundary setup and fallback behavior.
- `help.html`, `about.html` - user-facing map behavior documentation references.


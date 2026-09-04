# Maps Documentation (Zone Dashboard)

This document explains all map-related behavior in the app: where maps live, how they are initialized, what layers/controls exist, where map data comes from, and how users interact with map features.

**Basemap / lot-line decision record:** see `MAP_BASEMAP_ROADMAP.md`. Its approved main-map phases are now implemented.

## Map stack and dependencies

- Rendering engine: **Leaflet** (`leaflet.css` + `leaflet.js` loaded from CDN).
- Branded street renderer: **MapLibre GL JS 5.6.2** through
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

The app has four primary map contexts:

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

4. **Lot Weeding Command Center (`lotWeedingAdminState.map`)**
   - Recreated as the Command Center filters and tabs render.
   - Uses branded streets with Esri fallback, lot-status markers, drawing tools,
     and the optional Altagether Zones overlay.

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

The three explicitly approved maps share one guarded branded-street factory:

- **Main, Home, and Lot Weeding Street**: the local, versioned
  `public/map-styles/altagether-voyager-v1.json?v=2`, derived from CARTO Voyager and
  rendered by MapLibre under Leaflet. It keeps CARTO vector source, glyph, and
  sprite URLs; OSM-derived mapped structures appear as restrained historical
  reference outlines from Leaflet z18+; commercial POI clutter is reduced; and
  house numbers are collision-aware and subordinate from Leaflet z18+.
  The main map desktop and mobile Layers UI state the intended semantics exactly:
  **Structure shapes update periodically and may be inaccurate.**
  The local house-number layer starts at style zoom 17 because the Leaflet
  bridge evaluates MapLibre at `Leaflet zoom - 1`; its size stops are shifted
  the same way so apparent sizing remains 9/11/12px at Leaflet z18/z20/z24.
  The runtime `cartoBasemapKey` is appended to the CARTO TileJSON request when
  `/api/mapbox-token` provides one. Current unkeyed vector access is allowed to
  start so map initialization never waits for a key.
- **Batch Tagging and incidental-map Street**: unchanged Esri World Street Map
  chain; these maps do not load the branded style.
- **Satellite**: Esri World Imagery hybrid (imagery + place names + roads) on
  the existing Main and Home toggles. Lot Weeding has no added satellite mode.

If MapLibre, WebGL, the local style, or style startup fails, each approved map
automatically falls back to the existing Esri street chain. The shared factory
guards map identity, layer identity, mode, and generation; waits for hidden map
containers; resizes after reveal; monitors post-load error bursts and WebGL
context loss; and releases listeners/WebGL resources on removal. These guards
prevent late Home failures from replacing Satellite and prevent destroyed Lot
Weeding maps from being mutated.

The warm civic/editorial style uses paper `#F8F3E9`, navy labels `#314059`,
quiet numbers `#6F6A61`, pale gold major roads, cream-gold secondary roads,
muted olive open space, and soft blue-gray water. Local streets and structures
stay neutral. Operational teal `#347072` is not used for roads or water. Chivo
is not available from CARTO's glyph endpoint, so the style uses the closest existing supported stack:
Montserrat (with Open Sans and Noto Sans fallbacks). This avoids hosting a
large glyph archive.

### Where base map toggles exist

- Main map: in the custom Layers control (`setBaseMapMode('street'|'satellite')`).
- Home map: custom top-left toggle in `initializeHomeMap()`.
- Batch tagging map: custom top-left toggle in `initializeBatchTagging()`.
- Lot Weeding: no satellite toggle.

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

The Main, Home, and Lot Weeding zone polygons use the same restrained navy
`#314059` outline and warm `#D6C58F` wash family, with lighter sizing on Home.
Lot Weeding draw/lasso geometry, selection colors, and marker status colors are
unchanged.

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
   - Automatic and non-toggleable on the main map; no request or rendering
     below Leaflet z17 or while the main map is hidden.
   - Solid, no-fill, subtle parcel outlines ramp from opacity/weight
     `0.175/0.4375` at z17 to `0.28/0.70` at z20; no APN labels.
   - Debounced viewport envelope query asks for IDs first, deduplicates them,
     then retrieves minimal GeoJSON in batches of at most 150 IDs and below
     1,800 encoded URL characters (at most three requests concurrently) with
     `outSR=4326`.
   - `AbortController`, generation checks, partial-batch isolation, and a
     7,500-feature in-memory reuse cache prevent stale updates and limit traffic.
     A separate per-refresh map retains every current-viewport feature even
     when reuse-cache eviction occurs.
   - Rendering uses a dedicated Leaflet canvas renderer and deliberately has no
     feature-count cap, so dense current viewports do not silently lose lot lines.
   - Attribution/help wording: **Los Angeles County Office of the Assessor;
     informational, not survey-grade.** Attribution is registered permanently
     when the main map initializes and may remain visible below z17.
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
  - One toggle per configured dataset overlay in active order.
- LA County lot lines are automatic map context, not a Layers control.
- Desktop and mobile Layers UI both show the secondary note:
  **Structure shapes update periodically and may be inaccurate.**

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
- Fetches begin at Leaflet z17 and are discarded if superseded.

## Structure-outline sources and semantics

The main-map street style uses only the existing CARTO/OpenMapTiles `building`
source-layer, derived from OpenStreetMap, as historical/reference context from
Leaflet z18+ (style minzoom 17 accounts for the bridge offset). It uses a faint
warm fill and quiet solid outline beneath roads, labels, house numbers, and
operational overlays. The user-facing description is intentionally limited to:
**Structure shapes update periodically and may be inaccurate.**

The researched 2023 LARIAC structure-footprint endpoint remains prohibited:
live metadata says **“LARIAC Members only”**, so it is not used or exposed.
Generic dotted or dashed footprint styling also remains prohibited because it
could falsely imply fire loss. Building outlines have no status interaction or
damage semantics.

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


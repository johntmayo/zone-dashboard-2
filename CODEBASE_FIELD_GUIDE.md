# Altagether Zone Dashboard: Codebase Field Guide

A quick operational reference for anyone working in this repo. Read this before making changes.

**Last updated:** April 11, 2026
**Companion document:** `CURRENT_STATE_AUDIT.md` (full forensic audit)

---

## What This App Is

An internal dashboard for ~50 neighborhood captains managing post-fire recovery outreach in Altadena, CA. Each captain signs in with Google, gets mapped to a Google Sheet of resident data, and sees a dashboard with a map, contact table, and tools.

**Stack:** Express backend on Vercel → static HTML/JS frontend → Google Sheets API (service account) → Leaflet/Mapbox maps

---

## The Files That Matter Most

| File | What It Is | Risk Level |
|------|-----------|------------|
| **`index.html`** | The entire application: 16,942 lines of HTML + inline JS. All views, all logic, all state. | **Extreme** — any change can break anything |
| **`server.js`** | Express backend: 906 lines. Sheets proxy, user auth lookup, feed APIs, static serving. | **High** — all data flows through here |
| **`public/css/styles.css`** | All CSS: ~145KB. | Medium |
| **`public/js/utils.js`** | Shared utilities: address parsing, column finding, HTML helpers. 448 lines. | Medium — used by index.html |
| **`users.json`** | Email → sheet URL mapping. This is the user access control list. | **High** — editing this adds/removes user access |
| **`.env.local`** | Contains real secrets (service account key, user data, tokens). **Should not be in git.** | **Critical** |
| **`vercel.json`** | Deployment config: cache headers, host-based rewrite for NC Directory. | Low |
| **`nc-directory.html`** | Standalone NC Captain directory. Served at `directory.altagether.org`. | Medium |
| **`flyer_tool.html`** | Self-contained flyer generator. No backend dependencies. | Low |

---

## Where the Risky Logic Lives

### Authentication & Access Control (index.html ~1350–1600, server.js ~53–183)

**How sign-in works:**
1. Client uses Google Identity Services (GIS) to get an OAuth token (email scope only)
2. Client calls `https://www.googleapis.com/oauth2/v2/userinfo` to get the email
3. Client calls `GET /api/user-sheets?email=<email>` to get assigned sheet(s)
4. Server reads `users.json` (or `USERS_JSON` / `USERS_JSON_B64` env var), returns matching sheet URLs

**Known risk:** The server does not verify that the email in the query parameter matches the signed-in user's actual identity. The OAuth token is not sent to the server. This is a deliberate simplification documented in `LOGIN_SYSTEM_PLAN.md`.

### Sheet Data Loading (index.html ~2400–2700, server.js ~649–693)

**How data flows:**
1. Client calls `POST /api/sheets/values` with `{ sheetId, range, sheetName }`
2. Server uses service account to read via Google Sheets API v4
3. Response is raw `values` array — client parses into `sheetData` object
4. `sheetData` has: `headers`, `data` (array of row objects), `addressMap`, column helpers, `useResidentId` flag

**Known risk:** Column name matching is fuzzy and extensive. The `findAddressColumns` function in `utils.js` tries many variations (e.g., `House #`, `house #`, `House Number`, `_SitusHouseNo`). If a sheet has unexpected column names, features silently degrade.

### Sheet Writes (server.js ~696–876)

Four write endpoints, all unauthenticated:
- `/api/sheets/append` — append rows
- `/api/sheets/append-record` — append one row with validation inheritance
- `/api/sheets/batch-update` — update specific cells
- `/api/sheets/batch-update-by-resident-id` — look up row by resident_id, then update

### Map System (index.html ~1098–1265 config, ~9000+ functions)

Two Leaflet map instances:
- **`zoneMap`** — the full map view
- **`homeMap`** — the mini map on the Home view

Layers:
- **Markers** from sheet data (geocoded or pre-geocoded lat/lon columns)
- **Zone boundaries** via Mapbox dataset/tileset or KML fallback
- **Overlays** (census tracts, fire perimeter, water districts) via Mapbox vector tiles
- **Color-by** modes: contact status, damage status, build status

All Mapbox config (tileset IDs, source layers, styles, property keys) is hardcoded in the `MAPBOX_CONFIG`, `MAPBOX_ADDITIONAL_LAYER_CONFIG`, and `MAPBOX_DATASET_OVERLAY_CONFIG` objects starting at line ~1098.

### NC Profile (index.html ~775–916 HTML, ~1830–2100 JS)

Writes to the NC Directory sheet (`NC_DIRECTORY_SHEET_ID`). First-time users see a wizard; returning users see a full form. Uses `/api/sheets/batch-update` and `/api/sheets/append-record`.

---

## What Not to Touch Casually

1. **The `sheetData` object.** Dozens of functions read from it. Its shape (`.headers`, `.data`, `.addressMap`, `.getStreetString`, `.addressColumns`, `.useResidentId`) is an implicit contract. Changing how it's populated in `loadAddressData` will cascade.

2. **Column name matching in `utils.js`.** The `findAddressColumns` and `findColumn` functions are the bridge between unpredictable sheet headers and app logic. Changes here affect all address display, grouping, and map marker placement.

3. **The `switchView` function (~7528+).** This is the central router. It controls which views are visible, triggers data loads, manages the filter bar, and handles mobile state. Every nav action flows through here.

4. **Global state variables (~979–1054).** Key globals: `currentView`, `currentSheetUrl`, `sheetData`, `selectedAddress`, `accessToken`, `currentUserEmail`, `availableSheets`, `currentSheetId`, `zoneMap`, `homeMap`, `currentColorMode`, `currentZoneName`, `metadataSheetId`, `ncProfileRowIndex`.

5. **The `MAPBOX_*` config objects (~1098–1265).** These contain Mapbox Studio asset IDs. If you change anything in Mapbox Studio, these must be updated to match.

6. **Feed sheet IDs.** `CENTRAL_SHEET_ID` and `ACTIONS_SHEET_ID` are hardcoded in BOTH `server.js` (with env var override) AND `index.html` (no env var override). If you change the server value via env var but not the index.html fallback, the fallback path uses the old sheet.

---

## What Should Be Understood Before Making Edits

### The Dual-Path Feed Pattern

For the homepage feed and actions feed, the client tries the server API first (`/api/homepage-feed`, `/api/actions-feed`), then falls back to direct CSV export from the sheet. This means:
- The sheet must be both service-account-accessible AND publicly readable
- The server and client both have their own copies of the sheet IDs
- Bugs can hide in one path while the other works

### Zone Metadata

Each zone sheet is expected to have a "Zone Notes" tab containing key-value metadata:
- Zone name
- KML boundary URL
- Freeform notes

This is loaded by `fetchMetadata` and stored in globals (`currentZoneName`, `zoneKmlUrl`, `zoneNotes`).

### Address Canonicalization

The app builds canonical address strings from multiple possible column combinations (house number + direction + street, or a single full address column, with optional unit). The `buildAddressString` function in `utils.js` is the authoritative path. Addresses are used as grouping keys in the map and table.

### Mobile vs Desktop

The app has a responsive layout with:
- Desktop: left nav sidebar + floating panel
- Mobile: bottom tab bar + drawer + bottom sheet for map controls

The mobile logic is in a large IIFE at the bottom of index.html (~16613–16937). It registers its own event listeners and manipulates the same DOM as the desktop code.

---

## How to Add a New User

1. Edit `users.json` in the repo root (or the `USERS_JSON` / `USERS_JSON_B64` env var on Vercel)
2. Add their lowercase email and an array of sheet URLs:
   ```json
   "newuser@gmail.com": [
     "https://docs.google.com/spreadsheets/d/SHEET_ID_HERE/"
   ]
   ```
3. Ensure the Google Sheet is shared with the service account email (`dashboard@nc-dashboard-v1.iam.gserviceaccount.com`) as an Editor
4. Deploy (push to main, or update the Vercel env var and redeploy)

---

## Environment Setup for Local Development

1. `npm install`
2. Ensure `.env.local` (or `.env`) exists with at minimum:
   - `GOOGLE_SERVICE_ACCOUNT_JSON` or `GOOGLE_SERVICE_ACCOUNT_JSON_B64`
   - `MAPBOX_PUBLIC_TOKEN`
3. `npm run dev` (uses nodemon, runs on port 8000)
4. Open `http://localhost:8000`

The OAuth client ID in index.html (`633926045450-...`) is configured for specific origins. Local dev may need `http://localhost:8000` in the Google Cloud Console authorized origins.

---

## Deployment

- Vercel auto-deploys from `main` branch
- Vercel project: `zone-dashboard-2` in `john-mayos-projects` org
- Environment variables configured in Vercel dashboard
- No build step — Vercel runs `node server.js` as a serverless function
- `vercel.json` sets cache headers and the host-based rewrite for the NC Directory

---

## Known Broken Things

| What | Where | Impact |
|------|-------|--------|
| Contact List Creator tool | index.html ~14329+ | JS exists but no HTML element — silently does nothing |
| Zone Notes tab | index.html ~11752 | Missing `#addressesTab` prevents tab toggle from attaching |
| about.html Discord modal | about.html bottom script | References a button in commented-out HTML; throws JS error on load |
| `updateSheetLinkLabel` function | index.html ~2143 | References nonexistent `#sheetLinkLabel` element |
| CORS proxy fallbacks | index.html ~9400, ~11347 | Depends on three free third-party services for KML fetching |

---

## Accurate Documentation (as of this audit)

| Document | Accuracy |
|----------|----------|
| `LOGIN_SYSTEM_PLAN.md` | Current — best description of auth system |
| `MAPS.md` | Current — best description of map system |
| `SERVICE_ACCOUNT_SETUP.md` | Current — accurate setup guide |
| `NC_DIRECTORY_HANDOFF.md` | Current — accurate NC Directory description |
| `NC_DIRECTORY_SETUP.md` | Current — accurate setup steps |
| `ZONE_DASHBOARD_STYLE_GUIDE.md` | Current — matches actual fonts/colors |
| `ALTAGETHER_FEED_SETUP.md` | Mostly current — wrong line number reference |
| `altagether-data-architecture-brief.md` | Strategy doc — not a code description |
| `SETUP.md` | Mixed — some details outdated |
| `UX_RESPONSIVE_AUDIT.md` | Mixed — unclear which fixes were implemented |
| `CHANGELOG.md` | Mixed — file paths incorrect |
| `DEV_PLAN.md` | Stale — predates login system, many unchecked items |
| `PLATFORM_OVERVIEW.md` | **Stale** — describes pre-login-system onboarding |
| `AUTH_AND_SPREADSHEET_ACCESS.md` | **Stale** — describes wrong access model |
| `DATA_PROBLEM_HANDOFF.md` | **Stale** — Add Record flag claim is wrong |
| `context handoff.txt` | **Stale** — contradicted by code |
| `README.md` | **Useless** — placeholder only |

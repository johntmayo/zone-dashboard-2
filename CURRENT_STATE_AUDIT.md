# Altagether Zone Dashboard: Current State Audit

**Audit date:** April 11, 2026
**Repo:** `github.com/johntmayo/zone-dashboard-2` (branch: `main`)
**226 commits**, first commit 2026-01-28, latest 2026-04-10
**Deployed on:** Vercel (project `zone-dashboard-2`, org `john-mayos-projects`)

---

## 1. Executive Summary

The Altagether Zone Dashboard is an internal tool used by ~50 neighborhood captains in Altadena, CA to manage post-fire recovery outreach. It is built as a **monolithic Express + vanilla HTML/JS application** deployed on Vercel. The core idea: each captain signs in with Google, is mapped to a Google Sheet containing their zone's resident data, and gets a dashboard with a map, table, contact tools, and shared resources.

**Shape of the codebase:**

- The **main application logic lives in a single 16,942-line `index.html`** file containing all HTML structure, ~16,000 lines of inline JavaScript, and scattered inline styles. This is the dominant architectural reality.
- A **906-line `server.js`** provides the Express backend: Google Sheets proxy (service account), user-to-sheet mapping, feed APIs, NC directory API, and static file serving.
- A **144,000-character `public/css/styles.css`** handles all styling.
- A modest **`public/js/utils.js`** (448 lines) extracts a few shared utilities.
- **Seven secondary HTML pages** exist alongside `index.html`, each self-contained with their own inline JS.
- **16 markdown documentation files** exist in the repo root, many partially or fully stale.
- **Real secrets are committed to `.env.local`** — a Google service account private key, user email mappings, a Mapbox token, and a Vercel OIDC token.

**Main conclusions:**

1. The product works and is actively used. The core flow (sign in → load zone sheet → map + table + details) is functional.
2. The monolithic `index.html` is the central risk: all features, all state, all UI in one file.
3. Documentation is fragmented and substantially stale. Multiple docs contradict each other and the actual code.
4. Secrets in `.env.local` are committed to git — this is a critical security issue.
5. Several features are half-built, disconnected, or hidden behind flags.
6. The app depends on ~3 public CORS proxy services for KML fetching, which are inherently unreliable.
7. There is no test suite, no linting, no CI beyond Vercel's deployment pipeline.
8. The user access model trusts client-supplied email addresses without server-side verification.

---

## 2. Current Product Reality

### What the product does today

The Zone Dashboard serves Altadena neighborhood captains who are coordinating post-Eaton Fire recovery outreach. Each captain manages a "zone" — a geographic area with ~50–200 residential properties tracked in a Google Sheet.

**Core user flow:**
1. Captain opens the dashboard, sees a welcome overlay
2. Signs in with Google (OAuth popup, email-only scope)
3. Server looks up their email in `users.json` (or `USERS_JSON` env var) to find their assigned sheet(s)
4. If one sheet → loads automatically. If multiple → zone picker. If not registered → access denied.
5. Dashboard loads: sheet data fetched via the server's service account proxy
6. Captain sees: Home view (announcements, zone stats, charts), Map view (Leaflet + Mapbox), Neighbors table, Actions feed, Tools, Resources, NC Profile

**Views available to users (from left nav):**
- **Home** — Zone overview, alert banner, announcements from central sheet, charts (damage breakdown, contact progress, build status), quick actions, zone leadership
- **Map** — Full Leaflet map with address markers color-coded by contact/damage/rebuild status; overlays for zones, census tracts, Eaton Fire perimeter, water districts; base map toggle (street/satellite)
- **Neighbors** — Sortable, filterable table of all residents from the zone sheet; click a row for details panel; export to CSV/print; add new record
- **Actions** — Cards pulled from a central actions sheet
- **Tools** — Zone report generator (PDF), batch tagging, flyer creator link, contact list creator (broken/disconnected)
- **Resources** — Links to NC directory, calendars, wiki, LA County resources, zone spreadsheet
- **My NC Profile** — Captain's own profile in the NC Directory sheet; wizard for first-time setup

**Secondary pages (separate HTML files):**
- **About** (`about.html`) — Marketing/orientation page for captains
- **Help** (`help.html`) — End-user instructions (effectively hidden — not linked from live UI)
- **Discord Help** (`discord-help.html`) — Discord onboarding guide (effectively hidden)
- **Documentation** (`documentation.html`) — Developer docs on Add Record (hidden, single-topic)
- **Flyer Tool** (`flyer_tool.html`) — Self-contained flyer generator for neighborhood events
- **NC Directory** (`nc-directory.html`) — Public captain directory; served as homepage at `directory.altagether.org`
- **Outreach Helper** (`outreach-helper.html`) — Copy templates for captain outreach (orphan page — not linked from anywhere)

---

## 3. System Map

### Architecture

```
[Browser] ←→ [Vercel / Express server.js] ←→ [Google Sheets API (service account)]
                    ↕
              [Static HTML files]
              [Google OAuth (client-side, email only)]
              [Mapbox APIs (tiles, geocoding, tilequery)]
              [Public CORS proxies (KML fallback)]
```

### Entry Points

| Entry | File | Purpose |
|-------|------|---------|
| Main app | `index.html` | SPA-like dashboard, all views |
| Server | `server.js` | Express backend, API routes, static serving |
| NC Directory (standalone) | `nc-directory.html` | Public directory at `directory.altagether.org` |

### API Routes (server.js)

| Route | Method | Purpose |
|-------|--------|---------|
| `/api/user-sheets` | GET | Look up email → assigned sheet URLs |
| `/api/sheets/values` | GET/POST | Read sheet data via service account |
| `/api/sheets/append` | POST | Append rows to a sheet |
| `/api/sheets/append-record` | POST | Append one row inheriting validation |
| `/api/sheets/batch-update` | POST | Batch update cells |
| `/api/sheets/batch-update-by-resident-id` | POST | Update by resident_id (sort-safe) |
| `/api/homepage-feed` | GET | Central announcements feed |
| `/api/actions-feed` | GET | Actions feed |
| `/api/nc-directory` | GET | NC Directory data (Sheet1) |
| `/api/mapbox-token` | GET | Mapbox public token |
| `/api/ga-config` | GET | Google Analytics measurement ID |
| `GET /` (directory host) | GET | Serves `nc-directory.html` for `directory.altagether.org` |
| `GET *` (fallback) | GET | SPA fallback → `index.html` |

### Environment Variables

| Variable | Used In | Purpose |
|----------|---------|---------|
| `GOOGLE_SERVICE_ACCOUNT_JSON` | server.js | Service account credentials (JSON string) |
| `GOOGLE_SERVICE_ACCOUNT_JSON_B64` | server.js | Same, base64-encoded (preferred on Vercel) |
| `GOOGLE_APPLICATION_CREDENTIALS` | server.js | Fallback: path to key file |
| `USERS_JSON` | server.js | Inline user-to-sheet mapping |
| `USERS_JSON_B64` | server.js | Same, base64-encoded |
| `MAPBOX_PUBLIC_TOKEN` / `MAPBOX_ACCESS_TOKEN` | server.js | Mapbox token served to client |
| `GA_MEASUREMENT_ID` | server.js | Google Analytics 4 (optional) |
| `CENTRAL_SHEET_ID` | server.js | Announcements sheet (default hardcoded) |
| `ACTIONS_SHEET_ID` | server.js | Actions sheet (default hardcoded) |
| `NC_DIRECTORY_SHEET_ID` | server.js | NC Directory sheet (default hardcoded) |
| `PORT` | server.js | Server port (default 8000) |
| `VERCEL_OIDC_TOKEN` | .env.local | Vercel deployment token |

### External Dependencies

| Service | Purpose | Risk |
|---------|---------|------|
| Google Sheets API | All zone data, NC directory, announcements, actions | Core dependency |
| Google OAuth (GIS) | User identity | Core dependency |
| Mapbox | Map tiles, zone boundaries, geocoding, overlays | Map features break without it |
| Leaflet + plugins | Map rendering | CDN-loaded |
| Chart.js | Dashboard charts | CDN-loaded |
| html2pdf.js | Zone report PDF export | CDN-loaded |
| api.allorigins.win | CORS proxy for KML files | Unreliable third-party |
| corsproxy.io | CORS proxy fallback | Unreliable third-party |
| api.codetabs.com | CORS proxy fallback | Unreliable third-party |
| Google Fonts | Typography (Chivo, Merriweather) | CDN |
| Airtable | Feedback form | External link only |

### Key Google Sheets

| Sheet ID (hardcoded default) | Purpose | Where Referenced |
|------------------------------|---------|-----------------|
| `1PaqcX2BSypJjLBDMA3DnlAxCHK5y0TWMSbCIkTScIQU` | Central announcements ("From Altagether" feed) | server.js, index.html |
| `1g6gmdXF1yjrejpmT3HTY7JI1Zzb7jErYZQ2pwiH37I0` | Actions feed | server.js, index.html |
| `1E77qmT4eGtyokaDvD2wlK3q2NeMcS4itmkbYp6Rz0qM` | NC Directory (captain roster) | server.js, index.html, nc-directory.html |
| Per-user zone sheets | Zone resident data | users.json, .env.local USERS_JSON |

### Client-Side State (localStorage keys)

The app stores the following in `localStorage`:
- `googleOAuthToken` / `googleOAuthTokenExpiry` — OAuth access token
- `savedSheetUrl` — Last-used sheet URL
- `currentView` — Last active view
- `currentColorMode` — Map color mode
- `detailsPanelCollapsed` — Panel state
- `ncProfileUserEmail` — Profile email
- Various dismissed-alert and profile-nudge flags

### File Size Summary

| File | Size | Lines |
|------|------|-------|
| `index.html` | 767 KB | 16,942 |
| `public/css/styles.css` | 145 KB | ~5,000+ |
| `flyer_tool.html` | 88 KB | ~2,500+ |
| `nc-directory.html` | 46 KB | ~1,300+ |
| `outreach-helper.html` | 36 KB | ~1,000+ |
| `server.js` | 34 KB | 906 |
| `discord-help.html` | 25 KB | ~700+ |
| `help.html` | 21 KB | ~600+ |
| `about.html` | 20 KB | ~510 |
| `package-lock.json` | 56 KB | — |
| `.env.local` | 12.5 KB | 7 |

---

## 4. Feature Inventory

### Active Features

| Feature | Status | Location | Notes |
|---------|--------|----------|-------|
| Google Sign-In (email identity) | **Active** | index.html ~1468–1600 | GIS OAuth, email-only scope |
| User-to-sheet mapping | **Active** | server.js `/api/user-sheets`, users.json | Email → sheet URL(s) |
| Zone sheet data loading | **Active** | index.html `loadAddressData`, server.js `/api/sheets/values` | Service account proxy |
| Home view (dashboard) | **Active** | index.html #homeView ~217–407 | Stats, charts, feed, mini map |
| Central announcements feed | **Active** | server.js `/api/homepage-feed`, index.html ~13762+ | From central Google Sheet |
| Actions feed | **Active** | server.js `/api/actions-feed`, index.html ~13908+ | From actions Google Sheet |
| Map view (Leaflet) | **Active** | index.html ~118–129, `initializeMap` ~9000+ | Color-by-status markers |
| Map overlays (Mapbox tilesets) | **Active** | index.html ~1098–1265 | Zones, census, fire, water districts |
| Neighbors table | **Active** | index.html #peopleView ~414–424, `displayAddressTable` | Sortable, filterable, grouped |
| Address details panel | **Active** | index.html #floatingPanel ~162–202 | Inline editing, notes |
| Contact mode | **Active** | index.html ~11843+ | Toggle for contact tracking |
| Zone notes | **Active** | index.html ~11769+, `saveZoneNotes` | Saved to "Zone Notes" sheet tab |
| CSV/Print export | **Active** | index.html `showExportModal` ~5171+ | From Neighbors view |
| Add Record | **Active** | index.html ~4120+, `ENABLE_ADD_RECORD = true` | Adds row to zone sheet |
| NC Profile (My NC Profile) | **Active** | index.html #profileView ~775–916 | Wizard + full form |
| NC Directory (standalone) | **Active** | nc-directory.html, server.js `/api/nc-directory` | `directory.altagether.org` |
| Flyer Tool | **Active** | flyer_tool.html | Self-contained, linked from Tools |
| Resources page | **Active** | index.html #resourcesView ~426–558 | Links, calendar embeds |
| Mobile responsive layout | **Active** | index.html ~920–969, styles.css | Bottom nav, drawers, map sheet |
| Google Analytics 4 | **Active** | index.html ~28–48, server.js `/api/ga-config` | Optional via env var |
| Mapbox geocoding | **Active** | index.html ~3740+ | Address → lat/lon |
| Batch cell updates by resident_id | **Active** | server.js `/api/sheets/batch-update-by-resident-id` | Sort-safe writes |
| Multi-zone picker | **Active** | index.html ~2240–2263 | For users with >1 sheet |

### Hidden Features

| Feature | Status | Location | Notes |
|---------|--------|----------|-------|
| Sold Properties overlay | **Hidden (flag)** | index.html `ENABLE_SOLD_PROPERTIES_OVERLAY = false` ~1259 | Tileset exists, layer disabled |
| Build Notes tool | **Hidden (CSS)** | index.html #buildnotes ~739+ | Has `hidden` class |
| Data Transfer tool | **Hidden (CSS)** | index.html #dataTransferTool ~750+ | Has `hidden` class |
| Outreach Helper page | **Hidden (orphan)** | outreach-helper.html | Not linked from any UI |
| Help page | **Hidden (link removed)** | help.html | Links from about.html are commented out |
| Discord Help page | **Hidden (link removed)** | discord-help.html | Links from about.html are commented out |
| Documentation page | **Hidden (orphan)** | documentation.html | Only referenced in PLATFORM_OVERVIEW.md |

### Broken / Disconnected Features

| Feature | Status | Location | Notes |
|---------|--------|----------|-------|
| Contact List Creator | **Broken** | index.html ~14329+ | JS code exists but no matching HTML element `#contactListCreator` — initializer exits immediately |
| Zone Notes tab toggle | **Broken** | index.html ~11752 | Requires `#addressesTab` element that doesn't exist in HTML; tab stays hidden |
| `updateSheetLinkLabel` | **Dead code** | index.html ~2143–2163 | References `#sheetLinkLabel` element that doesn't exist |
| `switchView('progress')` | **Dead code** | index.html ~7706–7707 | Branch for `progressView` that has no HTML or nav item |
| about.html Discord modal script | **Broken** | about.html (bottom script) | Calls `getElementById('discordQuickStartBtn')` but the button is inside commented-out HTML |
| allorigins/corsproxy/codetabs fallback | **Fragile** | index.html ~2615, ~9400–9403, ~11347–11350 | Used for KML CORS bypass; third-party proxies are unreliable |

### Deprecated / Unclear Features

| Feature | Status | Location | Notes |
|---------|--------|----------|-------|
| CSV direct-fetch fallback | **Deprecated** | index.html ~2597–2621 | Pre-service-account code path, uses public CSV export + CORS proxy |
| Commented-out KML URL input | **Deprecated** | index.html ~9074–9079, ~11725–11734 | Was a manual KML input UI |

---

## 5. Content and Documentation Mismatches

### Documents that appear out of date relative to actual product behavior

| Document | Issue | Severity |
|----------|-------|----------|
| **`README.md`** | Contains only repeated project name tokens. No useful content. | High — first thing a new contributor sees |
| **`PLATFORM_OVERVIEW.md`** | Describes "paste sheet URL" onboarding which was replaced by the login system (`/api/user-sheets`). Multiple sections describe the old access model. | High — actively misleading |
| **`AUTH_AND_SPREADSHEET_ACCESS.md`** | Claims "anyone with the spreadsheet URL can use the app" — contradicts the current email-allowlist system in `users.json` / `/api/user-sheets`. | High — describes the wrong access model |
| **`DATA_PROBLEM_HANDOFF.md`** | States `ENABLE_ADD_RECORD = false` — but the current code has `ENABLE_ADD_RECORD = true`. | Medium — documents a state that no longer exists |
| **`context handoff.txt`** | Instructs reader that Add Record is disabled and to treat `DATA_PROBLEM_HANDOFF.md` as source of truth. Contradicted by code. | Medium |
| **`CHANGELOG.md`** | References file paths `css/styles.css` and `js/utils.js` — actual paths are `public/css/styles.css` and `public/js/utils.js`. | Low |
| **`ALTAGETHER_FEED_SETUP.md`** | Says `CENTRAL_SHEET_ID` is on "line 16" of `server.js` — it's actually line 233. | Low |
| **`DEV_PLAN.md`** | Last updated November 2024. Many items are aspirational; unclear which have been completed. Predates the login system work (March 2026). | Medium |
| **`SETUP.md`** | Describes pasting a Mapbox token into `index.html` — the actual flow uses `/api/mapbox-token` from an env var. | Medium |
| **`help.html`** | Tells users to grant access to "their" Google Sheets and share with "your Google account." Contradicts the service-account model described in `about.html`. | Medium — but page is effectively hidden |
| **`ZONE_DASHBOARD_STYLE_GUIDE.md`** vs **`DEV_PLAN.md`** | Style guide says Chivo + Merriweather; DEV_PLAN mentions Alegreya. Actual index.html loads Chivo + Merriweather. DEV_PLAN typography section is stale. | Low |

### about.html content issues

The About page has significant commented-out sections:
- Tutorials section (commented out)
- Troubleshooting section (commented out)
- "More Help" section with links to `help.html` and `discord-help.html` (commented out)
- The Discord Quick Start button referenced by the page's script is inside the commented-out HTML, causing a silent JavaScript error on page load

### NC Directory Info CSV

`NC_Directory_Info_v1.csv` in the repo root appears to be a schema/planning document for the NC Directory sheet, not live data. Row 2 contains column types, row 3 contains design notes. It is unclear if this matches the current live sheet structure.

---

## 6. Detritus Inventory

### Confirmed or Probably Unused Files

| Item | Classification | Reasoning |
|------|---------------|-----------|
| **`css/` directory** (empty) | Confirmed unused | Empty folder; styles live in `public/css/` |
| **`js/` directory** (empty) | Confirmed unused | Empty folder; scripts live in `public/js/` |
| **`resources/` and `resources/images/`** | Probably unused | Empty or contains no files visible in the glob output; no references found |
| **`address list.csv`** | Probably unused | 1,179-line CSV of street names with no imports or references from code |
| **`NC_Directory_Info_v1.csv`** | Probably unused | Schema planning doc, not referenced by code |
| **`context handoff.txt`** | Confirmed stale | Refers to a now-contradicted state (`ENABLE_ADD_RECORD = false`) |
| **`zone-dashboard-1.code-workspace`** | Probably unused | VS Code workspace file for a previous project name |
| **`zone-dashboard-2-bigshift.code-workspace`** | Probably unused | VS Code workspace file, likely from a past experiment |
| **`zone-dashboard-2.code-workspace`** | Unclear | May be actively used by the developer |

### Stale Documentation Files

| File | Classification | Reasoning |
|------|---------------|-----------|
| **`PLATFORM_OVERVIEW.md`** | Definitely stale | Describes pre-login-system behavior |
| **`AUTH_AND_SPREADSHEET_ACCESS.md`** | Definitely stale | Wrong access model |
| **`DATA_PROBLEM_HANDOFF.md`** | Partially stale | Add Record flag claim is wrong; architectural concerns may still apply |
| **`context handoff.txt`** | Definitely stale | Contradicted by code |
| **`DEV_PLAN.md`** | Partially stale | Predates login system; many unchecked items unclear |
| **`README.md`** | Placeholder/useless | Contains only repeated project names |
| **`CHANGELOG.md`** | Partially stale | File paths wrong |
| **`ALTAGETHER_FEED_SETUP.md`** | Partially stale | Line references wrong |

### Dead Code in index.html

| Item | Classification | Reasoning |
|------|---------------|-----------|
| `initializeContactListCreator` function (~14329+) | Confirmed dead | No `#contactListCreator` HTML element exists; function exits immediately |
| Contact list creator in `expandableModules` arrays (~16437, ~16478) | Confirmed dead | References nonexistent module |
| `updateSheetLinkLabel` function (~2143–2163) | Confirmed dead | No `#sheetLinkLabel` element in HTML |
| `switchView('progress')` branch (~7706–7707) | Confirmed dead | No `progressView` div or nav item |
| Tab toggle for `#addressesTab` (~11752) | Confirmed dead | No `#addressesTab` element; Zone Notes tab handler never attaches |
| CSV direct-fetch + allorigins fallback (~2597–2621) | Probably dead | Superseded by service-account path; only reached if OAuth flow fails and sheet is public |
| Commented-out KML URL input UI (~9074–9079, ~11725–11734) | Confirmed dead | Commented-out HTML and handlers |
| `#buildnotes` tool module (~739+) | Unclear | HTML exists but hidden; may be intended for future use |
| `#dataTransferTool` module (~750+) | Unclear | HTML exists but hidden; may be intended for future use |

### Stale Git Branches

Multiple remote branches appear to be leftover from completed or abandoned work:
- `remotes/origin/claude/add-former-resident-status-LxOri`
- `remotes/origin/claude/captain-profile-wizard-LWx2V`
- `remotes/origin/claude/details-panel-improvements-kPqmN`
- `remotes/origin/claude/mobile-app-design-LSidz`
- `remotes/origin/claude/plan-login-system-k95Rc`
- `remotes/origin/claude/refine-map-color-key-dwgpC`
- `remotes/origin/claude/self-serve-onboarding-yzvbz`
- `remotes/origin/hotfix/zone-setup-damage-count` (merged)
- `remotes/origin/add-record-fix` (merged)
- `remotes/origin/address-parse-changeover` (merged)
- `remotes/origin/merge/address-parse-into-main` (merged)
- `remotes/origin/test-preview-workflow`
- `remotes/origin/workflow-doc` (merged)
- `remotes/origin/timeout-fix` (merged)

Local branches `claude/plan-login-system-k95Rc`, `staging`, `test-preview-workflow`, `timeout-fix`, `workflow-doc` also exist.

---

## 7. Risks and Fragility

### Critical Security Issues

1. **Secrets committed to `.env.local` in the repo.** This file contains:
   - Full Google service account private key (JSON and base64)
   - All user email addresses with their sheet URL mappings
   - Mapbox public token
   - Vercel OIDC token

   Even though `.gitignore` lists `.env`, the file is named `.env.local` and **is tracked by git**. If this repo is or becomes public, all credentials are exposed. The service account key should be rotated immediately after being removed from version control.

2. **No server-side email verification.** The `/api/user-sheets` endpoint accepts an `email` query parameter from the client. There is no verification that the signed-in user actually owns that email address. The Google OAuth token is obtained client-side but the email claim is sent as a plain query parameter. A malicious user could call `/api/user-sheets?email=anyone@example.com` to discover another user's sheet URLs, then use `/api/sheets/values` with that sheet ID to read their data. The server trusts the client completely.

3. **No authentication on write endpoints.** The `/api/sheets/append`, `/api/sheets/batch-update`, `/api/sheets/batch-update-by-resident-id`, and `/api/sheets/append-record` endpoints require no authentication. Anyone who knows a sheet ID can write to it through these endpoints.

### Architectural Risks

4. **index.html is 16,942 lines / 767 KB.** This single file contains all application logic, all UI, all state management, all event handlers, and ~100 functions. Any change risks breaking unrelated features. Merge conflicts are likely. Reasoning about behavior requires reading the entire file.

5. **No separation of concerns.** Business logic (sheet column mapping, address parsing, zone identification), UI rendering (DOM manipulation, modal creation), data fetching, state management, and event handling are all interleaved in one global scope. Many functions depend on global variables like `sheetData`, `currentUserEmail`, `accessToken`, `zoneMap`, `currentColorMode`.

6. **Duplicated logic between index.html and server.js.** Both files contain:
   - `indexToColumnLetter` function (lines: server.js ~806, public/js/utils.js ~17)
   - CSV parsing logic (server.js ~420–477, index.html has `parseCSV`)
   - Sheet ID constants (hardcoded in both files)
   - The `CENTRAL_SHEET_ID` and `ACTIONS_SHEET_ID` are hardcoded in both `server.js` (with env var override) and `index.html` (no env var override — always hardcoded)

7. **Dual data paths for feeds.** The homepage feed and actions feed each have two code paths: an API call (`/api/homepage-feed`) and a direct CSV export fallback (`fetchSheetDirectly`, `fetchActionsSheetDirectly`). The client tries the API first, then falls back to direct CSV. This creates confusion about which path is actually used in production and means the sheet must be both service-account-accessible AND publicly readable.

### Operational Fragility

8. **Google Sheet column name sensitivity.** The entire system depends on matching column header strings (e.g., `"House #"`, `"Street"`, `"Damage Status"`, `"Address Plan"`, `"resident_id"`, etc.). If a captain renames a column in their sheet, dashboard features silently break. The `findAddressColumns` and `findColumn` utilities in `utils.js` use fuzzy matching with many fallback patterns, but this adds complexity without solving the root fragility.

9. **KML loading depends on public CORS proxies.** When direct KML fetch fails (common for Google Drive-hosted files), the app cycles through `api.allorigins.win`, `corsproxy.io`, and `api.codetabs.com`. These are free third-party services with no SLA. This code path is duplicated almost identically in two places (main map ~9375–9422 and home map ~11320–11386).

10. **User provisioning is manual JSON editing.** Adding a new user requires editing `users.json` (or the `USERS_JSON` / `USERS_JSON_B64` environment variable), mapping their email to a sheet URL, and redeploying. There is no admin UI. The `users.json` file in the repo contains 42 real user email addresses.

11. **No error boundary or crash recovery.** If any JavaScript error occurs during initialization or data loading, the app may show a blank screen or stale state. There is no global error handler, no error boundary component, no user-facing error state beyond specific try/catch blocks.

12. **External CDN dependencies loaded without integrity hashes.** Leaflet, Chart.js, html2pdf, VectorGrid, togeojson, and leaflet-kml are loaded from unpkg and cdnjs without subresource integrity (SRI) attributes. A CDN compromise could inject malicious code.

### Hidden Coupling

13. **NC Directory sheet structure is hardcoded in multiple places.** The sheet ID `1E77qmT4eGtyokaDvD2wlK3q2NeMcS4itmkbYp6Rz0qM` and column assumptions appear in `server.js`, `index.html` (NC Profile functions), and `nc-directory.html`. Changing the sheet requires updating all three.

14. **Mapbox configuration is embedded in index.html.** Dataset IDs, tileset IDs, source layer names, style objects, property key arrays, and manual label placement coordinates are all hardcoded in ~170 lines of configuration objects (index.html ~1098–1265). Any Mapbox Studio changes require editing index.html.

15. **localStorage as session state.** The app persists OAuth tokens, view state, and preferences in localStorage. This means: tokens survive across browser sessions (no logout on tab close), stale tokens can cause confusing failures, and clearing localStorage resets all user state.

### Maintenance Model (Inferred)

Based on commit history, branch naming, and codebase patterns:

- **Single developer** (johntmayo) making all changes
- **AI-assisted development** evident from `claude/` branch naming convention (7 branches)
- **No code review process** visible (PRs exist but appear self-merged)
- **No test suite** — zero test files in the repo
- **No linting** — no `.eslintrc`, no prettier config, no lint scripts
- **No CI/CD beyond Vercel** — Vercel auto-deploys from `main`
- **Staging branch exists** but unclear if actively used; `altagether-zone-dashboard-workflow.md` describes a staging workflow
- **Updates appear to be**: edit index.html → commit → push → Vercel auto-deploys
- **User provisioning**: manually edit users.json → commit → push → Vercel redeploys with new user map

---

## 8. Recommended Immediate Cleanup

These recommendations focus on truthfulness, clarity, and legibility — not refactoring.

### Priority 1: Security (Do Immediately)

1. **Remove `.env.local` from git tracking.** Add `.env.local` to `.gitignore`. Remove the file from the repository's git history (or at minimum, rotate all credentials contained in it: the Google service account key, the Mapbox token, and the Vercel OIDC token). Verify that Vercel environment variables are the production source for these values and that the committed file is not the canonical copy.

2. **Remove `users.json` from git tracking** (or accept the risk). This file contains real user email addresses. If the repo is private and will stay private, this may be acceptable. If there's any chance of the repo becoming public, move user mappings entirely to Vercel environment variables.

### Priority 2: Documentation Truth (Do This Week)

3. **Rewrite `README.md`** with a real project summary, setup instructions, and pointers to the most accurate docs.

4. **Mark stale docs clearly.** Add a `⚠️ POSSIBLY OUTDATED` header to: `PLATFORM_OVERVIEW.md`, `AUTH_AND_SPREADSHEET_ACCESS.md`, `DATA_PROBLEM_HANDOFF.md`, `DEV_PLAN.md`. Either update them or add a note saying which newer doc supersedes them.

5. **Delete or archive `context handoff.txt`.** It describes a state that no longer exists.

6. **Fix the `about.html` script error.** Either uncomment the Discord Quick Start button or remove the script that references it.

### Priority 3: Remove Obvious Detritus (Do Soon)

7. **Delete empty `css/` and `js/` top-level directories.** They serve no purpose (actual assets are in `public/css/` and `public/js/`).

8. **Evaluate `address list.csv` and `NC_Directory_Info_v1.csv`.** If these are reference/planning files, move them out of the repo root or document what they are. If unused, remove them.

9. **Evaluate the three `.code-workspace` files.** Keep only the one actually in use.

10. **Clean up stale git branches.** Delete merged remote branches and abandoned `claude/` experiment branches.

### Priority 4: Code Truthfulness (Do Before Any Feature Work)

11. **Remove confirmed dead code from index.html:**
    - `initializeContactListCreator` and its `expandableModules` references
    - `updateSheetLinkLabel`
    - `switchView('progress')` branch
    - Commented-out KML URL input UI

12. **Remove redundant explicit routes from server.js.** The `app.get` handlers for `/flyer_tool.html`, `/about.html`, `/help.html`, `/discord-help.html` (lines 879–890) are redundant with the `express.static` middleware registered earlier. They add confusion about how files are served.

13. **Reconcile sheet ID duplication.** The `CENTRAL_SHEET_ID` and `ACTIONS_SHEET_ID` are hardcoded in both `server.js` and `index.html`. The index.html copies have no env var override. Document this coupling or centralize.

---

## 9. Refactor Readiness Notes

Before a serious refactor should begin, the following must be understood and/or addressed:

1. **Map the complete state model.** The ~100 global variables and their interdependencies need to be documented. Functions like `loadAddressData` mutate `sheetData`, `selectedAddress`, map state, and UI simultaneously. Any refactor must preserve these side effects.

2. **Map all sheet column dependencies.** Create a complete inventory of every column name the app expects or fuzzy-matches against (damage, contact, address, plan, rebuild, captain, resident_id, etc.). This is the implicit schema of the product.

3. **Understand the zone metadata system.** The "Zone Notes" tab, KML URL storage, zone name extraction — these represent an implicit zone configuration layer stored within each zone's spreadsheet. This must be documented before restructuring.

4. **Decide the security model.** The current trust-the-client approach needs a deliberate decision: is it acceptable for an internal tool, or does it need server-side email verification? This decision affects the refactor architecture.

5. **Decide whether the feed dual-path is intentional.** The API-first-then-CSV pattern for feeds needs a decision: keep both paths, or commit to one.

6. **Test the NC Profile flow end-to-end.** The wizard, profile form, and save paths all write to the NC Directory sheet. Before refactoring, confirm these work correctly with the current sheet structure.

7. **Establish a minimal test harness.** Even manual smoke tests documented in a checklist would help. The app has zero automated tests and the monolithic structure means any change can break anything.

---

## 10. Open Questions / Requires Human Confirmation

1. **Is the `.env.local` file the production source of secrets, or are Vercel environment variables the canonical source?** If Vercel env vars are canonical, the `.env.local` can be safely removed from git without affecting production.

2. **Was `ENABLE_ADD_RECORD = true` an intentional re-enable?** The `DATA_PROBLEM_HANDOFF.md` and `context handoff.txt` say it was disabled. Commit `dfab811` ("fix add record feature") on the `add-record-fix` branch suggests it was intentionally re-enabled. Confirm.

3. **Is `outreach-helper.html` still wanted?** It's not linked from anywhere in the app. Is it shared via direct URL, or was it abandoned?

4. **Are `help.html` and `discord-help.html` still wanted?** They were linked from `about.html` but those links are now commented out. Are they maintained elsewhere or abandoned?

5. **Is the `staging` branch and staging workflow actively used?** The `altagether-zone-dashboard-workflow.md` describes a staging process, but it's unclear if this is practiced.

6. **Is `documentation.html` still needed?** It covers only the Add Record feature and is not linked from any UI.

7. **Are the hidden tool modules (`#buildnotes`, `#dataTransferTool`) planned for future release, or should they be removed?**

8. **Is the `address list.csv` file used for anything?** (1,179 street names, no code references.)

9. **How are new users added in practice?** Does someone edit `users.json` and push, or is it done through Vercel environment variables?

10. **Is the Sold Properties overlay (`ENABLE_SOLD_PROPERTIES_OVERLAY`) still planned, or should it be removed?**

11. **Which `claude/` branches represent completed work (merged elsewhere) vs abandoned experiments?**

12. **Is Google Analytics actually configured in production (is `GA_MEASUREMENT_ID` set)?**

13. **Does the current sheet structure actually have a `resident_id` column?** The batch-update-by-resident-id endpoint depends on it, and `DATA_PROBLEM_HANDOFF.md` listed it as aspirational.

---

## 11. Prioritized Cleanup Checklist

### Immediate (Security)
- [ ] Rotate Google service account key (it has been committed to git)
- [ ] Add `.env.local` to `.gitignore` and remove from git tracking
- [ ] Verify Vercel env vars are the production source for all secrets
- [ ] Evaluate whether `users.json` (with real emails) should be in git

### This Week (Documentation Truth)
- [ ] Rewrite `README.md` with real project info
- [ ] Add staleness warnings to `PLATFORM_OVERVIEW.md`, `AUTH_AND_SPREADSHEET_ACCESS.md`, `DATA_PROBLEM_HANDOFF.md`
- [ ] Delete or archive `context handoff.txt`
- [ ] Fix `about.html` broken Discord modal script
- [ ] Decide: are `help.html` and `discord-help.html` active or abandoned?

### Soon (Detritus Removal)
- [ ] Delete empty `css/` and `js/` top-level directories
- [ ] Evaluate and remove/relocate `address list.csv`, `NC_Directory_Info_v1.csv`
- [ ] Remove extra `.code-workspace` files (keep only one, if any)
- [ ] Delete merged/abandoned remote git branches
- [ ] Remove dead code from index.html (contact list creator, sheet link label, progress view, commented KML UI)
- [ ] Remove redundant explicit HTML routes from server.js

### Before Feature Work
- [ ] Document the complete set of expected sheet column names
- [ ] Document the zone metadata system (Zone Notes tab, KML URL, zone name)
- [ ] Document or reconcile the dual-path feed fetching
- [ ] Reconcile hardcoded sheet IDs between server.js and index.html
- [ ] Create a manual smoke test checklist for core flows
- [ ] Decide on security model (trust-the-client vs server-side verification)

### Before Refactoring
- [ ] Map global state variables and their dependencies
- [ ] Identify all implicit contracts between client and server
- [ ] Test NC Profile wizard end-to-end
- [ ] Establish minimal automated test coverage for critical paths
- [ ] Make a decision on the `outreach-helper.html` and hidden tool modules

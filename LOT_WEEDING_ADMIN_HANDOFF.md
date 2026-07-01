# Lot Weeding Admin Handoff

**Status:** Lot Weeding Command Center is feature-complete for the confirmed console design (June 2026). Staging validation completed on a copied intake sheet with revised columns and service-account Editor access. Recent work is **operator-driven UX polish** (filters bar, single-lot editor layout, contact formatting). Production cutover and write-flow tests remain when ready.

**Latest pass (UX polish + hardening, July 2026):**
- **Fifth tab: Help** — "How to Use This Tool" instructions (navigate map, edit a lot, group via Shift+click/Draw-area lasso, other tabs) + a "View Spreadsheet" link (`LOT_WEEDING_SPREADSHEET_URL`). ⚠️ The linked URL is the Altadena-Talks *original*; the tool actually reads a copy with revised headers. Confirm/repoint that link before relying on it.
- **Details card** — split into separate **Zone** and **Captain** rows. Captain row shows each captain's name + email (with small copy button); multiple captains are **semicolon-separated and aligned by index** across `captainName`/`captainEmail`. Phone numbers are now plain text (not tap-to-call). Email copy button is smaller/subtler. Follow-ups emails got the same copy button.
- **Context bar** — label is now contextual (**Date selected** / **Selection** / **Active filters**); day chip reads **Date:** not Day:. Fixed a bug where the bar/date lingered after clearing the last chip.
- **No auto-select on load** — the side panel opens on a "No lot selected" instructions state instead of auto-picking the top row.
- **Map height is fixed (700px)** again, with the side panel scrolling internally. (Reverted a variable-height experiment that caused scroll jank when selecting pins.)
- **Altagether Zones** overlay (renamed from "Zones") is **non-interactive**, sits under the pins, and shows **permanent, click-through labels** (zone name + captain names), lightly transparent so pins stay visible. Marker click focus outline removed.
- **Action dropdown labels standardized:** Schedule for a date / Mark Schedule Next / **Mark Cleaned** / **Mark Needs Attention**.
- **Pin/status palette + style now match the main app** — statuses recolored to the main map's `colorPalette` (Requested light-caramel `#fdba77`, Schedule Next soft-blush `#f9d6d3`, Scheduled sky-blue-light `#81bdc3`, Cleaned dry-sage `#afc892`, Needs Attention dusty-mauve `#bc455a`, Cancelled ash-grey `#e5e5e5`), and map markers converted from Leaflet `circleMarker` to the main app's SVG `divIcon` (offset charcoal shadow + charcoal stroke, grow-on-emphasis; amber ring for multi-selected). Badges echo the hues with darker legible text.
- **Captain phone** now shown in the details card (from the master sheet's `NC Phone` column, wired through `lot-weeding/routes.js`). **ⓘ** affordance added to the tooltipped Homeowner Notified / UWS Contract labels. Details card gained a heavy divider between Contact and Altagether Zone; "Zone"→"Altagether Zone", "Captain"→"Neighborhood Captain". Header kicker "Townwide operations"→"Neighbors helping neighbors". Partner logo path corrected to `public/images/atf-logo.png`.
- **Lot-weeding-only nav white-labeling** — for zoneless `lot_weeding_admin` users the left nav is stripped to just **Lot Weeding Command Center** + Sign out (no blur, other tabs/links hidden), and the partner logo (`public/images/atf-logo.png`, via `LOT_WEEDING_PARTNER_LOGO_SRC`) replaces the "Zone XX / Altagether" header. Falls back to the text title if the PNG is missing/fails to load.
- **Bug fixes:** (1) fixed a **TDZ crash on load** — `LOT_WEEDING_PARTNER_LOGO_SRC` was used by `updateNavigationState()` during initial synchronous execution before its `const` was initialized, which halted init and trapped users on "Checking your zone access" unless they cleared cache; the const now lives near the top and the nav-chrome call is wrapped in try/catch. (2) **Expired-session recovery** — the Command Center error state now shows **"Sign in with Google"** (calls `signIn()`) when there's no token, instead of a dead "Try again".

**Previous pass:** grouping/batch overhaul — multi-select side panel rebuilt as one **Action picker → single form → summary → collapsible preview → one Apply button** (added **Mark Schedule Next** batch; "Date Scheduled"; removed "Writes … only" pills and duplicate lot lists). Unified selection language to **"N lots selected"**. Map controls simplified to Draw area / Finish + Cancel. **Shift+click** pins to add/remove; queue button **Add to selection / Remove**. Show dropdown + helper text; revised status colors; Schedule Next rename; tooltips; single-lot editor layout.

**Earlier passes:** batch completion/attention, NC zone overlay, draw-to-select, Follow-up writes, batch scheduling, tabbed console, local post-save refresh.

This document captures what was built, how it is configured, what was validated in staging, and what still needs attention before calling the workflow production-ready.

**Maintenance rule:** Always update this handoff document after making any Lot Weeding Admin changes — keep Status, Latest pass, What We Built, UX Expectations, Current Limitations, and the Handoff Prompt accurate for the next agent.

---

## Purpose

The **Lot Weeding Command Center** is a townwide operations console for managing post-fire lot-weeding requests in Altadena. Homeowners submit requests through an intake process; those rows land in a shared spreadsheet. This tool gives a dedicated lot-weeding administrator (or full admin) a single place to run the program — without pretending they are a Neighborhood Captain assigned to one zone sheet.

**What the admin is trying to accomplish:**

1. **See the whole pipeline geographically** — every open request on a map, colored by status, with enough context (address, APN, zone, contact info) to reason about where work should happen.
2. **Schedule volunteer weeding runs** — assign lots to cleaning dates, individually or in spatial clusters (draw an area, select lots, batch-schedule a work day).
3. **Run the calendar** — see what is scheduled when, highlight a day on the map, copy a day’s lot list for volunteers (address-only or with contact info).
4. **Clear follow-up queues** — missing APNs, ROE not returned, scheduled lots where the homeowner has not yet been marked notified; fix or record state without hunting through the spreadsheet.
5. **Close the loop on work** — mark lots cleaned (with date), flag blockers as needs attention, edit any row details in one side-panel editor backed by controlled sheet writes.

The spreadsheet remains the source of truth. The command center is the **operator UI** for triage, scheduling, follow-through, and completion — map-first for geography, calendar for timing, follow-ups for exceptions.

**Who uses it:** users with the `lot_weeding_admin` role (zoneless, curtailed dashboard) or full `admin` users who also see the normal NC dashboard.

---

## UX Expectations (Product Owner)

**Feature-complete is not the same as done.** The product owner places a high priority on **clear, usable UI/UX**. Operators should be able to pick up the tool without memorizing hidden multi-step flows or reconciling duplicate controls that do the same thing differently.

**Guiding principles for any future work:**

- **One obvious path per task** — if scheduling a group takes Draw → points → Select, the UI must say so inline; controls should not look broken or inert when idle.
- **No redundant competing controls** — prefer one clear edit/save pattern; removed single-lot status quick-actions and selection buttons from the filters bar for this reason.
- **Visible state** — active filters, selection count, and calendar day filter must never be hidden; the context bar exists for this reason.
- **Preview before writes** — batch operations show what will change; partial failures are reported per lot.
- **Labels match behavior** — “Select” on the map means “close drawn polygon and select lots inside,” not generic multi-select; naming and affordances must match.
- **Polish is first-class work** — copy, layout density, disabled/hidden states, and operator testing feedback should be treated as priorities alongside new features.

**Resolved (June–July 2026):**
- Single-lot status quick-actions removed.
- Map view filter is a **Show** dropdown + helper text (replaced the status chips/filter bar).
- Map heading bar removed (“Map workspace / Townwide lot-weeding requests / mapped counts”).
- Single-lot editor layout: editable fields top, read-only requester/contact/zone/captain bottom, Notes last; Map status lat/lon line removed from editor.
- Map **Select** button removed; drawing now uses **Draw area → Finish/Cancel** with inline hints. Build a selection via draw, **Shift+click** pins, or queue **Add to selection / Remove**.
- Multi-select side panel collapsed from three stacked batch cards into one **Action picker → form → summary → preview → Apply** flow; selection language unified to **"N lots selected"** (no duplicate count in the map box).
- **Help tab** added with getting-started instructions and the source-spreadsheet link.
- Side panel no longer auto-selects the top lot; opens on instructions instead.
- Map height fixed (no more variable-height scroll jank); side panel scrolls internally.
- Altagether Zones overlay is non-interactive with click-through name+captain labels (doesn't block the lasso or cover pins).
- Lot-weeding-only users get a stripped, white-labelable nav; expired sessions recover via an in-view "Sign in with Google" button.

Improvements in these areas are **expected next work**, not optional cosmetic fixes.

---

## What We Built

The dashboard supports a specialty, zoneless **Lot Weeding Command Center** inside the existing Zone Dashboard.

Key pieces:

- New top-level `Lot Weeding Admin` tab in `index.html`.
- New `lot_weeding_admin` role/capability in the access flow.
- Full `admin` users automatically inherit Lot Weeding Admin access.
- Users with only `lot_weeding_admin` can sign in without a zone sheet and land in a curtailed dashboard.
- Dedicated backend module at `lot-weeding/routes.js`.
- Role-gated request APIs:
  - `GET /api/lot-weeding-admin/requests`
  - `PATCH /api/lot-weeding-admin/request-row`
- Captain-facing lot-weeding reads still use `GET /api/lot-weeding/values`.
- Normalization layer maps messy spreadsheet headers into stable request fields (revised intake columns + mirror-era aliases).

### Tabbed operations console

`#lotWeedingAdminView` is a five-tab console — **Map / Calendar / Follow-ups / Stats / Help** — over one shared `lotWeedingAdminState`. Switching tabs preserves selection and calendar day filter.

- **Context bar** — selection count and calendar day filter chips (each clearable). Label is contextual: **Date selected** / **Selection** / **Active filters**. Reliably removed when the last chip is cleared.
- **Map tab** — **Show** dropdown (Active default + per-status views + All), helper text explaining the current view, search + Refresh, Leaflet map (no heading bar above map), status legend, sortable request queue, single-lot or multi-select side panel. Calendar day filter dims non-matching lots on the map.
- **Map controls** — **Altagether Zones** (overlay, informational only) and **Draw area** (click corners). While drawing the control swaps to **Finish** (close shape, select lots inside) + **Cancel**; a transient hint line appears only during drawing. No standalone "Select" button, no persistent selection count in the map box (the side panel owns selection state/language). Control cluster is fixed-width so it never reflows as buttons/labels change.
- **Altagether Zones overlay** — non-interactive (never captures clicks/hover, so the lasso works and it can't block pins), rendered under the pins, with **click-through labels** showing zone name + captain first names (`buildLotWeedingZoneTooltipLabel`), styled lightly transparent (`.lot-weeding-zone-label`). Off by default. **Labels are zoom-gated** — hidden until zoom ≥ `LOT_WEEDING_ZONE_LABEL_MIN_ZOOM` (reuses the main Map tab's `MAPBOX_ADDITIONAL_LAYER_CONFIG.labelMinZoom`, currently 16) via `updateLotWeedingZoneLabelVisibility()` on `zoomend`, which toggles `.lw-show-zone-labels` on the map container (same tooltip-hidden-by-CSS pattern as the main map's `show-nearby-zone-labels`). Keeps names from stacking up when zoomed out.
- **Building a selection** — draw an area (primary, bulk), **Shift+click** pins to add/remove individually, or use the queue **Add to selection / Remove** buttons. A plain pin click opens the single-lot editor (replaces selection). On load nothing is auto-selected — the panel shows a "No lot selected" instructions state.
- **Calendar tab (read-only)** — month grid on `Date Scheduled`, day selection → shared `dayFilter`, **Copy day list** with optional contact info (clipboard only).
- **Follow-ups tab** — **Missing APN**, **Scheduled but not notified**, **ROE outstanding** queues with inline contact info (email has a copy button), **Open & edit**, and one-click **Mark notified** (`Homeowner notified = Yes`) / **Mark ROE returned** (`ROE Status = Returned`).
- **Stats tab** — workload cards (Active, Schedule Next, Scheduled, Needs Attention, Missing APN, Cleaned, Total).
- **Help tab** — "How to Use This Tool": navigate the map, edit a single lot, work several lots at once (Shift+click / Draw-area lasso), and what the other tabs do; plus the source-spreadsheet link (`LOT_WEEDING_SPREADSHEET_URL`). ⚠️ That link currently points at the Altadena-Talks original, not the revised-header copy the tool actually reads — verify before relying on it.
- **Single side-panel editor** — one lot at a time on the Map tab; **Save lot**. Layout (top → bottom): editable grid → hint → read-only Requester / Contact → heavy divider → **Altagether Zone** / **Neighborhood Captain** → **Notes** → Save. Panel is a fixed height and scrolls internally (map stays a fixed 700px; no layout reflow when selecting).
  - **Editable field order** (2 columns): Status | ROE Status; Date Scheduled | Date Cleaned; Homeowner Notified | UWS Contract; APN.
  - Tri-state fields (UWS Contract, Homeowner Notified, ROE Status) show **(unknown)** when blank (writes empty string). **Homeowner Notified** and **UWS Contract** labels have hover tooltips explaining each field.
  - **Contact:** requester email with a small/subtle copy button; **phone is plain text** (not tap-to-call).
  - **Neighborhood Captain:** separate row (below a heavy divider); each captain's name + email (with copy button) + phone (plain text, formatted). Multiple captains are **semicolon-separated in `captainName`/`captainEmail`/`captainPhone`, aligned by index** (`renderLotWeedingAdminCaptainsHtml`). Captain phone is mapped in `lot-weeding/routes.js` (request + context columns via `nc phone`/`captain phone`/`captain_phone`/`contact phone` aliases; name matcher excludes email/phone columns).
  - Tooltipped labels (**Homeowner Notified**, **UWS Contract**) show a subtle **ⓘ** affordance (`.lot-weeding-admin-tip-icon`) next to the text; the tooltip itself is still the native `title` attribute.
  - **Last Contact Date** removed from UI and PATCH (no longer on intake sheet).
  - Assigning `Date Scheduled` auto-sets `Status = Scheduled`. `Homeowner notified` is manual only — never auto-set by scheduling or batch actions.
- **Map view filter** — **Show** dropdown (not status chips); helper text below explains Active vs each status view. Not a selection/scheduling toolbar.
- **Multi-select side panel** — single panel for 2+ selected lots: header **"N lots selected"** + **Clear**, status-mix/mapped summary, collapsible **View selected lots** list, then one **Action** picker → one form → plain-language summary → collapsible per-lot preview → one **Apply** button + per-lot results. Replaced the old three stacked batch cards (no more "Writes … only" pills, no duplicate lot lists).
- **Batch group actions** (action picker) — all use sequential `PATCH /api/lot-weeding-admin/request-row` with summary, collapsible preview, single confirm, and per-lot partial-failure reporting:
  - Schedule for a date → `Date Scheduled` + `Status = Scheduled`
  - Mark Schedule Next → `Status = Schedule Next` only
  - Mark Cleaned → `Status = Cleaned` + `Date Cleaned`
  - Mark Needs Attention → `Status = Needs Attention`; optional note appended to Request notes (`details`)

Saves PATCH the sheet, merge into `lotWeedingAdminState.requests`, recompute stats locally, and refresh map/table/side panel in place (no full reload after every save).

Focused normalization/config tests live in `test/lot-weeding.test.js`.

---

## Staging / Source Sheet Setup (Completed)

The product owner completed staging setup and validation:

1. **Copied** the intake spreadsheet (live original left unchanged).
2. **Revised** the copy to the target column schema (see Recognized Intake Columns below).
3. **Shared** the copy with the service account as **Editor**.
4. Pointed staging at the copy via `LOT_WEEDING_SOURCE_SHEET_ID` or `LOT_WEEDING_SOURCE_SHEET_URL` (and `LOT_WEEDING_SOURCE_SHEET_NAME` if needed).
5. **Validated:**
   - `lot_weeding_admin`-only login (Access Sheet row with `role:lot_weeding_admin`)
   - Full admin access (normal dashboard + Lot Weeding Admin tab)
   - Controlled writes against the revised source (single-lot and batch flows)
   - Captain-facing lot-weeding surfaces after source/schema switch
   - Revised status vocabulary in live data
   - Map with APN-matched coordinates

Do not treat the central mirror (`LOT_WEEDING_SHEET_ID`) as the write target for real admin work — edits there may not flow back to the partner-owned sheet and mirror refreshes can overwrite changes.

---

## Important Architecture Decision

Lot Weeding Admin is modeled as a role-based specialty workflow, not as a fake Neighborhood Captain assignment.

A Lot Weeding Admin may not belong to Altagether, be an NC, have an assigned zone, or need the normal Map / Neighbors / Actions / Tools workflow.

The access model allows roles/capabilities even when `sheets: []`.

---

## Access Sheet Setup

Full admins do not need a new Access Sheet row — `admin` grants Lot Weeding Admin access.

For a specialty Lot Weeding Admin user:

| Column | Value |
|---|---|
| `login_email` | Their Google login email |
| `sheet_url` | `role:lot_weeding_admin` |
| `role` | `lot_weeding_admin` |
| `active` | `TRUE` |

The `role:lot_weeding_admin` value is a sentinel; the server does not parse it as a Google Sheet URL.

---

## Environment Variables

Source sheet priority:

```ini
LOT_WEEDING_SOURCE_SHEET_ID=
LOT_WEEDING_SOURCE_SHEET_URL=
LOT_WEEDING_SOURCE_SHEET_NAME=
LOT_WEEDING_SOURCE_RANGE=A1:ZZ5000
LOT_WEEDING_SOURCE_LABEL=original
```

Aliases: `LOT_WEEDING_INTAKE_SHEET_*`

Mirror fallback (smoke-test only; avoid writes):

```ini
LOT_WEEDING_SHEET_ID=
LOT_WEEDING_SHEET_URL=
LOT_WEEDING_SHEET_NAME=
```

---

## Service Account Access

- **Viewer** — read-only smoke testing
- **Editor** — required for admin PATCH writes on the configured source sheet

---

## Recognized Intake Columns

Target revised fields:

- `Request Submission Date Stamp`
- `Name of Homeowner`
- `Address of Property`
- `Phone Number of Homeowner`
- `Email of Homeowner`
- `Universal Waste Systems contract Y/N`
- `Last contact date` (legacy reads only; not editable in admin UI)
- `Date Scheduled`
- `Homeowner notified of schedule`
- `Date Cleaned`
- `ROE Status`
- `Notes`
- `APN`
- `Status`

Mirror-era aliases remain supported (`Timestamp`, `lot_weeding_*_spring_2026`, etc.).

Editable PATCH fields: `apn`, `status`, `scheduledDate`, `homeownerNotified`, `dateCleaned`, `roeStatus`, `universalWasteContract`, `details`.

---

## Status Vocabulary

Pin/status colors reuse the **main app's palette** (`colorPalette` in the non-lot-weeding map):

- `Requested` — submitted, not prioritized (`#fdba77` light-caramel)
- `Schedule Next` — look at next (`#f9d6d3` soft-blush); legacy `On-Deck` normalizes to this
- `Scheduled` — assigned to a date (`#81bdc3` sky-blue-light)
- `Cleaned` — weeding completed (`#afc892` dry-sage)
- `Needs Attention` — blocker / manual review (`#bc455a` dusty-mauve)
- `Cancelled` — no longer active (`#e5e5e5` ash-grey)

Map markers use the main app's SVG pin style (`buildLotWeedingAdminMarkerIcon`): status-colored circle + hard offset charcoal shadow + charcoal stroke, growing when emphasized (focused/day-hit/selected); multi-selected pins get an amber (`#FBBF24`) ring. Dimmed (day filter non-match) via marker opacity. Admin badges echo the same hues (background tint + border) but use a **darker text of each hue** so small pill text stays legible (`.lot-weeding-admin-status--*` in styles.css).

Legacy: `Completed` → `Cleaned`, `Flagged` → `Needs Attention`, `Open` → `Requested`.

`ROE Status` is separate: blank, `Requested`, `Returned` (legacy booleans → `Returned`).

---

## Zone/Captain Context

Enrichment by APN from `GODMODE_MASTER_SHEET_ID` / `GODMODE_MASTER_RANGE`, or overrides:

```ini
LOT_WEEDING_CONTEXT_SHEET_ID=
LOT_WEEDING_CONTEXT_RANGE=
```

Coordinates come from the **intake sheet** (`Latitude`/`Lat`, `Longitude`/`Lng`/etc.) when present; otherwise from **APN join to the godmode master/context sheet** (`GODMODE_MASTER_SHEET_ID` or `LOT_WEEDING_CONTEXT_SHEET_ID`). The API returns `latitude` and `longitude` on each request; the map uses those for markers. There is **no client-side geocoding** — lots without usable coordinates are unmapped (still in queue/Follow-ups). Missing APN or context → blank zone/captain.

---

## Files Changed

- `server.js`
- `index.html`
- `public/css/styles.css`
- `lot-weeding/routes.js`
- `test/lot-weeding.test.js`
- `public/images/atf-logo.png` (partner logo for lot-weeding-only nav; app degrades gracefully if absent)

---

## Confirmed Console Design (June 25, 2026)

Settled with the product owner. All items below are **implemented** unless noted under Current Limitations.

### Build order — all DONE

1. Tab split + active context bar — June 25, 2026  
2. Calendar tab (read-only, day filter, copy list) — June 25, 2026  
3. Follow-up queues + one-click Mark notified / Mark ROE returned — June 2026  
4. Batch scheduling writes — June 25, 2026  
5. NC zone overlay — June 2026  
6. Drawn polygon selection → group batch actions — June 2026  
7. Batch completion / attention workflows — June 26, 2026  

### Locked design rules

- **Tabbed console:** Map / Calendar / Follow-ups / Stats / Help (five tabs); shared state across tabs.
- **Single editor** on Map tab; no per-row inline editing in the queue; no status quick-action buttons.
- **Assigning `Date Scheduled` auto-sets `Scheduled`**; **`Homeowner notified of schedule` is always manual** (side panel, Follow-ups Mark notified, or spreadsheet — never set by schedule/clean/attention batch writes).
- **Date pickers** for all date fields in the UI.
- **Day export** — address-only or with contact info; clipboard only.
- **NC zones** — overlay only, off by default, not a filter.
- **Batch writes** — preview before commit; partial-failure reporting per lot.

Single-lot and batch writes use `PATCH /api/lot-weeding-admin/request-row` (batch iterates single-row PATCHs intentionally).

---

## Current Limitations

The command center is operational but **UX polish is still needed** based on operator testing. Known rough edges:

- No dedicated map warning layer for edge cases (e.g. Scheduled without date).
- No address geocode fallback for unmapped lots (coordinates from APN/context join only).
- No batch PATCH endpoint (sequential writes only).
- No audit log or row conflict detection.
- No polished mobile workflow for heavy editing.
- Write-flow automated tests are thin (normalization only in `test/lot-weeding.test.js`).

Not planned: persistent named Groups / deployment-group object model; generic sheet-write API beyond the narrow PATCH path.

---

## Next Work

1. **UX polish** from real operator use — copy/help text, edge-case warnings, mobile workflow.
2. **Production cutover** when ready — point production env at the validated source sheet (staging copy or approved production intake); do not switch env vars casually.
3. **Write-flow tests** — PATCH field mapping, batch partial-failure, date round-trip, note append.
4. **Optional:** narrow batch PATCH endpoint if large group sizes become slow.

---

## Verification Commands

Run after touching lot-weeding code (PowerShell — one command per line):

```powershell
node --check "server.js"
node --check "lot-weeding/routes.js"
node --test "test/lot-weeding.test.js"
node --test "test/godmode.test.js"
node -e "const fs=require('fs'); const vm=require('vm'); const html=fs.readFileSync('index.html','utf8'); const scripts=[...html.matchAll(/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/gi)].map((m)=>m[1]); scripts.forEach((script,index)=>new vm.Script(script,{filename:'index.html#inline-script-'+index})); console.log('checked '+scripts.length+' inline scripts');"
```

Read lints on touched files (`index.html`, `public/css/styles.css`, `lot-weeding/routes.js`).

---

## Implementation Notes

### Shared state (`lotWeedingAdminState`)

- Tabs: `activeTab` (`map` | `calendar` | `followups` | `stats` | `help`)
- Filters: `filter`, `query`, `dayFilter`, `calendarMonth`, `includeContactInfo`
- Selection: `selectedRowNumbers`, `selectedRowNumber` (no auto-select on load — cleared if the prior lot no longer exists)
- Batch: `batchSchedule*`, `batchClean*`, `batchAttention*`, `batchScheduleNext*`, `batchAction`
- Map: `map`, `markers`, zone overlay, draw polygon (`drawEnabled`, `drawLatLngs`, etc.)

### Nav chrome & auth recovery for lot-weeding-only users

- `isZonelessLotWeedingOnlyUser()` = `lot_weeding_admin` capability, not `admin`, no `currentSheetUrl` (driven partly by the cached `lotWeedingAdmin` localStorage flag).
- `applyLotWeedingOnlyNavChrome()` (called at the end of `updateNavigationState`, wrapped in try/catch) toggles `left-nav--lot-weeding-only` (CSS hides all nav items except `#navLotWeedingAdmin` + `#signOutBtn`, and removes the disabled blur) and swaps the header for the partner logo when it loads.
- `LOT_WEEDING_PARTNER_LOGO_SRC` (`public/images/atf-logo.png`) is declared **near the top of the script** on purpose — `updateNavigationState()` runs during initial synchronous load, so any `const` it transitively reads must be initialized first (this caused a TDZ crash when declared late).
- **Expired-session recovery:** when `loadLotWeedingAdminData` has no `accessToken`/`currentUserEmail`, the error card shows **"Sign in with Google"** → `signIn()`; on success `completeSignInAfterToken()` re-routes a zoneless lot-weeding user back via `switchView('lotWeedingAdmin')`.

### Dates

Intake stores free-text dates. `parseLotWeedingDate` / `toLotWeedingDateKey` normalize for grouping and pickers; writes use `formatLotWeedingDateForSheet` (`M/D/YYYY`). Unparseable sheet values (e.g. "TBD") are preserved when the picker is empty (`data-lot-weeding-date-original`).

### Map interaction

- **Plain marker click** → `focusLotWeedingAdminLot` (single lot, replaces selection).
- **Shift+click marker** → `toggleLotWeedingAdminRequestSelection` (add/remove from multi-selection).
- **Multi-select** → Draw area → **Finish**, Shift+click pins, or queue **Add to selection / Remove**.
- **Selection changes** on Map tab update in place via `refreshLotWeedingAdminMapSelection` (no full map rebuild on click).
- **Batch action panel** → `renderLotWeedingBatchActions` reads `lotWeedingAdminState.batchAction`; `applyLotWeedingSelectedBatchAction` dispatches to the schedule/scheduleNext/clean/attention writers.

### Batch completion / attention (June 26, 2026)

- Batch clean: requires Date Cleaned; writes `status` + `dateCleaned` only.
- Batch attention: writes `status: Needs Attention`; optional note appended to `details`.
- Clearing selection resets batch message/result state.

---

## Handoff Prompt For Next Agent

```text
Continue the Lot Weeding Admin work. Read LOT_WEEDING_ADMIN_HANDOFF.md (Purpose, UX Expectations, What We Built) and CODEBASE_FIELD_GUIDE.md.

Context: Lot Weeding Command Center — Map / Calendar / Follow-ups / Stats / Help over shared lotWeedingAdminState. Staging validation done (copied intake sheet, revised columns, service-account Editor). Core features shipped: batch schedule/clean/attention, Follow-up Mark notified / Mark ROE returned, NC zone overlay, draw-to-select, local post-save refresh.

Recent UX (do not regress):
- Five tabs incl. **Help** ("How to Use This Tool" + spreadsheet link `LOT_WEEDING_SPREADSHEET_URL`). Note: that link points at the Altadena-Talks original, NOT the revised-header copy the tool actually reads — verify before relying on it.
- Map tab: **Show** dropdown + helper text (not filter chips). Status colors reuse the main app palette: Requested #fdba77, Schedule Next #f9d6d3, Scheduled #81bdc3, Cleaned #afc892, Needs Attention #bc455a, Cancelled #e5e5e5. Pins use the main app's SVG style (offset charcoal shadow + charcoal stroke, grow-on-emphasis); badges echo the hues with darker legible text.
- Multi-select side panel = one Action picker (Schedule for a date / Mark Schedule Next / Mark Cleaned / Mark Needs Attention) → single form → summary → collapsible preview → one Apply button + per-lot results. Header "N lots selected" + Clear. Do not bring back the three stacked batch cards or "Writes … only" pills.
- Selection language is "N lots selected" everywhere; map box shows NO persistent selection count.
- Map controls: **Altagether Zones** + Draw area; while drawing → Finish + Cancel. No standalone Select button. Fixed-width control cluster. Zones overlay is NON-interactive (under pins, click-through name+captain labels) — don't make it clickable/hoverable (breaks the lasso).
- Build selection via: draw area, Shift+click pins, or queue Add to selection / Remove. Plain pin click opens single-lot editor. Nothing auto-selects on load (panel shows instructions).
- Map is fixed 700px height; side panel scrolls internally. Do NOT reintroduce variable map height (caused scroll jank).
- Single-lot editor: editable fields top (Status, ROE Status, Date Scheduled, Date Cleaned, Homeowner Notified, UWS Contract, APN), read-only Requester/Contact then a heavy divider then Altagether Zone/Neighborhood Captain below, Notes at bottom. Requester email has a subtle copy button; phone is PLAIN TEXT (not tap-to-call). Captain row = name+email+phone per captain (semicolon-separated, index-aligned; phone mapped through routes.js). Homeowner Notified / UWS Contract labels have hover tooltips + a subtle ⓘ icon.
- Context bar label is contextual (Date selected / Selection / Active filters) and disappears when the last chip is cleared.
- Lot-weeding-only users: stripped left nav (only Lot Weeding Command Center + Sign out, no blur) + partner logo `public/images/atf-logo.png` (`LOT_WEEDING_PARTNER_LOGO_SRC`). Keep `applyLotWeedingOnlyNavChrome` in try/catch and any const it reads declared before `updateNavigationState` runs (TDZ crash risk). Expired session → error card offers "Sign in with Google" (signIn()).
- Status **Schedule Next** (not On-Deck); legacy On-Deck sheet values normalize on read.
- No status quick-actions; no Last Contact Date in UI/PATCH; tri-state fields use (unknown) default.
- Homeowner notified always manual.

Goal: Continue UX polish from operator feedback (see UX Expectations). Optional: write-flow tests, batch PATCH endpoint, production cutover when asked.

Do not: invent sheet columns; remove mirror compatibility; change Access Sheet or production env vars without explicit request.

Always update LOT_WEEDING_ADMIN_HANDOFF.md after any changes you make (Status, Latest pass, relevant sections, and Handoff Prompt).

Run verification commands in handoff after code changes.
```

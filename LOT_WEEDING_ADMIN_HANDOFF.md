# Lot Weeding Admin Handoff

**Status:** first architecture pass implemented and staging tests passed. Next phase is a map-first UX/functionality redesign of the Lot Weeding Admin tab.

**Latest pass:** NC zone overlay shipped after Follow-up write actions and the save-speed/clarity cleanup. The Map tab now has an off-by-default **NC zones** toggle that draws the townwide Mapbox zone dataset as a subtle informational Leaflet GeoJSON layer behind lot markers, with hover tooltips and a small status message. It is not a filter or grouping dimension. The Follow-ups tab supports one-click **Mark notified** (`Homeowner notified = Yes`) on Scheduled-but-not-notified rows and **Mark ROE returned** (`ROE Status = Returned`) on ROE outstanding rows, using the existing narrow PATCH path and local post-save refresh. Single-lot saves now PATCH the sheet, merge the changed fields into `lotWeedingAdminState.requests`, recompute stats locally, and refresh the current map/table/side-panel in place instead of forcing a full sheet reload after every save. Batch scheduling also applies successful row updates locally after each PATCH and no longer forces a final full reload. Server-side PATCH no longer reads the entire lot-weeding range just to resolve editable columns; it reuses fresh cached headers when available or reads only `A1:ZZ1`. The Lot Weeding page now aligns with the standard content gutter, and the Map tab collapses the old selection strip + filter/search strip into a single compact command band. The empty Active Context strip is hidden until there is actual cross-tab context to show. The selection CTA now says **Pick Date** instead of **Schedule Selected** because it focuses the scheduling date picker rather than committing a write.

**Confirmed direction (June 25, 2026):** the view is now a tabbed operations console — **Map / Calendar / Follow-ups / Stats** — sharing selection/day context, with per-row inline editing retired in favor of a single side-panel editor. The tab split, compact contextual controls, read-only Calendar, single editor, Follow-up queues with direct write actions, command-center UI cleanup, sortable request table, Stats tab, batch scheduling writes, local post-save refresh, and NC zone overlay are implemented; remaining work is polygon/lasso selection and later batch completion/attention workflows. See "Confirmed Console Design" and "What We Built" below. A ready-to-use next-agent prompt is at the very bottom of this file.

This document captures what was built, how to configure it, and what still needs to happen before the Lot Weeding Admin workflow is production-ready.

---

## What We Built

The dashboard now supports a specialty, zoneless Lot Weeding Admin experience inside the existing Zone Dashboard.

Key pieces:

- New top-level `Lot Weeding Admin` tab in `index.html`.
- New `lot_weeding_admin` role/capability in the access flow.
- Full `admin` users automatically inherit Lot Weeding Admin access.
- Users with only `lot_weeding_admin` can sign in without a zone sheet and land in a curtailed dashboard.
- New dedicated backend module at `lot-weeding/routes.js`.
- New role-gated request APIs:
  - `GET /api/lot-weeding-admin/requests`
  - `PATCH /api/lot-weeding-admin/request-row`
- Existing captain-facing lot-weeding reads still use:
  - `GET /api/lot-weeding/values`
- New normalization layer maps messy spreadsheet headers into stable request fields.
- New first-pass admin UI includes:
  - Stats tab cards
  - status filters
  - text search
  - request queue table
  - editable APN, status, scheduled date, homeowner notified, date cleaned, ROE status, UWS contract, last contact date, and notes/details
- Map-first admin foundation now includes:
  - a large Leaflet map as the dominant Lot Weeding Admin workspace
  - marker colors by canonical status
  - a selected-request side panel
  - Map-only status/search filtering across map and table
  - Missing APN follow-up queue for records without parcel lookup
  - read-only single/multi-selection across markers and table rows
  - selected-group summary with clear selection and zoom-to-selected controls
  - compact sortable request table for list review
- Tabbed operations console (shipped June 25, 2026):
  - `#lotWeedingAdminView` is now a four-tab console — **Map / Calendar / Follow-ups / Stats** — over one shared `lotWeedingAdminState`. Switching tabs preserves the selection set and calendar day filter. Map status/search controls are intentionally Map-only.
  - A persistent **active-context bar** shows selection count and calendar day filter, plus status/search chips only on Map where those controls apply.
  - **Map tab:** the existing map workspace, selection bar, compact sortable request table, and selected-lot/group side panel. When a calendar day filter is active, that day's lots are emphasized on the map and the rest are dimmed.
  - **Calendar tab (read-only):** a month calendar keyed on `Date Scheduled` with per-day lot counts, prev/next/today navigation, day selection, a per-day list of scheduled lots, and a **Copy day list** action with an **Include contact info** checkbox (unchecked = address-only; checked = address + homeowner name + phone/email). Day export is clipboard-only. Selecting a day sets the shared `dayFilter`, which drives the Map highlight and the context bar.
  - **Follow-ups tab (read-only):** three queues — **Missing APN**, **ROE outstanding** (active lots whose `roeStatus` ≠ `Returned`), and **Scheduled but not notified** (`Scheduled` AND `homeownerNotified` ≠ `Yes`) — each with inline contact info and an **Open & edit** button that focuses the lot in the Map-tab side editor. One-click mark-contacted/notified writes are deferred to the next pass.
  - **Stats tab:** large workload cards for Active Requests / In the pipeline, On-Deck / Schedule next, Scheduled / On calendar, Needs Attention / Blockers, Missing APN / Fix parcel, Cleaned / Done, and Total / Requests.
  - **Single side-panel editor:** per-row inline editing was retired. Editing happens in one place — the selected-lot side panel on the Map tab, one lot at a time. It has status quick-actions (**Mark Scheduled / Mark Cleaned / Needs Attention**, status-only single-row writes), the full editable field set, and real `<input type="date">` date pickers. Assigning a `Date Scheduled` auto-sets status to `Scheduled` (unless already past that). `Homeowner notified` is never set automatically.
  - **Batch scheduling writes:** when multiple lots are selected, the group side panel shows a "Schedule work day" action with a date picker, preview, and confirm button. It writes each selected row via the existing single-row PATCH endpoint, setting `Date Scheduled` and `Status = Scheduled`, then reports per-lot successes/failures. No notification field is changed.
  - no polygon selection or notification automation yet
- New focused tests live in `test/lot-weeding.test.js`.

---

## Important Architecture Decision

Lot Weeding Admin is modeled as a role-based specialty workflow, not as a fake Neighborhood Captain assignment.

That matters because a Lot Weeding Admin may not:

- belong to Altagether
- be a Neighborhood Captain
- have an assigned zone
- have a captain spreadsheet
- need the normal Map / Neighbors / Actions / Tools workflow

The access model now allows a user to have roles/capabilities even when `sheets: []`.

---

## Access Sheet Setup

Existing full admins do not need a new Access Sheet row. The `admin` role is treated as a superset and grants Lot Weeding Admin access.

For a specialty Lot Weeding Admin user, add an active Access Sheet row:

| Column | Value |
|---|---|
| `login_email` | Their Google login email |
| `sheet_url` | `role:lot_weeding_admin` |
| `role` | `lot_weeding_admin` |
| `active` | `TRUE` |

Other columns can be left blank unless useful for human notes.

The `role:lot_weeding_admin` value is a sentinel. The server recognizes it as a role grant and does not try to parse it as a Google Sheet URL.

---

## Environment Variables

The lot-weeding source sheet is selected in priority order.

Preferred source-of-truth variables:

```ini
LOT_WEEDING_SOURCE_SHEET_ID=
LOT_WEEDING_SOURCE_SHEET_URL=
LOT_WEEDING_SOURCE_SHEET_NAME=
LOT_WEEDING_SOURCE_RANGE=A1:ZZ5000
LOT_WEEDING_SOURCE_LABEL=original
```

Accepted aliases:

```ini
LOT_WEEDING_INTAKE_SHEET_ID=
LOT_WEEDING_INTAKE_SHEET_URL=
LOT_WEEDING_INTAKE_SHEET_NAME=
```

Existing mirror fallback:

```ini
LOT_WEEDING_SHEET_ID=
LOT_WEEDING_SHEET_URL=
LOT_WEEDING_SHEET_NAME=
```

If `LOT_WEEDING_SOURCE_*` or `LOT_WEEDING_INTAKE_*` is not set, the code falls back to the existing mirror variables. That means staging can smoke-test the new tab without changing source sheet configuration, but writes will target the mirror.

---

## Service Account Access

For read-only smoke testing, the service account needs Viewer access to whichever sheet is configured.

For real admin testing and edits, the service account needs Editor access to the configured lot-weeding source sheet.

This is especially important if switching from the mirror to the original partner-owned intake sheet.

---

## Mirror vs Original Sheet

The current deployment may still point at the central lot-weeding mirror via `LOT_WEEDING_SHEET_ID`.

That is acceptable for initial smoke testing:

- login works
- tab visibility works
- request rows render
- filters/search work
- zone/captain enrichment can be checked

But writing to the mirror is not the real workflow.

Risks of writing to the mirror:

- edits may not flow back to the partner-owned original sheet
- mirror refreshes may overwrite admin edits
- generated/formula/import columns may behave badly when edited
- captains may see temporary mirror edits that are not in the real source of truth

Recommended staging sequence:

1. Leave the live original intake sheet and production mirror alone.
2. Make a copy of the intake spreadsheet or duplicate the relevant tab.
3. Revise the copy/duplicate to the target schema below.
4. Share the copy with the service account as Editor.
5. Set `LOT_WEEDING_SOURCE_SHEET_ID` or `LOT_WEEDING_SOURCE_SHEET_URL` in staging.
6. Set `LOT_WEEDING_SOURCE_SHEET_NAME` if the intake data is not on the first/default tab.
7. Test controlled writes against the copied/revised source.
8. After staging validation, do a planned production cutover.

---

## Recognized Intake Columns

The backend accepts multiple header variants for messy sheets. The target revised fields are:

- `Request Submission Date Stamp`
- `Name of Homeowner`
- `Address of Property`
- `Phone Number of Homeowner`
- `Email of Homeowner`
- `Universal Waste Systems contract Y/N`
- `Last contact date`
- `Date Scheduled`
- `Homeowner notified of schedule`
- `Date Cleaned`
- `ROE Status`
- `Notes`
- `APN`
- `Status`

The backend also keeps compatibility aliases for the existing mirror-era fields, including:

- `Timestamp`
- `lot_weeding_requested_spring_2026`
- `lot_weeding_request_details_spring_2026`
- `lot_weeding_date_scheduled_spring_2026`
- `lot_weeding_status_spring_2026`

Writes are intentionally narrow. The admin save endpoint only updates recognized editable fields:

- `apn`
- `status`
- `scheduledDate`
- `homeownerNotified`
- `dateCleaned`
- `roeStatus`
- `universalWasteContract`
- `lastContactDate`
- `details`

If the source sheet does not have recognizable columns for those fields, that field will not be updated.

---

## Status Vocabulary

Canonical lot-weeding statuses:

- `Requested`: submitted but not prioritized yet
- `On-Deck`: not scheduled yet, but should be looked at next
- `Scheduled`: assigned to a date
- `Cleaned`: weeding completed
- `Needs Attention`: blocker or manual review needed
- `Cancelled`: no longer active

Operational grouping:

- Active: `Requested`, `On-Deck`, `Scheduled`, `Needs Attention`
- Terminal: `Cleaned`, `Cancelled`
- Needs-review: `Needs Attention`
- Completed-equivalent: `Cleaned`

Legacy compatibility:

- old `Completed` values normalize to `Cleaned`
- old `Flagged` values normalize to `Needs Attention`
- old `Open` values normalize to `Requested`

`ROE Status` is separate from request status. Current recognized ROE values are blank, `Requested`, and `Returned`. Legacy boolean/checkbox returned values are treated as `Returned`.

---

## Zone/Captain Context

The Lot Weeding Admin request API tries to enrich requests with zone and Neighborhood Captain context by APN.

Default context source:

```ini
GODMODE_MASTER_SHEET_ID=
GODMODE_MASTER_RANGE=
```

Optional lot-weeding-specific overrides:

```ini
LOT_WEEDING_CONTEXT_SHEET_ID=
LOT_WEEDING_CONTEXT_RANGE=
```

If this context sheet is missing or cannot be read, the Lot Weeding Admin tab should still load the intake rows. Zone and captain fields will simply be blank or show "No zone match yet".

The map foundation also looks for coordinate columns in both the normalized intake rows and the APN context sheet. Recognized coordinate headers include `Latitude` / `Lat` and `Longitude` / `Lng` / `Lon` / `Long`, with context aliases such as parcel or centroid latitude/longitude. Coordinates are returned as `latitude` and `longitude` on `/api/lot-weeding-admin/requests`; invalid, blank, or zero coordinates are treated as unmapped.

---

## Files Changed

Primary implementation files:

- `server.js`
- `index.html`
- `public/css/styles.css`
- `lot-weeding/routes.js`
- `test/lot-weeding.test.js`

The plan file in `.cursor/plans` was not edited as part of implementation.

---

## Current Limitations

This is a first-pass operational dashboard plus a read-only map foundation, not the full lot-weeding product. The current tab proves the access model, source-sheet configuration, schema normalization, controlled write path, and map-ready request triage. It should not be treated as the final UX.

Not built yet:

- polygon drawing / lasso selection
- geography-based scheduling workflow
- date/group assignment from selected map clusters
- clear split between request intake, scheduling, and completion work
- deployment/group object model beyond a text column
- automated owner notifications, intentionally deferred because contact consent, timing, message review, retries, and auditability are separate workflow decisions
- volunteer notification workflows
- audit log
- row conflict detection
- strong server-side identity verification beyond the dashboard's existing email-query model
- polished mobile workflow for heavy editing

The current UI is suitable for staging validation, data cleanup planning, and basic controlled spreadsheet edits. The next UI should be redesigned around geography and batch operations.

---

## Confirmed Console Design (June 25, 2026)

These decisions are settled with the product owner. Build to these unless told otherwise.

### What the user must be able to do

- See all lot-weeding requests on a map; filter by `Status` and the other existing filters/search.
- See and edit detailed information about each lot.
- Schedule lots — individually or as a group — and update their statuses/info.
- Optionally turn on Altagether Neighborhood Captain zones as a visual overlay.
- See a calendar of all scheduled lots; quickly copy the lots scheduled for a given day.
- Reason spatially and temporally, e.g.:
  - "I could add another 1–2 lots to July 15."
  - "There's one lot half a block away I should add to the July 1 group."
  - "Copy the list of lots scheduled for July 19 so I can email volunteers."
- See which lots have not returned an ROE.
- See which homeowners with scheduled lots have not been contacted yet, with contact info handy, and mark them contacted/notified afterward.

### Primary user actions

1. Schedule lots for cleaning (single or grouped).
2. Update details about individual lots.
3. Contact homeowners with outstanding ROE or not-yet-notified scheduled cleanings.

### Decisions locked in

- **Tabbed console.** Inside `#lotWeedingAdminView`, split into three tabs: **Map**, **Calendar**, **Follow-ups**. All tabs read from the same `lotWeedingAdminState` (same status filter, search, and selection set). Switching tabs must never silently drop filters or selection.
- **Shared "active context" bar (resolves the hidden-filter risk).** A persistent strip rendered above the tabs shows every cross-tab filter/selection currently in effect — active status filter, search text, selection count, and especially a **calendar day filter** (e.g. "Day: Jul 1 · Clear"). This is the agreed fix for the concern that a calendar-driven map highlight could be invisible/confusing on the Map tab. The Map tab may highlight/dim by the active day filter, but only while that context bar makes the filter obvious and one-click clearable.
- **Calendar ↔ Map link is allowed** because the active context bar keeps it visible. Selecting a day in Calendar sets a day filter in shared state; the Map tab reflects it (highlight the day's lots, de-emphasize others) and the context bar announces it.
- **Single editor, not inline rows.** Retire per-row inline editing. Editing happens in one place: the selected-lot side panel. One lot edited at a time. A table/grid view may return later, but is not needed now — power users can use the backing spreadsheet for bulk manual edits.
- **Status quick-actions.** On a selected lot/group, offer quick actions ("Mark Scheduled", "Mark Cleaned", "Needs Attention") rather than burying status in a `<select>`. The full dropdown lives only in the side-panel editor.
- **Assigning a date auto-sets `Scheduled`.** Whenever a `Date Scheduled` is assigned (single or batch), status moves to `Scheduled` automatically. `Homeowner notified of schedule` is still set separately and never automatically.
- **Date picker everywhere.** Any place the user picks a date (side-panel edit, batch scheduling, calendar interactions) uses a real calendar selector widget, not a free-text date field.
- **Day export with optional contact info.** When copying a day's scheduled lots, provide an "Include contact info" checkbox:
  - unchecked → clean address-only list (for the volunteer pulling weeds),
  - checked → address + homeowner name + phone/email (for the day's point person).
  Decide a stable plain-text format that pastes cleanly into email.
- **NC zones = overlay only.** Purely informational visual overlay reusing the existing zone-boundary source (Mapbox/KML). Off by default, toggle on the Map tab. Not a filter and not a grouping dimension for now.

### Build order (confirmed)

1. **Tab split + shared active-context bar** (foundation; do this first so later features have a home). — DONE (June 25, 2026).
2. **Calendar tab, read-only** (calendar of scheduled lots, day selection, day export with contact-info checkbox, calendar↔map day filter via the context bar). Lower risk, immediately useful. — DONE (June 25, 2026).
3. **Follow-up queues** ("ROE outstanding" and "Scheduled but not notified") with inline contact info and one-click mark-contacted/notified. — PARTIAL: read-only queues with inline contact + Open & edit shipped; one-click mark-contacted/notified writes still to do.
4. **Batch scheduling writes** (assign date → auto `Scheduled`, with preview/confirmation and partial-failure reporting). — DONE (June 25, 2026).
5. **NC zone overlay** on the Map tab.
6. **Polygon/lasso selection** can slot in around step 4 to feed group scheduling, still client-side first.

Single-lot writes (the side-panel editor and status quick-actions) and batch scheduling both use the existing `PATCH /api/lot-weeding-admin/request-row` endpoint. Batch scheduling intentionally iterates single-row writes so partial failures can be reported clearly without exposing a broader generic sheet-write API.

Notifications remain explicitly out of scope; see "Notification prep" and Design Principles.

---

## Next Phase: Map-First UX Direction

The Lot Weeding Admin tab should become a townwide operations console where the map is the dominant workspace, not a secondary visualization.

Core concept:

- left/primary area: large map of all lot-weeding requests
- side panel: selected request or selected group details
- top controls: status filters, search, date/group controls, refresh
- bottom/secondary area: compact queue/table for list review and bulk editing

The map should support these workflows:

1. **Triage requests geographically**
   - Display all requests with APNs/coordinates when available.
   - Color markers by `Status`.
   - Visually distinguish missing APN / unmatched context / needs-attention records.
   - Keep raw submitted address visible, but use APN/master context for joins.

2. **Find clusters for efficient volunteer deployment**
   - Let admins see nearby requested/on-deck lots.
   - Add polygon or lasso selection for grouping lots.
   - Show selected count, statuses, APN completeness, and zone/captain mix.

3. **Schedule selected groups**
   - Assign `Date Scheduled` to selected lots.
   - Set `Status` to `Scheduled`.
   - Set `Homeowner notified of schedule` separately, not automatically.

4. **Complete or flag work**
   - Mark selected/request lots as `Cleaned`.
   - Set `Date Cleaned`.
   - Move blockers to `Needs Attention`.
   - Preserve `Cancelled` as terminal but not completed.

5. **Keep list/calendar as support UI**
   - Use the queue/Follow-ups tab for search, exact review, contact follow-through, and records that cannot be mapped.
   - Per the June 25, 2026 decision, retire per-row inline editing; the side panel is the single editor. A table view may return later but is not required now.
   - Do not let any list remain the primary mental model once map + calendar selection exist.

### Suggested Layout

```text
┌─────────────────────────────────────────────────────────────┐
│ Lot Weeding Admin header + status/search/date controls       │
├─────────────────────────────────────┬───────────────────────┤
│                                     │ Selected request/group │
│              Map workspace          │ details + actions      │
│                                     │                       │
├─────────────────────────────────────┴───────────────────────┤
│ Compact request queue / unmapped records / recent changes    │
└─────────────────────────────────────────────────────────────┘
```

### Status Behavior In The Map UX

Canonical statuses remain:

- `Requested`: submitted but not prioritized yet
- `On-Deck`: should be looked at next
- `Scheduled`: assigned to a date
- `Cleaned`: work complete
- `Needs Attention`: blocker or manual review
- `Cancelled`: no longer active

Map defaults should probably show active requests first:

- default visible: `Requested`, `On-Deck`, `Scheduled`, `Needs Attention`
- optional visible: `Cleaned`, `Cancelled`
- prominent warning layer: missing APN, unmatched APN, missing schedule date when `Scheduled`

### Data Needed For Map Phase

The intake sheet currently has raw addresses and APNs. The map phase needs reliable coordinates.

Preferred approach:

1. Join intake APNs to the existing master/context dataset if it has coordinates.
2. If master coordinates are not available, add a backend enrichment step that returns map-ready coordinates from known APN/address context.
3. Avoid writing lat/lon into the intake sheet unless there is a strong operational reason.

Open implementation question:

- Should map geometry come only from APN/master context, or should unmapped records be geocoded from raw homeowner-entered address as a fallback? Raw address fallback is convenient but less reliable.

### Implementation Sequence For The Map Redesign

Steps 1–3 are DONE. The remaining order is superseded by "Build order (confirmed)" in the Confirmed Console Design section above; it is restated here for context.

1. **Read-only map foundation** — DONE.
   - Renders normalized lot-weeding requests on a dedicated map inside `#lotWeedingAdminView`.
   - Marker colors by status; side panel for clicked request details.

2. **Filtering and unmapped handling** — DONE.
   - Status filters affect map, queue, and unmapped list together.
   - Explicit "Unmapped / missing APN" queue; map legend and count summary.

3. **Selection model** — DONE.
   - Read-only marker/queue/unmapped multi-selection, clear selection, zoom to selected.

4. **Tab split + shared active-context bar** — DONE (June 25, 2026).
   - Map / Calendar / Follow-ups tabs over shared filter + selection state.
   - Persistent context bar showing active status filter, search, selection count, and calendar day filter, each clearable.

5. **Calendar tab (read-only)** — DONE (June 25, 2026).
   - Calendar of scheduled lots keyed on `Date Scheduled`; select a day; copy day list with an "Include contact info" checkbox; day selection drives an obvious, clearable map highlight via the context bar.

6. **Follow-up queues** — PARTIAL (June 25, 2026).
   - "ROE outstanding" (`roeStatus` ≠ Returned) and "Scheduled but not notified" (`Scheduled` AND `homeownerNotified` ≠ Yes), with inline contact info shipped read-only. Each row's "Open & edit" focuses the lot in the single side-panel editor. One-click mark-contacted/notified writes are the remaining piece.

7. **Batch scheduling writes** — DONE (June 25, 2026).
   - For selected requests, write `Date Scheduled` and auto `Status = Scheduled`.
   - Preview before write; report partial failures clearly.

8. **NC zone overlay** — informational only on the Map tab.

9. **Polygon/lasso selection** — client-side first; feeds group scheduling.

10. **Completion/attention workflows**
   - Batch set `Cleaned` + `Date Cleaned`; batch set `Needs Attention` with notes/reason.

11. **Notification prep**
   - Do not automate homeowner notifications until scheduling semantics, consent, message wording, and audit expectations are stable.
   - If ever added, first build a reviewable contact list/export or draft-message workflow rather than automatic sends.

### Design Principles

- Make geography the first-class object.
- Keep APN as the join key.
- Treat raw address as human-entered display/help text, not authoritative location data.
- Avoid hidden writes. Every batch operation should preview what will change.
- Keep notification automation out of the scheduling path for now; scheduling should update operational state only unless a human explicitly reviews communications.
- Preserve compatibility with captain-facing lot-weeding views during the production cutover.
- Keep the backend API narrow; do not expose generic sheet writes to this workflow.

---

## Next Work

Recommended next steps:

1. Make a copy/duplicate of the current intake sheet for staging.
2. Revise the copy to the target schema.
3. Share the copied sheet with the service account as Editor.
4. Validate role-only login using a non-admin test account with `role:lot_weeding_admin`.
5. Validate full-admin access to confirm admins see the normal admin experience plus the Lot Weeding Admin tab.
6. Confirm existing captain-facing lot-weeding surfaces still behave when the source switches from mirror-style fields to revised fields.
7. Use the revised status vocabulary: `Requested`, `On-Deck`, `Scheduled`, `Cleaned`, `Needs Attention`, `Cancelled`.
8. Validate the read-only map foundation with staging request data that includes APN-matched coordinates.
9. Build the tabbed console (Map / Calendar / Follow-ups / Stats) with the shared active-context bar first.
10. Then build Follow-up write actions, then the NC zone overlay.
11. Treat notifications as a later optional workflow, not part of the near-term scheduling build.

---

## Verification Run During Implementation

The following checks passed after the first architecture pass:

```powershell
node --check "server.js"
node --check "lot-weeding/routes.js"
node --test "test/lot-weeding.test.js"
node --test "test/godmode.test.js"
```

IDE lints on touched files reported no errors at implementation time.

The following checks passed after the read-only map foundation pass:

```powershell
node --check "server.js"
node --check "lot-weeding/routes.js"
node --test "test/lot-weeding.test.js"
node --test "test/godmode.test.js"
node -e "const fs=require('fs'); const vm=require('vm'); const html=fs.readFileSync('index.html','utf8'); const scripts=[...html.matchAll(/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/gi)].map((m)=>m[1]); scripts.forEach((script,index)=>new vm.Script(script,{filename:'index.html#inline-script-'+index})); console.log('checked '+scripts.length+' inline scripts');"
```

IDE lints on touched files reported no errors after the map foundation pass.

The following checks passed after the tabbed-console + Calendar pass (June 25, 2026):

```powershell
node --check "server.js"
node --check "lot-weeding/routes.js"
node --test "test/lot-weeding.test.js"
node --test "test/godmode.test.js"
node -e "const fs=require('fs'); const vm=require('vm'); const html=fs.readFileSync('index.html','utf8'); const scripts=[...html.matchAll(/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/gi)].map((m)=>m[1]); scripts.forEach((script,index)=>new vm.Script(script,{filename:'index.html#inline-script-'+index})); console.log('checked '+scripts.length+' inline scripts');"
```

IDE lints on `index.html` and `public/css/styles.css` reported no errors after this pass. Note: on PowerShell, run each `node` command on its own line (use `;`), not chained with `&&`.

### Implementation notes for this pass

- New shared state on `lotWeedingAdminState`: `activeTab` (`map` | `calendar` | `followups`), `dayFilter` (`YYYY-MM-DD` or null), `calendarMonth` (`{year, month}`), `includeContactInfo` (bool).
- Dates: the intake sheet stores dates as free text. `parseLotWeedingDate` / `toLotWeedingDateKey` normalize many formats (M/D/YYYY, YYYY-MM-DD, `Mon DD, YYYY`) to a `YYYY-MM-DD` key for grouping and the date pickers. Writes go back as US `M/D/YYYY` via `formatLotWeedingDateForSheet`. If a date field already held an **unparseable** value (e.g. "TBD"), the editor preserves it rather than wiping it when the picker is empty (see `data-lot-weeding-date-original`).
- The Calendar and Follow-up "Open & edit" actions call `selectLotWeedingAdminLot`, which focuses exactly one lot (clears multi-select) and switches to the Map tab so the single editor shows.
- The Calendar derives from the same status+search-filtered set as the Map, so an active status filter that hides scheduled lots will empty the calendar — but the context bar always announces that filter, so it is never a hidden filter. Follow-up queues use their own status semantics intersected with the shared search only.
- **Map interaction model (fixed):** clicking a map marker (or "Inspect / Open & edit") calls `focusLotWeedingAdminLot`, which selects exactly one lot (replaces any prior selection) and opens it in the single editor — it does NOT accumulate a group. Building a multi-lot group is done deliberately via the "Select" buttons in the queue/unmapped lists (`data-lot-weeding-toggle`).
- **No map rebuild on selection (fixed):** selection changes on the Map tab now update in place via `refreshLotWeedingAdminMapSelection` (re-styles existing markers, swaps the side panel / selection bar / context bar, toggles row highlight classes) instead of re-running the whole view. The Leaflet map is only created/destroyed on data load, tab switch, filter/search change, or day selection — not on clicks — which removes the previous "zoom out then back in" flash. The map is also created directly at the saved center/zoom (`lastMapView`) so even legitimate rebuilds don't flash through the default view. Handler binding is factored into `attachLotWeedingAdminContextHandlers`, `attachLotWeedingAdminSelectionBarHandlers`, and `attachLotWeedingAdminSidePanelHandlers(root)` so the in-place refresh can re-bind only the swapped subtrees without double-binding the rest.

---

## Handoff Prompt For Next Agent

Paste the block below to start the next agent. It assumes the tabbed console (Map / Calendar / Follow-ups / Stats), the active-context bar, the read-only Calendar with day export, the single side-panel editor with status quick-actions and date pickers, read-only Follow-up queues, command-center UI cleanup, sortable request table, Stats tab, and batch scheduling writes are already implemented.

```text
Continue the Lot Weeding Admin work. Start by reading LOT_WEEDING_ADMIN_HANDOFF.md (especially "What We Built" → tabbed console, "Confirmed Console Design (June 25, 2026)", and "Implementation notes for this pass") and CODEBASE_FIELD_GUIDE.md.

Context: #lotWeedingAdminView is now a four-tab Lot Weeding Command Center (Map / Calendar / Follow-ups / Stats) over one shared lotWeedingAdminState. The Map tab has its own status filters/search; Calendar, Follow-ups, and Stats are not silently filtered by Map controls. There is a persistent active-context bar (selection count and calendar day filter; Map status/search chips only show on Map). The Calendar tab is read-only (month grid keyed on Date Scheduled, day selection drives a shared dayFilter that highlights the Map, plus "Copy day list" with an "Include contact info" checkbox, clipboard-only). Per-row inline editing was retired; the selected-lot side panel on the Map tab is the single editor (one lot at a time) with status quick-actions (Mark Scheduled / Mark Cleaned / Needs Attention), the full field set, and real date pickers. Assigning a Date Scheduled auto-sets Status = Scheduled. Follow-ups has three read-only queues (Missing APN; ROE outstanding; Scheduled-but-not-notified) with Missing APN stacked above Scheduled-but-not-notified and ROE alongside them. The Map request queue is a compact sortable table. Stats live only in the Stats tab. Multi-selected groups have a "Schedule work day" panel with date picker, preview, confirm button, sequential PATCH writes, and per-lot success/failure reporting. Single-lot writes and batch scheduling use PATCH /api/lot-weeding-admin/request-row. Canonical statuses: Requested, On-Deck, Scheduled, Cleaned, Needs Attention, Cancelled.

Goal for this pass (in order):
1. Follow-up write actions: add one-click "Mark notified" (sets Homeowner notified = Yes) and "Mark ROE returned" (sets ROE Status = Returned) directly on the Follow-ups rows, using the existing single-row PATCH. Optimistic UI + clear error handling.
2. NC zone overlay on the Map tab (informational only, off by default), then polygon/lasso selection feeding the existing batch scheduling flow.

Do:
- Reuse saveLotWeedingAdminRow / patchLotWeedingAdminRow for single follow-up writes.
- Do not re-add `Deployment Group` or a separate needs-attention reason/`flagReason` unless the product owner explicitly adds those columns to the source sheet. The generic Notes field is the intended place for blocker context right now.
- Keep everything driven by shared lotWeedingAdminState and reflected in the active-context bar.
- Keep the existing role/access/source-sheet architecture, the normalized /api/lot-weeding-admin/requests payload, canonical statuses, captain-facing lot-weeding compatibility, and mirror-schema fallbacks intact.
- Update LOT_WEEDING_ADMIN_HANDOFF.md with any decisions/changes.
- Run focused syntax/tests/lints afterward (node --check on server.js and lot-weeding/routes.js; node --test test/lot-weeding.test.js; node --test test/godmode.test.js; the inline-script syntax check used previously; ReadLints on touched files). On PowerShell, run each node command on its own line, not chained with &&.

Do not:
- Do NOT implement any homeowner/volunteer notification automation. Marking "notified" only records operational state; it must never send a message.
- Do NOT change the Access Sheet model or switch production source env vars.
- Do NOT remove old mirror-schema compatibility.

Design intent to honor:
- Assigning a Date Scheduled must auto-set Status = Scheduled; "Homeowner notified of schedule" is always set separately, never automatically.
- Avoid hidden writes — every batch operation must preview what will change before committing.
- NC zones, when added later, are an informational overlay only (reuse the existing Mapbox/KML zone-boundary source), off by default, not a filter.
- Map stays the dominant spatial workspace; do not regress to a spreadsheet-first layout.

After this pass, the following are queued (in order): polygon/lasso selection feeding group scheduling, then batch completion/attention workflows. Notifications remain explicitly out of scope.
```

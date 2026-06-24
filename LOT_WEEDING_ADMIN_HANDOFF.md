# Lot Weeding Admin Handoff

**Status:** first architecture pass implemented and staging tests passed. Next phase is a map-first UX/functionality redesign of the Lot Weeding Admin tab.

**Latest pass:** read-only map foundation implemented for the Lot Weeding Admin tab. Polygon/lasso selection and batch scheduling writes are still intentionally not built.

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
  - summary stat cards
  - status filters
  - text search
  - request queue table
  - editable APN, status, scheduled date, homeowner notified, date cleaned, ROE status, UWS contract, last contact date, deployment group, notes/details, and attention reason
- Map-first admin foundation now includes:
  - a large Leaflet map as the dominant Lot Weeding Admin workspace
  - marker colors by canonical status
  - a selected-request side panel
  - shared status/search filtering across map, unmapped queue, and table
  - an unmapped/missing APN queue for records without usable coordinates
  - read-only marker selection only; no polygon selection or batch writes yet
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
- `deploymentGroup`
- `details`
- `flagReason`

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
- map-based batch selection
- geography-based scheduling workflow
- date/group assignment from selected map clusters
- clear split between request intake, scheduling, and completion work
- deployment/group object model beyond a text column
- automated owner notifications
- volunteer notification workflows
- audit log
- row conflict detection
- strong server-side identity verification beyond the dashboard's existing email-query model
- polished mobile workflow for heavy editing

The current UI is suitable for staging validation, data cleanup planning, and basic controlled spreadsheet edits. The next UI should be redesigned around geography and batch operations.

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
   - Optionally assign/update `Deployment Group`.
   - Set `Status` to `Scheduled`.
   - Set `Homeowner notified of schedule` separately, not automatically.

4. **Complete or flag work**
   - Mark selected/request lots as `Cleaned`.
   - Set `Date Cleaned`.
   - Move blockers to `Needs Attention`.
   - Preserve `Cancelled` as terminal but not completed.

5. **Keep table/list as support UI**
   - Use the table for search, exact edits, and records that cannot be mapped.
   - Do not let the table remain the primary mental model once map selection exists.

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

Recommended order:

1. **Read-only map foundation**
   - Render all normalized lot-weeding requests on a dedicated map inside `#lotWeedingAdminView`.
   - Use marker colors by status.
   - Add side panel for clicked request details.
   - Keep table below as fallback.

2. **Filtering and unmapped handling**
   - Add status filters that affect both map and table.
   - Add explicit "Unmapped / missing APN" queue.
   - Add map legend and count summary.

3. **Selection model**
   - Support click-to-select multiple requests.
   - Add clear selected list/count.
   - Add "clear selection" and "zoom to selected".

4. **Polygon/lasso selection**
   - Add draw polygon tool.
   - Select all request markers inside polygon.
   - Keep this client-side first; do not write groups yet.

5. **Batch scheduling writes**
   - For selected requests, write `Date Scheduled`, optional `Deployment Group`, and `Status = Scheduled`.
   - Confirm before batch write.
   - Report partial failures clearly.

6. **Completion/attention workflows**
   - Batch set `Cleaned` + `Date Cleaned`.
   - Batch set `Needs Attention` with notes/reason.

7. **Notification prep**
   - Do not automate notifications until scheduling semantics are stable.
   - First add a review state or generated contact list for scheduled lots.

### Design Principles

- Make geography the first-class object.
- Keep APN as the join key.
- Treat raw address as human-entered display/help text, not authoritative location data.
- Avoid hidden writes. Every batch operation should preview what will change.
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
9. Add polygon/lasso selection and scheduling workflows only after the read-only map and unmapped-record handling are stable.
10. Add notifications only after scheduled-date/status semantics are settled.

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

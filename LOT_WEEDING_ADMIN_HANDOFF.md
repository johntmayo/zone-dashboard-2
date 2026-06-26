# Lot Weeding Admin Handoff

**Status:** Lot Weeding Command Center is feature-complete for the confirmed console design (June 2026). Staging validation has been run against a copied intake sheet with revised column names and Editor access for the service account. Remaining work is operator-driven UX polish, optional test coverage, and production cutover when ready — not new core features.

**Latest pass (June 26, 2026):** batch completion and batch attention workflows for multi-select groups. **Previous passes:** map-native NC zone overlay, drawn-area selection, Follow-up one-click writes, batch scheduling, tabbed console (Map / Calendar / Follow-ups / Stats), local post-save refresh.

This document captures what was built, how it is configured, what was validated in staging, and what still needs attention before calling the workflow production-ready.

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
- **No redundant competing controls** — e.g. status quick-action buttons that duplicate the form below and behave differently from batch actions create confusion and erode trust; prefer one clear edit/save pattern unless a shortcut is genuinely faster and consistent.
- **Visible state** — active filters, selection count, and calendar day filter must never be hidden; the context bar exists for this reason.
- **Preview before writes** — batch operations show what will change; partial failures are reported per lot.
- **Labels match behavior** — “Select” on the map means “close drawn polygon and select lots inside,” not generic multi-select; naming and affordances must match.
- **Polish is first-class work** — copy, layout density, disabled/hidden states, and operator testing feedback should be treated as priorities alongside new features.

**Known UX pain points (operator feedback, June 2026):**

- Map **Select** feels like it does nothing unless you already know the Draw → polygon → Select workflow; the status area below the buttons looks like an empty broken slot.
- Single-lot **Mark Scheduled / Mark Cleaned / Needs Attention** buttons at the top of the lot card overlap the Status dropdown and Save flow; Mark Cleaned there does not set Date Cleaned (unlike batch Mark cleaned), which is inconsistent and misleading.
- Multi-select side panel stacks three batch blocks — functional but dense.

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

`#lotWeedingAdminView` is a four-tab console — **Map / Calendar / Follow-ups / Stats** — over one shared `lotWeedingAdminState`. Switching tabs preserves selection and calendar day filter.

- **Active context bar** — selection count, calendar day filter, and (on Map) status/search chips; each clearable.
- **Map tab** — status filters, search, Leaflet map (marker colors by status), sortable request queue, single-lot or multi-select side panel. Calendar day filter dims non-matching lots on the map.
- **Map controls** — **Zones** (NC overlay, informational only), **Draw** (click polygon points), **Select** (close shape and select mapped lots inside), **Clear** (clear drawn area).
- **Calendar tab (read-only)** — month grid on `Date Scheduled`, day selection → shared `dayFilter`, **Copy day list** with optional contact info (clipboard only).
- **Follow-ups tab** — **Missing APN**, **Scheduled but not notified**, **ROE outstanding** queues with inline contact info, **Open & edit**, and one-click **Mark notified** (`Homeowner notified = Yes`) / **Mark ROE returned** (`ROE Status = Returned`).
- **Stats tab** — workload cards (Active, On-Deck, Scheduled, Needs Attention, Missing APN, Cleaned, Total).
- **Single side-panel editor** — one lot at a time on the Map tab; full field set with date pickers; **Save lot**. Assigning `Date Scheduled` auto-sets `Status = Scheduled`. `Homeowner notified of schedule` is edited manually only — never auto-set by scheduling or batch actions.
- **Batch group actions** (multi-select side panel) — all use sequential `PATCH /api/lot-weeding-admin/request-row` with preview, confirm, and per-lot partial-failure reporting:
  - Schedule work day → `Date Scheduled` + `Status = Scheduled`
  - Mark selected Cleaned → `Status = Cleaned` + `Date Cleaned`
  - Mark selected Needs Attention → `Status = Needs Attention`; optional note appended to Request notes (`details`)

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
- `Last contact date`
- `Date Scheduled`
- `Homeowner notified of schedule`
- `Date Cleaned`
- `ROE Status`
- `Notes`
- `APN`
- `Status`

Mirror-era aliases remain supported (`Timestamp`, `lot_weeding_*_spring_2026`, etc.).

Editable PATCH fields: `apn`, `status`, `scheduledDate`, `homeownerNotified`, `dateCleaned`, `roeStatus`, `universalWasteContract`, `lastContactDate`, `details`.

---

## Status Vocabulary

- `Requested` — submitted, not prioritized
- `On-Deck` — look at next
- `Scheduled` — assigned to a date
- `Cleaned` — weeding completed
- `Needs Attention` — blocker / manual review
- `Cancelled` — no longer active

Legacy: `Completed` → `Cleaned`, `Flagged` → `Needs Attention`, `Open` → `Requested`.

`ROE Status` is separate: blank, `Requested`, `Returned` (legacy booleans → `Returned`).

---

## Zone/Captain Context

Enrichment by APN from `GODMODE_MASTER_SHEET_ID` / `GODMODE_MASTER_RANGE`, or overrides:

```ini
LOT_WEEDING_CONTEXT_SHEET_ID=
LOT_WEEDING_CONTEXT_RANGE=
```

Coordinates come from intake or context sheet (`Latitude`/`Lat`, `Longitude`/`Lng`/etc.). Missing context → blank zone/captain; unmapped lots still appear in queues.

---

## Files Changed

- `server.js`
- `index.html`
- `public/css/styles.css`
- `lot-weeding/routes.js`
- `test/lot-weeding.test.js`

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

- **Tabbed console:** Map / Calendar / Follow-ups / Stats (+ Stats as fourth tab); shared state across tabs.
- **Single editor** on Map tab; no per-row inline editing in the queue.
- **Assigning `Date Scheduled` auto-sets `Scheduled`**; **`Homeowner notified of schedule` is always manual** (side panel, Follow-ups Mark notified, or spreadsheet — never set by schedule/clean/attention batch writes).
- **Date pickers** for all date fields in the UI.
- **Day export** — address-only or with contact info; clipboard only.
- **NC zones** — overlay only, off by default, not a filter.
- **Batch writes** — preview before commit; partial-failure reporting per lot.

Single-lot and batch writes use `PATCH /api/lot-weeding-admin/request-row` (batch iterates single-row PATCHs intentionally).

---

## Current Limitations

The command center is operational but **UX polish is still needed** based on operator testing. Known rough edges:

- Map **Select** is the second step of Draw → polygon → Select; labeling and empty status slot are confusing if you expect a standalone multi-select control.
- Single-lot **status quick-actions** (Mark Scheduled / Mark Cleaned / Needs Attention) overlap the form below and only write status (not dates) — redundant with the Status dropdown + Save lot.
- Multi-select side panel stacks three batch blocks — workable but dense.
- No dedicated map warning layer for edge cases (e.g. Scheduled without date).
- No address geocode fallback for unmapped lots (coordinates from APN/context join only).
- No batch PATCH endpoint (sequential writes only).
- No audit log or row conflict detection.
- No polished mobile workflow for heavy editing.
- Write-flow automated tests are thin (normalization only in `test/lot-weeding.test.js`).

Not planned: persistent named Groups / deployment-group object model; generic sheet-write API beyond the narrow PATCH path.

---

## Next Work

1. **UX polish** from real operator use — map Draw/Select/Clear flow, lot card quick-actions vs form, batch panel density, copy/help text.
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

- Tabs: `activeTab` (`map` | `calendar` | `followups` | `stats`)
- Filters: `filter`, `query`, `dayFilter`, `calendarMonth`, `includeContactInfo`
- Selection: `selectedRowNumbers`, `selectedRowNumber`
- Batch: `batchSchedule*`, `batchClean*`, `batchAttention*`
- Map: `map`, `markers`, zone overlay, draw polygon (`drawEnabled`, `drawLatLngs`, etc.)

### Dates

Intake stores free-text dates. `parseLotWeedingDate` / `toLotWeedingDateKey` normalize for grouping and pickers; writes use `formatLotWeedingDateForSheet` (`M/D/YYYY`). Unparseable sheet values (e.g. "TBD") are preserved when the picker is empty (`data-lot-weeding-date-original`).

### Map interaction

- **Marker click** → `focusLotWeedingAdminLot` (single lot, replaces selection).
- **Multi-select** → queue/unmapped **Select** buttons or Draw → polygon → **Select**.
- **Selection changes** on Map tab update in place via `refreshLotWeedingAdminMapSelection` (no full map rebuild on click).

### Batch completion / attention (June 26, 2026)

- Batch clean: requires Date Cleaned; writes `status` + `dateCleaned` only.
- Batch attention: writes `status: Needs Attention`; optional note appended to `details`.
- Clearing selection resets batch message/result state.

---

## Handoff Prompt For Next Agent

```text
Continue the Lot Weeding Admin work. Read LOT_WEEDING_ADMIN_HANDOFF.md and CODEBASE_FIELD_GUIDE.md.

Context: Lot Weeding Command Center is feature-complete — Map / Calendar / Follow-ups / Stats over shared lotWeedingAdminState. Staging validation completed on a copied intake sheet with revised columns and service-account Editor access. Batch schedule/clean/attention, Follow-up Mark notified / Mark ROE returned, NC zone overlay, and draw-to-select are implemented. Homeowner notified is manual only; never auto-set by scheduling or batch writes.

Goal: UX polish from operator feedback (priority — see "UX Expectations" section), write-flow tests, optional batch PATCH endpoint, production cutover planning when asked.

Read "Purpose" and "UX Expectations" before changing UI — clarity and one-obvious-path-per-task matter as much as new capability.

Do not: invent new sheet columns; remove mirror-schema compatibility; change Access Sheet model or production env vars without explicit request.

Run verification commands in the handoff after code changes.
```

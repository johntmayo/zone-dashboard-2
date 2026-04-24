# EPIC-LA Data Integration Plan (Dashboard-Only Enrichment)

**Created:** April 21, 2026  
**Status:** Backend/data plumbing live in production (April 23, 2026); Address Details modal UI integration in progress.  
**Scope:** Add EPIC-LA permitting/rebuild data to the dashboard details panel without expanding the captain/master spreadsheets.

---

## 0) Implementation Status (April 23, 2026)

What is complete:

- [x] Backend EPIC modules shipped (`epic/config.js`, `epic/arcgis.js`, `epic/normalize.js`, `epic/cache.js`, `epic/sync.js`, `epic/lookup.js`, `epic/routes.js`)
- [x] Endpoints live in production:
  - `GET /api/epic/by-apn`
  - `POST /api/epic/by-apns`
  - `GET /api/epic/sync-status`
  - `POST /api/admin/sync-epic`
- [x] Production sync env vars configured in Vercel (`EPIC_FEATURE_SERVICE_URL`, `EPIC_CACHE_SHEET_ID`, `EPIC_SYNC_TOKEN`)
- [x] First production sync completed successfully (`rows_fetched: 5647`, `inserted: 5147`, `updated: 500`)
- [x] GitHub Actions daily scheduler added and manually validated (`.github/workflows/epic-sync.yml`)
- [x] APN lookup path verified against production cache
- [x] Address Details modal now shows EPIC records, APN editing support, and move-pin tooling
- [x] Address-level UI now uses modal accordion sections for parcel, address data, EPIC records, and tools

What is not complete:

- [ ] Build-status suggestion box is intentionally hidden in UI pending field validation with captains

---

## 1) Goal in One Sentence

Surface daily-refreshed EPIC-LA Fire Recovery case data (matched by APN) inside the address details panel so captains can see permitting progress at a glance, while keeping EPIC as a separate data source from their operational sheets.

---

## 2) Product Decisions Already Settled

1. **Not live-live.** Daily refresh is sufficient.
2. **No spreadsheet bloat.** EPIC data should not be written into captain sheets or the core master sheet.
3. **Dashboard-only augmentation.** EPIC appears in UI as an additional panel section.
4. **Join key:** APN (`MAIN_AIN` from EPIC to `APN` in dashboard data after normalization).
5. **Captain language first.** County labels can be shown, but internal 5-stage model should be present and clear.
6. **Captain stage is authoritative.** EPIC-derived stage is advisory/suggested only, never auto-overwriting captain-entered stage.

---

## 3) Recommended Architecture

## 3.1 High-level flow

1. A scheduled daily sync pulls EPIC-LA rows for Altadena (`DISASTER_TYPE='Eaton Fire (01-2025)'`, `SUP_DIST='5'`).
2. Data is normalized and cached in a separate EPIC data store.
3. Dashboard reads captain sheet data as it does today.
4. When an address is selected, dashboard requests EPIC cases for that APN from a backend endpoint.
5. UI displays all matching cases, split into rebuild vs temporary housing, plus a computed headline stage.

## 3.2 Data store choice (v1)

Use a **separate Google Sheet as EPIC cache** for v1 because:
- It matches the existing operating model.
- It is easy to inspect/debug manually.
- It avoids adding a database right now.

Keep open the option to migrate the EPIC cache to SQLite/Postgres later if scale or query complexity grows.

---

## 4) EPIC Cache Schema (v1)

Create a dedicated sheet (example tab name: `epic_cases`) with one row per EPIC case (upsert key: `casenumber`).

Suggested columns:

- `casenumber` (primary key)
- `main_ain_raw`
- `main_ain_norm` (digits only)
- `main_address`
- `workclass_name`
- `status`
- `rebuild_progress`
- `rebuild_progress_num`
- `apply_date_iso`
- `issuance_date_iso`
- `last_inspection_date_iso`
- `permit_valuation`
- `struct_type_disp`
- `new_dwelling_units`
- `description`
- `css_link`
- `disaster_type`
- `sup_dist`
- `is_temporary_housing` (boolean)
- `suggested_stage_num` (derived, advisory)
- `suggested_stage_label` (derived, advisory)
- `suggestion_confidence` (`high` | `medium` | `low`)
- `suggestion_reason` (short text for explainability)
- `sync_run_at` (timestamp)
- `source_last_edit_date` (layer-level metadata value at pull time)

Optional second tab:
- `epic_sync_meta` for run status, row counts, duration, errors.

---

## 5) Stage Suggestion Strategy (Advisory Only)

Map county values into the internal model as a suggestion signal while preserving county text.

### Proposed suggestion mapping (default)

- `Rebuild Applications Received` -> Stage 2 (early)
- `Zoning Reviews Cleared` -> Stage 2
- `Full Building Plans Received` -> Stage 2
- `Building Plans Approved` -> Stage 2
- `Building Permits Issued` -> Stage 2/3 boundary (default suggestion Stage 2 unless local policy says Stage 3)
- `Rebuild In Construction` -> Stage 3
- `Construction Completed` -> Stage 4 candidate (never auto-suggest Stage 5)
- `Temporary Housing - ...` -> Parallel track (not merged into stage headline unless explicitly desired)

### Important guardrails

- Stage 1 remains captain knowledge (county cannot infer it).
- Stage 4 and Stage 5 remain captain-confirmed reality.
- **Do not auto-write suggested stage into captain stage field.**
- UI should show both:
  - county status/progress text
  - EPIC suggested stage + confidence + rationale

### Confidence model (v1)

- **High:** clear rebuild signal (e.g., `Rebuild In Construction`, approved plans path)
- **Medium:** boundary/ambiguous transitions (e.g., `Building Permits Issued`)
- **Low:** conflicting multi-case signals, temporary-only signals, or sparse records

### Current product decision (April 2026)

The backend still computes and stores `suggested_stage_*` fields, but the
frontend suggestion box is currently hidden. Reason: the heuristic is useful
as telemetry but not yet trusted enough for captain-facing guidance without
additional validation on real addresses.

---

## 6) Performance Plan (Captain Experience)

Captain zones are small (typically 10-150 addresses), so performance is controlled by **query strategy**, not total EPIC dataset size.

### Do this

- Query EPIC by APN on demand (or small batch prefetch for visible addresses).
- Return only matching rows for selected APN(s), not full cache.
- Normalize APN once at sync time and once at request input.
- Keep response payload focused to fields needed by UI.
- Cache in browser memory for the session to avoid repeat fetches.

### Avoid this

- Loading the full EPIC dataset into the browser per login.
- Doing global client-side joins across all EPIC rows.

---

## 7) Backend Endpoints (Implemented)

Implemented endpoints:

1. `GET /api/epic/by-apn?apn=<value>`
   - Returns rebuild cases, temporary housing cases, and advisory suggestion fields for one APN.

2. `POST /api/epic/by-apns`
   - Input: `{ apns: ["...","..."] }`
   - Returns a keyed object by normalized APN (useful for prefetch and table badges).

Current response shape includes:
- `cases_rebuild`
- `cases_temp_housing`
- `suggested_stage`
- `suggestion_confidence`
- `suggestion_reason`
- `last_synced_at`

---

## 8) Frontend UX Integration (Address Details Panel)

Inside the existing details panel, add an `EPIC-LA` section:

1. **Suggestion row (advisory)**
   - EPIC suggested stage (not authoritative)
   - confidence + rationale
   - Last refreshed timestamp
   - Optional `Apply suggestion` action (manual, never automatic)

2. **Rebuild cases**
   - Case number (linked via `CSSLink`)
   - Work class
   - County status
   - County rebuild progress + internal mapped stage
   - Apply / issue / last inspection dates
   - Valuation
   - Structure type
   - Description

3. **Temporary housing (separate subsection)**
   - Same formatting, separate visual grouping

4. **Empty state**
   - "No county cases found for this APN yet"
   - Clarify that Stage 1 and move-in status rely on captain outreach

### Existing person quick-tag mapping note

The person quick-tag checkbox labeled **Subscribe to updates** maps to the
boolean sheet column `Wants_Updates` (legacy variants like `wants updates`
and `wants-updates` are treated equivalently by the UI matcher).

---

## 9) Sync Cadence and Operations

## 9.1 Cadence

- Daily scheduled sync (recommended early morning, before captain activity).
- Optional manual "Run sync now" admin action.

## 9.2 Sync method

- Pull filtered EPIC rows using ArcGIS pagination (`resultOffset`, `resultRecordCount`, stable order by).
- Upsert by `casenumber`.
- Mark rows not seen in current run as stale/inactive if needed.

## 9.3 Monitoring basics

Track per run:
- start/end time
- row count pulled
- row count upserted
- error summary
- source metadata timestamps

Display last successful run timestamp in UI/API.

---

## 10) Risks and Edge Cases

1. **One APN, many cases** - expected; show all, not just latest.
2. **Multi-APN property reality** - initial match may miss linked secondary parcels.
3. **APN formatting drift** - normalize aggressively (digits only).
4. **Case duplication nuances** - use `casenumber` as key; retain source fields for troubleshooting.
5. **Source outages** - keep last successful cache available; show staleness warning only when needed.

---

## 11) Phased Rollout Plan

## Phase 1 - Foundation (fastest path) [COMPLETE]

- Create EPIC cache sheet and sync script.
- Add backend endpoints for APN lookup and sync status.
- Add manual sync trigger with token auth support.
- Ship daily refresh automation via GitHub Actions.
- Validate production sync + lookup behavior.

## Phase 2 - Better captain signal [NEXT]

- Add grouped case cards and temporary-housing split.
- Improve suggestion logic and tie-break rules.
- Add lightweight APN-miss diagnostics.

## Phase 3 - Data quality and advanced logic

- Add multi-APN handling strategy (junction/override).
- Add explicit "apply suggestion" audit trail (`stage_set_by`, `stage_last_changed_at`).
- Evaluate migration from EPIC cache sheet to database if needed.

---

## 12) Acceptance Criteria (v1)

1. Captain opens address details and sees an EPIC section within 1-2 seconds on normal connection.
2. Cases shown are APN-matched and include county link + status + dates.
3. Temporary housing is separated from rebuild cases.
4. EPIC suggestion row is visible with confidence and does not auto-overwrite captain stage.
5. Captain/master spreadsheets remain unchanged by EPIC sync.
6. "Last refreshed" timestamp is visible and accurate.

---

## 13) Out of Scope for v1

- Full cross-zone analytics over EPIC data
- Automated Stage 4/5 resident move-in confirmation
- Complete parcel topology reconciliation for all multi-APN properties
- Public-facing EPIC dashboards

---

## 14) Implementation Note for This Repo

Given the current architecture (Express backend + large frontend script + Google Sheets operational model), this plan is intentionally designed to:

- minimize invasive refactors,
- avoid loading large county payloads client-side,
- and preserve current captain sheet workflows.

That keeps risk low while adding high demo value and day-to-day utility for recovery work.

---

## 15) Agent Handoff Prompt: Plumbing-Only (No UI Yet)

Copy/paste prompt:

Implement **EPIC-LA plumbing only** from `EPIC_DATA_INTEGRATION_PLAN.md`.  
Do **not** build or modify the UI display yet.

### Goal
Set up all backend/data pipeline infrastructure for EPIC-LA integration so frontend UI can be designed later with confidence.

### Scope (in)
1. **Data ingestion + cache**
   - Build a sync job that pulls EPIC-LA rows filtered to:
     - `DISASTER_TYPE='Eaton Fire (01-2025)'`
     - `SUP_DIST='5'`
   - Implement pagination and stable ordering.
   - Normalize APN to `digits-only`.
   - Upsert records by `casenumber`.
   - Store in separate EPIC cache source (v1 can be a dedicated Google Sheet cache).

2. **Derived fields**
   - Compute and store:
     - temporary-housing flag
     - advisory suggestion fields (stage/confidence/reason)
     - sync timestamp metadata

3. **API endpoints (no UI usage yet)**
   - Add:
     - `GET /api/epic/by-apn?apn=...`
     - `POST /api/epic/by-apns`
   - Return normalized, structured payload suitable for future UI.

4. **Operational controls**
   - Add a manual sync trigger endpoint (admin-safe) OR script command.
   - Add basic sync status endpoint (last successful run, row counts, error summary).

5. **Resilience + observability**
   - Handle source failures without destroying last good cache.
   - Add clear logs and run metadata.
   - Keep backward compatibility with existing dashboard behavior.

6. **Documentation**
   - Update/add docs covering:
     - env vars
     - sync schedule setup
     - cache schema
     - endpoint contracts
     - manual runbook

### Scope (out)
- No address panel or other UI rendering
- No visual components
- No feature flags in UI needed yet (unless required for safe backend rollout)

### Constraints
- Keep EPIC data out of captain/master operational sheets.
- Avoid loading full EPIC dataset client-side.
- No unrelated refactors.
- Never auto-write EPIC suggested stage into captain-owned stage columns.

### Validation / acceptance
- Can run a sync and verify cache populated.
- Can query one APN and receive correct structured data.
- Can query multiple APNs efficiently.
- Can fetch sync status metadata.
- Existing dashboard behavior remains unchanged.

### Deliverables
- Code changes
- Setup instructions (including schedule)
- API contract summary with sample responses
- Test evidence for:
  - sync success
  - APN normalization
  - one-to-many APN case retrieval
  - failure fallback behavior

---

## 16) Agent Handoff Prompt: UI Design-Only (Post-Plumbing)

Copy/paste prompt:

Design and implement the **EPIC-LA UI layer only** using the existing EPIC plumbing endpoints.  
Do **not** modify sync logic or cache schema unless absolutely required for display.

### Goal
Create a clear, captain-friendly EPIC section in Address Details that handles dense data without overwhelming users.

### Inputs
- Use this plan: `EPIC_DATA_INTEGRATION_PLAN.md`
- Assume plumbing endpoints already exist:
  - `GET /api/epic/by-apn`
  - `POST /api/epic/by-apns`
  - sync status metadata

### UX requirements
1. Add an `EPIC-LA` section in Address Details with:
   - advisory EPIC suggested stage
   - confidence + rationale
   - last refresh timestamp
   - optional manual `Apply suggestion` action
2. Separate:
   - rebuild cases
   - temporary housing cases
3. Each case card should show:
   - case number (link)
   - work class
   - county status
   - county progress + advisory suggested stage context
   - key dates
   - valuation, structure type
   - description
4. Add strong empty/loading/error states.
5. Keep visual density manageable:
   - progressive disclosure
   - compact defaults
   - readable hierarchy

### Non-goals
- No changes to daily sync pipeline
- No changes to source filters
- No large architecture refactor
- No automatic overwrite of captain-entered stage fields

### Performance and behavior
- Lazy load EPIC section on address open.
- Cache APN results in-session to avoid repeat calls.
- Avoid blocking existing details panel rendering.

### Validation
- Works on addresses with:
  - no EPIC cases
  - one case
  - many cases
  - mixed rebuild + temporary housing
- Maintains current panel performance and usability.

### Deliverables
- UI code changes
- brief UX rationale
- before/after screenshots or notes
- manual test checklist/results

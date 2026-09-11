# EPIC-LA Data Integration: Current-State Audit and Decision Plan

**Created:** April 21, 2026
**Last audited:** September 10, 2026
**Status:** Production integration is operating, but its data model is not yet reliable enough for longitudinal trends or authoritative milestone statistics.
**Scope:** What Altagether pulls from EPIC-LA, how it is transformed and surfaced, what it omits, and which decisions should be revisited before building captain-facing intelligence.

---

## 0. Executive assessment

The integration has a sound basic shape: it uses the county's fire-recovery-specific public dataset, keeps county data separate from captain-owned sheets, joins by APN, refreshes daily, and never overwrites captain knowledge.

The main limitation is no longer access to data. It is that the current model flattens a rich current-state source into a smaller record, then uses one "latest progress" field for summaries even though the county explicitly says that field should not be used for statistics.

The most important findings are:

1. **The source is legitimately fire-related, but not strictly post-fire by application date.** The official dataset is a curated subset of EPIC-LA cases associated with Eaton or Palisades recovery. Our exact `DISASTER_TYPE` filter is the strongest fire-relationship signal available. On September 10, 2026, four Eaton/SD-5 records had application dates before January 7, 2025; they appear to be pre-existing projects subsequently associated with recovery.
2. **We pull 17 of the 57 fields exposed by the layer.** Important omissions include the seven cumulative phase flags, project grouping, plan-versus-permit module, case type, completion and expiration dates, source progress ordinal, stable case ID, spatial fallback ID, and useful structure classifications.
3. **The homepage milestone distribution is not county-compatible statistics.** It uses `REBUILD_PROGRESS`, assigns each APN/address to only its most advanced case, and produces mutually exclusive buckets. The county says a case can belong to multiple phases and provides separate phase fields specifically for that reason.
4. **There is no trustworthy history for trends.** Each sync overwrites the current row for a case. `sync_run_at` records only the latest observation. Rows that disappear are retained but not marked inactive, so they are stale data, not an event history.
5. **The cache can silently overstate current activity.** Records absent from a later source pull remain queryable forever. A successful zero-row or sharply reduced source result would still mark the sync successful and make old records appear freshly checked.
6. **The production case links are broken.** The source field is `CSSLink`, but normalization reads `CSSLINK`; ArcGIS returns the canonical mixed-case key. The real value is also a relative fragment such as `permit/<case-id>`, not a complete URL. Production API responses currently show `css_link: ""`.
7. **Actionable workflow states are pulled but underused.** As of the audit, the Eaton/SD-5 source included 730 cases in `Waiting for Applicant`, 91 on `Hold`, 43 `On Hold`, and 4 `Withdrawn`. Status appears only inside individual case cards; it is not available as a zone queue or summary.
8. **The browser now eagerly performs zone-wide EPIC lookups on Home.** The April plan still says EPIC is lazy-loaded only when its filter is selected. Since July, the Building & Rebuilding panel calls the batch endpoint on page rendering and receives full case payloads, including descriptions, to compute a small summary.
9. **"Last refreshed" means Altagether sync completion, not source freshness.** The county source edit timestamp is captured in sync metadata but is not returned in lookup payloads. Weekend syncs can therefore say county data refreshed today even when the county source did not change.
10. **Several original decisions remain good and should be preserved:** separate county cache, advisory-only county interpretation, no automatic captain-stage writes, one-to-many APN retrieval, and visible distinction between captain and county data.

These issues do not mean the source is unusable. They define the work needed to turn it into defensible captain intelligence.

---

## 1. Authoritative source

Official ArcGIS item:

- Title: **EPIC-LA Fire Recovery Cases**
- Item ID: `e87c8fcf5a2c4f7e87198b0c208d3d9f`
- Owner: `dpwgis_lacounty`
- Item metadata: <https://www.arcgis.com/sharing/rest/content/items/e87c8fcf5a2c4f7e87198b0c208d3d9f?f=pjson>
- Feature layer: <https://services.arcgis.com/RmCCgQtiZLDCtblq/arcgis/rest/services/EPICLA_Eaton_Palisades/FeatureServer/0>
- County catalog page: <https://data.lacounty.gov/datasets/lacounty::epic-la-fire-recovery-cases/about>
- County metric definitions: <https://file.lacounty.gov/SDSInter/dpw/recovery/1203584_2025FireRebuildingMetricDefinitions.pdf>

The item description says:

- It is a **subset** of plans and permits related to Eaton and Palisades recovery.
- It includes rebuild and temporary-housing cases, focused on residential properties in unincorporated LA County.
- It is refreshed each business day, Monday-Friday, by around 9 a.m.
- `MODULENAME` distinguishes `PlanManagement` from `PermitManagement`.
- Cases can be grouped into projects.
- Duplicate case numbers are possible because of multiple geometries or history versions.
- A case can belong to multiple rebuilding phases.
- `REBUILD_PROGRESS` is the latest stage display and **should not be used for statistics**.
- Separate phase fields are supplied for phase counts.

### Live source snapshot on September 10, 2026

The following are point-in-time observations, not hardcoded product assumptions:

- 7,066 rows across both fires.
- 6,641 rows tagged `Eaton Fire (01-2025)`.
- 6,640 rows matching our additional `SUP_DIST='5'` filter.
- 3,715 distinct `MAIN_AIN` values in the Eaton/SD-5 subset, including one null value.
- 1,949 APNs with multiple cases; the largest had 8 cases.
- 5,143 permit-module rows and 1,497 plan-module rows.
- 6,640 distinct case numbers at that moment, despite the source warning that duplicates are possible.
- 4 records applied before January 7, 2025; the earliest was May 12, 2023.
- 1 record had no `MAIN_AIN` but did have parcel `SPATIALID=5833010011` and point geometry.
- 19 additional rows had different `MAIN_AIN` and `SPATIALID` values.
- Spatial comparison found 6,633 filtered rows in Altadena, 5 in Kinneloa Mesa, 1 in Agua Dulce, and 1 associated with the City of Pasadena.
- The one Eaton row excluded by `SUP_DIST='5'` is a confirmed Altadena rebuild at 410 E Pine Street; it has `SUP_DIST='1'`, `DISTRICT_DISPLAY='SD-5'`, and Altadena geometry.
- Source layer `editingInfo.lastEditDate`: `2026-09-10T11:46:27.800Z`.

The layer's categorical fields have no coded-value domains. Status, progress, and classification monitoring must therefore tolerate and detect new open-text values.

Current-status counts included:

- Issued: 3,263
- Open: 1,379
- Waiting for Applicant: 730
- In Review: 404
- Finaled: 269
- Approved Pending Clearances: 235
- Approved Ready for Permit: 184
- Hold: 91
- On Hold: 43
- Withdrawn: 4

These counts are **case rows**, not unique parcels, addresses, projects, structures, or households.

---

## 2. Current production data flow

1. GitHub Actions calls `POST /api/admin/sync-epic` once per day with `x-epic-sync-token`.
2. `epic/config.js` builds an explicit source field list and reads source/cache settings.
3. `epic/arcgis.js` queries ArcGIS with:
   - `DISASTER_TYPE='Eaton Fire (01-2025)'`
   - `SUP_DIST='5'`
   - no date constraint
   - no status constraint
   - no geometry
   - `OBJECTID ASC` pagination
4. `epic/normalize.js` renames fields, converts dates, normalizes APNs, detects temporary housing, and computes advisory captain-stage fields.
5. `epic/cache.js` rewrites every source record into a dedicated Google Sheet, upserting by `casenumber`.
6. Rows not seen in the current run remain in the sheet indefinitely and have no active/stale flag.
7. `epic/lookup.js` reads the entire cache into server memory for 60 seconds, indexes it by normalized APN, and builds one- or many-APN responses.
8. `index.html`:
   - fetches all EPIC cases for a selected APN in Address Details;
   - fetches full EPIC payloads for every zone APN on Home;
   - derives exclusive homepage milestone buckets;
   - powers EPIC filters for table, list, and map.

Production status at the time of audit:

- Last successful sync: `2026-09-10T14:55:52.875Z`
- Source rows fetched: 6,640
- Rows inserted: 4
- Rows rewritten as updates: 6,636
- Duration: 14.7 seconds
- Pages: 4
- Max-page cap reached: no

---

## 3. What is pulled

`epic/config.js` requests these 17 source fields:

- Identity/location: `OBJECTID`, `CASENUMBER`, `MAIN_AIN`, `MAIN_ADDRESS`
- Classification: `WORKCLASS_NAME`, `STRUCT_TYPE_DISP`
- State/progress: `STATUS`, `REBUILD_PROGRESS`
- Dates: `APPLY_DATE`, `ISSUANCE_DATE`, `LAST_INSPECTION_DATE`
- Scale/content: `PERMIT_VALUATION`, `NEW_DWELLING_UNITS`, `DESCRIPTION`
- Linking/scope: `CSSLink` (requested as `CSSLINK`), `DISASTER_TYPE`, `SUP_DIST`

### Normalized cache schema

The cache has 25 columns:

`casenumber`, `main_ain_raw`, `main_ain_norm`, `main_address`,
`workclass_name`, `status`, `rebuild_progress`, `rebuild_progress_num`,
`apply_date_iso`, `issuance_date_iso`, `last_inspection_date_iso`,
`permit_valuation`, `struct_type_disp`, `new_dwelling_units`, `description`,
`css_link`, `disaster_type`, `sup_dist`, `is_temporary_housing`,
`suggested_stage_num`, `suggested_stage_label`, `suggestion_confidence`,
`suggestion_reason`, `sync_run_at`, `objectid`.

Important transformation details:

- `main_ain_norm` removes every non-digit character; it does not validate length or format.
- `rebuild_progress_num` is recomputed from an exact text map. The source's own `REBUILD_PROGRESS_NUM` is not pulled.
- ArcGIS dates become UTC ISO strings.
- Temporary housing is inferred from `WORKCLASS_NAME` or `REBUILD_PROGRESS` text.
- Suggested captain stages are derived from the latest-progress label and stored even though their UI box is hidden.
- `CSSLink` is currently lost because JavaScript property access is case-sensitive.

### What the frontend actually displays or uses

Address Details displays:

- case number
- work class
- status
- latest county progress
- valuation
- application, issuance, and last-inspection dates
- structure type
- description
- case link when nonblank
- sync completion time

Address Details does **not** display `new_dwelling_units`, source address, source object ID, disaster tag, supervisor district, or advisory suggestion fields.

Home and filters use:

- APN
- total case presence
- temporary-housing presence
- recomputed progress ordinal/latest milestone
- sync completion time

They currently receive full case records even though they use only a few values.

---

## 4. Important source fields not pulled

### Priority 0: required before defensible trends or phase statistics

- `CASEID`: stable system case identifier; safer than assuming `CASENUMBER` is unique forever.
- `MODULENAME`: tells captains and analytics whether a row is a plan or permit.
- `CASENAME`: distinguishes recovery permits, residential permits, express cases, commercial, multifamily, and mixed use.
- `PROJECT_NUMBER`, `PROJECT_NAME`, and/or `PROJECTID`: groups multiple permits/cases belonging to one rebuild project.
- `STYLE_CATEGORY`: contains all phase labels associated with a row.
- `REBUILD_APP_RECEIVED`
- `ZONING_REV_CLEARED`
- `BUILD_PLAN_REV_PROC`
- `BUILD_PLAN_APPROVED`
- `BUILD_PERMIT_ISSUED`
- `REBUILD_IN_CONS`
- `CONS_COMPLETED`
- `REBUILD_PROGRESS_NUM`: county-supplied latest ordinal.
- `COMPLETE_DATE`: completion/final date; distinct from last inspection.
- `EXPIRE_DATE`: useful for expired/at-risk permit review.
- `SPATIALTYPE`, `SPATIALID`, and source geometry: fallback and diagnostic path when `MAIN_AIN` is missing or wrong.

### Priority 1: valuable captain context and segmentation

- `STAT_CLASS`: detailed construction class such as SFR, garage/carport, other residential, repair, or commercial.
- `DISASTER_LOSS`: source flag that may help explain why a pre-existing permit is included; semantics need county confirmation before use.
- `ACCESSORY_DWELLING_UNIT` and `JUNIOR_ADU`: distinguish ADU/JADU work.
- `MAIN_PARTIAL_ADDR`: useful for address reconciliation without city/ZIP noise.
- `DISTRICT_DISPLAY`: diagnostic confirmation of district assignment.
- `AFFORDABLE_HOUSING`: sparse but potentially important context.

### Priority 2: retain only if a defined use appears

- `USE_CURR*`, `USE_STATUS*`, `USE_PROPOSED*`
- duplicate project-name variants
- internal queue/spatial identifiers beyond those needed for stable identity

Do not ingest every field merely because it exists. Add fields when they support identity, correct statistics, matching, explainability, or an agreed captain workflow.

---

## 5. Current derived semantics

### Temporary housing

A record is treated as temporary housing when work class or latest progress contains phrases such as `temporary housing`, `temp housing`, or a narrower `temp` pattern. Current source labels match this approach, but the source also provides `STYLE_CATEGORY`; future classification should use explicit source values first and text heuristics only as fallback.

### Suggested captain stage

Current mapping:

- Rebuild application / zoning / plans / plan approval -> Stage 2
- Permit issued -> Stage 2 boundary
- Rebuild in construction -> Stage 3
- Construction completed -> Stage 4 candidate
- Temporary housing -> no rebuild stage

This mapping is advisory and never writes to captain sheets. That guardrail is correct.

The mapping should not become a trend model without:

- storing source transitions over time;
- distinguishing plan and permit records;
- grouping related project cases;
- handling withdrawn, expired, hold, and waiting-for-applicant states;
- explaining conflicts between multiple active cases;
- validating the county-to-captain stage relationship with captains.

### Homepage milestone rollup

Current logic assigns each address to one exclusive bucket based on the most advanced rebuild case on its APN:

- application or plans under review
- permit issued
- construction underway
- construction completed

Limitations:

- It ignores cumulative phase flags.
- "Application or plans under review" can include approved plans, held cases, withdrawn applications, and waiting-for-applicant cases.
- Missing or unrecognized progress ordinals default to the application/plans bucket in the browser.
- It treats the highest-progress case as representative of the parcel even when SFR, ADU, accessory, or repair projects differ.
- Two dashboard addresses sharing one APN each count the same parcel activity.
- The denominator is every address in the zone, not fire-damaged addresses, eligible parcels, households, or unique APNs.
- A stale retained cache row counts as present.

The current chart is best described as **"most advanced EPIC activity matched to each dashboard address"**, not as county phase statistics or recovery rates.

---

## 6. Matching and coverage

### Current join

- County: `MAIN_AIN`
- Dashboard: first row's `APN` value for an address
- Normalization: digits only
- Relationship: one dashboard APN to zero or many EPIC case rows

### Known blind spots

- Missing APN means no lookup.
- Invalid APNs are not rejected by length or checksum/format rules.
- If multiple resident rows under one address disagree on APN, only the first row is read.
- Multi-parcel properties are unsupported.
- Multiple dashboard addresses on one parcel duplicate parcel-level activity in address counts.
- County `MAIN_AIN` can be null even when `SPATIALID` or geometry identifies a parcel.
- County `MAIN_AIN` and `SPATIALID` can disagree; 19 current rows require an explicit conflict policy.
- Address text and geometry are not used to verify a surprising APN match.
- EPIC recognizes only an exact dashboard header named `APN`; unlike the sales integration, it does not accept aliases such as `AIN` or `Parcel`.
- Editing an APN updates in-memory sheet data, but the zone-wide EPIC presence map is not reset; Home/filter results can remain stale until zone data reloads.

### Filter decision: `SUP_DIST='5'`

This filter currently excludes only one of 6,641 Eaton-tagged source rows, but that row is a confirmed Altadena Eaton rebuild. Conversely, seven included rows fall outside the formal Altadena boundary. `SUP_DIST` is therefore neither a reliable Altadena boundary nor a reliable inclusion rule.

Recommended decision:

- Keep `DISASTER_TYPE='Eaton Fire (01-2025)'`.
- Evaluate removing `SUP_DIST` from ingestion and scoping at lookup by dashboard APNs.
- If geographic scoping is needed, validate against the dashboard APN universe and/or an agreed Altadena-plus-adjacent-community geometry.
- If `SUP_DIST` is retained temporarily, monitor and report Eaton rows outside SD-5 rather than silently ignoring them.

### Date decision

Do not add `APPLY_DATE >= 2025-01-07` without product review. Four current rows predate the fire but were deliberately included by the county and completed or issued after the fire. Add an `applied_before_fire` diagnostic flag and inspect their meaning before deciding whether they belong in captain-facing rebuild statistics.

---

## 7. Persistence, freshness, and trend readiness

### Current behavior

- Upsert key: `casenumber`
- Every fetched record is rewritten every day, even when unchanged.
- Missing source records are retained indefinitely.
- No `active`, `last_seen_at`, or `missing_since` field exists.
- No snapshot or field-level change event is stored.
- Sync success metadata survives later failures.
- Lookup freshness is based on `last_success_finished_at`.

### Why this cannot support trends

After each sync, only the latest value remains. It is impossible to reliably answer:

- Which addresses received a new application this week?
- Which moved from review to permit issued?
- Which entered or left `Waiting for Applicant`?
- How long has a case been at a stage?
- Which cases disappeared, were replaced, or were withdrawn?
- What changed since a captain's last visit?

Rows left behind after disappearance cannot answer those questions because they are not labeled as historical, inactive, deleted, or current.

### Required model before trend work

Use three logical datasets, whether implemented in Sheets or a database:

1. **Current cases**
   - one current source observation per stable source row/case identity;
   - `first_seen_at`, `last_seen_at`, `active`, `missing_since`;
   - source and ingestion timestamps kept separately.
2. **Case snapshots or change events**
   - append-only observations or field-level changes for status, phase flags, dates, APN, project, structure type, and key classifications;
   - sync run ID and source edit timestamp on every observation.
3. **Sync runs**
   - source row count, distinct cases/APNs/projects, insert/change/disappearance counts, validation results, duration, and failure details.

Do not call retained stale rows "history." History requires explicit observation time and state.

### Feasibility and storage scale

A trustworthy current-zone snapshot is feasible without a new large database. The source has enough present-state information; Phase A below is primarily ingestion, reconciliation, aggregation, and UI work. A useful first release is likely several days to roughly two weeks, depending on the captain-facing presentation and validation required.

The current cache is small: about 6,640 rows by 25 columns, or roughly 166,000 cells. The storage problem appears only if every full state is copied every day. That design would produce about 2.4 million rows and 61 million cells per year, far beyond a single Google Sheet's 10-million-cell ceiling.

Prefer a tiered design:

- keep one current-state cache;
- store compact field-level change events rather than unchanged daily copies;
- store small daily zone/phase/status aggregates for charting;
- use a modest managed relational database, such as Postgres, if detailed event history or cross-project queries outgrow Sheets.

This is not "massive database" scale. Google Sheets can remain viable for current state and compact aggregates, but it should not be treated as an unlimited full-snapshot warehouse. A reliable trend foundation is directionally one to three weeks of additional engineering after metric definitions; polished alerts, comparisons, and captain action queues would be subsequent product work.

History begins when explicit observations are retained. Earlier transitions generally cannot be reconstructed from the overwritten cache, although dated county fields can support limited retrospective counts.

---

## 8. API and performance audit

Implemented endpoints:

- `GET /api/epic/by-apn`
- `POST /api/epic/by-apns` (maximum 500 submitted APNs)
- `GET /api/epic/sync-status`
- `POST /api/admin/sync-epic`

Current backend behavior:

- Every cold/expired lookup reads the entire Google Sheet and builds an APN map.
- Cache TTL is 60 seconds per server process.
- The batch endpoint returns full case bodies, including long descriptions.
- Home requests the full payload for every unique zone APN to calculate counts and milestones.
- Address Details performs a fresh browser request every time the modal opens; it has no client session cache.

Recommended API split:

- Keep detailed `by-apn` for Address Details.
- Add a compact zone/APN-summary endpoint returning only match state, phase flags/counts, action statuses, project/case counts, latest activity dates, match confidence, and source freshness.
- Compute source-compatible rollups on the server from explicit phase fields.
- Include `source_last_edit_at`, `sync_finished_at`, and stale/active state separately.

### Operational scaling concerns

- A September production sync rewrote 6,636 rows and took 14.7 seconds.
- Google Sheets writes are chunked, but unchanged rows are still rewritten.
- Concurrent manual and scheduled syncs have no lock and can race on append ranges and metadata.
- No minimum-row, row-drop, schema, duplicate-key, or missing-APN validation gates a "successful" sync.
- Header repair can overwrite a changed header order without migrating existing row cells.
- Duplicate case-number rows already present in the sheet remain duplicated in lookup output because cache reads retain every row even though the upsert index points only to the last duplicate.
- Reaching `EPIC_MAX_PAGES` still returns sync status `ok`; truncation appears only as a metadata flag.
- The public status endpoint exposes configuration shape and old failure details; this is probably acceptable operationally but should be intentional.
- All EPIC read endpoints are unauthenticated. The underlying county source is public, but the dashboard also makes address, valuation, and description data easy to enumerate by APN; decide explicitly whether dashboard-session gating is appropriate.
- Admin-email query authorization proves only that an email is on the admin list, not that the caller controls that email. The token path is the appropriate scheduler mechanism; manual admin triggering should use authenticated session identity.

---

## 9. Decisions to preserve

- Keep EPIC data out of captain/master operational sheets.
- Keep the county source visibly distinct from captain-entered knowledge.
- Never auto-overwrite captain stages or plans.
- Preserve all legitimately distinct cases for an APN.
- Separate temporary housing from rebuild work.
- Continue daily rather than live request-through to ArcGIS.
- Keep the last good cache available during a source outage.
- Keep clear empty, loading, and error states.

Preserving the last good cache does **not** require treating records missing from a successful current source pull as active.

---

## 10. Decisions that should be reopened

1. `casenumber` as the only primary key, despite the source's duplicate warning.
2. `SUP_DIST='5'` as an ingestion filter.
3. No source geometry or `SPATIALID` fallback.
4. Recomputed ordinal instead of source `REBUILD_PROGRESS_NUM`.
5. Latest-progress field as the basis for statistics.
6. Highest case progress as the single parcel headline.
7. Retain-forever cache rows with no active/stale state.
8. Google Sheets as the future snapshot/event store.
9. Full case payloads for zone summary/filter use.
10. Daily scheduling regardless of the source's business-day cadence.
11. Sync completion shown as county freshness.
12. Free-form digits-only APN normalization without validation or match confidence.
13. Address counts that duplicate one parcel across multiple addresses.
14. Hidden advisory-stage computation that consumes schema and API surface without a validated use.
15. Email query parameter as manual-sync authorization.
16. Public unauthenticated lookup endpoints versus signed-in dashboard-session access.
17. Exact `APN` header requirement versus the alias handling used by other parcel integrations.

---

## 11. Recommended sequence before captain-facing trends

### Phase A: make current state trustworthy

- Fix `CSSLink` ingestion and construct the correct EPIC-LA SelfService URL.
- Pull stable identity, module/case/project fields, source ordinal, phase flags, completion/expiration dates, structure classification, and spatial fallback fields.
- Add source schema validation and row-count/drop anomaly checks.
- Add `active`, `last_seen_at`, and disappearance handling.
- Add APN format validation and conflict diagnostics.
- Separate source edit time from Altagether sync time in API and UI.
- Add a sync lock and safer authenticated manual trigger.
- Correct the homepage's statistical label or replace its calculation.

### Phase B: create a trend-capable store

- Record append-only snapshots or field-level events.
- Establish stable identity and project-grouping rules.
- Decide retention, compaction, and backfill strategy.
- Prefer a database over Sheets if snapshots materially multiply row count or query complexity.
- Add tests for transitions, disappearances, duplicate cases, project grouping, and source-schema changes.

### Phase C: validate useful captain signals

Candidate signals, in priority order:

1. Waiting for applicant / hold / expired-or-near-expiry review queue.
2. New application, permit issuance, construction, final inspection, or completion since prior sync.
3. County progress ahead of captain record, shown as a reconciliation prompt.
4. Captain knowledge ahead of or absent from county data, preserved as local knowledge.
5. Missing/invalid APN and uncertain-match queue.
6. Parallel SFR/ADU/accessory/repair projects on one parcel.
7. Meaningful inactivity windows, only after defining fair status-specific thresholds.

All signals must expose the source fields and rule that produced them. "Potentially stalled" should never be inferred from elapsed time alone without accounting for `Waiting for Applicant`, hold, project type, and county process expectations.

---

## 12. Test and evidence gaps

The current `npm run test:epic` suite passes 10 tests and covers helper logic, basic upsert, APN lookup, and source-failure cache preservation.

It does not cover:

- live source schema/canonical field casing;
- relative case-link construction;
- ArcGIS pagination against the real service;
- duplicate case numbers or stable identity;
- stale/disappeared records;
- partial Google Sheets batch writes and retry behavior;
- concurrent syncs;
- zero-row or major-row-drop validation;
- source phase flags and cumulative statistics;
- frontend Home/filter calculations;
- APN edits invalidating zone EPIC state;
- malformed but digit-bearing APNs;
- source freshness versus ingestion freshness;
- project grouping;
- trend snapshots/events.
- continuous integration: no GitHub workflow currently runs the test suite on code changes.

Other repository documentation also drifted: `PRIORITY_ROADMAP.md` still describes a two-option, filter-only lazy EPIC experience, and `ZONE_DASHBOARD_STYLE_GUIDE.md` refers to EPIC map markers that are not implemented.

The homepage aggregation tested in `epic/normalize.js` is not the implementation used by `index.html`; similar logic is duplicated client-side. Tests can pass while the shipped browser logic diverges.

---

## 13. Acceptance criteria for the next data-foundation release

Before building trends, require:

1. Current cases can be distinguished from disappeared/inactive cases.
2. Every observation has source freshness and ingestion time.
3. Stable identity behavior is documented and tested.
4. County cumulative phase counts use the source phase flags.
5. Exclusive "current/latest stage" views are labeled as such.
6. Project and structure type prevent unrelated parallel permits from being flattened into one unexplained status.
7. APN matches expose missing, invalid, fallback, and ambiguous states.
8. Changes between successful syncs are queryable.
9. Address Details links reach the real county case.
10. Sync anomalies fail closed or alert operators without replacing current state.
11. Zone summary endpoints avoid sending descriptions and other detail fields unnecessarily.
12. Captain-facing interpretations have been reviewed with captains and remain advisory.

---

## 14. Bottom line

The integration already captures a useful county-curated set of fire-recovery cases. The highest-value next move is not to pull every remaining EPIC field or add another chart. It is to preserve identity, cumulative phases, operational status, project context, source freshness, and change over time.

Once those foundations are trustworthy, the dashboard can answer the questions captains actually need: **what changed, who may be waiting on something, where county and local knowledge disagree, and which neighbor may benefit from a check-in.**

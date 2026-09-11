# EPIC-LA Integration Runbook

**Last verified:** September 10, 2026
**Scope:** Production data pull, Google Sheets cache, lookup APIs, Home/filter use, Address Details use, validation, and known limitations.
**Product/data audit:** See `EPIC_DATA_INTEGRATION_PLAN.md`.

---

## 1. Current live status

The EPIC-LA integration is deployed and used by the dashboard.

Production components:

- Daily GitHub Actions trigger: `.github/workflows/epic-sync.yml`
- ArcGIS ingestion and normalization: `epic/`
- Dedicated Google Sheet cache: `epic_cases` and `epic_sync_meta`
- Server endpoints:
  - `GET /api/epic/by-apn`
  - `POST /api/epic/by-apns`
  - `GET /api/epic/sync-status`
  - `POST /api/admin/sync-epic`
- Browser surfaces:
  - Home **Building & Rebuilding** zone summary
  - EPIC milestone/temporary-housing filters in map and people views
  - Address Details EPIC case cards

Verified production status on September 10, 2026:

```text
status: ok
reason: token_trigger
last_success_started_at: 2026-09-10T14:55:38.134Z
last_success_finished_at: 2026-09-10T14:55:52.875Z
last_success_duration_ms: 14741
last_success_pages: 4
last_success_rows_fetched: 6640
last_success_rows_inserted: 4
last_success_rows_updated: 6636
last_success_skipped_no_casenumber: 0
last_success_hit_max_pages: FALSE
last_success_source_last_edit_date: 1789040787800
```

The source edit timestamp above is `2026-09-10T11:46:27.800Z`.

---

## 2. Source of truth

Use this official hosted feature layer:

```ini
EPIC_FEATURE_SERVICE_URL=https://services.arcgis.com/RmCCgQtiZLDCtblq/arcgis/rest/services/EPICLA_Eaton_Palisades/FeatureServer/0
```

References:

- ArcGIS item ID: `e87c8fcf5a2c4f7e87198b0c208d3d9f`
- Item metadata: <https://www.arcgis.com/sharing/rest/content/items/e87c8fcf5a2c4f7e87198b0c208d3d9f?f=pjson>
- Layer metadata/schema: <https://services.arcgis.com/RmCCgQtiZLDCtblq/arcgis/rest/services/EPICLA_Eaton_Palisades/FeatureServer/0?f=pjson>
- County data page: <https://data.lacounty.gov/datasets/lacounty::epic-la-fire-recovery-cases/about>
- County metric definitions: <https://file.lacounty.gov/SDSInter/dpw/recovery/1203584_2025FireRebuildingMetricDefinitions.pdf>

Do not use the old example `public.gis.lacounty.gov/.../DPW_EPIC/FireRecoveryCases`; it is not the current hosted item behind the county catalog.

The county describes this dataset as a residential-focused subset of EPIC-LA plans and permits related to Eaton and Palisades fire recovery. It is refreshed on business days, Monday-Friday, by around 9 a.m.

---

## 3. Architecture

```text
LA County ArcGIS hosted feature layer
  -> scheduled/manual sync
  -> normalize + advisory derivations
  -> dedicated Google Sheet
       epic_cases
       epic_sync_meta
  -> server lookup cache (60-second per-process TTL)
  -> /api/epic/*
  -> Home summary, filters, Address Details
```

EPIC sync does not write to captain/master operational sheets. Dashboard APNs are read only as lookup keys.

Current source filter:

```sql
DISASTER_TYPE='Eaton Fire (01-2025)' AND SUP_DIST='5'
```

There is no application-date or status filter. Withdrawn, held, waiting, completed, and pre-fire-applied cases remain eligible if the county tagged them to the Eaton fire and SD-5.

`SUP_DIST='5'` is not a reliable Altadena boundary. During the September audit it:

- excluded one confirmed Altadena Eaton rebuild at 410 E Pine Street because `SUP_DIST` was `1` while `DISTRICT_DISPLAY` and geometry placed it in SD-5/Altadena;
- included 5 Kinneloa Mesa rows, 1 Agua Dulce row, and 1 row associated with the City of Pasadena.

Treat the supervisor-district predicate as a known scoping defect pending replacement with dashboard-APN and/or agreed geographic validation.

Pagination:

- `returnGeometry=false`
- explicit `outFields`
- `OBJECTID ASC`
- offset/page-size pagination
- default page size 2,000
- default safety cap 100 pages

---

## 4. Repository map

- `epic/config.js` — environment parsing and 17-field ArcGIS selection
- `epic/arcgis.js` — WHERE clause, source metadata, paginated fetch
- `epic/normalize.js` — APN/date normalization, temp classification, stage mapping, lookup shaping, homepage helper
- `epic/cache.js` — tab/header creation, full-cache reads, row upserts, sync metadata
- `epic/sync.js` — sync orchestration and success/failure metadata
- `epic/lookup.js` — APN index and 60-second server memory cache
- `epic/routes.js` — lookup, status, and trigger routes
- `scripts/sync-epic.js` — CLI entry point
- `.github/workflows/epic-sync.yml` — production daily trigger
- `test/epic.test.js` — Node test suite
- `index.html` — shipped Home, filter, and Address Details consumers

`epic/normalize.js` also contains a server-side homepage summarizer used by tests, but the shipped browser reimplements similar logic in `index.html`.

---

## 5. Environment variables

Required for sync:

- `EPIC_FEATURE_SERVICE_URL`
- `EPIC_CACHE_SHEET_ID`
- Google service account credentials through one of:
  - `GOOGLE_SERVICE_ACCOUNT_JSON_B64`
  - `GOOGLE_SERVICE_ACCOUNT_JSON`
  - `GOOGLE_APPLICATION_CREDENTIALS`

Required for the production scheduler:

- `EPIC_SYNC_TOKEN` in the dashboard host
- matching `EPIC_SYNC_TOKEN` GitHub Actions secret

Optional:

- `EPIC_DISASTER_TYPE` — default `Eaton Fire (01-2025)`
- `EPIC_SUP_DIST` — default `5`
- `EPIC_CACHE_TAB` — default `epic_cases`
- `EPIC_META_TAB` — default `epic_sync_meta`
- `EPIC_PAGE_SIZE` — default `2000`
- `EPIC_MAX_PAGES` — default `100`
- `EPIC_FETCH_TIMEOUT_MS` — default `30000`
- `EPIC_LOOKUP_CACHE_TTL_MS` — default `60000`

Local example:

```ini
EPIC_FEATURE_SERVICE_URL=https://services.arcgis.com/RmCCgQtiZLDCtblq/arcgis/rest/services/EPICLA_Eaton_Palisades/FeatureServer/0
EPIC_CACHE_SHEET_ID=<dedicated-cache-sheet-id>
EPIC_SYNC_TOKEN=<long-random-token>
```

The cache sheet must be different from all captain/master sheets and shared as Editor with the dashboard service account.

---

## 6. Fields and cache schema

The sync currently requests:

```text
OBJECTID
CASENUMBER
MAIN_AIN
MAIN_ADDRESS
WORKCLASS_NAME
STATUS
REBUILD_PROGRESS
APPLY_DATE
ISSUANCE_DATE
LAST_INSPECTION_DATE
PERMIT_VALUATION
STRUCT_TYPE_DISP
NEW_DWELLING_UNITS
DESCRIPTION
CSSLINK
DISASTER_TYPE
SUP_DIST
```

ArcGIS accepts `CSSLINK` in `outFields` but returns the canonical property name `CSSLink`. Current normalization reads `a.CSSLINK`, so production `css_link` is blank. The source value is also relative, such as `permit/<uuid>` or `plan/<uuid>`. Treat case links as a known defect until both issues are fixed.

### `epic_cases`

One cached row is intended per case number:

```text
casenumber
main_ain_raw
main_ain_norm
main_address
workclass_name
status
rebuild_progress
rebuild_progress_num
apply_date_iso
issuance_date_iso
last_inspection_date_iso
permit_valuation
struct_type_disp
new_dwelling_units
description
css_link
disaster_type
sup_dist
is_temporary_housing
suggested_stage_num
suggested_stage_label
suggestion_confidence
suggestion_reason
sync_run_at
objectid
```

Operational cautions:

- The source says duplicate case numbers are possible, although the Eaton/SD-5 subset had no duplicates during the audit.
- Rows are upserted by `casenumber`, not stable `CASEID` or `OBJECTID`.
- Duplicate case-number rows already present in the cache can appear multiple times in API output; reads retain every row while the upsert map tracks only the last duplicate.
- Rows absent from a successful later source pull are never deleted or marked inactive.
- `sync_run_at` is the latest observation time, not history.
- Header order is the schema. Automatic header repair does not migrate existing cells if columns are reordered or added.
- Every fetched record is written on every sync, including unchanged records.

### `epic_sync_meta`

Success keys:

```text
status
reason
last_success_started_at
last_success_finished_at
last_success_duration_ms
last_success_pages
last_success_rows_fetched
last_success_rows_inserted
last_success_rows_updated
last_success_skipped_no_casenumber
last_success_hit_max_pages
last_success_source_last_edit_date
last_success_disaster_type
last_success_sup_dist
```

Failure keys:

```text
status
reason
last_failure_started_at
last_failure_finished_at
last_failure_stage
last_failure_error
last_failure_partial
last_failure_rows_fetched
```

Failure keys persist after a later success. This preserves incident context but can make very old resolved failures look current unless timestamps are read carefully.

---

## 7. API contracts

All lookup/status endpoints set or intend `Cache-Control: no-store`.

### `GET /api/epic/by-apn?apn=<value>`

The APN may be hyphenated or digits-only. The server removes all nondigits.

Response fields:

```json
{
  "apn": "5833015005",
  "cases_rebuild": [],
  "cases_temp_housing": [],
  "suggested_stage": null,
  "suggestion_confidence": "low",
  "suggestion_reason": "No EPIC cases found for this APN.",
  "last_synced_at": "2026-09-10T14:55:52.875Z",
  "counts": {
    "rebuild": 0,
    "temp_housing": 0,
    "total": 0
  }
}
```

`last_synced_at` is Altagether's sync completion time. It is not the county layer's edit time.

Errors:

- 400 `apn_required`
- 503 `epic_not_configured`
- 500 `epic_lookup_failed`

### `POST /api/epic/by-apns`

Request:

```json
{ "apns": ["5833-015-005", "5833010011"] }
```

Behavior:

- maximum 500 submitted values;
- normalization and deduplication happen server-side;
- values containing no digits are dropped;
- other malformed digit-bearing values are not rejected;
- every accepted APN receives a result, including empty matches;
- full case payloads are returned.
- read endpoints do not require a dashboard session. The county source is public, but address, valuation, and description data are therefore enumerable through the dashboard host.

### `GET /api/epic/sync-status`

Returns all metadata plus `_config`.

Production check:

```bash
curl -fsS https://dashboard.altagether.org/api/epic/sync-status
```

### `POST /api/admin/sync-epic`

Preferred authorization:

```http
x-epic-sync-token: <EPIC_SYNC_TOKEN>
```

The route also accepts `?email=<admin>` when the value appears in the admin list. That checks list membership but does not prove caller identity; do not rely on it as strong manual-admin authentication.

Success is HTTP 200. Operational sync failure is HTTP 502. Missing configuration is HTTP 503.

There is no concurrency lock. Do not intentionally run scheduled, CLI, and manual syncs at the same time.

---

## 8. Browser behavior

### Home

The Home Building & Rebuilding panel automatically loads EPIC data for every unique APN in the current zone. This is not lazy-only-on-filter behavior.

It calculates:

- addresses with any EPIC case;
- addresses with rebuild cases;
- addresses with temporary housing;
- one most-advanced milestone per address/APN;
- missing-APN count;
- percent of all zone addresses with any EPIC record.

The batch response includes complete case records and descriptions, even though Home needs only summary values.

The milestone display is an Altagether exclusive latest-stage rollup, not the county's cumulative phase statistics. County metadata says not to use `REBUILD_PROGRESS` for statistics.

If a progress label is new or unrecognized, the browser's zero/blank ordinal path places it in the application/plans bucket.

### Filters

Available EPIC filters:

- Has permitting records
- Application / plans under review
- Permit issued
- Construction underway
- Construction completed
- Temporary housing

If the batch lookup fails while activating a filter, the UI falls back to All EPIC.

### Address Details

Address Details loads one APN on demand and shows rebuild and temporary-housing groups.

Currently shown:

- case number
- work class
- status
- county progress
- valuation
- applied/issued/last-inspection dates
- structure type
- description
- case link if present

Currently not shown despite being cached:

- new dwelling units
- source address
- source object ID
- advisory stage/confidence/reason
- source scope fields

The currency formatter currently turns a blank cache value into `$0`; interpret zero valuations cautiously until blank-versus-zero rendering is corrected.

After an APN edit, reopening Address Details uses the new APN, but Home/filter EPIC state is not explicitly invalidated and can retain results from the old APN until the zone data is reloaded.

EPIC recognizes only a dashboard column named exactly `APN` after case folding. It does not accept `AIN` or `Parcel` aliases as the sales integration does.

---

## 9. Running a sync

### First-time setup

1. Create an empty dedicated Google Sheet.
2. Share it as Editor with the dashboard service account.
3. Configure the required environment variables.
4. Ensure the sheet has substantially more than 6,640 rows available; 10,000 is a practical current minimum, not a permanent capacity plan.
5. Run:

```bash
npm run sync:epic
```

6. Confirm:
   - process exit code is 0;
   - both cache tabs exist;
   - status is `ok`;
   - row count is plausible;
   - `last_success_hit_max_pages` is `FALSE`;
   - one known APN lookup returns expected cases.

CLI exit codes:

- 0 success
- 1 configuration error
- 2 operational/fatal failure

### Production scheduler

The active workflow runs:

```yaml
- cron: "0 11 * * *"
```

That is 04:00 Pacific during daylight saving time and 03:00 Pacific during standard time. The old workflow comment states the standard-time conversion incorrectly.

The county says its source refreshes on business days by around 9 a.m. The current schedule can therefore run before the published source-refresh target and also runs on weekends. Revisit the schedule or compare source edit time before presenting a sync as fresh county data.

The workflow has no explicit retry, timeout, concurrency guard, or notification step.

---

## 10. Health checks

### Source layer

Layer metadata:

```text
https://services.arcgis.com/RmCCgQtiZLDCtblq/arcgis/rest/services/EPICLA_Eaton_Palisades/FeatureServer/0?f=pjson
```

Current filtered count:

```text
https://services.arcgis.com/RmCCgQtiZLDCtblq/arcgis/rest/services/EPICLA_Eaton_Palisades/FeatureServer/0/query?f=json&where=DISASTER_TYPE%3D%27Eaton%20Fire%20%2801-2025%29%27%20AND%20SUP_DIST%3D%275%27&returnCountOnly=true
```

As of September 10, 2026, expected count was 6,640. It will change.

### Production

Check:

- `status` and latest failure timestamp;
- last success age;
- source edit timestamp age;
- rows fetched compared with prior run;
- inserted versus updated counts;
- missing case-number count;
- max-page flag;
- duration trend;
- one known positive APN;
- one known empty APN;
- whether source and cache counts plausibly agree.

Current code does not automatically enforce row-count or freshness thresholds. Operators must interpret them.

### Recommended alert thresholds to implement

- zero rows;
- material row-count drop;
- unexpected duplicate case keys;
- source schema missing a required field;
- new open-text progress, status, or classification values (the layer defines no coded-value domains);
- source edit time older than expected business-day cadence;
- `hit_max_pages=TRUE`;
- sync duration approaching host timeout;
- any partial cache write;
- cache rows not seen in the current successful run;
- missing/invalid APN rate increase.

---

## 11. Failure handling

### `ensureTabs`

Likely causes:

- wrong sheet ID;
- service account lacks access;
- Sheets API/auth failure.

The code attempts to record failure metadata, but that may also fail if the sheet is inaccessible.

### `arcgis_fetch`

Likely causes:

- source outage;
- moved service;
- schema/field change;
- timeout;
- invalid configured filter.

The cache is not written. Last good data remains available.

### `cache_upsert`

Likely causes:

- permissions/quota;
- sheet grid too small;
- request limit;
- host timeout;
- concurrent writers.

The run may be partial. Do not assume all cases have the same `sync_run_at`.

The first production attempt failed because `epic_cases` had only 1,000 rows:

```text
Range (epic_cases!A1001:Y1001) exceeds grid limits.
```

Expand the grid before retrying.

### Successful but suspicious sync

A run can return `ok` even when:

- source row count is zero or sharply reduced;
- source data is unchanged/stale;
- records disappeared from the source;
- old cache-only records remain queryable;
- link values were lost during normalization;
- source field meanings changed without a field-name change;
- the page cap was reached; current code reports `hit_max_pages` but still returns `status: ok`.

Treat success as transport/write success, not data-quality certification.

---

## 12. Cache rebuild and stale rows

Re-running `npm run sync:epic` is idempotent only with respect to the current `casenumber` upsert model.

To rebuild from scratch:

1. Export or copy the existing cache if investigation/history may be needed.
2. Delete data rows below the header in `epic_cases`.
3. Run one sync.
4. Compare source count, cache count, duplicate keys, missing APNs, and sample cases.

Do not use a destructive rebuild as the normal answer to disappeared source rows. Add explicit active/last-seen semantics first, as described in `EPIC_DATA_INTEGRATION_PLAN.md`.

---

## 13. Tests

Run:

```bash
npm run test:epic
```

Verified September 10, 2026:

```text
tests: 10
pass: 10
fail: 0
```

Covered:

- APN normalization
- ArcGIS date conversion
- temporary-housing classification
- advisory stage mapping
- homepage latest-milestone helper
- record/cache round trip
- lookup grouping/headline
- WHERE escaping
- successful insert/update sync
- ArcGIS failure preserving cache

Not covered:

- real source schema and field casing;
- real relative case links;
- stale/disappeared rows;
- snapshots/transitions;
- duplicate case numbers;
- concurrency;
- row-count/schema anomaly gates;
- partial batch recovery;
- frontend Home/filter implementation;
- APN edit invalidation;
- project grouping;
- county cumulative phase fields.
- CI execution; no GitHub workflow currently runs the tests on pushes or pull requests.

---

## 14. Known limitations that must remain visible

- This source covers county EPIC-LA cases in unincorporated areas, not all permitting jurisdictions or all rebuilding activity.
- No EPIC match does not mean no rebuild.
- Missing APN means "not checked," not "no record."
- Captain knowledge remains authoritative for outreach, occupancy, household context, and locally confirmed stage.
- Current source is a present-state view; the cache does not preserve reliable transitions.
- Current homepage milestones are exclusive Altagether rollups, not official county phase counts.
- Case status, project, parcel, structure, and household are different units of analysis.
- Source data is informational and subject to LA County terms and corrections.

Operational changes and captain-facing analytics should preserve these distinctions.

# EPIC-LA Integration Runbook (Plumbing Only)

**Scope:** backend + data pipeline only. No UI is wired yet. See
`EPIC_DATA_INTEGRATION_PLAN.md` for product context.

---

## Current Live Status (April 23, 2026)

- EPIC backend plumbing is merged to `main` and deployed to production.
- Production endpoint check passed: `GET /api/epic/sync-status`.
- First token-triggered production sync succeeded:
  - `status: ok`
  - `rows_fetched: 5647`
  - `inserted: 5147`
  - `updated: 500`
- Production lookup check passed: `GET /api/epic/by-apn?apn=<known APN>`.
- Daily automation is active via GitHub Actions workflow:
  - `.github/workflows/epic-sync.yml`
  - uses `POST /api/admin/sync-epic` with `x-epic-sync-token`.
- Address Details modal UI is live for EPIC record viewing, APN editing, and
  move-pin tools.
- Stage-suggestion fields are still computed by backend, but the suggestion
  box is intentionally hidden in UI until mapping confidence is validated in
  field use.

---

## 1. What this is

A read-through cache that pulls filtered EPIC-LA Fire Recovery Cases into a
dedicated Google Sheet, normalizes them, and exposes them over a few
dashboard-server endpoints. The captain/master operational sheets are never
touched.

```
ArcGIS FeatureServer
   └── (daily sync) ──> epic_cases tab + epic_sync_meta tab  ──> /api/epic/* endpoints
```

Filters applied at sync time:

- `DISASTER_TYPE = 'Eaton Fire (01-2025)'`
- `SUP_DIST = '5'`

Upsert key: `casenumber`. Stable ordering: `OBJECTID ASC`.

---

## 2. Files

| Path | Purpose |
|------|---------|
| `epic/config.js`    | Reads env vars, provides the sync/read config shape |
| `epic/arcgis.js`    | Paginated ArcGIS FeatureServer client (native `fetch`) |
| `epic/normalize.js` | Pure helpers: APN normalization, temp-housing flag, stage mapping, cache schema |
| `epic/cache.js`     | Google Sheets read/write layer: `ensureTabs`, `upsertRecords`, meta IO |
| `epic/sync.js`      | Orchestrator: fetch → normalize → upsert → meta (with resilient failure path) |
| `epic/lookup.js`    | APN-keyed lookup for endpoints + short in-memory TTL cache |
| `epic/routes.js`    | Express registration for all `/api/epic/*` + admin sync routes |
| `scripts/sync-epic.js` | CLI entrypoint (`npm run sync:epic`) |
| `test/epic.test.js` | Node `--test` suite covering normalization + sync orchestration |

`suggested_stage_*` fields are treated as heuristic outputs, not source of
truth, and can be ignored by frontend consumers until re-enabled.

All new code lives under `epic/`, `scripts/`, and `test/`. `server.js` was
touched only to call `registerEpicRoutes(app, deps)` right before the SPA
fallback.

---

## 3. Environment variables

Required:

| Var | Description |
|-----|-------------|
| `EPIC_FEATURE_SERVICE_URL` | Full ArcGIS FeatureServer layer URL. Ends in `/FeatureServer/<layerId>`. Example: `https://public.gis.lacounty.gov/public/rest/services/<SERVICE>/FeatureServer/0`. |
| `EPIC_CACHE_SHEET_ID`      | Google Sheet ID that will host the EPIC cache. Must be a DIFFERENT sheet from any captain/master sheet. Share with the service account (`dashboard@nc-dashboard-v1.iam.gserviceaccount.com`) as **Editor**. |
| `GOOGLE_SERVICE_ACCOUNT_JSON_B64` (or `GOOGLE_SERVICE_ACCOUNT_JSON`, or `GOOGLE_APPLICATION_CREDENTIALS`) | Already used by the rest of the app. Required for Sheets writes. |

Optional (with defaults):

| Var | Default | Notes |
|-----|---------|-------|
| `EPIC_DISASTER_TYPE` | `Eaton Fire (01-2025)` | If the source renames this, update here. |
| `EPIC_SUP_DIST` | `5` | Altadena = SUP_DIST 5. |
| `EPIC_CACHE_TAB` | `epic_cases` | Auto-created on first sync. |
| `EPIC_META_TAB` | `epic_sync_meta` | Auto-created on first sync. |
| `EPIC_PAGE_SIZE` | `2000` | Per ArcGIS query page. |
| `EPIC_MAX_PAGES` | `100` | Safety cap. |
| `EPIC_FETCH_TIMEOUT_MS` | `30000` | Per HTTP call. |
| `EPIC_LOOKUP_CACHE_TTL_MS` | `60000` | In-memory cache TTL for the lookup endpoints. |
| `EPIC_SYNC_TOKEN` | *(unset)* | If set, callers can trigger `POST /api/admin/sync-epic` with header `x-epic-sync-token: <value>` instead of needing an admin email. Use this for scheduled/external triggers. |

### Local `.env.local` snippet

```ini
EPIC_FEATURE_SERVICE_URL=https://public.gis.lacounty.gov/public/rest/services/DPW_EPIC/FireRecoveryCases/FeatureServer/0
EPIC_CACHE_SHEET_ID=1ABCxxxxxxxxxxxxxxxxxxxxxxxxx
# EPIC_SYNC_TOKEN=some-long-random-string
```

> The exact FeatureServer URL is not shipped in this repo because the EPIC
> portal occasionally rehomes services. Get the current URL from the ArcGIS
> hub listing linked in `index.html` ("EPIC-LA Fire Recovery Cases") by
> clicking **View API Resources → Query**.

---

## 4. Cache schema

### Tab: `epic_cases`

One row per EPIC case, keyed by `casenumber`. Columns are written in this
exact order on every sync (the order IS the schema — see
`CACHE_COLUMNS` in `epic/normalize.js`):

```
casenumber, main_ain_raw, main_ain_norm, main_address, workclass_name,
status, rebuild_progress, rebuild_progress_num, apply_date_iso,
issuance_date_iso, last_inspection_date_iso, permit_valuation,
struct_type_disp, new_dwelling_units, description, css_link,
disaster_type, sup_dist, is_temporary_housing, suggested_stage_num,
suggested_stage_label, suggestion_confidence, suggestion_reason,
sync_run_at, objectid
```

Notes:

- `main_ain_norm` is the digits-only APN used for all joins.
- `is_temporary_housing` is `TRUE`/`FALSE` strings so it's human-readable in Sheets.
- `suggested_stage_num` is blank for temporary-housing cases and cases the
  model can't classify.
- Rows are **upserted, never deleted**. If a case disappears from the source
  it simply stops being updated (its `sync_run_at` stays frozen at the last
  run that saw it). This is deliberate so a transient source outage cannot
  wipe the cache.

### Tab: `epic_sync_meta`

Key/value pairs. Each row has `key`, `value`, `updated_at`. The sync always
writes the following keys on success:

```
status, reason,
last_success_started_at, last_success_finished_at, last_success_duration_ms,
last_success_pages, last_success_rows_fetched, last_success_rows_inserted,
last_success_rows_updated, last_success_skipped_no_casenumber,
last_success_hit_max_pages, last_success_source_last_edit_date,
last_success_disaster_type, last_success_sup_dist
```

On failure it writes:

```
status='failed', reason, last_failure_started_at, last_failure_finished_at,
last_failure_stage, last_failure_error, last_failure_partial,
last_failure_rows_fetched
```

`last_success_*` keys are **never cleared by a failure**, so the most
recent successful run is always visible.

---

## 5. API contract

All endpoints return JSON and set `Cache-Control: no-store`.

### `GET /api/epic/by-apn?apn=<value>`

APN can be raw (e.g. `5842-001-020`) or digits-only. Normalization happens
server-side.

Sample success:

```json
{
  "apn": "5842001020",
  "cases_rebuild": [
    {
      "casenumber": "BLDR2025-01234",
      "main_ain_raw": "5842-001-020",
      "main_ain_norm": "5842001020",
      "main_address": "123 Main St, Altadena",
      "workclass_name": "Residential Rebuild",
      "status": "Issued",
      "rebuild_progress": "Rebuild In Construction",
      "rebuild_progress_num": 6,
      "apply_date_iso": "2025-02-14T00:00:00.000Z",
      "issuance_date_iso": "2025-06-01T00:00:00.000Z",
      "last_inspection_date_iso": "2026-03-05T00:00:00.000Z",
      "permit_valuation": 450000,
      "struct_type_disp": "Single Family",
      "new_dwelling_units": 1,
      "description": "Rebuild after Eaton Fire",
      "css_link": "https://epicla.lacounty.gov/case/BLDR2025-01234",
      "disaster_type": "Eaton Fire (01-2025)",
      "sup_dist": "5",
      "is_temporary_housing": "FALSE",
      "suggested_stage_num": 3,
      "suggested_stage_label": "Stage 3 - Construction",
      "suggestion_confidence": "high",
      "suggestion_reason": "Rebuild in construction (ordinal 6).",
      "sync_run_at": "2026-04-23T09:00:05.123Z",
      "objectid": "4451"
    }
  ],
  "cases_temp_housing": [],
  "suggested_stage": {
    "num": 3,
    "label": "Stage 3 - Construction",
    "source_casenumber": "BLDR2025-01234"
  },
  "suggestion_confidence": "high",
  "suggestion_reason": "Rebuild in construction (ordinal 6).",
  "last_synced_at": "2026-04-23T09:00:05.123Z",
  "counts": { "rebuild": 1, "temp_housing": 0, "total": 1 }
}
```

Empty-match response (still 200, no error):

```json
{
  "apn": "9999999999",
  "cases_rebuild": [],
  "cases_temp_housing": [],
  "suggested_stage": null,
  "suggestion_confidence": "low",
  "suggestion_reason": "No EPIC cases found for this APN.",
  "last_synced_at": "2026-04-23T09:00:05.123Z",
  "counts": { "rebuild": 0, "temp_housing": 0, "total": 0 }
}
```

Error responses:

| Status | Body | Reason |
|--------|------|--------|
| 400 | `{ "error": "apn_required" }` | `apn` query parameter missing |
| 503 | `{ "error": "epic_not_configured", "message": "…" }` | `EPIC_CACHE_SHEET_ID` not set |
| 500 | `{ "error": "epic_lookup_failed", "message": "…" }` | Sheets read failed |

### `POST /api/epic/by-apns`

Request:

```json
{ "apns": ["5842-001-020", "5842001021", "junk", null] }
```

Limits: max 500 APNs per call. Non-digit/blank inputs are dropped silently.

Response:

```json
{
  "last_synced_at": "2026-04-23T09:00:05.123Z",
  "count": 2,
  "results": {
    "5842001020": { /* same shape as by-apn */ },
    "5842001021": { /* ... */ }
  }
}
```

### `GET /api/epic/sync-status`

Returns the full `epic_sync_meta` key/value map plus a `_config` block
showing which env vars are set. Safe to call without auth.

```json
{
  "configured": true,
  "status": "ok",
  "reason": "cli",
  "last_success_started_at": "2026-04-23T09:00:00.000Z",
  "last_success_finished_at": "2026-04-23T09:00:05.123Z",
  "last_success_rows_fetched": "312",
  "last_success_rows_inserted": "4",
  "last_success_rows_updated": "308",
  "last_success_source_last_edit_date": "1711200000000",
  "_config": {
    "feature_service_url_set": true,
    "cache_sheet_id_set": true,
    "cache_tab": "epic_cases",
    "meta_tab": "epic_sync_meta",
    "disaster_type": "Eaton Fire (01-2025)",
    "sup_dist": "5",
    "page_size": 2000
  },
  "_meta_updated_at": "2026-04-23T09:00:05.123Z"
}
```

### `POST /api/admin/sync-epic`

Manually trigger a sync. Authorized by EITHER:

- `?email=<admin>` query parameter where the email resolves to a user with
  `role: admin` in the user access sheet (matches the pattern used by
  `/api/admin/refresh-users`), OR
- `x-epic-sync-token: <token>` header matching `EPIC_SYNC_TOKEN`.

Response on success: 200 with the sync summary. On operational failure
(source down, etc.) returns 502 with the failure summary; the cache is
preserved.

---

## 6. Manual runbook

### First-time setup

1. Create a new Google Sheet (name suggestion: `EPIC-LA Cache`). Leave it empty.
2. Share it as **Editor** with the service account email used by the
   dashboard (see `SERVICE_ACCOUNT_SETUP.md`).
3. Copy the sheet ID from the URL (`…/spreadsheets/d/<ID>/edit`).
4. In Vercel (or `.env.local` for local dev) set:
   - `EPIC_FEATURE_SERVICE_URL=<layer URL>`
   - `EPIC_CACHE_SHEET_ID=<ID from step 3>`
5. (Optional) Set `EPIC_SYNC_TOKEN` to a long random string if you want to
   trigger sync from a scheduler without admin login.
6. Run the first sync:
   ```bash
   npm run sync:epic
   ```
   Expected output ends with `[epic-sync] ok inserted=<N> updated=0 duration_ms=<n>`.
7. Verify:
   - The sheet now has `epic_cases` and `epic_sync_meta` tabs.
   - `curl http://localhost:8000/api/epic/sync-status` shows `status: ok`.
   - Pick a known APN from the cache and hit
     `/api/epic/by-apn?apn=<apn>` — you should get that case back.

### Scheduling the daily sync

Three supported patterns — pick one.

**A. Vercel Cron** (easiest if dashboard is already on Vercel):

Add to `vercel.json`:

```json
{
  "crons": [
    { "path": "/api/admin/sync-epic", "schedule": "0 11 * * *" }
  ]
}
```

and set `EPIC_SYNC_TOKEN`. Then configure the cron caller to send the
`x-epic-sync-token` header (Vercel's built-in cron does not send custom
headers — use pattern B or C instead if you need header auth).

> Vercel crons hit the route via GET; our route is POST-only by design. Use
> pattern B or C below, or add a GET alias if your scheduler only does GET.

**B. External scheduler (GitHub Actions, Cloudflare Cron, etc.):**

This is the active production pattern for this repo.

```yaml
# .github/workflows/epic-sync.yml (example)
name: EPIC-LA daily sync
on:
  schedule:
    - cron: '0 11 * * *'  # 04:00 PT
jobs:
  sync:
    runs-on: ubuntu-latest
    steps:
      - name: Trigger sync
        run: |
          curl -fsS -X POST "https://<your-host>/api/admin/sync-epic" \
            -H "x-epic-sync-token: ${{ secrets.EPIC_SYNC_TOKEN }}"
```

**C. Local `cron` / Task Scheduler running `npm run sync:epic`** directly on
a box that has the service account credentials. Simplest to debug.

### Verifying a run

```bash
curl -s http://localhost:8000/api/epic/sync-status | jq .
```

Watch for:

- `status: ok`
- `last_success_finished_at` in the last 24h
- `last_success_rows_fetched` within the expected range
- `last_success_hit_max_pages: FALSE` (if `TRUE`, bump `EPIC_MAX_PAGES`)

### Forcing a cache rebuild

Just run `npm run sync:epic` again — it's idempotent. If you need to wipe
the cache first, open the sheet and delete the rows in `epic_cases` below
the header (leave the header). The next sync will repopulate.

### What to do if a sync fails

1. Check `sync-status` for `last_failure_stage` and `last_failure_error`.
2. If `stage = arcgis_fetch`: the source is unreachable or changed schema.
   The cache is untouched — dashboard reads continue to work from the last
   good data. No action needed until the source is back.
3. If `stage = cache_upsert`: sheet permissions or quota. Check that the
   service account still has Editor on `EPIC_CACHE_SHEET_ID`. Re-run the
   sync after fixing.
4. If `stage = ensureTabs`: the configured sheet ID is wrong, or the
   service account has no access at all.
5. If error mentions `Range ... exceeds grid limits` (for example row 1001):
   the `epic_cases` tab is too small. Expand the sheet row count (for example
   to 10,000+ rows) and re-run sync.

The `last_success_*` keys survive failures, so operators can see both the
last good run AND the most recent failure at the same time.

---

## 7. Test evidence

Run the suite:

```bash
npm run test:epic
```

Expected output (abbreviated):

```
ok 1 - normalizeApn: strips non-digits and preserves leading zeros
ok 2 - arcgisDateToIso: parses epoch-ms and rejects junk
ok 3 - isTemporaryHousing: detects temp housing from workclass/progress text
ok 4 - mapStage: respects guardrails from the integration plan
ok 5 - buildRecordFromArcgisAttrs + recordToRow/rowToRecord roundtrip
ok 6 - buildLookupPayload: splits rebuild vs temp, picks most-progressed headline
ok 7 - buildWhereClause: escapes single quotes safely
ok 8 - runSync: success path populates cache and writes ok meta
ok 9 - runSync: arcgis failure preserves existing cache and writes failure meta
# pass 9, fail 0
```

What each test covers:

| Test | Scope covered |
|------|---------------|
| 1 | APN normalization (hyphens, spaces, leading zeros, numeric input, nullish) |
| 2 | ArcGIS epoch-ms date parsing + rejection of junk |
| 3 | Temporary-housing detection from workclass or progress text |
| 4 | Stage-suggestion guardrails from the plan (never auto-suggest Stage 5, etc.) |
| 5 | Full normalization + cache row roundtrip (row → record → row) |
| 6 | Lookup payload: rebuild vs temp split, one-to-many APN picks "most progressed" headline, empty-state messaging |
| 7 | ArcGIS WHERE clause escaping (single quotes) |
| 8 | End-to-end sync: inserts on first run, upserts by casenumber on second run (1-to-many APN retrieval verified), batch lookup, APN-miss returns empty payload |
| 9 | Failure fallback: simulated ArcGIS outage leaves cache intact, status endpoint reports both last-success and last-failure |

---

## 8. Constraints honored

- No writes to captain/master sheets. EPIC cache sheet is a separate file.
- No client-side fetch of the full EPIC dataset. Only per-APN lookups.
- No automatic write of `suggested_stage_*` into any captain-owned column.
- No UI changes. Existing dashboard behavior is unchanged (`server.js` only
  gains the `registerEpicRoutes(...)` call).

### UI maintenance note (person quick tags)

In the details UI, the quick-tag checkbox **Subscribe to updates** maps to
the boolean person column `Wants_Updates` (plus tolerant header variants with
spaces or hyphens). Keep this mapping intact during sheet/header migrations.

'use strict';

// Tests for the EPIC-LA integration. Run with:
//   npm run test:epic
//
// Uses the built-in node:test runner (Node 18+). No external deps.
// Exercises pure logic (normalization, payload shaping) plus the sync
// orchestrator end-to-end using an in-memory Sheets fake.

const test = require('node:test');
const assert = require('node:assert');

const {
  normalizeApn,
  arcgisDateToIso,
  isTemporaryHousing,
  mapStage,
  buildRecordFromArcgisAttrs,
  recordToRow,
  rowToRecord,
  buildLookupPayload,
  CACHE_COLUMNS
} = require('../epic/normalize');

const { buildWhereClause } = require('../epic/arcgis');

// --- Pure helpers -----------------------------------------------------------

test('normalizeApn: strips non-digits and preserves leading zeros', () => {
  assert.strictEqual(normalizeApn('5842-001-020'), '5842001020');
  assert.strictEqual(normalizeApn('  5842 001 020 '), '5842001020');
  assert.strictEqual(normalizeApn('0058-42-007'), '005842007');
  assert.strictEqual(normalizeApn(5842001020), '5842001020');
  assert.strictEqual(normalizeApn(null), '');
  assert.strictEqual(normalizeApn(''), '');
  assert.strictEqual(normalizeApn('APN only'), '');
});

test('arcgisDateToIso: parses epoch-ms and rejects junk', () => {
  assert.strictEqual(arcgisDateToIso(1704067200000), '2024-01-01T00:00:00.000Z');
  assert.strictEqual(arcgisDateToIso('1704067200000'), '2024-01-01T00:00:00.000Z');
  assert.strictEqual(arcgisDateToIso(''), '');
  assert.strictEqual(arcgisDateToIso(null), '');
  assert.strictEqual(arcgisDateToIso('not a date'), '');
  assert.strictEqual(arcgisDateToIso(-1), '');
});

test('isTemporaryHousing: detects temp housing from workclass/progress text', () => {
  assert.strictEqual(isTemporaryHousing('Temporary Housing - Trailer', ''), true);
  assert.strictEqual(isTemporaryHousing('', 'Temporary Housing - Installed'), true);
  assert.strictEqual(isTemporaryHousing('Residential Rebuild', 'Building Permits Issued'), false);
  assert.strictEqual(isTemporaryHousing('', ''), false);
});

test('mapStage: respects guardrails from the integration plan', () => {
  const temp = mapStage({ isTempHousing: true });
  assert.strictEqual(temp.num, null);
  assert.match(temp.label, /Temporary Housing/);

  const construction = mapStage({ isTempHousing: false, rebuildProgress: 'Rebuild In Construction' });
  assert.strictEqual(construction.num, 3);
  assert.strictEqual(construction.confidence, 'high');

  const permits = mapStage({ isTempHousing: false, rebuildProgress: 'Building Permits Issued' });
  assert.strictEqual(permits.num, 2);
  assert.strictEqual(permits.confidence, 'medium');

  const completed = mapStage({ isTempHousing: false, rebuildProgress: 'Construction Completed' });
  // Plan guardrail: never auto-suggest Stage 5.
  assert.notStrictEqual(completed.num, 5);
  assert.strictEqual(completed.num, 4);

  const unknown = mapStage({ isTempHousing: false, rebuildProgress: 'Something Weird' });
  assert.strictEqual(unknown.num, null);
  assert.strictEqual(unknown.confidence, 'low');
});

test('buildRecordFromArcgisAttrs + recordToRow/rowToRecord roundtrip', () => {
  const attrs = {
    OBJECTID: 42,
    CASENUMBER: 'CASE-123',
    MAIN_AIN: '5842-001-020',
    MAIN_ADDRESS: '123 Main St',
    WORKCLASS_NAME: 'Residential Rebuild',
    STATUS: 'Issued',
    REBUILD_PROGRESS: 'Rebuild In Construction',
    APPLY_DATE: 1704067200000,
    ISSUANCE_DATE: null,
    LAST_INSPECTION_DATE: 1706659200000,
    PERMIT_VALUATION: 450000,
    STRUCT_TYPE_DISP: 'Single Family',
    NEW_DWELLING_UNITS: 1,
    DESCRIPTION: 'Rebuild after Eaton Fire',
    CSSLINK: 'https://epicla.lacounty.gov/case/123',
    DISASTER_TYPE: 'Eaton Fire (01-2025)',
    SUP_DIST: '5'
  };
  const syncAt = '2026-04-23T00:00:00.000Z';
  const rec = buildRecordFromArcgisAttrs(attrs, syncAt);

  assert.strictEqual(rec.main_ain_norm, '5842001020');
  assert.strictEqual(rec.main_ain_raw, '5842-001-020');
  assert.strictEqual(rec.is_temporary_housing, 'FALSE');
  assert.strictEqual(rec.suggested_stage_num, 3);
  assert.strictEqual(rec.apply_date_iso, '2024-01-01T00:00:00.000Z');
  assert.strictEqual(rec.issuance_date_iso, '');
  assert.strictEqual(rec.sync_run_at, syncAt);

  const row = recordToRow(rec);
  assert.strictEqual(row.length, CACHE_COLUMNS.length);
  const back = rowToRecord(row);
  assert.strictEqual(back.casenumber, 'CASE-123');
  assert.strictEqual(back.main_ain_norm, '5842001020');
  assert.strictEqual(String(back.suggested_stage_num), '3');
});

test('buildLookupPayload: splits rebuild vs temp, picks most-progressed headline', () => {
  const sync = '2026-04-22T12:00:00.000Z';
  const r1 = buildRecordFromArcgisAttrs(
    { CASENUMBER: 'A', MAIN_AIN: '111222333', WORKCLASS_NAME: 'Residential Rebuild', REBUILD_PROGRESS: 'Building Plans Approved' },
    sync
  );
  const r2 = buildRecordFromArcgisAttrs(
    { CASENUMBER: 'B', MAIN_AIN: '111222333', WORKCLASS_NAME: 'Residential Rebuild', REBUILD_PROGRESS: 'Rebuild In Construction' },
    sync
  );
  const r3 = buildRecordFromArcgisAttrs(
    { CASENUMBER: 'C', MAIN_AIN: '111222333', WORKCLASS_NAME: 'Temporary Housing - RV' },
    sync
  );

  const payload = buildLookupPayload([r1, r2, r3], { apnNorm: '111222333', lastSyncedAt: sync });
  assert.strictEqual(payload.counts.rebuild, 2);
  assert.strictEqual(payload.counts.temp_housing, 1);
  assert.strictEqual(payload.counts.total, 3);
  assert.ok(payload.suggested_stage);
  assert.strictEqual(payload.suggested_stage.source_casenumber, 'B');
  assert.strictEqual(payload.suggested_stage.num, 3);
  assert.strictEqual(payload.last_synced_at, sync);

  const empty = buildLookupPayload([], { apnNorm: '999888777' });
  assert.strictEqual(empty.suggested_stage, null);
  assert.strictEqual(empty.counts.total, 0);
  assert.match(empty.suggestion_reason, /No EPIC cases/);
});

test('buildWhereClause: escapes single quotes safely', () => {
  const where = buildWhereClause({ disasterType: `Eaton's Fire`, supDist: '5' });
  assert.ok(where.includes(`DISASTER_TYPE='Eaton''s Fire'`), `got: ${where}`);
  assert.ok(where.includes(`SUP_DIST='5'`));
});

// --- Sync orchestrator with an in-memory Sheets fake ------------------------

function makeSheetsFake(initial = {}) {
  // initial is { [tabName]: [[row],[row]] }. First row treated as header.
  const tabs = {};
  for (const [name, rows] of Object.entries(initial)) {
    tabs[name] = rows.map((r) => r.slice());
  }

  function parseRange(range) {
    const m = range.match(/^([^!]+)!(.+)$/);
    if (!m) return { tab: range, cell: null };
    return { tab: m[1], cell: m[2] };
  }

  function ensureTab(tab) {
    if (!tabs[tab]) tabs[tab] = [];
    return tabs[tab];
  }

  function columnLetterToIndex(letter) {
    let n = 0;
    for (const ch of letter.toUpperCase()) n = n * 26 + (ch.charCodeAt(0) - 64);
    return n - 1;
  }

  function writeRange(range, values) {
    const { tab, cell } = parseRange(range);
    const rows = ensureTab(tab);
    // Accept forms: "A1:ZZ1", "A2:ZZ", "1:1", "A:A" etc. We only need to
    // handle the subset our cache module actually emits.
    let startRow = 0; // 0-based
    let startCol = 0;
    const m = cell.match(/^([A-Z]+)?(\d+)?(?::([A-Z]+)?(\d+)?)?$/i);
    if (m) {
      if (m[1]) startCol = columnLetterToIndex(m[1]);
      if (m[2]) startRow = Number.parseInt(m[2], 10) - 1;
    }
    for (let i = 0; i < values.length; i++) {
      const targetRow = startRow + i;
      while (rows.length <= targetRow) rows.push([]);
      const row = rows[targetRow];
      for (let j = 0; j < values[i].length; j++) {
        while (row.length <= startCol + j) row.push('');
        row[startCol + j] = values[i][j];
      }
    }
  }

  function readRange(range) {
    const { tab, cell } = parseRange(range);
    const rows = tabs[tab] || [];
    if (!cell) return rows.map((r) => r.slice());
    // Handle "1:1" (header), "A2:<L>", "A:A".
    const headerMatch = cell.match(/^(\d+):(\d+)$/);
    if (headerMatch) {
      const idx = Number.parseInt(headerMatch[1], 10) - 1;
      return rows[idx] ? [rows[idx].slice()] : [];
    }
    const colAMatch = cell.match(/^([A-Z]+):([A-Z]+)$/i);
    if (colAMatch) {
      const colIdx = columnLetterToIndex(colAMatch[1]);
      return rows.map((r) => [r[colIdx] == null ? '' : r[colIdx]]);
    }
    const rangeMatch = cell.match(/^([A-Z]+)(\d+):([A-Z]+)(\d*)$/i);
    if (rangeMatch) {
      const startRow = Number.parseInt(rangeMatch[2], 10) - 1;
      const endRow = rangeMatch[4] ? Number.parseInt(rangeMatch[4], 10) - 1 : rows.length - 1;
      const startCol = columnLetterToIndex(rangeMatch[1]);
      const endCol = columnLetterToIndex(rangeMatch[3]);
      const out = [];
      for (let i = startRow; i <= endRow; i++) {
        if (!rows[i]) continue;
        const slice = [];
        for (let j = startCol; j <= endCol; j++) slice.push(rows[i][j] == null ? '' : rows[i][j]);
        out.push(slice);
      }
      return out;
    }
    return rows.map((r) => r.slice());
  }

  const client = {
    _tabs: tabs,
    spreadsheets: {
      get: async () => ({
        data: { sheets: Object.keys(tabs).map((title) => ({ properties: { title, sheetId: title.length } })) }
      }),
      batchUpdate: async ({ requestBody }) => {
        const reqs = (requestBody && requestBody.requests) || [];
        for (const r of reqs) {
          if (r.addSheet && r.addSheet.properties && r.addSheet.properties.title) {
            ensureTab(r.addSheet.properties.title);
          }
        }
        return { data: {} };
      },
      values: {
        get: async ({ range }) => ({ data: { values: readRange(range) } }),
        update: async ({ range, requestBody }) => {
          writeRange(range, (requestBody && requestBody.values) || []);
          return { data: {} };
        },
        batchUpdate: async ({ requestBody }) => {
          for (const entry of ((requestBody && requestBody.data) || [])) {
            writeRange(entry.range, entry.values || []);
          }
          return { data: {} };
        },
        append: async () => ({ data: {} })
      }
    }
  };

  return client;
}

test('runSync: success path populates cache and writes ok meta', async (t) => {
  // Patch env and arcgis client so we don't hit the network.
  process.env.EPIC_FEATURE_SERVICE_URL = 'https://fake/FeatureServer/0';
  process.env.EPIC_CACHE_SHEET_ID = 'FAKE_SHEET';

  const arcgisModule = require('../epic/arcgis');
  const origFetchAll = arcgisModule.fetchAllEpicFeatures;
  const origFetchMeta = arcgisModule.fetchLayerMetadata;
  arcgisModule.fetchAllEpicFeatures = async () => ({
    features: [
      { attributes: { CASENUMBER: 'C-1', MAIN_AIN: '111-222-333', WORKCLASS_NAME: 'Residential Rebuild', REBUILD_PROGRESS: 'Rebuild In Construction' } },
      { attributes: { CASENUMBER: 'C-2', MAIN_AIN: '444555666', WORKCLASS_NAME: 'Temporary Housing - RV' } }
    ],
    pages: 1,
    hitMaxPages: false
  });
  arcgisModule.fetchLayerMetadata = async () => ({ lastEditDate: 1711200000000 });
  t.after(() => {
    arcgisModule.fetchAllEpicFeatures = origFetchAll;
    arcgisModule.fetchLayerMetadata = origFetchMeta;
  });

  // Reload sync module fresh (config reads env at call time, so reload not
  // strictly required, but lookup cache needs clearing for later tests).
  delete require.cache[require.resolve('../epic/sync')];
  delete require.cache[require.resolve('../epic/lookup')];
  const { runSync } = require('../epic/sync');
  const { lookupByApn, lookupByApns, clearCache } = require('../epic/lookup');
  clearCache();

  const sheetsClient = makeSheetsFake();
  const summary = await runSync({ sheetsClient, logger: { log() {}, error() {} } });

  assert.strictEqual(summary.status, 'ok');
  assert.strictEqual(summary.rows_fetched, 2);
  assert.strictEqual(summary.inserted, 2);
  assert.strictEqual(summary.updated, 0);

  // One-to-one APN retrieval returns normalized payload with suggestion.
  const one = await lookupByApn({ sheetsClient, apn: '111-222-333' });
  assert.strictEqual(one.counts.rebuild, 1);
  assert.strictEqual(one.suggested_stage.num, 3);
  assert.strictEqual(one.apn, '111222333');

  // Unknown APN returns empty payload (not an error).
  clearCache();
  const none = await lookupByApn({ sheetsClient, apn: '999-999-999' });
  assert.strictEqual(none.counts.total, 0);
  assert.strictEqual(none.suggested_stage, null);

  // Run again with updated data: one existing case should be UPDATED, not
  // re-inserted, proving upsert by casenumber.
  arcgisModule.fetchAllEpicFeatures = async () => ({
    features: [
      { attributes: { CASENUMBER: 'C-1', MAIN_AIN: '111-222-333', WORKCLASS_NAME: 'Residential Rebuild', REBUILD_PROGRESS: 'Construction Completed' } },
      { attributes: { CASENUMBER: 'C-3', MAIN_AIN: '777888999', WORKCLASS_NAME: 'Residential Rebuild', REBUILD_PROGRESS: 'Building Permits Issued' } }
    ],
    pages: 1,
    hitMaxPages: false
  });
  clearCache();
  const summary2 = await runSync({ sheetsClient, logger: { log() {}, error() {} } });
  assert.strictEqual(summary2.status, 'ok');
  assert.strictEqual(summary2.updated, 1, 'C-1 should be updated');
  assert.strictEqual(summary2.inserted, 1, 'C-3 should be inserted');

  clearCache();
  const updated = await lookupByApn({ sheetsClient, apn: '111222333' });
  assert.strictEqual(updated.cases_rebuild[0].rebuild_progress, 'Construction Completed');
  assert.strictEqual(updated.suggested_stage.num, 4);

  // Batch lookup returns keyed results for each requested APN.
  clearCache();
  const batch = await lookupByApns({ sheetsClient, apns: ['111-222-333', '777-888-999', 'not-an-apn'] });
  assert.strictEqual(Object.keys(batch.results).length, 2);
  assert.ok(batch.results['111222333']);
  assert.ok(batch.results['777888999']);
});

test('runSync: arcgis failure preserves existing cache and writes failure meta', async (t) => {
  process.env.EPIC_FEATURE_SERVICE_URL = 'https://fake/FeatureServer/0';
  process.env.EPIC_CACHE_SHEET_ID = 'FAKE_SHEET';

  const arcgisModule = require('../epic/arcgis');
  const origFetchAll = arcgisModule.fetchAllEpicFeatures;
  const origFetchMeta = arcgisModule.fetchLayerMetadata;
  arcgisModule.fetchLayerMetadata = async () => ({ lastEditDate: null });
  t.after(() => {
    arcgisModule.fetchAllEpicFeatures = origFetchAll;
    arcgisModule.fetchLayerMetadata = origFetchMeta;
  });

  delete require.cache[require.resolve('../epic/sync')];
  delete require.cache[require.resolve('../epic/lookup')];
  const { runSync, readSyncStatus } = require('../epic/sync');
  const { lookupByApn, clearCache } = require('../epic/lookup');
  clearCache();

  // First, seed a successful sync.
  arcgisModule.fetchAllEpicFeatures = async () => ({
    features: [
      { attributes: { CASENUMBER: 'C-100', MAIN_AIN: '555-666-777', WORKCLASS_NAME: 'Residential Rebuild', REBUILD_PROGRESS: 'Rebuild In Construction' } }
    ],
    pages: 1,
    hitMaxPages: false
  });

  const sheetsClient = makeSheetsFake();
  const ok = await runSync({ sheetsClient, logger: { log() {}, error() {} } });
  assert.strictEqual(ok.status, 'ok');

  // Now simulate the source failing.
  arcgisModule.fetchAllEpicFeatures = async () => { throw new Error('upstream 502'); };
  const failed = await runSync({ sheetsClient, logger: { log() {}, error() {} } });
  assert.strictEqual(failed.status, 'failed');
  assert.strictEqual(failed.stage, 'arcgis_fetch');
  assert.strictEqual(failed.cache_preserved, true);

  // The cache should still serve the previous record.
  clearCache();
  const stillThere = await lookupByApn({ sheetsClient, apn: '555666777' });
  assert.strictEqual(stillThere.counts.rebuild, 1, 'cache must be preserved after source failure');
  assert.strictEqual(stillThere.cases_rebuild[0].casenumber, 'C-100');

  // Status should reflect both the last success AND the last failure so
  // operators can see what happened.
  const status = await readSyncStatus({ sheetsClient });
  assert.strictEqual(status.status, 'failed');
  assert.match(status.last_failure_error || '', /upstream 502/);
  assert.ok(status.last_success_finished_at, 'last_success_* should persist across failure');
});

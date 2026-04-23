'use strict';

// Sync orchestrator for EPIC-LA.
//
// Responsibilities:
//   1. Pull filtered EPIC-LA rows from ArcGIS (paginated, stable order).
//   2. Normalize each row and compute derived fields.
//   3. Upsert into the EPIC cache sheet keyed by casenumber.
//   4. Write run metadata to the meta tab (success or failure).
//
// Critical resilience rule: if the source fails, we do NOT touch the cache.
// The last good cache is preserved and a failure record is written to the
// meta tab so the status endpoint surfaces it clearly.

const { getEpicConfig, assertSyncConfig } = require('./config');
// Import arcgis as a namespace so tests can monkey-patch individual calls.
const arcgis = require('./arcgis');
const { buildRecordFromArcgisAttrs } = require('./normalize');
const { ensureTabs, upsertRecords, writeMeta, readMeta } = require('./cache');

// Run one sync. Accepts an injected sheets client (so server code and CLI
// share the same path) and an optional logger (defaults to console).
//
// Returns a summary object describing what happened. Throws only on
// config errors - operational failures are captured and returned in the
// summary with status='failed' so callers can render them.
async function runSync({ sheetsClient, logger = console, reason = 'manual' } = {}) {
  if (!sheetsClient) throw new Error('runSync requires a sheetsClient (googleapis Sheets v4).');

  const cfg = getEpicConfig();
  assertSyncConfig(cfg);

  const startedAt = new Date();
  const startedAtIso = startedAt.toISOString();
  logger.log(`[epic-sync] start reason=${reason} at=${startedAtIso}`);

  // 1) Make sure cache tabs exist. This is safe to run every time.
  try {
    await ensureTabs(sheetsClient, cfg.cacheSheetId, {
      cacheTab: cfg.cacheTab,
      metaTab: cfg.metaTab
    });
  } catch (err) {
    const msg = `Failed to ensure EPIC cache tabs: ${err.message}`;
    logger.error(`[epic-sync] ${msg}`);
    await safeWriteFailureMeta(sheetsClient, cfg, {
      reason,
      startedAtIso,
      stage: 'ensureTabs',
      error: msg
    });
    return {
      status: 'failed',
      stage: 'ensureTabs',
      error: msg,
      started_at: startedAtIso,
      finished_at: new Date().toISOString()
    };
  }

  // 2) Pull from ArcGIS.
  let features = [];
  let pages = 0;
  let hitMaxPages = false;
  let layerMeta = null;
  try {
    layerMeta = await arcgis.fetchLayerMetadata(cfg);
    const result = await arcgis.fetchAllEpicFeatures(cfg);
    features = result.features;
    pages = result.pages;
    hitMaxPages = result.hitMaxPages;
  } catch (err) {
    const msg = `ArcGIS fetch failed: ${err.message}`;
    logger.error(`[epic-sync] ${msg}`);
    await safeWriteFailureMeta(sheetsClient, cfg, {
      reason,
      startedAtIso,
      stage: 'arcgis_fetch',
      error: msg
    });
    return {
      status: 'failed',
      stage: 'arcgis_fetch',
      error: msg,
      started_at: startedAtIso,
      finished_at: new Date().toISOString(),
      pages,
      cache_preserved: true
    };
  }

  logger.log(`[epic-sync] fetched ${features.length} features across ${pages} page(s)`);

  // 3) Normalize.
  const syncRunAtIso = new Date().toISOString();
  const records = [];
  const skippedNoCasenumber = [];
  for (const f of features) {
    const attrs = (f && f.attributes) || {};
    const rec = buildRecordFromArcgisAttrs(attrs, syncRunAtIso);
    if (!rec.casenumber) {
      skippedNoCasenumber.push(attrs.OBJECTID);
      continue;
    }
    records.push(rec);
  }

  // 4) Upsert. If this throws, we partially wrote - but existing rows not
  //    touched in this partial run are still valid, so we don't try to
  //    roll back. We surface the error clearly in meta.
  let upsertResult = { inserted: 0, updated: 0 };
  try {
    upsertResult = await upsertRecords(sheetsClient, cfg.cacheSheetId, cfg.cacheTab, records);
  } catch (err) {
    const msg = `Cache upsert failed: ${err.message}`;
    logger.error(`[epic-sync] ${msg}`);
    await safeWriteFailureMeta(sheetsClient, cfg, {
      reason,
      startedAtIso,
      stage: 'cache_upsert',
      error: msg,
      partial: true,
      rowsFetched: features.length
    });
    return {
      status: 'failed',
      stage: 'cache_upsert',
      error: msg,
      started_at: startedAtIso,
      finished_at: new Date().toISOString(),
      pages,
      rows_fetched: features.length,
      inserted: upsertResult.inserted,
      updated: upsertResult.updated,
      cache_preserved: 'partial'
    };
  }

  const finishedAt = new Date();
  const finishedAtIso = finishedAt.toISOString();
  const durationMs = finishedAt - startedAt;

  // 5) Write success meta. Keep last_failure_* fields untouched on success
  //    so operators can still see the previous failure context for one run.
  await writeMeta(sheetsClient, cfg.cacheSheetId, cfg.metaTab, {
    status: 'ok',
    reason,
    last_success_started_at: startedAtIso,
    last_success_finished_at: finishedAtIso,
    last_success_duration_ms: String(durationMs),
    last_success_pages: String(pages),
    last_success_rows_fetched: String(features.length),
    last_success_rows_inserted: String(upsertResult.inserted),
    last_success_rows_updated: String(upsertResult.updated),
    last_success_skipped_no_casenumber: String(skippedNoCasenumber.length),
    last_success_hit_max_pages: hitMaxPages ? 'TRUE' : 'FALSE',
    last_success_source_last_edit_date: layerMeta && layerMeta.lastEditDate ? String(layerMeta.lastEditDate) : '',
    last_success_disaster_type: cfg.disasterType,
    last_success_sup_dist: cfg.supDist
  });

  logger.log(`[epic-sync] ok inserted=${upsertResult.inserted} updated=${upsertResult.updated} duration_ms=${durationMs}`);

  return {
    status: 'ok',
    started_at: startedAtIso,
    finished_at: finishedAtIso,
    duration_ms: durationMs,
    pages,
    rows_fetched: features.length,
    inserted: upsertResult.inserted,
    updated: upsertResult.updated,
    skipped_no_casenumber: skippedNoCasenumber.length,
    hit_max_pages: hitMaxPages,
    source_last_edit_date: layerMeta && layerMeta.lastEditDate ? layerMeta.lastEditDate : null,
    reason
  };
}

async function safeWriteFailureMeta(sheets, cfg, { reason, startedAtIso, stage, error, partial = false, rowsFetched = 0 }) {
  try {
    await writeMeta(sheets, cfg.cacheSheetId, cfg.metaTab, {
      status: 'failed',
      reason,
      last_failure_started_at: startedAtIso,
      last_failure_finished_at: new Date().toISOString(),
      last_failure_stage: stage,
      last_failure_error: error,
      last_failure_partial: partial ? 'TRUE' : 'FALSE',
      last_failure_rows_fetched: String(rowsFetched)
    });
  } catch (metaErr) {
    // Last resort - we cannot even write meta. Log loudly; do not throw
    // because the failure record is advisory.
    console.error('[epic-sync] CRITICAL: failed to write failure metadata:', metaErr.message);
  }
}

// Read sync status from the meta tab. Returns a plain object; empty if none.
async function readSyncStatus({ sheetsClient } = {}) {
  if (!sheetsClient) throw new Error('readSyncStatus requires a sheetsClient.');
  const cfg = getEpicConfig();
  if (!cfg.cacheSheetId) {
    return {
      configured: false,
      message: 'EPIC_CACHE_SHEET_ID not set. See EPIC_RUNBOOK.md.'
    };
  }
  const map = await readMeta(sheetsClient, cfg.cacheSheetId, cfg.metaTab).catch(() => ({}));
  const out = { configured: true };
  for (const [k, v] of Object.entries(map)) {
    out[k] = v.value;
  }
  out._meta_updated_at = mostRecentUpdatedAt(map);
  return out;
}

function mostRecentUpdatedAt(map) {
  let max = '';
  for (const { updated_at } of Object.values(map)) {
    if (updated_at && updated_at > max) max = updated_at;
  }
  return max;
}

module.exports = {
  runSync,
  readSyncStatus
};

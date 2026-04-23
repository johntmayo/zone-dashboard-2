'use strict';

// Central config/envar parser for the EPIC-LA integration.
// Reads everything from process.env so nothing operational is hardcoded.
// All callers go through this module so behavior is consistent.

function strEnv(name, fallback = '') {
  const value = process.env[name];
  if (value == null) return fallback;
  return String(value).trim();
}

function intEnv(name, fallback) {
  const raw = strEnv(name, '');
  if (!raw) return fallback;
  const n = Number.parseInt(raw, 10);
  return Number.isFinite(n) ? n : fallback;
}

function getEpicConfig() {
  // ArcGIS FeatureServer layer URL. Example format:
  //   https://<host>/arcgis/rest/services/<Service>/FeatureServer/0
  // Left blank by default so the sync refuses to run until an operator sets it.
  const featureServiceUrl = strEnv('EPIC_FEATURE_SERVICE_URL', '');

  const disasterType = strEnv('EPIC_DISASTER_TYPE', 'Eaton Fire (01-2025)');
  const supDist = strEnv('EPIC_SUP_DIST', '5');

  // Google Sheet used as the EPIC cache. Intentionally separate from any
  // captain/master operational sheet so EPIC data never pollutes them.
  const cacheSheetId = strEnv('EPIC_CACHE_SHEET_ID', '');
  const cacheTab = strEnv('EPIC_CACHE_TAB', 'epic_cases');
  const metaTab = strEnv('EPIC_META_TAB', 'epic_sync_meta');

  // Source fields we request from ArcGIS. Using explicit list (not `*`)
  // keeps payloads smaller and the contract stable if the source grows new
  // columns. `OBJECTID` is added for diagnostics.
  const outFields = [
    'OBJECTID',
    'CASENUMBER',
    'MAIN_AIN',
    'MAIN_ADDRESS',
    'WORKCLASS_NAME',
    'STATUS',
    'REBUILD_PROGRESS',
    'APPLY_DATE',
    'ISSUANCE_DATE',
    'LAST_INSPECTION_DATE',
    'PERMIT_VALUATION',
    'STRUCT_TYPE_DISP',
    'NEW_DWELLING_UNITS',
    'DESCRIPTION',
    'CSSLINK',
    'DISASTER_TYPE',
    'SUP_DIST'
  ];

  const pageSize = intEnv('EPIC_PAGE_SIZE', 2000);
  const fetchTimeoutMs = intEnv('EPIC_FETCH_TIMEOUT_MS', 30000);
  const maxPages = intEnv('EPIC_MAX_PAGES', 100); // safety cap

  // Optional bearer token for cron-style manual trigger without admin email.
  const syncToken = strEnv('EPIC_SYNC_TOKEN', '');

  // Short in-memory read cache for lookup endpoints to avoid hammering Sheets.
  const lookupCacheTtlMs = intEnv('EPIC_LOOKUP_CACHE_TTL_MS', 60_000);

  return {
    featureServiceUrl,
    disasterType,
    supDist,
    cacheSheetId,
    cacheTab,
    metaTab,
    outFields,
    pageSize,
    fetchTimeoutMs,
    maxPages,
    syncToken,
    lookupCacheTtlMs
  };
}

function assertSyncConfig(cfg) {
  const missing = [];
  if (!cfg.featureServiceUrl) missing.push('EPIC_FEATURE_SERVICE_URL');
  if (!cfg.cacheSheetId) missing.push('EPIC_CACHE_SHEET_ID');
  if (missing.length) {
    const err = new Error(
      `EPIC sync not configured. Set env var(s): ${missing.join(', ')}. ` +
      `See EPIC_RUNBOOK.md for setup.`
    );
    err.code = 'EPIC_NOT_CONFIGURED';
    throw err;
  }
}

function assertReadConfig(cfg) {
  if (!cfg.cacheSheetId) {
    const err = new Error(
      'EPIC cache is not configured. Set EPIC_CACHE_SHEET_ID. See EPIC_RUNBOOK.md.'
    );
    err.code = 'EPIC_NOT_CONFIGURED';
    throw err;
  }
}

module.exports = {
  getEpicConfig,
  assertSyncConfig,
  assertReadConfig
};

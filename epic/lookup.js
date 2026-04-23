'use strict';

// APN lookup layer on top of the cache sheet. Keeps a short in-memory TTL
// cache so rapid repeated UI calls for different APNs don't hammer Sheets.

const { getEpicConfig, assertReadConfig } = require('./config');
const { readAllRecords, readMeta } = require('./cache');
const { normalizeApn, buildLookupPayload } = require('./normalize');

let cached = null; // { expiresAt, records, byApn, lastSyncedAt }

function clearCache() {
  cached = null;
}

async function loadCache({ sheetsClient }) {
  const cfg = getEpicConfig();
  assertReadConfig(cfg);

  const now = Date.now();
  if (cached && cached.expiresAt > now) return cached;

  const [{ records }, meta] = await Promise.all([
    readAllRecords(sheetsClient, cfg.cacheSheetId, cfg.cacheTab),
    readMeta(sheetsClient, cfg.cacheSheetId, cfg.metaTab).catch(() => ({}))
  ]);

  const byApn = new Map();
  for (const rec of records) {
    const apn = String(rec.main_ain_norm || '').trim();
    if (!apn) continue;
    if (!byApn.has(apn)) byApn.set(apn, []);
    byApn.get(apn).push(rec);
  }

  cached = {
    expiresAt: now + cfg.lookupCacheTtlMs,
    records,
    byApn,
    lastSyncedAt: (meta.last_success_finished_at && meta.last_success_finished_at.value) || ''
  };
  return cached;
}

// Look up cases by a single APN value (raw or normalized).
async function lookupByApn({ sheetsClient, apn }) {
  const { byApn, lastSyncedAt } = await loadCache({ sheetsClient });
  const apnNorm = normalizeApn(apn);
  const records = apnNorm ? (byApn.get(apnNorm) || []) : [];
  return buildLookupPayload(records, { apnNorm, lastSyncedAt });
}

// Batch lookup. Returns a keyed object { "<normalized_apn>": payload, ... }.
// Missing APNs still return a payload so the client never has to second-guess.
async function lookupByApns({ sheetsClient, apns }) {
  const { byApn, lastSyncedAt } = await loadCache({ sheetsClient });
  const out = {};
  const seen = new Set();
  for (const raw of (apns || [])) {
    const apnNorm = normalizeApn(raw);
    if (!apnNorm || seen.has(apnNorm)) continue;
    seen.add(apnNorm);
    const records = byApn.get(apnNorm) || [];
    out[apnNorm] = buildLookupPayload(records, { apnNorm, lastSyncedAt });
  }
  return {
    last_synced_at: lastSyncedAt || '',
    count: Object.keys(out).length,
    results: out
  };
}

module.exports = {
  loadCache,
  lookupByApn,
  lookupByApns,
  clearCache
};

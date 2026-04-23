'use strict';

// Express route registration for EPIC-LA endpoints.
//
// Endpoints (all under /api/epic and /api/admin):
//   GET  /api/epic/by-apn?apn=<value>            → cases + suggestion for one APN
//   POST /api/epic/by-apns                       → { apns: [...] } → keyed result
//   GET  /api/epic/sync-status                   → last run metadata
//   POST /api/admin/sync-epic?email=<admin>      → manual sync trigger (admin)
//     - OR header x-epic-sync-token matching EPIC_SYNC_TOKEN (for cron/CI)
//
// This file is injected into server.js via `registerEpicRoutes(app, deps)`
// so we don't reach into server internals. Keeps server.js as the single
// place that knows about auth helpers.

const { runSync, readSyncStatus } = require('./sync');
const { lookupByApn, lookupByApns, clearCache } = require('./lookup');
const { normalizeApn } = require('./normalize');
const { getEpicConfig } = require('./config');

function registerEpicRoutes(app, deps) {
  const { getSheetsClient, isAdminEmail } = deps;
  if (typeof getSheetsClient !== 'function') {
    throw new Error('registerEpicRoutes: deps.getSheetsClient is required');
  }

  app.get('/api/epic/by-apn', async (req, res) => {
    const apn = String((req.query && req.query.apn) || '').trim();
    if (!apn) return res.status(400).json({ error: 'apn_required' });
    try {
      const sheetsClient = await getSheetsClient();
      const payload = await lookupByApn({ sheetsClient, apn });
      res.set('Cache-Control', 'no-store');
      return res.json(payload);
    } catch (err) {
      if (err && err.code === 'EPIC_NOT_CONFIGURED') {
        return res.status(503).json({ error: 'epic_not_configured', message: err.message });
      }
      console.error('[epic] by-apn error:', err.message);
      return res.status(500).json({ error: 'epic_lookup_failed', message: err.message });
    }
  });

  app.post('/api/epic/by-apns', async (req, res) => {
    const body = req.body || {};
    const apns = Array.isArray(body.apns) ? body.apns : null;
    if (!apns) return res.status(400).json({ error: 'apns_array_required' });
    if (apns.length > 500) return res.status(400).json({ error: 'too_many_apns', message: 'Max 500 APNs per request.' });
    try {
      const sheetsClient = await getSheetsClient();
      const payload = await lookupByApns({ sheetsClient, apns });
      res.set('Cache-Control', 'no-store');
      return res.json(payload);
    } catch (err) {
      if (err && err.code === 'EPIC_NOT_CONFIGURED') {
        return res.status(503).json({ error: 'epic_not_configured', message: err.message });
      }
      console.error('[epic] by-apns error:', err.message);
      return res.status(500).json({ error: 'epic_lookup_failed', message: err.message });
    }
  });

  app.get('/api/epic/sync-status', async (req, res) => {
    try {
      const sheetsClient = await getSheetsClient().catch(() => null);
      if (!sheetsClient) {
        return res.status(503).json({
          configured: false,
          message: 'Sheets client not available (check service account credentials).'
        });
      }
      const status = await readSyncStatus({ sheetsClient });
      const cfg = getEpicConfig();
      status._config = {
        feature_service_url_set: Boolean(cfg.featureServiceUrl),
        cache_sheet_id_set: Boolean(cfg.cacheSheetId),
        cache_tab: cfg.cacheTab,
        meta_tab: cfg.metaTab,
        disaster_type: cfg.disasterType,
        sup_dist: cfg.supDist,
        page_size: cfg.pageSize
      };
      res.set('Cache-Control', 'no-store');
      return res.json(status);
    } catch (err) {
      console.error('[epic] sync-status error:', err.message);
      return res.status(500).json({ error: 'epic_status_failed', message: err.message });
    }
  });

  app.post('/api/admin/sync-epic', async (req, res) => {
    const tokenHeader = String(req.headers['x-epic-sync-token'] || '').trim();
    const emailParam = String((req.query && req.query.email) || '').trim().toLowerCase();

    const cfg = getEpicConfig();
    const tokenAllowed = Boolean(cfg.syncToken && tokenHeader && tokenHeader === cfg.syncToken);
    const adminAllowed = Boolean(emailParam && typeof isAdminEmail === 'function' && await safeIsAdmin(isAdminEmail, emailParam));

    if (!tokenAllowed && !adminAllowed) {
      return res.status(401).json({ error: 'not_authorized', message: 'Admin email or x-epic-sync-token required.' });
    }

    try {
      const sheetsClient = await getSheetsClient();
      const reason = tokenAllowed ? 'token_trigger' : `admin:${emailParam}`;
      const summary = await runSync({ sheetsClient, reason });
      clearCache(); // invalidate lookup cache after a sync
      const httpStatus = summary.status === 'ok' ? 200 : 502;
      return res.status(httpStatus).json(summary);
    } catch (err) {
      if (err && err.code === 'EPIC_NOT_CONFIGURED') {
        return res.status(503).json({ error: 'epic_not_configured', message: err.message });
      }
      console.error('[epic] manual sync error:', err.message);
      return res.status(500).json({ error: 'epic_sync_failed', message: err.message });
    }
  });
}

async function safeIsAdmin(isAdminEmail, email) {
  try {
    const v = await isAdminEmail(email);
    return Boolean(v);
  } catch (err) {
    console.error('[epic] isAdminEmail check failed:', err.message);
    return false;
  }
}

module.exports = { registerEpicRoutes };

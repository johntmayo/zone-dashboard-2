'use strict';

// Read-only admin endpoints for the Godmode master spreadsheet.

let cachedPayload = null; // { expiresAt, payload }

function strEnv(name, fallback = '') {
  return String(process.env[name] || fallback).trim();
}

function intEnv(name, fallback) {
  const value = Number.parseInt(String(process.env[name] || ''), 10);
  return Number.isFinite(value) && value >= 0 ? value : fallback;
}

function getGodmodeConfig() {
  return {
    masterSheetId: strEnv('GODMODE_MASTER_SHEET_ID'),
    masterRange: strEnv('GODMODE_MASTER_RANGE', 'Master!A1:ZZ5000'),
    cacheTtlMs: intEnv('GODMODE_MASTER_CACHE_TTL_MS', 60 * 1000)
  };
}

function assertReadConfig(config) {
  if (!config.masterSheetId) {
    const err = new Error('GODMODE_MASTER_SHEET_ID is not configured.');
    err.code = 'GODMODE_NOT_CONFIGURED';
    throw err;
  }
}

function normalizeSheetValues(values) {
  const rows = Array.isArray(values) ? values : [];
  const rawHeaders = rows[0] || [];
  const headers = rawHeaders.map((header, index) => {
    const text = String(header || '').trim();
    return text || `Column ${index + 1}`;
  });

  const dataRows = rows.slice(1)
    .filter((row) => Array.isArray(row) && row.some((cell) => String(cell || '').trim()))
    .map((row) => {
      const record = {};
      headers.forEach((header, index) => {
        record[header] = row[index] == null ? '' : String(row[index]);
      });
      return record;
    });

  return { headers, rows: dataRows };
}

async function fetchGodmodeMaster({ sheetsClient, config }) {
  assertReadConfig(config);
  const result = await sheetsClient.spreadsheets.values.get({
    spreadsheetId: config.masterSheetId,
    range: config.masterRange
  });
  return normalizeSheetValues(result.data && result.data.values);
}

async function loadGodmodePayload({ sheetsClient, config }) {
  const now = Date.now();
  if (cachedPayload && cachedPayload.expiresAt > now) {
    return cachedPayload.payload;
  }

  const { headers, rows } = await fetchGodmodeMaster({ sheetsClient, config });
  const payload = {
    headers,
    rows,
    range: config.masterRange,
    lastFetchedAt: new Date().toISOString()
  };

  if (config.cacheTtlMs > 0) {
    cachedPayload = {
      expiresAt: now + config.cacheTtlMs,
      payload
    };
  }

  return payload;
}

function clearGodmodeCache() {
  cachedPayload = null;
}

function registerGodmodeRoutes(app, deps) {
  const { getSheetsClient, isAdminEmail } = deps;
  if (typeof getSheetsClient !== 'function') {
    throw new Error('registerGodmodeRoutes: deps.getSheetsClient is required');
  }

  app.get('/api/admin/godmode-master', async (req, res) => {
    const emailParam = String((req.query && req.query.email) || '').trim().toLowerCase();
    if (!emailParam) return res.status(401).json({ error: 'no_email' });

    try {
      const adminAllowed = Boolean(typeof isAdminEmail === 'function' && await isAdminEmail(emailParam));
      if (!adminAllowed) return res.status(401).json({ error: 'not_admin' });

      const config = getGodmodeConfig();
      const sheetsClient = await getSheetsClient();
      const payload = await loadGodmodePayload({ sheetsClient, config });
      res.set('Cache-Control', 'no-store');
      return res.json(payload);
    } catch (err) {
      if (err && err.code === 'GODMODE_NOT_CONFIGURED') {
        return res.status(503).json({ error: 'godmode_not_configured', message: err.message });
      }
      console.error('[godmode] master read error:', err.message);
      return res.status(500).json({ error: 'godmode_master_failed', message: err.message });
    }
  });
}

module.exports = {
  registerGodmodeRoutes,
  normalizeSheetValues,
  fetchGodmodeMaster,
  getGodmodeConfig,
  clearGodmodeCache
};

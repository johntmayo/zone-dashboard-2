'use strict';

/**
 * Contact Check-In — AddressReview progress store.
 *
 * Central sheet columns (row 1):
 *   review_key, check_in_id, address_id, zone_id, captain_id,
 *   review_status, answer, reviewed_at, updated_at
 *
 * Env:
 *   CONTACT_CHECKIN_SHEET_ID (required for live use; default set for launch sheet)
 *   CONTACT_CHECKIN_SHEET_NAME (default: AddressReviews)
 *   CONTACT_CHECKIN_CHECK_IN_ID (default: contact_check_in_2026)
 *   CONTACT_CHECKIN_CACHE_TTL_MS (default: 15000)
 */

const DEFAULT_SHEET_ID = '1sOWW-OWC4WY8ZMk75jcT9VXFn6LkTSO65EftqJpLOpc';
const DEFAULT_SHEET_NAME = 'AddressReviews';
const DEFAULT_CHECK_IN_ID = 'contact_check_in_2026';
const DEFAULT_CACHE_TTL_MS = 15 * 1000;

const REVIEW_HEADERS = [
  'review_key',
  'check_in_id',
  'address_id',
  'zone_id',
  'captain_id',
  'review_status',
  'answer',
  'reviewed_at',
  'updated_at'
];

let cachedReviews = null; // { expiresAt, rows, headers }

function strEnv(name, fallback = '') {
  return String(process.env[name] || fallback).trim();
}

function intEnv(name, fallback) {
  const value = Number.parseInt(String(process.env[name] || ''), 10);
  return Number.isFinite(value) && value >= 0 ? value : fallback;
}

function extractSpreadsheetId(value) {
  const clean = String(value || '').trim();
  if (!clean) return '';
  const match = clean.match(/\/spreadsheets\/d\/([a-zA-Z0-9-_]+)/);
  return match ? match[1] : clean;
}

function getContactCheckinConfig() {
  return {
    sheetId: extractSpreadsheetId(strEnv('CONTACT_CHECKIN_SHEET_ID', DEFAULT_SHEET_ID)),
    sheetName: strEnv('CONTACT_CHECKIN_SHEET_NAME', DEFAULT_SHEET_NAME),
    checkInId: strEnv('CONTACT_CHECKIN_CHECK_IN_ID', DEFAULT_CHECK_IN_ID),
    cacheTtlMs: intEnv('CONTACT_CHECKIN_CACHE_TTL_MS', DEFAULT_CACHE_TTL_MS)
  };
}

function indexToColumnLetter(index) {
  let letter = '';
  let n = index;
  while (n >= 0) {
    letter = String.fromCharCode((n % 26) + 65) + letter;
    n = Math.floor(n / 26) - 1;
  }
  return letter;
}

function normalizeHeader(value, index) {
  const text = String(value || '').trim();
  return text || `Column ${index + 1}`;
}

function buildReviewKey(checkInId, zoneId, captainId, addressId) {
  return [
    String(checkInId || '').trim(),
    String(zoneId || '').trim(),
    String(captainId || '').trim().toLowerCase(),
    String(addressId || '').trim()
  ].join('__');
}

function rowToObject(headers, row) {
  const obj = {};
  headers.forEach((header, i) => {
    obj[header] = row[i] != null ? String(row[i]) : '';
  });
  return obj;
}

function invalidateReviewCache() {
  cachedReviews = null;
}

async function resolveSheetName(sheetsClient, config) {
  const preferred = String(config.sheetName || '').trim();
  const candidates = [];
  if (preferred) candidates.push(preferred);
  ['AddressReviews', 'Sheet1'].forEach((name) => {
    if (!candidates.includes(name)) candidates.push(name);
  });

  try {
    const meta = await sheetsClient.spreadsheets.get({
      spreadsheetId: config.sheetId,
      fields: 'sheets.properties.title'
    });
    const titles = (meta.data.sheets || [])
      .map((s) => s.properties && s.properties.title)
      .filter(Boolean);
    const matched = candidates.find((name) => titles.includes(name));
    if (matched) return matched;
    if (titles.length) return titles[0];
  } catch (err) {
    console.warn('Contact Check-In: could not list sheet tabs:', err.message || err);
  }
  return preferred || 'AddressReviews';
}

async function loadReviewRows(sheetsClient, config) {
  const now = Date.now();
  if (cachedReviews && cachedReviews.expiresAt > now) {
    return cachedReviews;
  }

  const sheetName = await resolveSheetName(sheetsClient, config);
  const range = `${sheetName}!A1:I`;
  const result = await sheetsClient.spreadsheets.values.get({
    spreadsheetId: config.sheetId,
    range
  });
  const values = (result.data && result.data.values) ? result.data.values : [];
  const headers = (values[0] || REVIEW_HEADERS).map(normalizeHeader);
  const rows = values.slice(1).map((row) => rowToObject(headers, row));

  cachedReviews = {
    expiresAt: now + config.cacheTtlMs,
    headers,
    rows,
    sheetName
  };
  return cachedReviews;
}

function filterReviews(rows, { checkInId, zoneId, captainId } = {}) {
  return rows.filter((row) => {
    if (checkInId && String(row.check_in_id || '').trim() !== String(checkInId).trim()) return false;
    if (zoneId && String(row.zone_id || '').trim() !== String(zoneId).trim()) return false;
    if (captainId) {
      const left = String(row.captain_id || '').trim().toLowerCase();
      const right = String(captainId).trim().toLowerCase();
      if (left !== right) return false;
    }
    return true;
  });
}

function summarizeReviews(rows, totalAddresses) {
  const reviewed = rows.filter((r) => String(r.review_status || '').trim() === 'reviewed').length;
  const skipped = rows.filter((r) => String(r.review_status || '').trim() === 'skipped').length;
  const reached = rows.filter((r) => String(r.answer || '').trim() === 'yes_successful_contact').length;
  const noContact = rows.filter((r) => String(r.answer || '').trim() === 'no_successful_contact').length;
  const total = Number.isFinite(totalAddresses) ? totalAddresses : 0;
  const remaining = Math.max(0, total - reviewed);
  return {
    reviewed,
    skipped,
    reached,
    noContact,
    remaining,
    total,
    percentReviewed: total > 0 ? Math.round((reviewed / total) * 100) : 0
  };
}

async function upsertReview(sheetsClient, config, payload) {
  const checkInId = String(payload.check_in_id || config.checkInId).trim();
  const zoneId = String(payload.zone_id || '').trim();
  const captainId = String(payload.captain_id || '').trim().toLowerCase();
  const addressId = String(payload.address_id || '').trim();
  const reviewStatus = String(payload.review_status || '').trim();
  const answer = payload.answer == null ? '' : String(payload.answer).trim();

  if (!zoneId || !captainId || !addressId) {
    const err = new Error('zone_id, captain_id, and address_id are required');
    err.status = 400;
    throw err;
  }
  if (reviewStatus !== 'reviewed' && reviewStatus !== 'skipped') {
    const err = new Error('review_status must be reviewed or skipped');
    err.status = 400;
    throw err;
  }
  if (reviewStatus === 'reviewed' && answer !== 'yes_successful_contact' && answer !== 'no_successful_contact') {
    const err = new Error('reviewed answers must be yes_successful_contact or no_successful_contact');
    err.status = 400;
    throw err;
  }
  if (reviewStatus === 'skipped' && answer) {
    // Skipped rows keep answer blank
  }

  const reviewKey = buildReviewKey(checkInId, zoneId, captainId, addressId);
  const nowIso = new Date().toISOString();

  invalidateReviewCache();
  const loaded = await loadReviewRows(sheetsClient, config);
  const headers = loaded.headers.length ? loaded.headers : REVIEW_HEADERS.slice();

  const keyCol = headers.findIndex((h) => String(h).trim().toLowerCase() === 'review_key');
  if (keyCol === -1) {
    const err = new Error('AddressReviews sheet is missing review_key column');
    err.status = 500;
    throw err;
  }

  const existingIndex = loaded.rows.findIndex(
    (row) => String(row.review_key || '').trim() === reviewKey
  );

  const existing = existingIndex >= 0 ? loaded.rows[existingIndex] : null;
  const reviewedAt = existing && existing.reviewed_at
    ? existing.reviewed_at
    : nowIso;

  const record = {
    review_key: reviewKey,
    check_in_id: checkInId,
    address_id: addressId,
    zone_id: zoneId,
    captain_id: captainId,
    review_status: reviewStatus,
    answer: reviewStatus === 'skipped' ? '' : answer,
    reviewed_at: reviewedAt,
    updated_at: nowIso
  };

  const values = headers.map((header) => {
    const key = String(header || '').trim().toLowerCase();
    if (Object.prototype.hasOwnProperty.call(record, key)) return record[key];
    // Exact header match for mixed-case sheets
    if (Object.prototype.hasOwnProperty.call(record, header)) return record[header];
    return existing && existing[header] != null ? existing[header] : '';
  });

  const sheetName = loaded.sheetName || await resolveSheetName(sheetsClient, config);

  if (existingIndex >= 0) {
    const rowNumber = existingIndex + 2; // header is row 1
    const endCol = indexToColumnLetter(Math.max(headers.length - 1, 0));
    await sheetsClient.spreadsheets.values.update({
      spreadsheetId: config.sheetId,
      range: `${sheetName}!A${rowNumber}:${endCol}${rowNumber}`,
      valueInputOption: 'RAW',
      requestBody: { values: [values] }
    });
  } else {
    await sheetsClient.spreadsheets.values.append({
      spreadsheetId: config.sheetId,
      range: `${sheetName}!A1`,
      valueInputOption: 'RAW',
      insertDataOption: 'INSERT_ROWS',
      requestBody: { values: [values] }
    });
  }

  invalidateReviewCache();
  return record;
}

function registerContactCheckinRoutes(app, deps) {
  const getSheetsClient = deps && deps.getSheetsClient;
  if (typeof getSheetsClient !== 'function') {
    throw new Error('registerContactCheckinRoutes requires getSheetsClient');
  }

  app.get('/api/contact-checkin/config', (req, res) => {
    const config = getContactCheckinConfig();
    res.json({
      checkInId: config.checkInId,
      sheetConfigured: Boolean(config.sheetId),
      sheetName: config.sheetName
    });
  });

  app.get('/api/contact-checkin/reviews', async (req, res) => {
    try {
      const config = getContactCheckinConfig();
      if (!config.sheetId) {
        return res.status(500).json({ error: 'CONTACT_CHECKIN_SHEET_ID not configured' });
      }

      const zoneId = String(req.query.zone_id || '').trim();
      const captainId = String(req.query.captain_id || '').trim().toLowerCase();
      const checkInId = String(req.query.check_in_id || config.checkInId).trim();
      const totalAddresses = Number.parseInt(String(req.query.total_addresses || ''), 10);

      if (!zoneId || !captainId) {
        return res.status(400).json({ error: 'zone_id and captain_id are required' });
      }

      const sheets = await getSheetsClient();
      const loaded = await loadReviewRows(sheets, config);
      const rows = filterReviews(loaded.rows, { checkInId, zoneId, captainId });
      const summary = summarizeReviews(rows, Number.isFinite(totalAddresses) ? totalAddresses : undefined);

      res.json({
        checkInId,
        zoneId,
        captainId,
        reviews: rows,
        summary
      });
    } catch (err) {
      console.error('Contact Check-In reviews error:', err.message || err);
      res.status(500).json({ error: 'Failed to load Contact Check-In reviews', message: err.message || String(err) });
    }
  });

  app.post('/api/contact-checkin/review', async (req, res) => {
    try {
      const config = getContactCheckinConfig();
      if (!config.sheetId) {
        return res.status(500).json({ error: 'CONTACT_CHECKIN_SHEET_ID not configured' });
      }

      const body = req.body || {};
      const sheets = await getSheetsClient();
      const record = await upsertReview(sheets, config, body);
      res.json({ success: true, review: record });
    } catch (err) {
      const status = err.status || 500;
      console.error('Contact Check-In upsert error:', err.message || err);
      res.status(status).json({
        error: status === 400 ? err.message : 'Failed to save Contact Check-In review',
        message: err.message || String(err)
      });
    }
  });
}

module.exports = {
  registerContactCheckinRoutes,
  getContactCheckinConfig,
  buildReviewKey,
  summarizeReviews,
  REVIEW_HEADERS,
  DEFAULT_CHECK_IN_ID
};

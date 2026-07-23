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
 *   CONTACT_CHECKIN_CACHE_TTL_MS (default: 60000)
 */

const DEFAULT_SHEET_ID = '1sOWW-OWC4WY8ZMk75jcT9VXFn6LkTSO65EftqJpLOpc';
const DEFAULT_SHEET_NAME = 'AddressReviews';
const DEFAULT_CHECK_IN_ID = 'contact_check_in_2026';
const DEFAULT_CACHE_TTL_MS = 60 * 1000;
const SHEET_NAME_CACHE_TTL_MS = 10 * 60 * 1000;

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

let cachedReviews = null; // { expiresAt, rows, headers, sheetName }
let cachedSheetName = null; // { sheetId, name, expiresAt }

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
    cacheTtlMs: intEnv('CONTACT_CHECKIN_CACHE_TTL_MS', DEFAULT_CACHE_TTL_MS),
    // Homepage Contact Check-In + Community Feed launch gate (default off).
    homeEnabled: (() => {
      const raw = String(process.env.CONTACT_CHECKIN_HOME_ENABLED || '').trim().toLowerCase();
      return raw === '1' || raw === 'true' || raw === 'yes' || raw === 'on';
    })()
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

function quoteSheetName(name) {
  return `'${String(name || '').replace(/'/g, "''")}'`;
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

function isRetryableSheetsError(err) {
  const msg = String((err && err.message) || err || '').toLowerCase();
  const code = err && (err.code || (err.response && err.response.status));
  if (code === 429 || code === 503 || code === 500) return true;
  if (msg.includes('quota') || msg.includes('rate limit')) return true;
  if (msg.includes('unable to parse range')) return true;
  if (msg.includes('backend error') || msg.includes('internal error')) return true;
  if (msg.includes('unavailable') || msg.includes('timeout')) return true;
  return false;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function withSheetsRetry(fn, { attempts = 4, baseDelayMs = 700 } = {}) {
  let lastErr;
  for (let i = 0; i < attempts; i += 1) {
    try {
      return await fn();
    } catch (err) {
      lastErr = err;
      if (i >= attempts - 1 || !isRetryableSheetsError(err)) throw err;
      const delay = baseDelayMs * (2 ** i) + Math.floor(Math.random() * 250);
      console.warn(
        `Contact Check-In: Sheets call failed (attempt ${i + 1}/${attempts}), retrying in ${delay}ms:`,
        err.message || err
      );
      await sleep(delay);
    }
  }
  throw lastErr;
}

async function resolveSheetName(sheetsClient, config) {
  const preferred = String(config.sheetName || '').trim();
  const now = Date.now();
  if (
    cachedSheetName &&
    cachedSheetName.sheetId === config.sheetId &&
    cachedSheetName.expiresAt > now &&
    cachedSheetName.name
  ) {
    return cachedSheetName.name;
  }

  const candidates = [];
  if (preferred) candidates.push(preferred);
  ['AddressReviews', 'Sheet1'].forEach((name) => {
    if (!candidates.includes(name)) candidates.push(name);
  });

  let resolved = preferred || 'AddressReviews';
  try {
    const meta = await withSheetsRetry(() => sheetsClient.spreadsheets.get({
      spreadsheetId: config.sheetId,
      fields: 'sheets.properties.title'
    }));
    const titles = (meta.data.sheets || [])
      .map((s) => s.properties && s.properties.title)
      .filter(Boolean);
    const matched = candidates.find((name) => titles.includes(name));
    if (matched) resolved = matched;
    else if (titles.length) resolved = titles[0];
  } catch (err) {
    console.warn('Contact Check-In: could not list sheet tabs:', err.message || err);
  }

  cachedSheetName = {
    sheetId: config.sheetId,
    name: resolved,
    expiresAt: now + SHEET_NAME_CACHE_TTL_MS
  };
  return resolved;
}

async function loadReviewRows(sheetsClient, config, options = {}) {
  const forceRefresh = Boolean(options.forceRefresh);
  const now = Date.now();
  if (!forceRefresh && cachedReviews && cachedReviews.expiresAt > now) {
    return cachedReviews;
  }

  const sheetName = await resolveSheetName(sheetsClient, config);
  const range = `${quoteSheetName(sheetName)}!A1:I`;
  const result = await withSheetsRetry(() => sheetsClient.spreadsheets.values.get({
    spreadsheetId: config.sheetId,
    range
  }));
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

function patchReviewCache(record, existingIndex, headers, sheetName, cacheTtlMs) {
  if (!record) return;
  const now = Date.now();
  const ttl = Number.isFinite(cacheTtlMs) ? cacheTtlMs : DEFAULT_CACHE_TTL_MS;
  if (!cachedReviews) {
    cachedReviews = {
      expiresAt: now + ttl,
      headers: (headers && headers.length) ? headers.slice() : REVIEW_HEADERS.slice(),
      rows: [Object.assign({}, record)],
      sheetName
    };
    return;
  }

  const rows = cachedReviews.rows.slice();
  if (existingIndex >= 0 && existingIndex < rows.length) {
    rows[existingIndex] = Object.assign({}, rows[existingIndex], record);
  } else {
    const key = String(record.review_key || '').trim();
    const found = rows.findIndex((row) => String(row.review_key || '').trim() === key);
    if (found >= 0) rows[found] = Object.assign({}, rows[found], record);
    else rows.push(Object.assign({}, record));
  }
  cachedReviews = {
    expiresAt: now + ttl,
    headers: cachedReviews.headers.length ? cachedReviews.headers : ((headers && headers.length) ? headers.slice() : REVIEW_HEADERS.slice()),
    rows,
    sheetName: sheetName || cachedReviews.sheetName
  };
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

/**
 * Zone-wide teammate progress for the captain home card (no PII).
 * Counts unique addresses reviewed by OTHER captains in the same zone so a
 * captain who just signed in can see their co-captain has already been working.
 */
function summarizeZoneTeammates(rows, { checkInId, zoneId, captainId } = {}) {
  const zoneRows = filterReviews(rows, { checkInId, zoneId });
  const me = String(captainId || '').trim().toLowerCase();
  const otherCaptains = new Set();
  const addressesReviewedByOthers = new Set();
  zoneRows.forEach((r) => {
    const cap = String(r.captain_id || '').trim().toLowerCase();
    if (!cap || cap === me) return;
    otherCaptains.add(cap);
    if (String(r.review_status || '').trim() === 'reviewed') {
      const aid = String(r.address_id || '').trim();
      if (aid) addressesReviewedByOthers.add(aid);
    }
  });
  return {
    otherCaptainCount: otherCaptains.size,
    addressesReviewedByOthers: addressesReviewedByOthers.size
  };
}

function parseReviewTimestamp(row) {
  const raw = String((row && (row.reviewed_at || row.updated_at)) || '').trim();
  if (!raw) return NaN;
  const ms = Date.parse(raw);
  return Number.isFinite(ms) ? ms : NaN;
}

/** Org-wide Contact Check-In momentum for the Community Feed (no PII). */
function buildCommunitySummary(rows, { checkInId, nowMs } = {}) {
  const checkIn = String(checkInId || '').trim();
  const filtered = (rows || []).filter((row) => {
    if (!checkIn) return true;
    return String(row.check_in_id || '').trim() === checkIn;
  });

  const reviewedRows = filtered.filter((r) => String(r.review_status || '').trim() === 'reviewed');
  const skipped = filtered.filter((r) => String(r.review_status || '').trim() === 'skipped').length;
  const reached = reviewedRows.filter((r) => String(r.answer || '').trim() === 'yes_successful_contact').length;

  const reviewedAddresses = new Set();
  reviewedRows.forEach((r) => {
    const id = String(r.address_id || '').trim();
    if (id) reviewedAddresses.add(id);
  });

  const zones = new Set();
  const captains = new Set();
  filtered.forEach((r) => {
    const zone = String(r.zone_id || '').trim();
    const captain = String(r.captain_id || '').trim().toLowerCase();
    if (zone) zones.add(zone);
    if (captain) captains.add(captain);
  });

  const now = Number.isFinite(nowMs) ? nowMs : Date.now();
  const cutoff = now - (48 * 60 * 60 * 1000);
  const recentReviewed = reviewedRows.filter((r) => {
    const ts = parseReviewTimestamp(r);
    return Number.isFinite(ts) && ts >= cutoff;
  });

  const zoneRecentCounts = {};
  recentReviewed.forEach((r) => {
    const zone = String(r.zone_id || '').trim();
    if (!zone) return;
    zoneRecentCounts[zone] = (zoneRecentCounts[zone] || 0) + 1;
  });

  const highlights = [];
  if (recentReviewed.length > 0) {
    highlights.push({
      type: 'town_milestone',
      count: recentReviewed.length
    });
  }
  Object.keys(zoneRecentCounts)
    .sort((a, b) => zoneRecentCounts[b] - zoneRecentCounts[a])
    .slice(0, 4)
    .forEach((zone) => {
      highlights.push({
        type: 'zone_progress',
        zone,
        count: zoneRecentCounts[zone]
      });
    });

  return {
    reviewedAddresses: reviewedAddresses.size,
    reviewedRows: reviewedRows.length,
    reached,
    skipped,
    zonesParticipating: zones.size,
    captainsParticipating: captains.size,
    reviewedLast48h: recentReviewed.length,
    highlights
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

  const reviewKey = buildReviewKey(checkInId, zoneId, captainId, addressId);
  const nowIso = new Date().toISOString();

  // Fresh read for write correctness across serverless instances; do not wipe the
  // shared GET cache first (that caused a full re-read storm after every save).
  const loaded = await loadReviewRows(sheetsClient, config, { forceRefresh: true });
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
    if (Object.prototype.hasOwnProperty.call(record, header)) return record[header];
    return existing && existing[header] != null ? existing[header] : '';
  });

  const sheetName = loaded.sheetName || await resolveSheetName(sheetsClient, config);
  const quoted = quoteSheetName(sheetName);

  if (existingIndex >= 0) {
    const rowNumber = existingIndex + 2; // header is row 1
    const endCol = indexToColumnLetter(Math.max(headers.length - 1, 0));
    await withSheetsRetry(() => sheetsClient.spreadsheets.values.update({
      spreadsheetId: config.sheetId,
      range: `${quoted}!A${rowNumber}:${endCol}${rowNumber}`,
      valueInputOption: 'RAW',
      requestBody: { values: [values] }
    }));
  } else {
    await withSheetsRetry(() => sheetsClient.spreadsheets.values.append({
      spreadsheetId: config.sheetId,
      range: `${quoted}!A1`,
      valueInputOption: 'RAW',
      insertDataOption: 'INSERT_ROWS',
      requestBody: { values: [values] }
    }));
  }

  // Keep homepage / community reads warm without another Google round-trip.
  patchReviewCache(record, existingIndex, headers, sheetName, config.cacheTtlMs);
  return record;
}

/**
 * Admin report aggregation across every zone/captain for a check-in campaign.
 * Groups raw AddressReview rows into per-zone and per-captain rollups and a
 * de-duplicated list of successfully contacted addresses (for CSV export).
 * Human-readable street addresses are not stored here — the client enriches
 * them by joining address_id against the Godmode master sheet.
 */
function buildAdminReport(rows, { checkInId } = {}) {
  const checkIn = String(checkInId || '').trim();
  const filtered = (rows || []).filter((row) => {
    if (!checkIn) return true;
    return String(row.check_in_id || '').trim() === checkIn;
  });

  const zones = new Map();
  const captains = new Map();
  const contactedAddresses = new Map(); // address_id -> aggregate

  const ensureZone = (zoneId) => {
    const key = zoneId || 'unknown_zone';
    if (!zones.has(key)) {
      zones.set(key, {
        zoneId: key,
        reviewedAddressIds: new Set(),
        skippedAddressIds: new Set(),
        reachedAddressIds: new Set(),
        noContactAddressIds: new Set(),
        captains: new Set(),
        reviewRows: 0,
        lastActivityMs: 0
      });
    }
    return zones.get(key);
  };

  const ensureCaptain = (captainId) => {
    if (!captains.has(captainId)) {
      captains.set(captainId, {
        captainId,
        zones: new Set(),
        reviewedAddressIds: new Set(),
        reachedAddressIds: new Set(),
        noContactAddressIds: new Set(),
        reviewRows: 0,
        lastActivityMs: 0
      });
    }
    return captains.get(captainId);
  };

  filtered.forEach((row) => {
    const zoneId = String(row.zone_id || '').trim();
    const captainId = String(row.captain_id || '').trim().toLowerCase();
    const addressId = String(row.address_id || '').trim();
    const status = String(row.review_status || '').trim();
    const answer = String(row.answer || '').trim();
    const ts = parseReviewTimestamp(row);
    const tsMs = Number.isFinite(ts) ? ts : 0;

    const zone = ensureZone(zoneId);
    zone.reviewRows += 1;
    if (captainId) zone.captains.add(captainId);
    if (tsMs > zone.lastActivityMs) zone.lastActivityMs = tsMs;
    if (addressId) {
      if (status === 'reviewed') zone.reviewedAddressIds.add(addressId);
      if (status === 'skipped') zone.skippedAddressIds.add(addressId);
      if (answer === 'yes_successful_contact') zone.reachedAddressIds.add(addressId);
      if (answer === 'no_successful_contact') zone.noContactAddressIds.add(addressId);
    }

    if (captainId) {
      const captain = ensureCaptain(captainId);
      captain.reviewRows += 1;
      if (zoneId) captain.zones.add(zoneId);
      if (tsMs > captain.lastActivityMs) captain.lastActivityMs = tsMs;
      if (addressId) {
        if (status === 'reviewed') captain.reviewedAddressIds.add(addressId);
        if (answer === 'yes_successful_contact') captain.reachedAddressIds.add(addressId);
        if (answer === 'no_successful_contact') captain.noContactAddressIds.add(addressId);
      }
    }

    if (addressId && answer === 'yes_successful_contact') {
      const existing = contactedAddresses.get(addressId);
      const isoTs = String(row.reviewed_at || row.updated_at || '').trim();
      if (!existing) {
        contactedAddresses.set(addressId, {
          addressId,
          zoneId,
          captains: new Set(captainId ? [captainId] : []),
          firstContactedAt: isoTs,
          firstContactedMs: tsMs
        });
      } else {
        if (captainId) existing.captains.add(captainId);
        if (!existing.zoneId && zoneId) existing.zoneId = zoneId;
        if (tsMs && (!existing.firstContactedMs || tsMs < existing.firstContactedMs)) {
          existing.firstContactedMs = tsMs;
          existing.firstContactedAt = isoTs;
        }
      }
    }
  });

  const zoneList = Array.from(zones.values()).map((zone) => ({
    zoneId: zone.zoneId,
    reviewedAddresses: zone.reviewedAddressIds.size,
    skippedAddresses: zone.skippedAddressIds.size,
    reachedAddresses: zone.reachedAddressIds.size,
    noContactAddresses: zone.noContactAddressIds.size,
    captains: Array.from(zone.captains),
    reviewRows: zone.reviewRows,
    lastActivityAt: zone.lastActivityMs ? new Date(zone.lastActivityMs).toISOString() : ''
  }));

  const captainList = Array.from(captains.values()).map((captain) => ({
    captainId: captain.captainId,
    zones: Array.from(captain.zones),
    reviewedAddresses: captain.reviewedAddressIds.size,
    reachedAddresses: captain.reachedAddressIds.size,
    noContactAddresses: captain.noContactAddressIds.size,
    reviewRows: captain.reviewRows,
    lastActivityAt: captain.lastActivityMs ? new Date(captain.lastActivityMs).toISOString() : ''
  }));

  const contactedList = Array.from(contactedAddresses.values()).map((entry) => ({
    addressId: entry.addressId,
    zoneId: entry.zoneId,
    captains: Array.from(entry.captains),
    contactedAt: entry.firstContactedAt
  }));

  return {
    zones: zoneList,
    captains: captainList,
    contactedAddresses: contactedList
  };
}

function registerContactCheckinRoutes(app, deps) {
  const getSheetsClient = deps && deps.getSheetsClient;
  const isAdminEmail = deps && deps.isAdminEmail;
  if (typeof getSheetsClient !== 'function') {
    throw new Error('registerContactCheckinRoutes requires getSheetsClient');
  }

  app.get('/api/contact-checkin/config', (req, res) => {
    const config = getContactCheckinConfig();
    res.json({
      checkInId: config.checkInId,
      sheetConfigured: Boolean(config.sheetId),
      sheetName: config.sheetName,
      homeEnabled: Boolean(config.homeEnabled)
    });
  });

  app.get('/api/contact-checkin/community', async (req, res) => {
    try {
      const config = getContactCheckinConfig();
      if (!config.sheetId) {
        return res.status(500).json({ error: 'CONTACT_CHECKIN_SHEET_ID not configured' });
      }

      const checkInId = String(req.query.check_in_id || config.checkInId).trim();
      const sheets = await getSheetsClient();
      const loaded = await loadReviewRows(sheets, config);
      const community = buildCommunitySummary(loaded.rows, { checkInId });

      res.json({
        checkInId,
        community
      });
    } catch (err) {
      console.error('Contact Check-In community error:', err.message || err);
      res.status(500).json({
        error: 'Failed to load Contact Check-In community summary',
        message: err.message || String(err)
      });
    }
  });

  app.get('/api/contact-checkin/admin', async (req, res) => {
    try {
      const emailParam = String((req.query && req.query.email) || '').trim().toLowerCase();
      if (!emailParam) return res.status(401).json({ error: 'no_email' });

      const adminAllowed = Boolean(typeof isAdminEmail === 'function' && await isAdminEmail(emailParam));
      if (!adminAllowed) return res.status(401).json({ error: 'not_admin' });

      const config = getContactCheckinConfig();
      if (!config.sheetId) {
        return res.status(503).json({ error: 'contact_checkin_not_configured', message: 'CONTACT_CHECKIN_SHEET_ID not configured' });
      }

      const checkInId = String(req.query.check_in_id || config.checkInId).trim();
      const forceRefresh = String(req.query.force || '').trim() === '1';
      const sheets = await getSheetsClient();
      const loaded = await loadReviewRows(sheets, config, { forceRefresh });
      const report = buildAdminReport(loaded.rows, { checkInId });
      const community = buildCommunitySummary(loaded.rows, { checkInId });

      res.set('Cache-Control', 'no-store');
      res.json({
        checkInId,
        generatedAt: new Date().toISOString(),
        community,
        zones: report.zones,
        captains: report.captains,
        contactedAddresses: report.contactedAddresses
      });
    } catch (err) {
      console.error('Contact Check-In admin report error:', err.message || err);
      res.status(500).json({
        error: 'Failed to load Contact Check-In admin report',
        message: err.message || String(err)
      });
    }
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
      const teammate = summarizeZoneTeammates(loaded.rows, { checkInId, zoneId, captainId });

      res.json({
        checkInId,
        zoneId,
        captainId,
        reviews: rows,
        summary,
        teammate
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
      const status = err.status || (isRetryableSheetsError(err) ? 503 : 500);
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
  summarizeZoneTeammates,
  buildCommunitySummary,
  buildAdminReport,
  REVIEW_HEADERS,
  DEFAULT_CHECK_IN_ID
};

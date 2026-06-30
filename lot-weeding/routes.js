'use strict';

let cachedPayload = null; // { expiresAt, payload }

const DEFAULT_RANGE = 'A1:ZZ5000';
const DEFAULT_CACHE_TTL_MS = 30 * 1000;
const STATUS_VALUES = ['Requested', 'On-Deck', 'Scheduled', 'Cleaned', 'Needs Attention', 'Cancelled'];
const ROE_STATUS_VALUES = ['Requested', 'Returned'];

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

function getLotWeedingConfig() {
  const sourceValue = strEnv('LOT_WEEDING_SOURCE_SHEET_ID') ||
    strEnv('LOT_WEEDING_SOURCE_SHEET_URL') ||
    strEnv('LOT_WEEDING_INTAKE_SHEET_ID') ||
    strEnv('LOT_WEEDING_INTAKE_SHEET_URL') ||
    strEnv('LOT_WEEDING_SHEET_ID') ||
    strEnv('LOT_WEEDING_SHEET_URL');

  const source = strEnv('LOT_WEEDING_SOURCE_LABEL') ||
    (strEnv('LOT_WEEDING_SOURCE_SHEET_ID') || strEnv('LOT_WEEDING_SOURCE_SHEET_URL') || strEnv('LOT_WEEDING_INTAKE_SHEET_ID') || strEnv('LOT_WEEDING_INTAKE_SHEET_URL')
      ? 'original'
      : 'mirror');

  return {
    sheetId: extractSpreadsheetId(sourceValue),
    sheetName: strEnv('LOT_WEEDING_SOURCE_SHEET_NAME') ||
      strEnv('LOT_WEEDING_INTAKE_SHEET_NAME') ||
      strEnv('LOT_WEEDING_SHEET_NAME'),
    range: strEnv('LOT_WEEDING_SOURCE_RANGE', DEFAULT_RANGE),
    source,
    cacheTtlMs: intEnv('LOT_WEEDING_CACHE_TTL_MS', DEFAULT_CACHE_TTL_MS),
    masterSheetId: strEnv('LOT_WEEDING_CONTEXT_SHEET_ID') || strEnv('GODMODE_MASTER_SHEET_ID'),
    masterRange: strEnv('LOT_WEEDING_CONTEXT_RANGE') || strEnv('GODMODE_MASTER_RANGE', DEFAULT_RANGE)
  };
}

function rangeWithSheetName(config, rangeOverride = '') {
  const range = String(rangeOverride || config.range || DEFAULT_RANGE).trim();
  return config.sheetName ? `${config.sheetName}!${range}` : range;
}

function normalizeHeader(value, index) {
  const text = String(value || '').trim();
  return text || `Column ${index + 1}`;
}

function normalizeKey(value) {
  return String(value || '').trim().toLowerCase().replace(/[^a-z0-9]/g, '');
}

function findColumn(headers, aliases, fallbackMatcher) {
  const aliasKeys = aliases.map(normalizeKey);
  return headers.find((header) => aliasKeys.includes(normalizeKey(header))) ||
    headers.find((header) => {
      const lower = String(header || '').toLowerCase();
      return typeof fallbackMatcher === 'function' && fallbackMatcher(lower);
    }) ||
    null;
}

function getHeaderWords(value) {
  return String(value || '').toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);
}

function getLotWeedingColumns(headers) {
  return {
    timestamp: findColumn(headers, [
      'request submission date stamp',
      'request submission datestamp',
      'timestamp',
      'submitted at',
      'submission timestamp',
      'form submitted at',
      'request timestamp',
      'created at'
    ], (lower) => lower.includes('timestamp') || lower.includes('submitted') || (lower.includes('created') && lower.includes('at'))),
    requesterName: findColumn(headers, [
      'name of homeowner',
      'name',
      'full name',
      'requester name',
      'property owner name',
      'owner name'
    ], (lower) => lower.includes('name') && (lower.includes('requester') || lower.includes('owner'))),
    email: findColumn(headers, [
      'email of homeowner',
      'email',
      'email address',
      'requester email',
      'property owner email',
      'owner email'
    ], (lower) => lower.includes('email')),
    phone: findColumn(headers, [
      'phone number of homeowner',
      'phone',
      'phone number',
      'requester phone',
      'property owner phone',
      'owner phone'
    ], (lower) => lower.includes('phone') || lower.includes('mobile') || lower.includes('cell')),
    address: findColumn(headers, [
      'address of property',
      'address',
      'property address',
      'lot address',
      'site address',
      'situs address'
    ], (lower) => lower.includes('address')),
    apn: findColumn(headers, [
      'apn',
      'ain',
      'parcel',
      'parcel number',
      'parcel id',
      'assessor parcel number',
      'assessor parcel no'
    ], (lower) => lower.includes('apn') || lower.includes('ain') || lower.includes('parcel')),
    details: findColumn(headers, [
      'lot_weeding_request_details_spring_2026',
      'lot weeding request details spring 2026',
      'lot weeding request details',
      'request details',
      'details',
      'notes',
      'comments'
    ], (lower) => (lower.includes('lot') && lower.includes('weeding') && lower.includes('detail')) || lower.includes('note') || lower.includes('comment')),
    universalWasteContract: findColumn(headers, [
      'universal waste systems contract y/n',
      'uws contract',
      'universal waste systems contract',
      'do you have a contract with universal waste systems that you are currently paying?'
    ], (lower) => lower.includes('universal waste') || lower.includes('uws contract')),
    lastContactDate: findColumn(headers, [
      'last contact date',
      'last contacted',
      'emailed',
      'contact date'
    ], (lower) => lower.includes('last') && lower.includes('contact')),
    requested: findColumn(headers, [
      'lot_weeding_requested_spring_2026',
      'lot weeding requested spring 2026',
      'lot weeding requested',
      'weeding requested',
      'requested'
    ], (lower) => lower.includes('lot') && lower.includes('weeding') && lower.includes('requested')),
    status: findColumn(headers, [
      'lot_weeding_status_spring_2026',
      'lot weeding status spring 2026',
      'lot weeding status',
      'weeding status',
      'request status',
      'status'
    ], (lower) => lower.includes('status') && !lower.includes('roe') && !lower.includes('right of entry')),
    scheduledDate: findColumn(headers, [
      'date scheduled',
      'lot_weeding_date_scheduled_spring_2026',
      'lot_weeding_scheduled_date_spring_2026',
      'lot weeding date scheduled spring 2026',
      'lot weeding scheduled date spring 2026',
      'lot weeding date scheduled',
      'scheduled date'
    ], (lower) => lower.includes('scheduled') && lower.includes('date')),
    homeownerNotified: findColumn(headers, [
      'homeowner notified of schedule',
      'homeowner notified',
      'owner notified',
      'notified of schedule'
    ], (lower) => lower.includes('notified') && (lower.includes('homeowner') || lower.includes('owner') || lower.includes('schedule'))),
    dateCleaned: findColumn(headers, [
      'date cleaned',
      'cleaned date',
      'date completed',
      'completed date'
    ], (lower) => lower.includes('date') && (lower.includes('cleaned') || lower.includes('completed'))),
    roeStatus: findColumn(headers, [
      'roe status',
      'roe returned',
      'roe form',
      'right of entry status',
      'right of entry'
    ], (lower) => lower.includes('roe') || lower.includes('right of entry')),
    zone: findColumn(headers, [
      'zone',
      'altagether zone',
      'zone number',
      'zone name'
    ], (lower) => lower.includes('zone')),
    captainName: findColumn(headers, [
      'captain',
      'neighborhood captain',
      'captain name',
      'nc name'
    ], (lower) => lower.includes('captain') || lower === 'nc'),
    captainEmail: findColumn(headers, [
      'captain email',
      'neighborhood captain email',
      'nc email'
    ], (lower) => lower.includes('captain') && lower.includes('email')),
    latitude: findColumn(headers, [
      'latitude',
      'lat',
      'parcel latitude',
      'centroid latitude'
    ], (lower) => {
      const words = getHeaderWords(lower);
      return words.includes('latitude') || words.includes('lat');
    }),
    longitude: findColumn(headers, [
      'longitude',
      'lng',
      'lon',
      'long',
      'parcel longitude',
      'centroid longitude'
    ], (lower) => {
      const words = getHeaderWords(lower);
      return words.includes('longitude') || words.includes('lng') || words.includes('lon') || words.includes('long');
    })
  };
}

function getContextColumns(headers) {
  return {
    apn: findColumn(headers, [
      'apn',
      'ain',
      'parcel',
      'parcel number',
      'assessor parcel number',
      'main_ain_norm',
      'main ain'
    ], (lower) => lower.includes('apn') || lower.includes('ain') || lower.includes('parcel')),
    zone: findColumn(headers, [
      'zone',
      'altagether zone',
      'zone number',
      'zone name',
      'zonename'
    ], (lower) => lower.includes('zone')),
    captainName: findColumn(headers, [
      'captain',
      'neighborhood captain',
      'captain name',
      'nc name',
      'captain_display_name'
    ], (lower) => lower.includes('captain') && !lower.includes('email')),
    captainEmail: findColumn(headers, [
      'captain email',
      'neighborhood captain email',
      'nc email',
      'contact email',
      'contact_email'
    ], (lower) => lower.includes('email') && (lower.includes('captain') || lower.includes('contact') || lower.includes('nc'))),
    latitude: findColumn(headers, [
      'latitude',
      'lat',
      'parcel latitude',
      'centroid latitude',
      'y'
    ], (lower) => {
      const words = getHeaderWords(lower);
      return words.includes('latitude') || words.includes('lat') || lower === 'y';
    }),
    longitude: findColumn(headers, [
      'longitude',
      'lng',
      'lon',
      'long',
      'parcel longitude',
      'centroid longitude',
      'x'
    ], (lower) => {
      const words = getHeaderWords(lower);
      return words.includes('longitude') || words.includes('lng') || words.includes('lon') || words.includes('long') || lower === 'x';
    })
  };
}

function getValue(record, columnName) {
  return columnName ? String(record[columnName] || '').trim() : '';
}

function isTruthySheetValue(value) {
  return ['true', 'yes', 'y', '1', 'x', 'requested'].includes(String(value || '').trim().toLowerCase());
}

function normalizeStatus(value, requestedValue = '') {
  const text = String(value || '').trim();
  const normalized = text.toLowerCase();
  if (['scheduled', 'schedule'].includes(normalized)) return 'Scheduled';
  if (['cleaned', 'completed', 'complete', 'done'].includes(normalized)) return 'Cleaned';
  if (['needs attention', 'needs-attention', 'flagged', 'error', 'issue', 'problem', 'cannot service', 'cannot be serviced'].includes(normalized)) return 'Needs Attention';
  if (['cancelled', 'canceled', 'cancel'].includes(normalized)) return 'Cancelled';
  if (['on-deck', 'on deck', 'ondeck', 'next up'].includes(normalized)) return 'On-Deck';
  if (['open', 'requested', 'request', 'pending', 'new'].includes(normalized)) return 'Requested';
  if (!normalized) {
    return isTruthySheetValue(requestedValue) ? 'Requested' : '';
  }
  return STATUS_VALUES.find((status) => status.toLowerCase() === normalized) || text;
}

function normalizeRoeStatus(value) {
  const text = String(value || '').trim();
  const normalized = text.toLowerCase();
  if (['returned', 'return', 'true', 'yes', 'y'].includes(normalized)) return 'Returned';
  if (['requested', 'request'].includes(normalized)) return 'Requested';
  return ROE_STATUS_VALUES.find((status) => status.toLowerCase() === normalized) || text;
}

function normalizeYesNo(value) {
  const text = String(value || '').trim();
  const normalized = text.toLowerCase();
  if (['true', 'yes', 'y', '1'].includes(normalized)) return 'Yes';
  if (['false', 'no', 'n', '0'].includes(normalized)) return 'No';
  return text;
}

function isTerminalStatus(status) {
  return status === 'Cleaned' || status === 'Cancelled';
}

function normalizeSheetValues(values) {
  const rows = Array.isArray(values) ? values : [];
  const headers = (rows[0] || []).map(normalizeHeader);
  const dataRows = rows.slice(1)
    .map((row, index) => {
      const record = {};
      headers.forEach((header, columnIndex) => {
        record[header] = row[columnIndex] == null ? '' : String(row[columnIndex]);
      });
      return {
        rowNumber: index + 2,
        record
      };
    })
    .filter(({ record }) => Object.values(record).some((value) => String(value || '').trim()));

  return { headers, rows: dataRows };
}

function normalizeLotWeedingRows(headers, rows) {
  const columns = getLotWeedingColumns(headers || []);
  return (rows || []).map(({ rowNumber, record }) => {
    const requestedValue = getValue(record, columns.requested);
    const status = normalizeStatus(getValue(record, columns.status), requestedValue);
    const coords = parseCoordinatePair(getValue(record, columns.latitude), getValue(record, columns.longitude));
    return {
      rowNumber,
      timestamp: getValue(record, columns.timestamp),
      requesterName: getValue(record, columns.requesterName),
      email: getValue(record, columns.email),
      phone: getValue(record, columns.phone),
      address: getValue(record, columns.address),
      apn: getValue(record, columns.apn),
      details: getValue(record, columns.details),
      universalWasteContract: normalizeYesNo(getValue(record, columns.universalWasteContract)),
      lastContactDate: getValue(record, columns.lastContactDate),
      requested: isTruthySheetValue(requestedValue) || Boolean(status),
      status: status || 'Requested',
      scheduledDate: getValue(record, columns.scheduledDate),
      homeownerNotified: normalizeYesNo(getValue(record, columns.homeownerNotified)),
      dateCleaned: getValue(record, columns.dateCleaned),
      roeStatus: normalizeRoeStatus(getValue(record, columns.roeStatus)),
      zone: getValue(record, columns.zone),
      captainName: getValue(record, columns.captainName),
      captainEmail: getValue(record, columns.captainEmail),
      latitude: coords ? coords.latitude : null,
      longitude: coords ? coords.longitude : null,
      raw: record
    };
  });
}

function summarizeRequests(requests) {
  return (requests || []).reduce((stats, request) => {
    stats.total += 1;
    if (request.status === 'Requested') stats.requested += 1;
    else if (request.status === 'On-Deck') stats.onDeck += 1;
    else if (request.status === 'Scheduled') stats.scheduled += 1;
    else if (request.status === 'Cleaned') stats.cleaned += 1;
    else if (request.status === 'Needs Attention') stats.needsAttention += 1;
    else if (request.status === 'Cancelled') stats.cancelled += 1;
    if (!isTerminalStatus(request.status)) stats.active += 1;
    if (!request.apn) stats.missingApn += 1;
    stats.open = stats.requested + stats.onDeck + stats.needsAttention;
    stats.completed = stats.cleaned;
    stats.flagged = stats.needsAttention;
    return stats;
  }, {
    total: 0,
    active: 0,
    requested: 0,
    onDeck: 0,
    scheduled: 0,
    cleaned: 0,
    needsAttention: 0,
    cancelled: 0,
    missingApn: 0,
    open: 0,
    completed: 0,
    flagged: 0
  });
}

function normalizeApnDigits(value) {
  return String(value || '').replace(/\D/g, '');
}

function parseCoordinatePair(latitudeValue, longitudeValue) {
  const latitudeText = String(latitudeValue || '').trim();
  const longitudeText = String(longitudeValue || '').trim();
  if (!latitudeText || !longitudeText) return null;

  const latitude = Number.parseFloat(latitudeText);
  const longitude = Number.parseFloat(longitudeText);
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return null;
  if (Math.abs(latitude) < 0.0001 && Math.abs(longitude) < 0.0001) return null;
  if (Math.abs(latitude) > 90 || Math.abs(longitude) > 180) return null;
  return { latitude, longitude };
}

async function loadContextByApn({ sheetsClient, config }) {
  if (!config.masterSheetId) return new Map();

  try {
    const result = await sheetsClient.spreadsheets.values.get({
      spreadsheetId: config.masterSheetId,
      range: config.masterRange || DEFAULT_RANGE
    });
    const parsed = normalizeSheetValues(result.data && result.data.values);
    const columns = getContextColumns(parsed.headers);
    if (!columns.apn) return new Map();

    const byApn = new Map();
    parsed.rows.forEach(({ record }) => {
      const apnDigits = normalizeApnDigits(getValue(record, columns.apn));
      if (!apnDigits || byApn.has(apnDigits)) return;
      const coords = parseCoordinatePair(getValue(record, columns.latitude), getValue(record, columns.longitude));
      byApn.set(apnDigits, {
        zone: getValue(record, columns.zone),
        captainName: getValue(record, columns.captainName),
        captainEmail: getValue(record, columns.captainEmail),
        latitude: coords ? coords.latitude : null,
        longitude: coords ? coords.longitude : null
      });
    });
    return byApn;
  } catch (err) {
    console.warn('[lot-weeding] context enrichment unavailable:', err.message);
    return new Map();
  }
}

function enrichRequestsWithContext(requests, contextByApn) {
  if (!(contextByApn instanceof Map) || contextByApn.size === 0) return requests;
  return (requests || []).map((request) => {
    const context = contextByApn.get(normalizeApnDigits(request.apn));
    if (!context) return request;
    return {
      ...request,
      zone: request.zone || context.zone || '',
      captainName: request.captainName || context.captainName || '',
      captainEmail: request.captainEmail || context.captainEmail || '',
      latitude: request.latitude ?? context.latitude ?? null,
      longitude: request.longitude ?? context.longitude ?? null
    };
  });
}

async function fetchLotWeedingValues({ sheetsClient, config, rangeOverride = '' }) {
  const result = await sheetsClient.spreadsheets.values.get({
    spreadsheetId: config.sheetId,
    range: rangeWithSheetName(config, rangeOverride)
  });
  return result.data && result.data.values ? result.data.values : [];
}

async function loadLotWeedingPayload({ sheetsClient, config, force = false }) {
  if (!config.sheetId) {
    return {
      configured: false,
      source: config.source,
      headers: [],
      requests: [],
      stats: summarizeRequests([])
    };
  }

  const now = Date.now();
  if (!force && cachedPayload && cachedPayload.expiresAt > now) {
    return cachedPayload.payload;
  }

  const values = await fetchLotWeedingValues({ sheetsClient, config });
  const parsed = normalizeSheetValues(values);
  const contextByApn = await loadContextByApn({ sheetsClient, config });
  const requests = enrichRequestsWithContext(
    normalizeLotWeedingRows(parsed.headers, parsed.rows),
    contextByApn
  );
  const payload = {
    configured: true,
    source: config.source,
    sheetName: config.sheetName,
    range: config.range,
    headers: parsed.headers,
    requests,
    stats: summarizeRequests(requests),
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

function clearLotWeedingCache() {
  cachedPayload = null;
}

function getEditableColumns(headers) {
  const columns = getLotWeedingColumns(headers || []);
  return {
    apn: columns.apn,
    status: columns.status,
    scheduledDate: columns.scheduledDate,
    homeownerNotified: columns.homeownerNotified,
    dateCleaned: columns.dateCleaned,
    roeStatus: columns.roeStatus,
    universalWasteContract: columns.universalWasteContract,
    lastContactDate: columns.lastContactDate,
    details: columns.details
  };
}

async function getEditableColumnsForUpdate({ sheetsClient, config }) {
  const cachedHeaders = cachedPayload &&
    cachedPayload.expiresAt > Date.now() &&
    Array.isArray(cachedPayload.payload && cachedPayload.payload.headers)
    ? cachedPayload.payload.headers
    : null;
  const headers = cachedHeaders || normalizeSheetValues(
    await fetchLotWeedingValues({ sheetsClient, config, rangeOverride: 'A1:ZZ1' })
  ).headers;
  return {
    editableColumns: getEditableColumns(headers),
    headerIndexByName: new Map(headers.map((header, index) => [header, index]))
  };
}

async function updateLotWeedingRequest({ sheetsClient, config, rowNumber, updates }) {
  if (!config.sheetId) {
    const err = new Error('Lot weeding source sheet is not configured.');
    err.code = 'LOT_WEEDING_NOT_CONFIGURED';
    throw err;
  }

  const { editableColumns, headerIndexByName } = await getEditableColumnsForUpdate({ sheetsClient, config });
  const data = [];

  Object.entries(updates || {}).forEach(([field, value]) => {
    const columnName = editableColumns[field];
    if (!columnName || !headerIndexByName.has(columnName)) return;
    const columnIndex = headerIndexByName.get(columnName);
    const columnLetter = indexToColumnLetter(columnIndex);
    const range = config.sheetName
      ? `${config.sheetName}!${columnLetter}${rowNumber}`
      : `${columnLetter}${rowNumber}`;
    data.push({
      range,
      values: [[value == null ? '' : String(value)]]
    });
  });

  if (data.length === 0) {
    const err = new Error('No editable lot weeding columns matched the requested update.');
    err.code = 'NO_EDITABLE_COLUMNS';
    throw err;
  }

  await sheetsClient.spreadsheets.values.batchUpdate({
    spreadsheetId: config.sheetId,
    requestBody: {
      valueInputOption: 'USER_ENTERED',
      data
    }
  });
  clearLotWeedingCache();
  return { updatedCells: data.length };
}

function indexToColumnLetter(index) {
  let number = index + 1;
  let letters = '';
  while (number > 0) {
    const remainder = (number - 1) % 26;
    letters = String.fromCharCode(65 + remainder) + letters;
    number = Math.floor((number - 1) / 26);
  }
  return letters;
}

function registerLotWeedingRoutes(app, deps) {
  const { getSheetsClient, hasLotWeedingAdminAccess } = deps;
  if (typeof getSheetsClient !== 'function') {
    throw new Error('registerLotWeedingRoutes: deps.getSheetsClient is required');
  }

  app.get('/api/lot-weeding/values', async (req, res) => {
    const config = getLotWeedingConfig();
    if (!config.sheetId) return res.json({ configured: false, values: [] });

    try {
      const sheetsClient = await getSheetsClient();
      const rangeOverride = req.query.range || '';
      const sheetName = req.query.sheetName || config.sheetName || '';
      const values = await fetchLotWeedingValues({
        sheetsClient,
        config: { ...config, sheetName },
        rangeOverride
      });
      return res.json({
        configured: true,
        source: config.source,
        values
      });
    } catch (err) {
      console.error('[lot-weeding] values read error:', err.message);
      const status = Number.isInteger(err && err.code) ? err.code : 500;
      return res.status(status).json({ error: 'lot_weeding_values_failed', message: err.message });
    }
  });

  app.get('/api/lot-weeding-admin/requests', async (req, res) => {
    const emailParam = String((req.query && req.query.email) || '').trim().toLowerCase();
    if (!emailParam) return res.status(401).json({ error: 'no_email' });

    try {
      const allowed = Boolean(typeof hasLotWeedingAdminAccess === 'function' && await hasLotWeedingAdminAccess(emailParam));
      if (!allowed) return res.status(401).json({ error: 'not_lot_weeding_admin' });

      const config = getLotWeedingConfig();
      const sheetsClient = await getSheetsClient();
      const payload = await loadLotWeedingPayload({
        sheetsClient,
        config,
        force: String(req.query.force || '') === '1'
      });
      res.set('Cache-Control', 'no-store');
      return res.json(payload);
    } catch (err) {
      console.error('[lot-weeding] admin requests read error:', err.message);
      return res.status(500).json({ error: 'lot_weeding_admin_failed', message: err.message });
    }
  });

  app.patch('/api/lot-weeding-admin/request-row', async (req, res) => {
    const emailParam = String((req.query && req.query.email) || '').trim().toLowerCase();
    if (!emailParam) return res.status(401).json({ error: 'no_email' });

    try {
      const allowed = Boolean(typeof hasLotWeedingAdminAccess === 'function' && await hasLotWeedingAdminAccess(emailParam));
      if (!allowed) return res.status(401).json({ error: 'not_lot_weeding_admin' });

      const rowNumber = Number.parseInt(String(req.body && req.body.rowNumber), 10);
      if (!Number.isInteger(rowNumber) || rowNumber < 2) {
        return res.status(400).json({ error: 'invalid_row_number' });
      }

      const allowedFields = new Set([
        'apn',
        'status',
        'scheduledDate',
        'homeownerNotified',
        'dateCleaned',
        'roeStatus',
        'universalWasteContract',
        'details'
      ]);
      const updates = {};
      Object.entries((req.body && req.body.updates) || {}).forEach(([field, value]) => {
        if (allowedFields.has(field)) updates[field] = value;
      });
      if (Object.keys(updates).length === 0) return res.status(400).json({ error: 'no_allowed_updates' });

      const config = getLotWeedingConfig();
      const sheetsClient = await getSheetsClient();
      const result = await updateLotWeedingRequest({ sheetsClient, config, rowNumber, updates });
      return res.json({ success: true, ...result });
    } catch (err) {
      if (err && err.code === 'LOT_WEEDING_NOT_CONFIGURED') {
        return res.status(503).json({ error: 'lot_weeding_not_configured', message: err.message });
      }
      if (err && err.code === 'NO_EDITABLE_COLUMNS') {
        return res.status(400).json({ error: 'no_editable_columns', message: err.message });
      }
      console.error('[lot-weeding] admin request update error:', err.message);
      return res.status(500).json({ error: 'lot_weeding_update_failed', message: err.message });
    }
  });
}

module.exports = {
  registerLotWeedingRoutes,
  getLotWeedingConfig,
  normalizeSheetValues,
  normalizeLotWeedingRows,
  getLotWeedingColumns,
  normalizeStatus,
  normalizeRoeStatus,
  clearLotWeedingCache
};

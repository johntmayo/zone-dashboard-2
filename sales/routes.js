'use strict';

let cachedPayload = null;

const DEFAULT_RANGE = 'A1:ZZ5000';
const DEFAULT_CACHE_TTL_MS = 5 * 60 * 1000;
const DEFAULT_SHEET_ID = '10DlHR_AblJPPtnO341WOKyJYJhCHa61UZ2-6whANGwg';
const DEFAULT_SHEET_NAME = 'Sales Rollup by APN';
const APN_DIGIT_LENGTH = 10;

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

function getSalesConfig() {
  return {
    sheetId: extractSpreadsheetId(
      strEnv('SALES_SOURCE_SHEET_ID') || strEnv('SALES_SOURCE_SHEET_URL') || DEFAULT_SHEET_ID
    ),
    sheetName: strEnv('SALES_SOURCE_SHEET_NAME', DEFAULT_SHEET_NAME),
    range: strEnv('SALES_SOURCE_RANGE', DEFAULT_RANGE),
    cacheTtlMs: intEnv('SALES_CACHE_TTL_MS', DEFAULT_CACHE_TTL_MS)
  };
}

function rangeWithSheetName(config) {
  const range = String(config.range || DEFAULT_RANGE).trim();
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
  const aliasKeys = new Set(aliases.map(normalizeKey));
  return headers.find((header) => aliasKeys.has(normalizeKey(header))) ||
    headers.find((header) => {
      const lower = String(header || '').toLowerCase();
      return typeof fallbackMatcher === 'function' && fallbackMatcher(lower);
    }) ||
    null;
}

function getSalesColumns(headers) {
  return {
    apn: findColumn(headers, [
      'apn',
      'ain',
      'parcel',
      'parcel number',
      'parcel id',
      'assessor parcel number',
      'assessor identification number'
    ], (lower) => /\b(apn|ain)\b/.test(lower) || lower.includes('parcel')),
    address: findColumn(headers, [
      'address',
      'property address',
      'site address',
      'situs address'
    ], (lower) => lower.includes('address')),
    latestSaleDate: findColumn(headers, [
      'latest sale date',
      'sale date',
      'sold date',
      'recording date',
      'date sold'
    ], (lower) => (lower.includes('sale') || lower.includes('sold') || lower.includes('recording')) && lower.includes('date')),
    latestSalePrice: findColumn(headers, [
      'latest sale price',
      'sale price',
      'sold price',
      'purchase price',
      'price'
    ], (lower) => (lower.includes('sale') || lower.includes('sold') || lower.includes('purchase')) && lower.includes('price')),
    latestNewOwner: findColumn(headers, [
      'latest new owner',
      'buyer',
      'buyer name',
      'new owner',
      'owner',
      'grantee',
      'purchaser'
    ], (lower) => lower.includes('buyer') || lower.includes('new owner') || lower.includes('grantee') || lower.includes('purchaser')),
    salesHistory: findColumn(headers, [
      'sales history',
      'sale history',
      'history'
    ], (lower) => lower.includes('histor')),
    soldSinceFire: findColumn(headers, [
      'address - sold since fire',
      'sold since fire',
      'post-fire sale',
      'post fire sale'
    ], (lower) => lower.includes('sold') && lower.includes('fire'))
  };
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
      return { rowNumber: index + 2, record };
    })
    .filter(({ record }) => Object.values(record).some((value) => String(value || '').trim()));
  return { headers, rows: dataRows };
}

function getValue(record, columnName) {
  return columnName ? String(record[columnName] || '').trim() : '';
}

function isTruthy(value) {
  return ['true', 'yes', 'y', '1', 'x', 'sold'].includes(String(value || '').trim().toLowerCase());
}

function formatSheetDate(value) {
  const text = String(value || '').trim();
  if (!text) return '';
  const numericValue = Number(text);
  if (Number.isFinite(numericValue) && numericValue > 20000 && numericValue < 80000) {
    const date = new Date(Date.UTC(1899, 11, 30) + numericValue * 24 * 60 * 60 * 1000);
    return date.toISOString().slice(0, 10);
  }
  return text;
}

function normalizeSalesRows(headers, rows) {
  const columns = getSalesColumns(headers || []);
  if (!columns.apn) return [];

  return (rows || []).map(({ rowNumber, record }) => {
    const apn = getValue(record, columns.apn);
    const apnDigits = String(apn || '').replace(/\D/g, '');
    const explicitSoldValue = getValue(record, columns.soldSinceFire);
    return {
      rowNumber,
      apn,
      apnDigits,
      address: getValue(record, columns.address),
      soldSinceFire: columns.soldSinceFire ? isTruthy(explicitSoldValue) : true,
      latestSaleDate: formatSheetDate(getValue(record, columns.latestSaleDate)),
      latestSalePrice: getValue(record, columns.latestSalePrice),
      latestNewOwner: getValue(record, columns.latestNewOwner),
      salesHistory: getValue(record, columns.salesHistory),
    };
  }).filter((record) => record.apnDigits.length === APN_DIGIT_LENGTH);
}

async function loadSalesPayload({ sheetsClient, config, force = false }) {
  if (!config.sheetId) {
    return { configured: false, records: [], lastFetchedAt: null };
  }

  const now = Date.now();
  if (!force && cachedPayload && cachedPayload.expiresAt > now) {
    return cachedPayload.payload;
  }

  const result = await sheetsClient.spreadsheets.values.get({
    spreadsheetId: config.sheetId,
    range: rangeWithSheetName(config),
    valueRenderOption: 'FORMATTED_VALUE'
  });
  const parsed = normalizeSheetValues(result.data && result.data.values);
  const payload = {
    configured: true,
    records: normalizeSalesRows(parsed.headers, parsed.rows),
    lastFetchedAt: new Date().toISOString()
  };

  if (config.cacheTtlMs > 0) {
    cachedPayload = { expiresAt: now + config.cacheTtlMs, payload };
  }
  return payload;
}

function clearSalesCache() {
  cachedPayload = null;
}

function registerSalesRoutes(app, deps) {
  const { getSheetsClient } = deps;
  if (typeof getSheetsClient !== 'function') {
    throw new Error('registerSalesRoutes: deps.getSheetsClient is required');
  }

  app.get('/api/sales/records', async (req, res) => {
    try {
      const config = getSalesConfig();
      if (!config.sheetId) {
        res.set('Cache-Control', 'no-store');
        return res.json({ configured: false, records: [], lastFetchedAt: null });
      }
      const sheetsClient = await getSheetsClient();
      const payload = await loadSalesPayload({
        sheetsClient,
        config,
        force: String(req.query.force || '') === '1'
      });
      res.set('Cache-Control', 'no-store');
      return res.json(payload);
    } catch (err) {
      console.error('[sales] records read error:', err.message);
      const status = Number.isInteger(err && err.code) ? err.code : 500;
      return res.status(status).json({ error: 'sales_records_failed', message: err.message });
    }
  });
}

module.exports = {
  registerSalesRoutes,
  getSalesConfig,
  getSalesColumns,
  normalizeSheetValues,
  normalizeSalesRows,
  loadSalesPayload,
  clearSalesCache
};

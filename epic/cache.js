'use strict';

// Read/write layer for the EPIC cache. The cache lives in a dedicated Google
// Sheet (EPIC_CACHE_SHEET_ID) with two tabs:
//   - epic_cases   : one row per case, keyed by casenumber
//   - epic_sync_meta : key/value run metadata (latest status, counts, errors)
//
// This module isolates every Sheets API call for EPIC so the rest of the code
// stays free of spreadsheet mechanics and could be swapped for a DB later.

const {
  CACHE_COLUMNS,
  META_COLUMNS,
  recordToRow,
  rowToRecord
} = require('./normalize');

const LAST_COLUMN_LETTER = columnIndexToLetter(CACHE_COLUMNS.length - 1);

function columnIndexToLetter(index) {
  let letter = '';
  let n = index;
  while (n >= 0) {
    letter = String.fromCharCode((n % 26) + 65) + letter;
    n = Math.floor(n / 26) - 1;
  }
  return letter;
}

// Ensure both tabs exist with the right headers. Creates missing tabs and
// writes the header row. Idempotent.
async function ensureTabs(sheets, cacheSheetId, { cacheTab, metaTab }) {
  const meta = await sheets.spreadsheets.get({ spreadsheetId: cacheSheetId });
  const existingTitles = new Set(
    (meta.data.sheets || []).map((s) => s && s.properties && s.properties.title)
  );

  const addRequests = [];
  if (!existingTitles.has(cacheTab)) {
    addRequests.push({ addSheet: { properties: { title: cacheTab } } });
  }
  if (!existingTitles.has(metaTab)) {
    addRequests.push({ addSheet: { properties: { title: metaTab } } });
  }
  if (addRequests.length) {
    await sheets.spreadsheets.batchUpdate({
      spreadsheetId: cacheSheetId,
      requestBody: { requests: addRequests }
    });
  }

  // Write/repair headers on each tab (read first to avoid clobbering if a
  // human has customized order; if headers differ, we overwrite with the
  // canonical ordering because downstream code depends on it).
  const [cacheHeaderRes, metaHeaderRes] = await Promise.all([
    sheets.spreadsheets.values.get({ spreadsheetId: cacheSheetId, range: `${cacheTab}!1:1` }).catch(() => ({ data: {} })),
    sheets.spreadsheets.values.get({ spreadsheetId: cacheSheetId, range: `${metaTab}!1:1` }).catch(() => ({ data: {} }))
  ]);

  const cacheHeader = (cacheHeaderRes.data && cacheHeaderRes.data.values && cacheHeaderRes.data.values[0]) || [];
  const metaHeader = (metaHeaderRes.data && metaHeaderRes.data.values && metaHeaderRes.data.values[0]) || [];

  const updates = [];
  if (!arraysEqual(cacheHeader, CACHE_COLUMNS)) {
    updates.push({
      range: `${cacheTab}!A1:${LAST_COLUMN_LETTER}1`,
      values: [CACHE_COLUMNS]
    });
  }
  if (!arraysEqual(metaHeader, META_COLUMNS)) {
    updates.push({
      range: `${metaTab}!A1:C1`,
      values: [META_COLUMNS]
    });
  }
  if (updates.length) {
    await sheets.spreadsheets.values.batchUpdate({
      spreadsheetId: cacheSheetId,
      requestBody: { valueInputOption: 'RAW', data: updates }
    });
  }
}

function arraysEqual(a, b) {
  if (!Array.isArray(a) || !Array.isArray(b)) return false;
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    if (String(a[i] || '').trim() !== String(b[i] || '').trim()) return false;
  }
  return true;
}

// Read all rows from the cache tab. Returns { records, casenumberToRowNumber }.
// casenumberToRowNumber maps casenumber -> 1-based sheet row number (>=2).
async function readAllRecords(sheets, cacheSheetId, cacheTab) {
  const res = await sheets.spreadsheets.values.get({
    spreadsheetId: cacheSheetId,
    range: `${cacheTab}!A2:${LAST_COLUMN_LETTER}`
  });
  const rows = (res.data && res.data.values) || [];
  const records = [];
  const casenumberToRowNumber = new Map();
  rows.forEach((row, i) => {
    const rec = rowToRecord(row);
    const key = String(rec.casenumber || '').trim();
    if (!key) return;
    records.push(rec);
    casenumberToRowNumber.set(key, i + 2); // +2 because A2 is row 2
  });
  return { records, casenumberToRowNumber };
}

// Write records into the cache tab, upserting by casenumber. Does NOT delete
// rows that weren't in this run - we preserve history so a transient source
// outage can't wipe the cache. Returns { inserted, updated }.
async function upsertRecords(sheets, cacheSheetId, cacheTab, records) {
  if (!records.length) return { inserted: 0, updated: 0 };

  const { casenumberToRowNumber } = await readAllRecords(sheets, cacheSheetId, cacheTab);

  // Determine current last data row so appends go in the right place.
  const endRes = await sheets.spreadsheets.values.get({
    spreadsheetId: cacheSheetId,
    range: `${cacheTab}!A:A`
  });
  const colA = (endRes.data && endRes.data.values) || [];
  let nextAppendRow = Math.max(colA.length, 1) + 1; // 1-based; header is row 1

  const toUpdate = []; // { range, values }
  const toAppend = [];

  for (const rec of records) {
    const key = String(rec.casenumber || '').trim();
    if (!key) continue;
    const row = recordToRow(rec);
    const existingRowNum = casenumberToRowNumber.get(key);
    if (existingRowNum) {
      toUpdate.push({
        range: `${cacheTab}!A${existingRowNum}:${LAST_COLUMN_LETTER}${existingRowNum}`,
        values: [row]
      });
    } else {
      toAppend.push({
        range: `${cacheTab}!A${nextAppendRow}:${LAST_COLUMN_LETTER}${nextAppendRow}`,
        values: [row]
      });
      casenumberToRowNumber.set(key, nextAppendRow); // guard against duplicate casenumbers in input
      nextAppendRow += 1;
    }
  }

  // Chunk batchUpdate calls so we don't exceed request size limits on large
  // syncs. 500 ranges per batch is well under the Sheets limit.
  const all = toUpdate.concat(toAppend);
  const CHUNK = 500;
  for (let i = 0; i < all.length; i += CHUNK) {
    const chunk = all.slice(i, i + CHUNK);
    await sheets.spreadsheets.values.batchUpdate({
      spreadsheetId: cacheSheetId,
      requestBody: { valueInputOption: 'RAW', data: chunk }
    });
  }

  return { inserted: toAppend.length, updated: toUpdate.length };
}

// Meta tab uses key/value/updated_at rows. We read the existing set, then
// upsert each passed-in key.
async function readMeta(sheets, cacheSheetId, metaTab) {
  const res = await sheets.spreadsheets.values.get({
    spreadsheetId: cacheSheetId,
    range: `${metaTab}!A2:C`
  }).catch(() => ({ data: {} }));
  const rows = (res.data && res.data.values) || [];
  const map = {};
  rows.forEach((row, i) => {
    const key = String(row[0] || '').trim();
    if (!key) return;
    map[key] = { value: row[1] == null ? '' : row[1], updated_at: row[2] || '', rowNumber: i + 2 };
  });
  return map;
}

async function writeMeta(sheets, cacheSheetId, metaTab, entries) {
  if (!entries || !Object.keys(entries).length) return;

  const existing = await readMeta(sheets, cacheSheetId, metaTab);

  const now = new Date().toISOString();
  const endRes = await sheets.spreadsheets.values.get({
    spreadsheetId: cacheSheetId,
    range: `${metaTab}!A:A`
  }).catch(() => ({ data: {} }));
  const colA = (endRes.data && endRes.data.values) || [];
  let nextAppendRow = Math.max(colA.length, 1) + 1;

  const data = [];
  for (const [key, value] of Object.entries(entries)) {
    const row = [key, value == null ? '' : String(value), now];
    const existingEntry = existing[key];
    if (existingEntry) {
      data.push({ range: `${metaTab}!A${existingEntry.rowNumber}:C${existingEntry.rowNumber}`, values: [row] });
    } else {
      data.push({ range: `${metaTab}!A${nextAppendRow}:C${nextAppendRow}`, values: [row] });
      nextAppendRow += 1;
    }
  }

  if (data.length) {
    await sheets.spreadsheets.values.batchUpdate({
      spreadsheetId: cacheSheetId,
      requestBody: { valueInputOption: 'RAW', data }
    });
  }
}

module.exports = {
  ensureTabs,
  readAllRecords,
  upsertRecords,
  readMeta,
  writeMeta,
  LAST_COLUMN_LETTER,
  columnIndexToLetter
};

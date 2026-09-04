'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  getSalesConfig,
  normalizeSheetValues,
  normalizeSalesRows,
  loadSalesPayload,
  clearSalesCache
} = require('../sales/routes');

test('normalizeSalesRows maps EPN-keyed source columns to read-only records', () => {
  const parsed = normalizeSheetValues([
    ['EPN Number', 'Property Address', 'Sold Date', 'Sale Price', 'Buyer Name', 'Lot Sq Ft', 'Sales History', 'Sale Notes'],
    ['5842-001-020', '123 Lake Ave', '7/15/2026', '$925,000', 'Jane Buyer', '7,500', '2026 sale', 'Recorded transfer'],
    ['', 'No parcel', '7/20/2026', '$1', '', '', '', '']
  ]);

  const records = normalizeSalesRows(parsed.headers, parsed.rows);

  assert.equal(records.length, 1);
  assert.deepEqual(records[0], {
    rowNumber: 2,
    epn: '5842-001-020',
    address: '123 Lake Ave',
    saleDate: '7/15/2026',
    salePrice: '$925,000',
    buyer: 'Jane Buyer',
    lotSize: '7,500',
    history: '2026 sale',
    notes: 'Recorded transfer',
    soldSinceFire: true
  });
});

test('normalizeSalesRows accepts APN aliases and explicit sold-since-fire values', () => {
  const parsed = normalizeSheetValues([
    ['APN', 'Sale Date', 'Address - Sold Since Fire'],
    ['5842001020', '46218', 'FALSE'],
    ['5842001021', '46219', 'TRUE']
  ]);

  const records = normalizeSalesRows(parsed.headers, parsed.rows);

  assert.equal(records[0].saleDate, '2026-07-15');
  assert.equal(records[0].soldSinceFire, false);
  assert.equal(records[1].soldSinceFire, true);
});

test('getSalesConfig accepts a spreadsheet URL and source tab', (t) => {
  const original = {
    id: process.env.SALES_SOURCE_SHEET_ID,
    url: process.env.SALES_SOURCE_SHEET_URL,
    name: process.env.SALES_SOURCE_SHEET_NAME,
    range: process.env.SALES_SOURCE_RANGE
  };

  delete process.env.SALES_SOURCE_SHEET_ID;
  process.env.SALES_SOURCE_SHEET_URL = 'https://docs.google.com/spreadsheets/d/source-sheet-id/edit';
  process.env.SALES_SOURCE_SHEET_NAME = 'Sales';
  process.env.SALES_SOURCE_RANGE = 'A1:N';

  t.after(() => {
    Object.entries({
      SALES_SOURCE_SHEET_ID: original.id,
      SALES_SOURCE_SHEET_URL: original.url,
      SALES_SOURCE_SHEET_NAME: original.name,
      SALES_SOURCE_RANGE: original.range
    }).forEach(([key, value]) => {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    });
  });

  const config = getSalesConfig();
  assert.equal(config.sheetId, 'source-sheet-id');
  assert.equal(config.sheetName, 'Sales');
  assert.equal(config.range, 'A1:N');
});

test('loadSalesPayload caches normalized records without any write operation', async () => {
  clearSalesCache();
  let reads = 0;
  const sheetsClient = {
    spreadsheets: {
      values: {
        get: async () => {
          reads += 1;
          return { data: { values: [['EPN', 'Sale Date'], ['5842-001-020', '7/15/2026']] } };
        }
      }
    }
  };
  const config = {
    sheetId: 'sales-sheet',
    sheetName: '',
    range: 'A1:ZZ5000',
    cacheTtlMs: 30000
  };

  const first = await loadSalesPayload({ sheetsClient, config });
  const second = await loadSalesPayload({ sheetsClient, config });

  assert.equal(first.records.length, 1);
  assert.strictEqual(second, first);
  assert.equal(reads, 1);
  clearSalesCache();
});

'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const {
  getSalesConfig,
  normalizeSheetValues,
  normalizeSalesRows,
  loadSalesPayload,
  clearSalesCache
} = require('../sales/routes');

test('normalizeSalesRows maps the Sales Rollup by APN contract', () => {
  const parsed = normalizeSheetValues([
    ['Address', 'APN', 'Address - Sold Since Fire', 'Sales History', 'Sale Count', 'Latest Sale Date', 'Latest Sale Price', 'Latest New Owner', 'Lot SqFt', 'Latitude', 'Longitude'],
    ['123 Lake Ave', '5842-001-020', 'TRUE', '[Jul 15, 2026] Second sale\n[Mar 2, 2025] First sale', '2', '7/15/2026', '$925,000', 'Jane Buyer', '7,500', '34.1', '-118.1']
  ]);

  const records = normalizeSalesRows(parsed.headers, parsed.rows);

  assert.equal(records.length, 1);
  assert.deepEqual(records[0], {
    rowNumber: 2,
    apn: '5842-001-020',
    apnDigits: '5842001020',
    address: '123 Lake Ave',
    soldSinceFire: true,
    latestSaleDate: '7/15/2026',
    latestSalePrice: '$925,000',
    latestNewOwner: 'Jane Buyer',
    salesHistory: '[Jul 15, 2026] Second sale\n[Mar 2, 2025] First sale'
  });
});

test('normalizeSalesRows converts date serials and excludes malformed APNs', () => {
  const parsed = normalizeSheetValues([
    ['APN', 'Latest Sale Date', 'Address - Sold Since Fire'],
    ['5842001020', '46218', 'FALSE'],
    ['5842001021', '46219', 'TRUE'],
    ['Irregular property: Forest service cabin 1', '46220', 'TRUE'],
    ['', '46221', 'TRUE']
  ]);

  const records = normalizeSalesRows(parsed.headers, parsed.rows);

  assert.equal(records.length, 2);
  assert.equal(records[0].latestSaleDate, '2026-07-15');
  assert.equal(records[0].soldSinceFire, false);
  assert.equal(records[1].soldSinceFire, true);
});

test('getSalesConfig defaults to the maintained rollup spreadsheet', (t) => {
  const names = [
    'SALES_SOURCE_SHEET_ID',
    'SALES_SOURCE_SHEET_URL',
    'SALES_SOURCE_SHEET_NAME',
    'SALES_SOURCE_RANGE',
    'SALES_CACHE_TTL_MS'
  ];
  const original = Object.fromEntries(names.map((name) => [name, process.env[name]]));
  names.forEach((name) => delete process.env[name]);
  t.after(() => names.forEach((name) => {
    if (original[name] === undefined) delete process.env[name];
    else process.env[name] = original[name];
  }));

  const config = getSalesConfig();
  assert.equal(config.sheetId, '10DlHR_AblJPPtnO341WOKyJYJhCHa61UZ2-6whANGwg');
  assert.equal(config.sheetName, 'Sales Rollup by APN');
  assert.equal(config.cacheTtlMs, 300000);
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
          return { data: { values: [['APN', 'Latest Sale Date'], ['5842-001-020', '7/15/2026']] } };
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

test('central sales APN helper does not shadow the existing homepage helper', () => {
  const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
  assert.equal((html.match(/function getAddressSalesApnDigits\(/g) || []).length, 1);
  assert.equal((html.match(/function getAddressApnDigits\(/g) || []).length, 1);
  assert.match(html, /getAddressSalesApnDigits\(address\)\.forEach/);
});

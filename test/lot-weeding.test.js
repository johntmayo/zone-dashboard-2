'use strict';

const test = require('node:test');
const assert = require('node:assert');

const {
  getLotWeedingConfig,
  normalizeSheetValues,
  normalizeLotWeedingRows
} = require('../lot-weeding/routes');

test('normalizeLotWeedingRows: maps messy intake columns to stable request fields', () => {
  const parsed = normalizeSheetValues([
    ['Timestamp', 'Property Address', 'Assessor Parcel Number', 'Request Status', 'Scheduled Date', 'Owner Email', 'Notes'],
    ['6/1/2026 10:30 AM', '123 Lake Ave', '5842-001-020', 'Requested', '', 'owner@example.com', 'Gate is unlocked'],
    ['6/2/2026 11:00 AM', '456 Pine St', '', 'Completed', '7/15/2026', '', '']
  ]);

  const rows = normalizeLotWeedingRows(parsed.headers, parsed.rows);

  assert.strictEqual(rows.length, 2);
  assert.strictEqual(rows[0].address, '123 Lake Ave');
  assert.strictEqual(rows[0].apn, '5842-001-020');
  assert.strictEqual(rows[0].status, 'Open');
  assert.strictEqual(rows[0].email, 'owner@example.com');
  assert.strictEqual(rows[0].details, 'Gate is unlocked');
  assert.strictEqual(rows[1].status, 'Completed');
  assert.strictEqual(rows[1].scheduledDate, '7/15/2026');
});

test('getLotWeedingConfig: prefers source sheet env vars over mirror fallback', (t) => {
  const original = {
    sourceId: process.env.LOT_WEEDING_SOURCE_SHEET_ID,
    sourceUrl: process.env.LOT_WEEDING_SOURCE_SHEET_URL,
    intakeId: process.env.LOT_WEEDING_INTAKE_SHEET_ID,
    mirrorId: process.env.LOT_WEEDING_SHEET_ID
  };

  process.env.LOT_WEEDING_SOURCE_SHEET_ID = 'source-sheet-id';
  process.env.LOT_WEEDING_SHEET_ID = 'mirror-sheet-id';
  delete process.env.LOT_WEEDING_SOURCE_SHEET_URL;
  delete process.env.LOT_WEEDING_INTAKE_SHEET_ID;

  t.after(() => {
    Object.entries({
      LOT_WEEDING_SOURCE_SHEET_ID: original.sourceId,
      LOT_WEEDING_SOURCE_SHEET_URL: original.sourceUrl,
      LOT_WEEDING_INTAKE_SHEET_ID: original.intakeId,
      LOT_WEEDING_SHEET_ID: original.mirrorId
    }).forEach(([key, value]) => {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    });
  });

  const config = getLotWeedingConfig();
  assert.strictEqual(config.sheetId, 'source-sheet-id');
  assert.strictEqual(config.source, 'original');
});

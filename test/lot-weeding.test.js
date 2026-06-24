'use strict';

const test = require('node:test');
const assert = require('node:assert');

const {
  getLotWeedingConfig,
  normalizeSheetValues,
  normalizeLotWeedingRows,
  normalizeStatus,
  normalizeRoeStatus
} = require('../lot-weeding/routes');

test('normalizeLotWeedingRows: maps revised intake columns to stable request fields', () => {
  const parsed = normalizeSheetValues([
    ['Request Submission Date Stamp', 'Name of Homeowner', 'Address of Property', 'Phone Number of Homeowner', 'Email of Homeowner', 'Universal Waste Systems contract Y/N', 'Last contact date', 'Date Scheduled', 'Homeowner notified of schedule', 'Date Cleaned', 'ROE Status', 'Notes', 'APN', 'Status'],
    ['6/1/2026 10:30 AM', 'Jane Owner', '123 Lake Ave', '6265551212', 'owner@example.com', 'yes', '6/3/2026', '', 'No', '', 'Requested', 'Gate is unlocked', '5842-001-020', 'On-Deck'],
    ['6/2/2026 11:00 AM', 'Sam Owner', '456 Pine St', '', '', 'No', '', '7/15/2026', 'Yes', '7/20/2026', 'Returned', '', '', 'Cleaned']
  ]);

  const rows = normalizeLotWeedingRows(parsed.headers, parsed.rows);

  assert.strictEqual(rows.length, 2);
  assert.strictEqual(rows[0].timestamp, '6/1/2026 10:30 AM');
  assert.strictEqual(rows[0].requesterName, 'Jane Owner');
  assert.strictEqual(rows[0].address, '123 Lake Ave');
  assert.strictEqual(rows[0].apn, '5842-001-020');
  assert.strictEqual(rows[0].status, 'On-Deck');
  assert.strictEqual(rows[0].email, 'owner@example.com');
  assert.strictEqual(rows[0].universalWasteContract, 'Yes');
  assert.strictEqual(rows[0].homeownerNotified, 'No');
  assert.strictEqual(rows[0].roeStatus, 'Requested');
  assert.strictEqual(rows[0].details, 'Gate is unlocked');
  assert.strictEqual(rows[1].status, 'Cleaned');
  assert.strictEqual(rows[1].scheduledDate, '7/15/2026');
  assert.strictEqual(rows[1].dateCleaned, '7/20/2026');
  assert.strictEqual(rows[1].roeStatus, 'Returned');
});

test('normalizeLotWeedingRows: remains compatible with old mirror-style columns', () => {
  const parsed = normalizeSheetValues([
    ['Timestamp', 'Property Address', 'Assessor Parcel Number', 'Request Status', 'Scheduled Date', 'Owner Email', 'Notes'],
    ['6/1/2026 10:30 AM', '123 Lake Ave', '5842-001-020', 'Requested', '', 'owner@example.com', 'Gate is unlocked'],
    ['6/2/2026 11:00 AM', '456 Pine St', '', 'Completed', '7/15/2026', '', '']
  ]);

  const rows = normalizeLotWeedingRows(parsed.headers, parsed.rows);

  assert.strictEqual(rows[0].status, 'Requested');
  assert.strictEqual(rows[1].status, 'Cleaned');
});

test('normalizeStatus: maps old and revised status values to canonical operations values', () => {
  assert.strictEqual(normalizeStatus('Requested'), 'Requested');
  assert.strictEqual(normalizeStatus('On deck'), 'On-Deck');
  assert.strictEqual(normalizeStatus('Scheduled'), 'Scheduled');
  assert.strictEqual(normalizeStatus('Completed'), 'Cleaned');
  assert.strictEqual(normalizeStatus('Needs Attention'), 'Needs Attention');
  assert.strictEqual(normalizeStatus('Cancelled'), 'Cancelled');
});

test('normalizeRoeStatus: treats legacy boolean returned values as Returned', () => {
  assert.strictEqual(normalizeRoeStatus('Requested'), 'Requested');
  assert.strictEqual(normalizeRoeStatus('Returned'), 'Returned');
  assert.strictEqual(normalizeRoeStatus('TRUE'), 'Returned');
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

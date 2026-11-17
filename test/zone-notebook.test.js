'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  normalizeZoneKey,
  normalizeDateInput,
  normalizeMultiline,
  buildZoneNameIndex,
  resolveZoneForCaller,
  buildRowValues,
  mapEventRow,
  sortEvents,
  EVENT_HEADERS,
  EVENT_FIELD_ALIASES,
  ISSUE_HEADERS,
  ISSUE_FIELD_ALIASES
} = require('../zone-notebook/routes');

const extractId = (url) => {
  const match = String(url || '').match(/\/spreadsheets\/d\/([a-zA-Z0-9-_]+)/);
  return match ? match[1] : '';
};
const sheetUrl = (id) => `https://docs.google.com/spreadsheets/d/${id}/edit`;

test('normalizeZoneKey: "Zone 12", "zone-12" and "12" compare equal', () => {
  assert.equal(normalizeZoneKey('Zone 12'), '12');
  assert.equal(normalizeZoneKey('zone-12'), '12');
  assert.equal(normalizeZoneKey('12'), '12');
  assert.equal(normalizeZoneKey('Zone 3A'), '3a');
  assert.notEqual(normalizeZoneKey('Zone 1'), normalizeZoneKey('Zone 11'));
});

test('normalizeDateInput: accepts ISO and US dates, rejects junk', () => {
  assert.equal(normalizeDateInput('2026-03-04'), '2026-03-04');
  assert.equal(normalizeDateInput('3/4/2026'), '2026-03-04');
  assert.equal(normalizeDateInput('3/4/26'), '2026-03-04');
  assert.equal(normalizeDateInput(''), '');
  assert.equal(normalizeDateInput('2026-02-30'), null);
  assert.equal(normalizeDateInput('sometime in spring'), null);
});

test('normalizeMultiline: trims and collapses runs of blank lines', () => {
  assert.equal(normalizeMultiline('  a  \r\n\r\n\r\n\r\nb  '), 'a\n\nb');
});

test('buildZoneNameIndex: captain rows win, admins ignored, majority spelling wins', () => {
  const usersMap = {
    'a@x.com': [{ url: sheetUrl('S1'), name: 'Zone 12', role: 'captain' }],
    'b@x.com': [{ url: sheetUrl('S1'), name: 'Zone 12', role: 'captain' }],
    'c@x.com': [{ url: sheetUrl('S1'), name: 'zone 12 ', role: 'captain' }],
    'admin@x.com': [{ url: sheetUrl('S1'), name: 'Admin Label', role: 'admin' }, { url: sheetUrl('S2'), name: 'Zone 4', role: 'admin' }]
  };
  const index = buildZoneNameIndex(usersMap, extractId);
  assert.equal(index.get('S1'), 'Zone 12');
  assert.equal(index.has('S2'), false);
});

test('resolveZoneForCaller: captains only reach their own zone; admins reach any', () => {
  const zoneIndex = new Map([['S1', 'Zone 12'], ['S2', 'Zone 4']]);
  const captainRows = [{ url: sheetUrl('S1'), name: 'Zone 12', role: 'captain' }];
  assert.equal(resolveZoneForCaller({ rows: captainRows, isAdmin: false, sheetId: 'S1', zoneIndex, extractId }), 'Zone 12');
  assert.equal(resolveZoneForCaller({ rows: captainRows, isAdmin: false, sheetId: 'S2', zoneIndex, extractId }), '');
  assert.equal(resolveZoneForCaller({ rows: captainRows, isAdmin: false, sheetId: '', zoneIndex, extractId }), '');
  assert.equal(resolveZoneForCaller({ rows: [{ role: 'admin' }], isAdmin: true, sheetId: 'S2', zoneIndex, extractId }), 'Zone 4');
  assert.equal(resolveZoneForCaller({ rows: [{ role: 'admin' }], isAdmin: true, sheetId: 'UNKNOWN', zoneIndex, extractId }), '');
});

test('buildRowValues: writes by header name and keeps extra columns', () => {
  const headers = ['Zone', 'Issues', 'Owner Notes', 'Last Updated By', 'Last Updated On'];
  const existing = ['Zone 12', 'old', 'keep me', 'a@x.com', '2026-01-01'];
  const values = buildRowValues(headers, existing, {
    zone: 'Zone 12',
    issues: 'new',
    lastUpdatedBy: 'b@x.com',
    lastUpdatedOn: '2026-02-02'
  }, ISSUE_FIELD_ALIASES);
  assert.deepEqual(values, ['Zone 12', 'new', 'keep me', 'b@x.com', '2026-02-02']);
  assert.equal(ISSUE_HEADERS.length, 4);
});

test('mapEventRow: reads the default Events headers and normalizes sheet-formatted dates', () => {
  const row = ['evt_1', 'Zone 12', 'Block party', '3/14/2026', 'Bring chairs', 'a@x.com', '2026-03-01T00:00:00Z', '', ''];
  const item = mapEventRow(EVENT_HEADERS, row, 2);
  assert.equal(item.id, 'evt_1');
  assert.equal(item.date, '2026-03-14');
  assert.equal(item.notes, 'Bring chairs');
  assert.equal(item.rowNumber, 2);
  const roundTrip = buildRowValues(EVENT_HEADERS, row, { event: 'Block party (moved)' }, EVENT_FIELD_ALIASES);
  assert.equal(roundTrip[2], 'Block party (moved)');
  assert.equal(roundTrip[0], 'evt_1');
});

test('sortEvents: newest dated events first, undated last', () => {
  const sorted = sortEvents([
    { event: 'Undated', date: '', addedOn: '2026-05-01' },
    { event: 'Older', date: '2025-06-01', addedOn: '2025-06-02' },
    { event: 'Newer', date: '2026-02-01', addedOn: '2026-02-02' }
  ]);
  assert.deepEqual(sorted.map((e) => e.event), ['Newer', 'Older', 'Undated']);
});

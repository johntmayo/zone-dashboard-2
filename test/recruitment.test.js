'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  extractSpreadsheetId,
  parseEnabledFlag,
  normalizeKey,
  normalizeText,
  mapPlaceRow,
  mapEventRow,
  mapPhoneBankRow,
  mapLinkRow,
  inferLinkSection,
  mapRecordToHeaders,
  sortPlaces,
  sortEvents,
  isDuplicatePlace,
  isDuplicateEvent,
  parseLooseDate,
  nameFromEmail,
  PLACE_HEADERS,
  EVENT_HEADERS,
  PLACE_FIELD_ALIASES
} = require('../recruitment/routes');

test('extractSpreadsheetId: accepts id or full URL', () => {
  assert.equal(extractSpreadsheetId('1AbCdefGhIJ'), '1AbCdefGhIJ');
  assert.equal(
    extractSpreadsheetId('https://docs.google.com/spreadsheets/d/1AbCdefGhIJ/edit#gid=0'),
    '1AbCdefGhIJ'
  );
  assert.equal(extractSpreadsheetId(''), '');
});

test('parseEnabledFlag: defaults on, honors off values', () => {
  assert.equal(parseEnabledFlag('', true), true);
  assert.equal(parseEnabledFlag('0', true), false);
  assert.equal(parseEnabledFlag('false', true), false);
  assert.equal(parseEnabledFlag('off', true), false);
  assert.equal(parseEnabledFlag('1', false), true);
  assert.equal(parseEnabledFlag('yes', false), true);
});

test('normalize helpers collapse punctuation and whitespace', () => {
  assert.equal(normalizeKey('Captain Email'), 'captainemail');
  assert.equal(normalizeText('  Rotary   Club  '), 'Rotary Club');
});

test('nameFromEmail: turns local-part into a display name', () => {
  assert.equal(nameFromEmail('jane.doe@example.com'), 'Jane Doe');
});

test('mapPlaceRow: reads aliased headers and omits email from the public item', () => {
  const headers = ['Created', 'Business Name', 'Captain Name', 'Captain Email', 'Zone'];
  const row = {
    Created: '2026-09-09T12:00:00.000Z',
    'Business Name': 'Fox’s',
    'Captain Name': 'Maria',
    'Captain Email': 'maria@example.com',
    Zone: '4'
  };
  assert.deepEqual(mapPlaceRow(row, headers, 2), {
    id: 'place-2',
    timestamp: '2026-09-09T12:00:00.000Z',
    place: 'Fox’s',
    captainName: 'Maria',
    zone: '4'
  });
});

test('mapEventRow and mapPhoneBankRow: map the campaign columns', () => {
  const event = mapEventRow({
    Event: 'Rotary Club',
    When: 'Wednesday, September 9',
    'Captain Name': 'Lee',
    Timestamp: '2026-09-08T18:00:00.000Z',
    Zone: '7'
  }, ['Timestamp', 'Event', 'When', 'Captain Name', 'Zone'], 3);
  assert.equal(event.event, 'Rotary Club');
  assert.equal(event.when, 'Wednesday, September 9');
  assert.equal(event.captainName, 'Lee');

  const session = mapPhoneBankRow({
    Date: 'Sept 12',
    Time: '6:00 PM',
    Title: 'Townwide phone bank',
    'Virtual Join Link': 'https://example.com/join',
    'In-Person Location': 'EFC, 540 W. Woodbury Road',
    Notes: 'Bring a laptop'
  }, ['Date', 'Time', 'Title', 'Virtual Join Link', 'In-Person Location', 'Notes'], 2);
  assert.equal(session.joinUrl, 'https://example.com/join');
  assert.equal(session.title, 'Townwide phone bank');
  assert.equal(session.inPersonLocation, 'EFC, 540 W. Woodbury Road');
});

test('mapLinkRow: uses Filename/Link aliases and infers section from the label', () => {
  const fromFilename = mapLinkRow({
    Filename: 'Recruitment flyer.pdf',
    Link: 'https://example.com/flyer.pdf'
  }, ['Filename', 'Link'], 2);
  assert.deepEqual(fromFilename, {
    id: 'link-2',
    label: 'Recruitment flyer.pdf',
    url: 'https://example.com/flyer.pdf',
    section: 'places'
  });

  const explicit = mapLinkRow({
    Label: 'Townwide one-pager',
    URL: 'https://example.com/onepager',
    Section: 'Events'
  }, ['Label', 'URL', 'Section'], 3);
  assert.equal(explicit.section, 'events');
});

test('inferLinkSection: label keywords and explicit section names', () => {
  assert.equal(inferLinkSection('Phone bank script', ''), 'phonebank');
  assert.equal(inferLinkSection('Meeting pitch script', ''), 'events');
  assert.equal(inferLinkSection('Become a captain', ''), 'invite');
  assert.equal(inferLinkSection('Townwide one-pager', 'Places'), 'places');
  assert.equal(inferLinkSection('Something else', ''), 'all');
});

test('mapRecordToHeaders: writes fields into the live header order', () => {
  const values = mapRecordToHeaders(
    ['Captain Email', 'Place', 'Timestamp', 'Zone', 'Captain Name'],
    {
      timestamp: 'ts',
      place: 'Library',
      captainName: 'Ada',
      captainEmail: 'ada@example.com',
      zone: '2'
    },
    PLACE_FIELD_ALIASES
  );
  assert.deepEqual(values, ['ada@example.com', 'Library', 'ts', '2', 'Ada']);
});

test('sortPlaces: newest timestamp first', () => {
  const sorted = sortPlaces([
    { place: 'A', timestamp: '2026-09-01T00:00:00.000Z' },
    { place: 'B', timestamp: '2026-09-09T00:00:00.000Z' }
  ]);
  assert.equal(sorted[0].place, 'B');
});

test('sortEvents: upcoming dates first, then newest signups', () => {
  const sorted = sortEvents([
    { event: 'Past', when: 'January 1, 2020', timestamp: '2026-09-09T00:00:00.000Z' },
    { event: 'Soon', when: 'December 1, 2026', timestamp: '2026-09-01T00:00:00.000Z' },
    { event: 'Also soon', when: 'November 1, 2026', timestamp: '2026-09-02T00:00:00.000Z' }
  ]);
  assert.equal(sorted[0].event, 'Also soon');
  assert.equal(sorted[1].event, 'Soon');
  assert.equal(sorted[2].event, 'Past');
});

test('isDuplicatePlace / isDuplicateEvent: match captain + item', () => {
  const placeHeaders = PLACE_HEADERS;
  const placeRows = [{
    Timestamp: 'ts',
    Place: 'Fox’s',
    'Captain Name': 'Maria',
    'Captain Email': 'maria@example.com',
    Zone: '4'
  }];
  assert.equal(isDuplicatePlace(placeRows, placeHeaders, 'fox’s', 'maria@example.com'), true);
  assert.equal(isDuplicatePlace(placeRows, placeHeaders, 'Other Cafe', 'maria@example.com'), false);

  const eventHeaders = EVENT_HEADERS;
  const eventRows = [{
    Timestamp: 'ts',
    Event: 'Rotary Club',
    When: 'Wednesday, September 9',
    'Captain Name': 'Lee',
    'Captain Email': 'lee@example.com',
    Zone: '7'
  }];
  assert.equal(
    isDuplicateEvent(eventRows, eventHeaders, 'Rotary Club', 'Wednesday, September 9', 'lee@example.com'),
    true
  );
  assert.equal(
    isDuplicateEvent(eventRows, eventHeaders, 'Rotary Club', 'Thursday', 'lee@example.com'),
    false
  );
});

test('parseLooseDate: accepts ISO and US dates', () => {
  assert.ok(parseLooseDate('2026-09-09T12:00:00.000Z'));
  assert.equal(parseLooseDate('9/9/2026').getMonth(), 8);
  assert.equal(parseLooseDate(''), null);
});

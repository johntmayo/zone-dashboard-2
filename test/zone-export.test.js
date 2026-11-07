'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  NEIGHBORS_ADDRESSEE,
  DEFAULT_CONTACT_FIELD_IDS,
  resolveExportFields,
  findExportColumn,
  resolveSelectedFieldIds,
  summarizeExportRows,
  buildContactExport,
  formatAddressee,
  buildMailingLabelExport,
  escapeCsvCell,
  toCsv,
  buildExportFilename
} = require('../public/js/zone-export');

const headers = [
  'Zone Name', 'NC Name', 'NC Email',
  '_SitusHouseNo', '_SitusDirection', '_SitusStreet', '_SitusUnit', 'City', 'State', 'Zip',
  'Resident Name', 'Home Phone', 'Cell Phone', 'Email Address', 'Damage', 'Age',
  'Build Status', 'Address Plan', 'Remediation Status', 'Last Outreach Attempt Date',
  'Former Resident', 'Deceased', 'Address Placeholder', 'resident_id', 'address_id'
];

function row(values) {
  const base = {
    'Zone Name': 'Zone 7', 'NC Name': 'Captain Cora', 'NC Email': 'cora@example.org',
    City: 'Altadena', State: 'CA', Zip: '91001', Damage: 'Destroyed (>50%)'
  };
  return Object.assign(base, values);
}

const rowsByAddress = new Map([
  ['123 N MAIN ST', [
    row({ _SitusHouseNo: '123', _SitusDirection: 'N', _SitusStreet: 'MAIN ST', 'Resident Name': 'Jane Smith', 'Email Address': 'jane@example.com', Age: '44', 'Address Plan': 'Rebuild' }),
    row({ _SitusHouseNo: '123', _SitusDirection: 'N', _SitusStreet: 'MAIN ST', 'Resident Name': 'John Smith', 'Cell Phone': '626-555-0101' }),
    row({ _SitusHouseNo: '123', _SitusDirection: 'N', _SitusStreet: 'MAIN ST', 'Resident Name': 'Old Owner', 'Former Resident': 'TRUE' }),
    row({ _SitusHouseNo: '123', _SitusDirection: 'N', _SitusStreet: 'MAIN ST', 'Resident Name': 'Late Neighbor', Deceased: 'TRUE', 'Former Resident': 'TRUE' })
  ]],
  ['45 OAK AVE, Unit 2', [
    row({ _SitusHouseNo: '45', _SitusStreet: 'OAK AVE', _SitusUnit: '2', 'Resident Name': 'Placeholder Resident', 'Address Placeholder': 'TRUE', Zip: '' })
  ]]
]);
const addresses = Array.from(rowsByAddress.keys());

test('field catalog avoids captain columns and the Damage/Age mix-up', () => {
  assert.equal(findExportColumn(headers, 'email'), 'Email Address');
  assert.equal(findExportColumn(headers, 'age'), 'Age');
  const fields = resolveExportFields(headers);
  const name = fields.find((f) => f.id === 'name');
  assert.deepEqual(name.columns, ['Resident Name']);
  assert.equal(fields.some((f) => f.group === 'other'), false);
});

test('admins also get unclaimed sheet columns', () => {
  const other = resolveExportFields(headers, { includeOtherColumns: true })
    .filter((f) => f.group === 'other')
    .map((f) => f.label);
  assert.ok(other.includes('resident_id'));
  assert.ok(other.includes('NC Email'));
  assert.ok(!other.includes('Email Address'));
  assert.ok(!other.includes('_SitusStreet'));
});

test('defaults leave Address Plan and Remediation Status optional', () => {
  const fields = resolveExportFields(headers);
  const ids = resolveSelectedFieldIds(fields, null);
  assert.ok(!ids.includes('addressPlan'));
  assert.ok(!ids.includes('remediationStatus'));
  assert.ok(ids.includes('zip'));
  assert.deepEqual(ids, DEFAULT_CONTACT_FIELD_IDS.filter((id) => fields.some((f) => f.id === id)));
});

test('saved selections drop fields this sheet lacks and fall back when empty', () => {
  const fields = resolveExportFields(headers);
  assert.deepEqual(resolveSelectedFieldIds(fields, ['email', 'gender', 'addressPlan']), ['email', 'addressPlan']);
  assert.deepEqual(resolveSelectedFieldIds(fields, ['gender']), resolveSelectedFieldIds(fields, null));
});

test('contact export: current residents only, address fields on every row', () => {
  const result = buildContactExport({
    headers,
    addressMap: rowsByAddress,
    addresses,
    fieldIds: ['address', 'zip', 'name', 'cellPhone', 'email', 'damage']
  });
  assert.deepEqual(result.headers, ['Address', 'ZIP', 'Name', 'Cell Phone', 'Email', 'Damage Status']);
  assert.deepEqual(result.rows, [
    ['123 N MAIN ST', '91001', 'Jane Smith', '', 'jane@example.com', 'Destroyed (>50%)'],
    ['123 N MAIN ST', '91001', 'John Smith', '626-555-0101', '', 'Destroyed (>50%)'],
    ['45 OAK AVE Unit 2', '', '', '', '', 'Destroyed (>50%)']
  ]);
  assert.deepEqual(summarizeExportRows({ headers, addressMap: rowsByAddress, addresses }), {
    addresses: 2, people: 2, emptyAddresses: 1
  });
});

test('mailing labels: one row per address, destroyed and empty addresses included', () => {
  const result = buildMailingLabelExport({ headers, addressMap: rowsByAddress, addresses, addresseeMode: 'neighbors' });
  assert.deepEqual(result.headers, ['Addressee', 'Street Address', 'City', 'State', 'ZIP', 'Resident Names', 'Damage Status']);
  assert.deepEqual(result.rows, [
    [NEIGHBORS_ADDRESSEE, '123 N MAIN ST', 'Altadena', 'CA', '91001', 'Jane Smith; John Smith', 'Destroyed (>50%)'],
    [NEIGHBORS_ADDRESSEE, '45 OAK AVE Unit 2', 'Altadena', 'CA', '', '', 'Destroyed (>50%)']
  ]);
  assert.deepEqual(result.stats, { labels: 2, missingCity: 0, missingState: 0, missingZip: 1 });
});

test('addressee modes', () => {
  assert.equal(formatAddressee(['Jane Smith'], 'neighbors'), 'Our Neighbors');
  assert.equal(formatAddressee(['Jane Smith'], 'blank'), '');
  assert.equal(formatAddressee([], 'names'), 'Our Neighbors');
  assert.equal(formatAddressee(['Jane Smith'], 'names'), 'Jane Smith');
  assert.equal(formatAddressee(['Jane Smith', 'John Smith'], 'names'), 'Jane Smith & John Smith');
  assert.equal(formatAddressee(['Jane Smith', 'John Smith', 'Kid Smith'], 'names'), 'Jane Smith & Family');
  assert.equal(
    formatAddressee(['Bartholomew Montgomery', 'Wilhelmina Fairweather'], 'names'),
    'Bartholomew Montgomery & Family'
  );
});

test('CSV output is Excel and mail-merge friendly', () => {
  const csv = toCsv(['Name', 'Notes'], [['Peña, José', 'said "hi"\nlater']]);
  assert.ok(csv.startsWith('\uFEFF'));
  assert.equal(csv, '\uFEFFName,Notes\r\n"Peña, José","said ""hi""\nlater"\r\n');
  assert.equal(escapeCsvCell('=HYPERLINK("x")'), '"\'=HYPERLINK(""x"")"');
  assert.equal(escapeCsvCell('+1 626 555 0101'), '+1 626 555 0101');
  assert.equal(escapeCsvCell('-'), '-');
});

test('export filenames are readable', () => {
  assert.equal(buildExportFilename('Zone 7 — Lake & Mariposa', 'mailing-labels', new Date(2026, 10, 6)), 'zone-7-lake-mariposa-mailing-labels-2026-11-06.csv');
  assert.equal(buildExportFilename('', 'contacts', new Date(2026, 0, 2)), 'zone-contacts-2026-01-02.csv');
});

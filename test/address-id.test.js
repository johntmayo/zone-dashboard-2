'use strict';

// Tests for address_id identity helpers. Run with:
//   npm run test:address-id

const test = require('node:test');
const assert = require('node:assert');

const {
  generateAddressId,
  normalizeAddressIdText,
  normalizeAddressIdDirection,
  normalizeAddressIdStreet,
  buildCanonicalAddressKey,
  findAddressIdsForCanonicalKey,
  resolveAddressIdForAddRecord,
  ADDRESS_ID_PREFIX
} = require('../public/js/address-id');

test('generateAddressId: prefixed UUID v4 shape', () => {
  const id = generateAddressId();
  assert.ok(id.startsWith(ADDRESS_ID_PREFIX));
  assert.match(
    id,
    /^addr_[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
  );
});

test('normalizeAddressIdText: trim, uppercase, collapse spaces, strip .,#,', () => {
  assert.strictEqual(normalizeAddressIdText('  calaveras  st. '), 'CALAVERAS ST');
  assert.strictEqual(normalizeAddressIdText('#2'), '2');
  assert.strictEqual(normalizeAddressIdText('1/2'), '1/2');
  assert.strictEqual(normalizeAddressIdText(null), '');
});

test('normalizeAddressIdDirection: abbreviation map only', () => {
  assert.strictEqual(normalizeAddressIdDirection('n'), 'NORTH');
  assert.strictEqual(normalizeAddressIdDirection('SW'), 'SOUTHWEST');
  assert.strictEqual(normalizeAddressIdDirection('NORTH'), 'NORTH');
  assert.strictEqual(normalizeAddressIdDirection('XYZ'), 'XYZ');
});

test('normalizeAddressIdStreet: final-token suffix only, exact tokens', () => {
  assert.strictEqual(normalizeAddressIdStreet('Calaveras St'), 'CALAVERAS STREET');
  assert.strictEqual(normalizeAddressIdStreet('Calaveras Street'), 'CALAVERAS STREET');
  assert.strictEqual(normalizeAddressIdStreet('Calaveras Ct'), 'CALAVERAS COURT');
  assert.notStrictEqual(
    normalizeAddressIdStreet('Calaveras St'),
    normalizeAddressIdStreet('Calaveras Ct')
  );
  assert.strictEqual(normalizeAddressIdStreet('Lake Ave'), 'LAKE AVENUE');
  assert.strictEqual(normalizeAddressIdStreet('Oak'), 'OAK');
});

test('buildCanonicalAddressKey: situs + city/state/zip only', () => {
  const headers = [
    '_SitusHouseNo',
    '_SitusDirection',
    '_SitusStreet',
    '_SitusUnit',
    'City',
    'State',
    'Zip',
    'House',
    'Street',
    'address_id'
  ];
  const row = {
    _SitusHouseNo: '123',
    _SitusDirection: 'N',
    _SitusStreet: 'Calaveras St',
    _SitusUnit: '1/2',
    City: 'Altadena',
    State: 'CA',
    Zip: '91001',
    House: '999',
    Street: 'Wrong St'
  };
  assert.strictEqual(
    buildCanonicalAddressKey(row, headers),
    '123|NORTH|CALAVERAS STREET|1/2|ALTADENA|CA|91001'
  );

  const sameViaStreet = {
    ...row,
    _SitusStreet: 'Calaveras Street'
  };
  assert.strictEqual(
    buildCanonicalAddressKey(row, headers),
    buildCanonicalAddressKey(sameViaStreet, headers)
  );

  const differentCourt = {
    ...row,
    _SitusStreet: 'Calaveras Ct'
  };
  assert.notStrictEqual(
    buildCanonicalAddressKey(row, headers),
    buildCanonicalAddressKey(differentCourt, headers)
  );
});

test('buildCanonicalAddressKey: ignores legacy House/Street when situs present', () => {
  const headers = ['_SitusHouseNo', '_SitusStreet', 'House', 'Street', 'City', 'State', 'Zip'];
  const a = {
    _SitusHouseNo: '10',
    _SitusStreet: 'Main St',
    House: '99',
    Street: 'Other',
    City: 'Altadena',
    State: 'CA',
    Zip: '91001'
  };
  const b = {
    _SitusHouseNo: '10',
    _SitusStreet: 'Main Street',
    House: '1',
    Street: 'Totally Different',
    City: 'Altadena',
    State: 'CA',
    Zip: '91001'
  };
  assert.strictEqual(buildCanonicalAddressKey(a, headers), buildCanonicalAddressKey(b, headers));
});

test('findAddressIdsForCanonicalKey / resolveAddressIdForAddRecord: reuse, mint, conflict', () => {
  const headers = [
    '_SitusHouseNo',
    '_SitusDirection',
    '_SitusStreet',
    '_SitusUnit',
    'City',
    'State',
    'Zip',
    'address_id',
    'resident_id'
  ];
  const sheetRows = [
    {
      _SitusHouseNo: '123',
      _SitusDirection: 'N',
      _SitusStreet: 'Lake Ave',
      _SitusUnit: '',
      City: 'Altadena',
      State: 'CA',
      Zip: '91001',
      address_id: 'addr_aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      resident_id: 'r1'
    },
    {
      _SitusHouseNo: '123',
      _SitusDirection: 'N',
      _SitusStreet: 'Lake Avenue',
      _SitusUnit: '',
      City: 'Altadena',
      State: 'CA',
      Zip: '91001',
      address_id: 'addr_aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      resident_id: 'r2'
    }
  ];

  const key = buildCanonicalAddressKey(sheetRows[0], headers);
  assert.deepStrictEqual(findAddressIdsForCanonicalKey(sheetRows, headers, key).ids, [
    'addr_aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
  ]);

  const reuseValues = {
    _SitusHouseNo: '123',
    _SitusDirection: 'N',
    _SitusStreet: 'Lake Ave',
    City: 'Altadena',
    State: 'CA',
    Zip: '91001'
  };
  const reused = resolveAddressIdForAddRecord(headers, reuseValues, { sheetRows });
  assert.strictEqual(reused.status, 'reused');
  assert.strictEqual(reused.addressId, 'addr_aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa');
  assert.strictEqual(reuseValues.address_id, reused.addressId);

  const mintValues = {
    _SitusHouseNo: '999',
    _SitusDirection: '',
    _SitusStreet: 'Brand New Rd',
    _SitusUnit: '',
    City: 'Altadena',
    State: 'CA',
    Zip: '91001'
  };
  const minted = resolveAddressIdForAddRecord(headers, mintValues, { sheetRows });
  assert.strictEqual(minted.status, 'minted');
  assert.ok(minted.addressId.startsWith('addr_'));
  assert.strictEqual(mintValues.address_id, minted.addressId);

  const conflictRows = [
    ...sheetRows,
    {
      ...sheetRows[0],
      address_id: 'addr_bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
      resident_id: 'r3'
    }
  ];
  const conflictValues = { ...reuseValues };
  delete conflictValues.address_id;
  const conflicted = resolveAddressIdForAddRecord(headers, conflictValues, { sheetRows: conflictRows });
  assert.strictEqual(conflicted.status, 'conflict');
  assert.strictEqual(conflicted.addressId, '');
  assert.strictEqual(conflictValues.address_id, '');
});

test('resolveAddressIdForAddRecord: column absent and no-address paths', () => {
  const noCol = resolveAddressIdForAddRecord(['resident_id'], {}, {});
  assert.strictEqual(noCol.status, 'column_absent');

  const headers = ['address_id', '_SitusHouseNo', '_SitusStreet', 'City', 'State', 'Zip'];
  const blank = {};
  const noAddress = resolveAddressIdForAddRecord(headers, blank, { sheetRows: [] });
  assert.strictEqual(noAddress.status, 'no_address');
  assert.strictEqual(blank.address_id, '');
});

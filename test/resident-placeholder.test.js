'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  PLACEHOLDER_RESIDENT_NAME,
  generateResidentId,
  findAddressPlaceholderColumn,
  isAddressPlaceholder,
  setAddressPlaceholderValue,
  classifyResidentNameChange
} = require('../public/js/resident-placeholder');

const headers = ['Resident Name', 'resident_id', 'Address Placeholder'];

test('address-placeholder creation uses a UUID and a real TRUE boolean', () => {
  const row = {
    'Resident Name': PLACEHOLDER_RESIDENT_NAME,
    resident_id: generateResidentId()
  };
  setAddressPlaceholderValue(headers, row, true);

  assert.match(row.resident_id, /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i);
  assert.equal(typeof row['Address Placeholder'], 'boolean');
  assert.equal(row['Address Placeholder'], true);
  assert.equal(isAddressPlaceholder(row, headers), true);
});

test('converting a placeholder keeps its UUID and writes a real FALSE boolean', () => {
  const residentId = generateResidentId();
  const row = {
    'Resident Name': PLACEHOLDER_RESIDENT_NAME,
    resident_id: residentId,
    'Address Placeholder': true
  };

  assert.equal(
    classifyResidentNameChange(row['Resident Name'], 'Jamie Rivera', isAddressPlaceholder(row, headers)),
    'placeholder_conversion'
  );
  row['Resident Name'] = 'Jamie Rivera';
  setAddressPlaceholderValue(headers, row, false);

  assert.equal(row.resident_id, residentId);
  assert.equal(row['Address Placeholder'], false);
  assert.equal(typeof row['Address Placeholder'], 'boolean');
});

test('ordinary resident name changes require an identity decision', () => {
  assert.equal(
    classifyResidentNameChange('Jamie Rivera', 'Jamie R. Rivera', false),
    'real_resident_change'
  );
  assert.equal(
    classifyResidentNameChange('Jamie Rivera', 'Morgan Rivera', false),
    'real_resident_change'
  );
});

test('missing and blank Address Placeholder values are false', () => {
  assert.equal(findAddressPlaceholderColumn(['Resident Name']), null);
  assert.equal(isAddressPlaceholder({ 'Resident Name': 'Jamie' }, ['Resident Name']), false);
  assert.equal(isAddressPlaceholder({ 'Address Placeholder': '' }, headers), false);
  assert.equal(isAddressPlaceholder({ 'Address Placeholder': false }, headers), false);
  assert.equal(isAddressPlaceholder({ 'Address Placeholder': 'FALSE' }, headers), false);
});

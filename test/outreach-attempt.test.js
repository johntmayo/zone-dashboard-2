'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const {
  findOutreachDateColumn,
  hasPersonOutreachAttempt,
  canMeasureOutreachAttempt
} = require('../public/js/utils');

const headers = ['Last Outreach Attempt Date', 'Outreach Log', 'Successfully Contacted', 'Resident Name'];

test('Successfully Contacted counts as outreach even without a date or log', () => {
  assert.equal(hasPersonOutreachAttempt({
    'Successfully Contacted': 'TRUE',
    'Last Outreach Attempt Date': '',
    'Outreach Log': ''
  }, headers), true);
});

test('checkbox true and yes also count as Successfully Contacted', () => {
  assert.equal(hasPersonOutreachAttempt({ 'Successfully Contacted': true }, headers), true);
  assert.equal(hasPersonOutreachAttempt({ 'Successfully Contacted': 'yes' }, headers), true);
  assert.equal(hasPersonOutreachAttempt({ 'Successfully Contacted': 'FALSE' }, headers), false);
  assert.equal(hasPersonOutreachAttempt({ 'Successfully Contacted': '' }, headers), false);
});

test('an outreach date or log still counts on its own', () => {
  assert.equal(hasPersonOutreachAttempt({
    'Last Outreach Attempt Date': 'Apr 16, 2026',
    'Successfully Contacted': ''
  }, headers), true);
  assert.equal(hasPersonOutreachAttempt({
    'Outreach Log': '[Historical] Left a flyer.',
    'Successfully Contacted': ''
  }, headers), true);
  assert.equal(hasPersonOutreachAttempt({
    'Last Outreach Attempt Date': 'Historical',
    'Successfully Contacted': ''
  }, headers), true);
});

test('a person with no date, log, or successful contact is not outreach attempted', () => {
  assert.equal(hasPersonOutreachAttempt({
    'Successfully Contacted': '',
    'Last Outreach Attempt Date': '',
    'Outreach Log': ''
  }, headers), false);
  assert.equal(hasPersonOutreachAttempt({
    'Last Outreach Attempt Date': '—',
    'Outreach Log': '-'
  }, headers), false);
});

test('Successfully Contacted is never treated as the outreach date column', () => {
  assert.equal(findOutreachDateColumn(headers), 'Last Outreach Attempt Date');
  assert.equal(
    findOutreachDateColumn(['Successfully Contacted', 'Wants Updates']),
    null
  );
});

test('outreach can be measured from date, log, or Successfully Contacted', () => {
  assert.equal(canMeasureOutreachAttempt(headers), true);
  assert.equal(canMeasureOutreachAttempt(['Successfully Contacted']), true);
  assert.equal(canMeasureOutreachAttempt(['Resident Name', 'Email']), false);
});

test('dashboard counting surfaces use the shared outreach helper', () => {
  const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
  assert.match(html, /function isAddressContacted\(address\) \{[\s\S]*?hasPersonOutreachAttempt\(row, headers\)/);
  assert.match(html, /function addressMatchesOutreachVisibility\(address\)/);
  assert.match(html, /if \(isAddressContacted\(address\)\) contactedCount\+\+/);
  assert.match(html, /if \(isAddressContacted\(address\)\) contacted\+\+/);
  assert.match(html, /if \(!isAddressContacted\(address\)\) \{\s*uncontactedCount\+\+/);
  assert.match(html, /const hasContact = Boolean\(person\.hasOutreachAttempt\)/);
  assert.match(html, /hasGodmodeTruthyValue\(getGodmodeValue\(row, GODMODE_FIELD_ALIASES\.successfullyContacted\)\)/);
});

'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const css = fs.readFileSync(path.join(root, 'public/css/styles.css'), 'utf8');

test('Successfully Contacted is a persistent person tag, not a campaign write', () => {
  assert.match(html, /const SUCCESSFULLY_CONTACTED_HELP_TEXT = 'Have you ever had a successful two-way interaction with this person\?/);
  assert.match(html, /Sending an email, leaving a voicemail, or dropping off a flyer does not count unless they responded\./);
  assert.match(html, /function isSuccessfullyContactedColumn\(colName\) \{[\s\S]*?\/\^successfully\[\\s_-\]\*contacted\$\/i/);
  assert.match(html, /function getPersonQuickTagColumns\(headers\) \{[\s\S]*?isSuccessfullyContactedColumn\(col\)/);
  assert.match(html, /function isPersonQuickTagCheckbox\(colName\) \{[\s\S]*?isSuccessfullyContactedColumn\(colName\)/);
  assert.match(html, /isSuccessfullyContactedColumn\(col\) \? renderSuccessfullyContactedHelpTip\(\)/);
  assert.match(html, /options\.helpTip \? renderSuccessfullyContactedHelpTip\(\)/);
  assert.doesNotMatch(html, /\/api\/contact-checkin\/review/);
});

test('Batch Tagging exposes Successfully contacted separately from outreach status', () => {
  assert.match(html, /id="batchPersonSuccessfullyContacted"/);
  assert.match(html, /id="batchPersonSuccessfullyContactedHelp"/);
  assert.match(html, /Have you ever had a successful interaction with this person\?/);
  assert.match(html, /<option value="TRUE">Yes — two-way contact<\/option>/);
  assert.match(html, /successfullyContactedValue === 'FALSE' \? '' : successfullyContactedValue/);
  assert.match(html, /column: successfullyContactedCol, value: successfullyContactedWriteValue/);
  assert.match(html, /id="batchPersonContacted"[\s\S]*?Mark outreach attempted/);
});

test('Successfully contacted help uses a hover tip, not campaign progress UI', () => {
  assert.match(css, /\.field-help-tip:hover::after,\s*\.field-help-tip:focus::after \{[\s\S]*?content: attr\(data-tip\)/);
  assert.match(html, /class="field-help-tip"/);
  assert.doesNotMatch(html, /saveReviewRecord\(/);
});

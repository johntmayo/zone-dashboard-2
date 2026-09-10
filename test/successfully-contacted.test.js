'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const css = fs.readFileSync(path.join(root, 'public/css/styles.css'), 'utf8');

test('Successfully Contacted is a persistent person tag, not a campaign write', () => {
  assert.match(html, /const SUCCESSFULLY_CONTACTED_HELP_TEXT = 'A one-time historical record\. Have you ever had a successful two-way interaction with this person\?'/);
  assert.match(html, /function isSuccessfullyContactedColumn\(colName\) \{[\s\S]*?normalizePersonTagColumnKey\(colName\) === 'successfully contacted'/);
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

test('Successfully contacted help uses a floating hover tip, not campaign progress UI', () => {
  assert.match(css, /\.field-help-tooltip-floating \{[\s\S]*?position: fixed/);
  assert.match(html, /function initFieldHelpTooltipBehavior\(\)/);
  assert.match(html, /field-help-tooltip-floating/);
  assert.match(html, /class="field-help-tip"/);
  assert.doesNotMatch(html, /saveReviewRecord\(/);
});

test('details panel keeps Successfully Contacted in Quick tags and away from outreach date', () => {
  assert.match(html, /function buildDetailsPanelQuickTagCols\(headers, quickTagCols, personLevelCols\)/);
  assert.match(html, /const personTagCols = buildDetailsPanelQuickTagCols\(headers, quickTagCols, personLevelCols\)/);
  assert.match(html, /if \(successfullyContactedCol\) renderedFields\.delete\(successfullyContactedCol\)/);
  assert.match(html, /html \+= '<\/div><\/section>';[\s\S]*?findOutreachDateColumn\(headers\)[\s\S]*?const outreachLogCol/);
});

test('findOutreachDateColumn ignores Successfully Contacted headers', () => {
  const utils = fs.readFileSync(path.join(root, 'public/js/utils.js'), 'utf8');
  assert.match(utils, /function isSuccessfullyContactedHeader\(header\)/);
  assert.match(utils, /filter\(h => !isSuccessfullyContactedHeader\(h\)\)/);
});

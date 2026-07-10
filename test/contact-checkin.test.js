'use strict';

const test = require('node:test');
const assert = require('node:assert');

const {
  buildReviewKey,
  summarizeReviews,
  DEFAULT_CHECK_IN_ID
} = require('../contact-checkin/routes');

test('buildReviewKey: deterministic and lowercases captain', () => {
  assert.strictEqual(
    buildReviewKey('contact_check_in_2026', 'Alpine Villa', 'Captain@Example.com', 'addr_abc'),
    'contact_check_in_2026__Alpine Villa__captain@example.com__addr_abc'
  );
});

test('summarizeReviews: counts reviewed/skipped/reached/remaining', () => {
  const rows = [
    { review_status: 'reviewed', answer: 'yes_successful_contact' },
    { review_status: 'reviewed', answer: 'no_successful_contact' },
    { review_status: 'skipped', answer: '' },
    { review_status: 'reviewed', answer: 'yes_successful_contact' }
  ];
  const summary = summarizeReviews(rows, 10);
  assert.strictEqual(summary.reviewed, 3);
  assert.strictEqual(summary.skipped, 1);
  assert.strictEqual(summary.reached, 2);
  assert.strictEqual(summary.noContact, 1);
  assert.strictEqual(summary.remaining, 7);
  assert.strictEqual(summary.total, 10);
  assert.strictEqual(summary.percentReviewed, 30);
  assert.ok(DEFAULT_CHECK_IN_ID);
});

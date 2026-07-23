'use strict';

const test = require('node:test');
const assert = require('node:assert');

const {
  buildReviewKey,
  summarizeReviews,
  buildCommunitySummary,
  buildAdminReport,
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

test('buildCommunitySummary: aggregates unique addresses, zones, captains, recent activity', () => {
  const now = Date.parse('2026-07-10T18:00:00.000Z');
  const rows = [
    {
      check_in_id: 'contact_check_in_2026',
      zone_id: 'Alpine Villa',
      captain_id: 'a@example.com',
      address_id: 'addr_1',
      review_status: 'reviewed',
      answer: 'yes_successful_contact',
      reviewed_at: '2026-07-10T12:00:00.000Z'
    },
    {
      check_in_id: 'contact_check_in_2026',
      zone_id: 'Alpine Villa',
      captain_id: 'a@example.com',
      address_id: 'addr_2',
      review_status: 'reviewed',
      answer: 'no_successful_contact',
      reviewed_at: '2026-07-10T13:00:00.000Z'
    },
    {
      check_in_id: 'contact_check_in_2026',
      zone_id: 'Lower Meadows',
      captain_id: 'b@example.com',
      address_id: 'addr_3',
      review_status: 'skipped',
      answer: '',
      reviewed_at: '2026-07-09T10:00:00.000Z'
    },
    {
      check_in_id: 'other_campaign',
      zone_id: 'Other Zone',
      captain_id: 'c@example.com',
      address_id: 'addr_9',
      review_status: 'reviewed',
      answer: 'yes_successful_contact',
      reviewed_at: '2026-07-10T12:00:00.000Z'
    }
  ];
  const community = buildCommunitySummary(rows, {
    checkInId: 'contact_check_in_2026',
    nowMs: now
  });
  assert.strictEqual(community.reviewedAddresses, 2);
  assert.strictEqual(community.reached, 1);
  assert.strictEqual(community.skipped, 1);
  assert.strictEqual(community.zonesParticipating, 2);
  assert.strictEqual(community.captainsParticipating, 2);
  assert.strictEqual(community.reviewedLast48h, 2);
  assert.ok(community.highlights.some((h) => h.type === 'town_milestone' && h.count === 2));
  assert.ok(community.highlights.some((h) => h.type === 'zone_progress' && h.zone === 'Alpine Villa'));
});

test('buildAdminReport: per-zone/per-captain rollups + deduped contacted addresses', () => {
  const rows = [
    // Alpine Villa: two captains, one address contacted by both (co-captains)
    {
      check_in_id: 'contact_check_in_2026', zone_id: 'Alpine Villa', captain_id: 'A@Example.com',
      address_id: 'addr_1', review_status: 'reviewed', answer: 'yes_successful_contact',
      reviewed_at: '2026-07-10T12:00:00.000Z'
    },
    {
      check_in_id: 'contact_check_in_2026', zone_id: 'Alpine Villa', captain_id: 'b@example.com',
      address_id: 'addr_1', review_status: 'reviewed', answer: 'yes_successful_contact',
      reviewed_at: '2026-07-09T12:00:00.000Z'
    },
    {
      check_in_id: 'contact_check_in_2026', zone_id: 'Alpine Villa', captain_id: 'a@example.com',
      address_id: 'addr_2', review_status: 'reviewed', answer: 'no_successful_contact',
      reviewed_at: '2026-07-10T13:00:00.000Z'
    },
    // Lower Meadows: skipped only
    {
      check_in_id: 'contact_check_in_2026', zone_id: 'Lower Meadows', captain_id: 'c@example.com',
      address_id: 'addr_3', review_status: 'skipped', answer: '',
      reviewed_at: '2026-07-08T10:00:00.000Z'
    },
    // Different campaign — must be excluded
    {
      check_in_id: 'other', zone_id: 'Zed', captain_id: 'z@example.com',
      address_id: 'addr_9', review_status: 'reviewed', answer: 'yes_successful_contact',
      reviewed_at: '2026-07-10T12:00:00.000Z'
    }
  ];

  const report = buildAdminReport(rows, { checkInId: 'contact_check_in_2026' });

  const alpine = report.zones.find((z) => z.zoneId === 'Alpine Villa');
  assert.ok(alpine);
  assert.strictEqual(alpine.reviewedAddresses, 2);       // addr_1, addr_2 (deduped)
  assert.strictEqual(alpine.reachedAddresses, 1);        // addr_1 only
  assert.strictEqual(alpine.noContactAddresses, 1);      // addr_2
  assert.strictEqual(alpine.captains.length, 2);

  const meadows = report.zones.find((z) => z.zoneId === 'Lower Meadows');
  assert.strictEqual(meadows.skippedAddresses, 1);
  assert.strictEqual(meadows.reviewedAddresses, 0);

  // Excluded campaign zone should not appear
  assert.ok(!report.zones.some((z) => z.zoneId === 'Zed'));

  // Contacted addresses deduped to one, earliest timestamp + both captains
  assert.strictEqual(report.contactedAddresses.length, 1);
  const contacted = report.contactedAddresses[0];
  assert.strictEqual(contacted.addressId, 'addr_1');
  assert.strictEqual(contacted.captains.length, 2);
  assert.strictEqual(contacted.contactedAt, '2026-07-09T12:00:00.000Z');

  // Captain rollup lowercases and dedupes address ids
  const capA = report.captains.find((c) => c.captainId === 'a@example.com');
  assert.strictEqual(capA.reviewedAddresses, 2);
  assert.strictEqual(capA.reachedAddresses, 1);
});

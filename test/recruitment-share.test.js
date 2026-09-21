'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');

test('recruitment actions keep the requested two-column order', () => {
  const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
  const firstColumnIndex = html.indexOf('<div class="recruitment-column">');
  const secondColumnIndex = html.indexOf('<div class="recruitment-column">', firstColumnIndex + 1);
  const nominateIndex = html.indexOf('id="recruitmentNominateCard"');
  const socialIndex = html.indexOf('id="recruitmentSocialCard"');
  const eventsIndex = html.indexOf('id="recruitmentEventsCard"');
  const placesIndex = html.indexOf('id="recruitmentPlacesCard"');

  assert.ok(firstColumnIndex > 0);
  assert.ok(nominateIndex > firstColumnIndex);
  assert.ok(socialIndex > nominateIndex);
  assert.ok(eventsIndex > socialIndex);
  assert.ok(eventsIndex < secondColumnIndex);
  assert.ok(placesIndex > secondColumnIndex);
  assert.equal(html.indexOf('id="recruitmentPhoneBankCard"'), -1);
  assert.match(html, /<h3>Post on social media<\/h3>/);
  assert.match(
    html,
    /class="recruitment-card recruitment-card--double-height" id="recruitmentPlacesCard"/
  );
});

test('onboarding tour does not reference the retired Actions tab', () => {
  const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
  const tourStart = html.indexOf('const ONBOARDING_TOUR_CARDS = [');
  const tourEnd = html.indexOf('let onboardingTourIndex = 0;', tourStart);
  const tourCards = html.slice(tourStart, tourEnd);

  assert.ok(tourStart > 0);
  assert.ok(tourEnd > tourStart);
  assert.doesNotMatch(tourCards, /ACTIONS.*tab/i);
  assert.match(tourCards, /QUICK ACTIONS.*HOME/);
});

test('recruitment share dialog exposes the expected accessible controls', () => {
  const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');

  assert.match(html, /id="recruitmentShareModal" role="dialog" aria-modal="true"/);
  assert.match(html, /aria-labelledby="recruitmentShareTitle"/);
  assert.match(html, /id="recruitmentShareClose" aria-label="Close share dialog"/);
  assert.match(html, /id="recruitmentShareDownload"/);
  assert.match(html, /id="recruitmentShareCopyPost"/);
  assert.match(html, /id="recruitmentShareCopyLink"/);
  assert.match(html, /role="group" aria-label="Choose a suggested post"/);
  assert.match(html, /data-recruitment-post-variant="altagether" aria-pressed="true"/);
  assert.match(html, /data-recruitment-post-variant="captain" aria-pressed="false"/);
  assert.match(html, /id="recruitmentShareStatus" role="status" aria-live="polite"/);
});

test('recruitment share content and labels live in the frontend config', () => {
  const script = fs.readFileSync(path.join(root, 'public', 'js', 'recruitment.js'), 'utf8');

  assert.match(script, /var SHARE_DRIVE_CONFIG = \{/);
  assert.match(script, /imagePath: '\/public\/images\/recruitment-drive-share\.png'/);
  assert.match(script, /defaultPostVariant: 'altagether'/);
  assert.match(script, /label: 'Altagether post'/);
  assert.match(script, /label: 'Captain post'/);
  assert.match(script, /'Learn more: altagether\.org\/join'/);
  assert.match(script, /I’m a Neighborhood Captain with Altagether/);
  assert.match(script, /take a look:\\naltagether\.org\/join/);
  assert.match(script, /recruitmentUrl: 'https:\/\/altagether\.org\/join'/);
  assert.match(script, /recruitmentUrlLabel: 'altagether\.org\/join'/);
  assert.match(script, /open: 'Share Recruitment Drive'/);
  assert.match(script, /copyPost: 'Copy post'/);
  assert.match(script, /copyLink: 'Copy link'/);
  assert.match(script, /copied: 'Copied'/);
  assert.match(script, /navigator\.clipboard\.writeText/);
  assert.match(script, /document\.execCommand\('copy'\)/);
});

test('recruitment share image remains the original square PNG dimensions', () => {
  const image = fs.readFileSync(path.join(root, 'public', 'images', 'recruitment-drive-share.png'));
  const pngSignature = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

  assert.deepEqual(image.subarray(0, 8), pngSignature);
  assert.equal(image.readUInt32BE(16), 1080);
  assert.equal(image.readUInt32BE(20), 1080);
});

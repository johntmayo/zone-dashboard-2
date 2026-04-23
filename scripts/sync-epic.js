#!/usr/bin/env node
'use strict';

// CLI entrypoint for running the EPIC-LA sync.
// Usage (local):   node scripts/sync-epic.js
// Usage (npm):     npm run sync:epic
//
// Env vars required: see EPIC_RUNBOOK.md.
// Exit codes:
//   0 → sync succeeded
//   1 → config error (missing env vars etc.)
//   2 → operational failure (source or cache write)

require('dotenv').config();

const { google } = require('googleapis');
const { runSync } = require('../epic/sync');

async function buildSheetsClient() {
  const b64 = process.env.GOOGLE_SERVICE_ACCOUNT_JSON_B64;
  const json = process.env.GOOGLE_SERVICE_ACCOUNT_JSON;
  const keyPath = process.env.GOOGLE_APPLICATION_CREDENTIALS;
  if (!b64 && !json && !keyPath) {
    throw new Error(
      'Missing GOOGLE_SERVICE_ACCOUNT_JSON, GOOGLE_SERVICE_ACCOUNT_JSON_B64, or GOOGLE_APPLICATION_CREDENTIALS.'
    );
  }
  const authOptions = { scopes: ['https://www.googleapis.com/auth/spreadsheets'] };
  if (b64) {
    authOptions.credentials = JSON.parse(Buffer.from(b64, 'base64').toString('utf8'));
  } else if (json) {
    authOptions.credentials = JSON.parse(json);
  } else {
    authOptions.keyFile = keyPath;
  }
  const auth = new google.auth.GoogleAuth(authOptions);
  return google.sheets({ version: 'v4', auth });
}

(async () => {
  try {
    const sheetsClient = await buildSheetsClient();
    const summary = await runSync({ sheetsClient, reason: 'cli' });
    console.log('[epic-sync] summary:', JSON.stringify(summary, null, 2));
    if (summary.status !== 'ok') {
      process.exitCode = 2;
    }
  } catch (err) {
    if (err && err.code === 'EPIC_NOT_CONFIGURED') {
      console.error('[epic-sync] configuration error:', err.message);
      process.exitCode = 1;
      return;
    }
    console.error('[epic-sync] fatal error:', err && err.stack ? err.stack : err);
    process.exitCode = 2;
  }
})();

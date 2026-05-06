'use strict';

const test = require('node:test');
const assert = require('node:assert');

const {
  normalizeSheetValues,
  fetchGodmodeMaster
} = require('../godmode/routes');

test('normalizeSheetValues: converts header row and records into objects', () => {
  const payload = normalizeSheetValues([
    ['resident_id', 'Full Name', 'Address', ''],
    ['r-1', 'Jane Altadena', '123 Lake Ave', 'extra'],
    ['', '', '', ''],
    ['r-2', 'Sam Sierra', '456 Pine St']
  ]);

  assert.deepStrictEqual(payload.headers, ['resident_id', 'Full Name', 'Address', 'Column 4']);
  assert.strictEqual(payload.rows.length, 2);
  assert.strictEqual(payload.rows[0].resident_id, 'r-1');
  assert.strictEqual(payload.rows[0]['Column 4'], 'extra');
  assert.strictEqual(payload.rows[1].Address, '456 Pine St');
  assert.strictEqual(payload.rows[1]['Column 4'], '');
});

test('fetchGodmodeMaster: uses configured sheet id and range only', async () => {
  const calls = [];
  const sheetsClient = {
    spreadsheets: {
      values: {
        get: async (args) => {
          calls.push(args);
          return {
            data: {
              values: [
                ['resident_id', 'Name'],
                ['abc', 'Resident One']
              ]
            }
          };
        }
      }
    }
  };

  const payload = await fetchGodmodeMaster({
    sheetsClient,
    config: {
      masterSheetId: 'configured-sheet-id',
      masterRange: 'Master!A1:Z10'
    }
  });

  assert.deepStrictEqual(calls, [{
    spreadsheetId: 'configured-sheet-id',
    range: 'Master!A1:Z10'
  }]);
  assert.strictEqual(payload.rows[0].Name, 'Resident One');
});

test('fetchGodmodeMaster: fails clearly when not configured', async () => {
  await assert.rejects(
    () => fetchGodmodeMaster({
      sheetsClient: {},
      config: { masterSheetId: '', masterRange: 'Master!A1:Z10' }
    }),
    /GODMODE_MASTER_SHEET_ID/
  );
});

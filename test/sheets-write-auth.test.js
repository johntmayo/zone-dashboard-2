'use strict';

const test = require('node:test');
const assert = require('node:assert');

const {
  extractBearerToken,
  createTokenIdentityCache,
  isRegisteredAccessRows,
  canEmailWriteSheet,
  createRequireSheetsWriteAuth
} = require('../sheets-write-auth');

test('extractBearerToken: reads Authorization header', () => {
  const req = {
    get(name) {
      return name === 'Authorization' ? 'Bearer abc.def.ghi' : '';
    }
  };
  assert.strictEqual(extractBearerToken(req), 'abc.def.ghi');
  assert.strictEqual(extractBearerToken({ headers: { authorization: 'bearer xyz' } }), 'xyz');
  assert.strictEqual(extractBearerToken({ get: () => '' }), '');
});

test('createTokenIdentityCache: stores and returns identity', () => {
  const cache = createTokenIdentityCache({ ttlMs: 60_000, maxEntries: 2 });
  cache.set('t1', { email: 'a@example.com' });
  assert.deepStrictEqual(cache.get('t1'), { email: 'a@example.com' });
  cache.set('t2', { email: 'b@example.com' });
  cache.set('t3', { email: 'c@example.com' });
  assert.strictEqual(cache.size <= 2, true);
});

test('isRegisteredAccessRows: accepts sheet or role grants', () => {
  assert.strictEqual(isRegisteredAccessRows([]), false);
  assert.strictEqual(isRegisteredAccessRows([{ url: 'https://docs.google.com/spreadsheets/d/abc/edit' }]), true);
  assert.strictEqual(isRegisteredAccessRows([{ role: 'lot_weeding_admin', roleGrant: true }]), true);
  assert.strictEqual(isRegisteredAccessRows([null, {}]), false);
});

test('canEmailWriteSheet: allows assigned zone sheet', async () => {
  const allowed = await canEmailWriteSheet('captain@example.com', 'zone-sheet-1', {
    getAccessRowsForEmail: async () => ([
      { url: 'https://docs.google.com/spreadsheets/d/zone-sheet-1/edit', role: 'captain' }
    ]),
    extractGoogleSheetId: (url) => {
      const m = String(url || '').match(/\/d\/([a-zA-Z0-9-_]+)/);
      return m ? m[1] : null;
    },
    sharedWritableSheetIds: ['nc-directory'],
    collectAccessRoles: () => ['captain']
  });
  assert.strictEqual(allowed, true);
});

test('canEmailWriteSheet: denies unassigned zone sheet', async () => {
  const allowed = await canEmailWriteSheet('captain@example.com', 'other-sheet', {
    getAccessRowsForEmail: async () => ([
      { url: 'https://docs.google.com/spreadsheets/d/zone-sheet-1/edit', role: 'captain' }
    ]),
    extractGoogleSheetId: (url) => {
      const m = String(url || '').match(/\/d\/([a-zA-Z0-9-_]+)/);
      return m ? m[1] : null;
    },
    sharedWritableSheetIds: ['nc-directory'],
    collectAccessRoles: () => ['captain']
  });
  assert.strictEqual(allowed, false);
});

test('canEmailWriteSheet: admins may write any sheet', async () => {
  const allowed = await canEmailWriteSheet('admin@example.com', 'any-sheet', {
    getAccessRowsForEmail: async () => ([{ role: 'admin', roleGrant: true }]),
    extractGoogleSheetId: () => null,
    sharedWritableSheetIds: [],
    collectAccessRoles: () => ['admin']
  });
  assert.strictEqual(allowed, true);
});

test('canEmailWriteSheet: registered users may write shared NC directory', async () => {
  const allowed = await canEmailWriteSheet('captain@example.com', 'nc-directory', {
    getAccessRowsForEmail: async () => ([
      { url: 'https://docs.google.com/spreadsheets/d/zone-sheet-1/edit', role: 'captain' }
    ]),
    extractGoogleSheetId: (url) => {
      const m = String(url || '').match(/\/d\/([a-zA-Z0-9-_]+)/);
      return m ? m[1] : null;
    },
    sharedWritableSheetIds: ['nc-directory'],
    collectAccessRoles: () => ['captain']
  });
  assert.strictEqual(allowed, true);
});

test('requireSheetsWriteAuth: rejects missing bearer token', async () => {
  const middleware = createRequireSheetsWriteAuth({
    enabled: true,
    getAccessRowsForEmail: async () => [],
    extractGoogleSheetId: () => null,
    collectAccessRoles: () => [],
    sharedWritableSheetIds: []
  });

  let statusCode = 0;
  let body = null;
  await middleware(
    { get: () => '', body: { sheetId: 'abc' } },
    {
      status(code) {
        statusCode = code;
        return this;
      },
      json(payload) {
        body = payload;
        return payload;
      }
    },
    () => {
      throw new Error('next should not be called');
    }
  );

  assert.strictEqual(statusCode, 401);
  assert.strictEqual(body.error, 'auth_required');
});

test('requireSheetsWriteAuth: allows valid token with sheet access', async () => {
  const middleware = createRequireSheetsWriteAuth({
    enabled: true,
    verifyToken: async () => ({ email: 'captain@example.com', sub: '1' }),
    getAccessRowsForEmail: async () => ([
      { url: 'https://docs.google.com/spreadsheets/d/zone-1/edit', role: 'captain' }
    ]),
    extractGoogleSheetId: () => 'zone-1',
    collectAccessRoles: () => ['captain'],
    sharedWritableSheetIds: []
  });

  let nextCalled = false;
  const req = {
    get: () => 'Bearer good-token',
    body: { sheetId: 'zone-1' }
  };
  await middleware(
    req,
    {
      status() { throw new Error('should not fail'); },
      json() { throw new Error('should not fail'); }
    },
    () => { nextCalled = true; }
  );

  assert.strictEqual(nextCalled, true);
  assert.strictEqual(req.authUser.email, 'captain@example.com');
});

test('requireSheetsWriteAuth: can be disabled via enabled=false', async () => {
  const middleware = createRequireSheetsWriteAuth({
    enabled: false,
    getAccessRowsForEmail: async () => [],
    extractGoogleSheetId: () => null,
    collectAccessRoles: () => []
  });

  let nextCalled = false;
  await middleware({ get: () => '' }, {}, () => { nextCalled = true; });
  assert.strictEqual(nextCalled, true);
});

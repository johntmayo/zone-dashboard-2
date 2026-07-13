'use strict';

const test = require('node:test');
const assert = require('node:assert');

const {
  createSessionToken,
  verifySessionToken,
  parseCookies,
  shouldSlideSession,
  createSessionAuth,
  buildSessionCookieHeader,
  buildClearSessionCookieHeader
} = require('../session-auth');

test('create/verify session token round-trip', () => {
  const secret = 'test-secret-please-change';
  const created = createSessionToken({ email: 'Captain@Example.com', sub: 'sub-1' }, {
    secret,
    ttlMs: 60_000,
    now: 1_000_000
  });
  const verified = verifySessionToken(created.token, { secret, now: 1_000_100 });
  assert.ok(verified);
  assert.strictEqual(verified.email, 'captain@example.com');
  assert.strictEqual(verified.sub, 'sub-1');
  assert.strictEqual(verified.exp, 1_060_000);
});

test('verifySessionToken rejects tampered payload', () => {
  const secret = 'test-secret-please-change';
  const created = createSessionToken({ email: 'a@example.com' }, { secret, now: 1000, ttlMs: 10_000 });
  const parts = created.token.split('.');
  const tampered = `${parts[0]}.${parts[1].slice(0, -4)}dead`;
  assert.strictEqual(verifySessionToken(tampered, { secret, now: 1500 }), null);
});

test('verifySessionToken rejects expired token', () => {
  const secret = 'test-secret-please-change';
  const created = createSessionToken({ email: 'a@example.com' }, { secret, now: 1000, ttlMs: 10 });
  assert.strictEqual(verifySessionToken(created.token, { secret, now: 2000 }), null);
});

test('parseCookies reads zd_session', () => {
  const cookies = parseCookies('foo=1; zd_session=abc%2Edef; bar=2');
  assert.strictEqual(cookies.zd_session, 'abc.def');
});

test('shouldSlideSession when near expiry', () => {
  assert.strictEqual(shouldSlideSession({ exp: 10_000 }, { now: 9_500, slideWindowMs: 1_000 }), true);
  assert.strictEqual(shouldSlideSession({ exp: 10_000 }, { now: 1_000, slideWindowMs: 1_000 }), false);
});

test('cookie headers include HttpOnly and SameSite', () => {
  const set = buildSessionCookieHeader('tok.en', { maxAgeMs: 1000, secure: true });
  assert.match(set, /HttpOnly/);
  assert.match(set, /SameSite=Lax/);
  assert.match(set, /Secure/);
  const clear = buildClearSessionCookieHeader({ secure: true });
  assert.match(clear, /Max-Age=0/);
});

test('createSessionAuth issues session from Google token', async () => {
  const auth = createSessionAuth({
    secret: 'unit-test-secret',
    ttlMs: 60_000,
    verifyGoogleAccessToken: async () => ({ email: 'user@example.com', sub: '99' })
  });

  const headers = {};
  const res = {
    setHeader(name, value) {
      headers[name] = value;
    }
  };
  const req = {
    body: { accessToken: 'google-token' },
    get() { return ''; },
    headers: {},
    secure: false
  };

  const session = await auth.createSessionFromGoogleToken(req, res);
  assert.strictEqual(session.email, 'user@example.com');
  assert.match(headers['Set-Cookie'], /zd_session=/);

  req.headers.cookie = headers['Set-Cookie'].split(';')[0];
  const read = auth.readSession(req);
  assert.ok(read);
  assert.strictEqual(read.email, 'user@example.com');
});

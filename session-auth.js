'use strict';

/**
 * Durable app sessions (Phase C).
 * After Google proves identity once, the server issues an httpOnly signed cookie
 * so captains can return for days without re-hitting Google.
 */

const crypto = require('crypto');

const SESSION_COOKIE_NAME = 'zd_session';
const DEFAULT_SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 days
const DEFAULT_SLIDE_WINDOW_MS = 24 * 60 * 60 * 1000; // refresh cookie if < 1 day left

function base64urlEncode(value) {
  return Buffer.from(value)
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/g, '');
}

function base64urlDecode(value) {
  const padded = String(value || '').replace(/-/g, '+').replace(/_/g, '/');
  const padLength = (4 - (padded.length % 4)) % 4;
  return Buffer.from(padded + '='.repeat(padLength), 'base64').toString('utf8');
}

function resolveSessionSecret(explicitSecret) {
  const fromEnv = String(explicitSecret || process.env.SESSION_SECRET || '').trim();
  if (fromEnv) return fromEnv;

  // Local/dev fallback so the app still boots without env config.
  // Production should always set SESSION_SECRET (sessions invalidate on restart otherwise).
  const fallback = crypto
    .createHash('sha256')
    .update(`zone-dashboard-dev-session:${process.env.USER_ACCESS_SHEET_ID || 'local'}`)
    .digest('hex');
  if (process.env.NODE_ENV === 'production' || process.env.VERCEL) {
    console.warn('SESSION_SECRET is not set — using unstable fallback. Set SESSION_SECRET in Vercel.');
  }
  return fallback;
}

function signPayload(payloadJson, secret) {
  return crypto.createHmac('sha256', secret).update(payloadJson).digest('base64url');
}

function createSessionToken(identity, {
  secret,
  ttlMs = DEFAULT_SESSION_TTL_MS,
  now = Date.now()
} = {}) {
  const email = String(identity?.email || '').trim().toLowerCase();
  if (!email) {
    const err = new Error('session_email_required');
    err.code = 'session_email_required';
    throw err;
  }

  const payload = {
    e: email,
    s: identity?.sub ? String(identity.sub) : '',
    iat: now,
    exp: now + ttlMs
  };
  const payloadJson = JSON.stringify(payload);
  const encodedPayload = base64urlEncode(payloadJson);
  const signature = signPayload(payloadJson, secret);
  return {
    token: `${encodedPayload}.${signature}`,
    payload,
    maxAgeMs: ttlMs
  };
}

function verifySessionToken(token, {
  secret,
  now = Date.now()
} = {}) {
  const raw = String(token || '').trim();
  if (!raw || !raw.includes('.')) return null;

  const splitAt = raw.lastIndexOf('.');
  const encodedPayload = raw.slice(0, splitAt);
  const signature = raw.slice(splitAt + 1);
  if (!encodedPayload || !signature) return null;

  let payloadJson;
  try {
    payloadJson = base64urlDecode(encodedPayload);
  } catch {
    return null;
  }

  const expected = signPayload(payloadJson, secret);
  const sigBuf = Buffer.from(signature);
  const expectedBuf = Buffer.from(expected);
  if (sigBuf.length !== expectedBuf.length || !crypto.timingSafeEqual(sigBuf, expectedBuf)) {
    return null;
  }

  let payload;
  try {
    payload = JSON.parse(payloadJson);
  } catch {
    return null;
  }

  const email = String(payload?.e || '').trim().toLowerCase();
  const exp = Number(payload?.exp || 0);
  if (!email || !Number.isFinite(exp) || now >= exp) return null;

  return {
    email,
    sub: payload?.s ? String(payload.s) : '',
    iat: Number(payload?.iat || 0),
    exp
  };
}

function parseCookies(headerValue) {
  const out = {};
  String(headerValue || '')
    .split(';')
    .map((part) => part.trim())
    .filter(Boolean)
    .forEach((part) => {
      const eq = part.indexOf('=');
      if (eq <= 0) return;
      const key = part.slice(0, eq).trim();
      const value = part.slice(eq + 1).trim();
      out[key] = decodeURIComponent(value);
    });
  return out;
}

function readSessionCookie(req, cookieName = SESSION_COOKIE_NAME) {
  const cookies = parseCookies(req?.headers?.cookie || (req?.get && req.get('cookie')) || '');
  return cookies[cookieName] || '';
}

function buildSessionCookieHeader(token, {
  maxAgeMs = DEFAULT_SESSION_TTL_MS,
  secure = false,
  cookieName = SESSION_COOKIE_NAME
} = {}) {
  const maxAgeSec = Math.max(1, Math.floor(maxAgeMs / 1000));
  const parts = [
    `${cookieName}=${encodeURIComponent(token)}`,
    'Path=/',
    `Max-Age=${maxAgeSec}`,
    'HttpOnly',
    'SameSite=Lax'
  ];
  if (secure) parts.push('Secure');
  return parts.join('; ');
}

function buildClearSessionCookieHeader({
  secure = false,
  cookieName = SESSION_COOKIE_NAME
} = {}) {
  const parts = [
    `${cookieName}=`,
    'Path=/',
    'Max-Age=0',
    'HttpOnly',
    'SameSite=Lax'
  ];
  if (secure) parts.push('Secure');
  return parts.join('; ');
}

function shouldSlideSession(session, {
  now = Date.now(),
  slideWindowMs = DEFAULT_SLIDE_WINDOW_MS
} = {}) {
  if (!session || !session.exp) return false;
  return session.exp - now <= slideWindowMs;
}

function isSecureRequest(req) {
  if (process.env.COOKIE_SECURE === '1') return true;
  if (process.env.COOKIE_SECURE === '0') return false;
  if (process.env.VERCEL) return true;
  const proto = String(req?.headers?.['x-forwarded-proto'] || '').split(',')[0].trim().toLowerCase();
  if (proto === 'https') return true;
  return Boolean(req?.secure);
}

function createSessionAuth(deps = {}) {
  const secret = resolveSessionSecret(deps.secret);
  const ttlMs = Number(deps.ttlMs) > 0 ? Number(deps.ttlMs) : DEFAULT_SESSION_TTL_MS;
  const cookieName = deps.cookieName || SESSION_COOKIE_NAME;
  const verifyGoogleAccessToken = deps.verifyGoogleAccessToken;

  function issueSession(res, identity, req) {
    const created = createSessionToken(identity, { secret, ttlMs });
    res.setHeader('Set-Cookie', buildSessionCookieHeader(created.token, {
      maxAgeMs: created.maxAgeMs,
      secure: isSecureRequest(req),
      cookieName
    }));
    return {
      email: created.payload.e,
      sub: created.payload.s,
      expiresAt: created.payload.exp
    };
  }

  function clearSession(res, req) {
    res.setHeader('Set-Cookie', buildClearSessionCookieHeader({
      secure: isSecureRequest(req),
      cookieName
    }));
  }

  function readSession(req) {
    const token = readSessionCookie(req, cookieName);
    if (!token) return null;
    return verifySessionToken(token, { secret });
  }

  function maybeSlideSession(req, res, session) {
    if (!session || !shouldSlideSession(session)) return session;
    return issueSession(res, { email: session.email, sub: session.sub }, req);
  }

  async function createSessionFromGoogleToken(req, res) {
    if (typeof verifyGoogleAccessToken !== 'function') {
      const err = new Error('verifyGoogleAccessToken_required');
      err.code = 'verifyGoogleAccessToken_required';
      throw err;
    }

    const bodyToken = String(req.body?.accessToken || '').trim();
    const header = String(req.get?.('Authorization') || req.headers?.authorization || '').trim();
    const bearerMatch = header.match(/^Bearer\s+(.+)$/i);
    const accessToken = bodyToken || (bearerMatch ? bearerMatch[1].trim() : '');
    if (!accessToken) {
      const err = new Error('access_token_required');
      err.code = 'access_token_required';
      throw err;
    }

    const identity = await verifyGoogleAccessToken(accessToken, {
      fetchImpl: deps.fetchImpl
    });
    return issueSession(res, identity, req);
  }

  return {
    secret,
    ttlMs,
    cookieName,
    issueSession,
    clearSession,
    readSession,
    maybeSlideSession,
    createSessionFromGoogleToken
  };
}

module.exports = {
  SESSION_COOKIE_NAME,
  DEFAULT_SESSION_TTL_MS,
  base64urlEncode,
  base64urlDecode,
  resolveSessionSecret,
  createSessionToken,
  verifySessionToken,
  parseCookies,
  readSessionCookie,
  buildSessionCookieHeader,
  buildClearSessionCookieHeader,
  shouldSlideSession,
  isSecureRequest,
  createSessionAuth
};

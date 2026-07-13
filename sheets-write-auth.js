'use strict';

/**
 * Lightweight write-gate for /api/sheets/* mutating routes.
 * Verifies the caller's Google OAuth access token, then checks that their
 * registered email is allowed to write the target spreadsheet.
 */

const DEFAULT_TOKEN_CACHE_TTL_MS = 5 * 60 * 1000;
const DEFAULT_TOKEN_CACHE_MAX = 500;

function extractBearerToken(req) {
  const header = String((req && req.get && req.get('Authorization')) || req?.headers?.authorization || '').trim();
  const match = header.match(/^Bearer\s+(.+)$/i);
  return match ? match[1].trim() : '';
}

function createTokenIdentityCache({ ttlMs = DEFAULT_TOKEN_CACHE_TTL_MS, maxEntries = DEFAULT_TOKEN_CACHE_MAX } = {}) {
  const cache = new Map();

  return {
    get(token) {
      const entry = cache.get(token);
      if (!entry) return null;
      if (Date.now() > entry.expiresAt) {
        cache.delete(token);
        return null;
      }
      return entry.identity;
    },
    set(token, identity) {
      if (!token || !identity) return;
      cache.set(token, { identity, expiresAt: Date.now() + ttlMs });
      if (cache.size > maxEntries) {
        const oldest = cache.keys().next().value;
        cache.delete(oldest);
      }
    },
    clear() {
      cache.clear();
    },
    get size() {
      return cache.size;
    }
  };
}

async function verifyGoogleAccessToken(accessToken, { fetchImpl = fetch } = {}) {
  const token = String(accessToken || '').trim();
  if (!token) {
    const err = new Error('missing_token');
    err.code = 'missing_token';
    throw err;
  }

  const response = await fetchImpl('https://www.googleapis.com/oauth2/v2/userinfo', {
    headers: { Authorization: `Bearer ${token}` }
  });

  if (!response.ok) {
    const err = new Error('invalid_token');
    err.code = 'invalid_token';
    err.status = response.status;
    throw err;
  }

  const data = await response.json();
  const email = String(data.email || '').trim().toLowerCase();
  if (!email) {
    const err = new Error('no_email');
    err.code = 'no_email';
    throw err;
  }

  return {
    email,
    sub: data.sub ? String(data.sub) : '',
    verifiedEmail: data.verified_email === true || data.verified_email === 'true'
  };
}

function isRegisteredAccessRows(rows) {
  const list = Array.isArray(rows) ? rows : [];
  if (!list.length) return false;
  return list.some((entry) => {
    if (!entry) return false;
    if (typeof entry === 'string') return Boolean(String(entry).trim());
    if (typeof entry === 'object') {
      if (entry.url) return true;
      if (entry.role) return true;
      return false;
    }
    return false;
  });
}

async function canEmailWriteSheet(email, sheetId, deps) {
  const {
    getAccessRowsForEmail,
    extractGoogleSheetId,
    sharedWritableSheetIds = [],
    collectAccessRoles
  } = deps;

  const normalizedEmail = String(email || '').trim().toLowerCase();
  const targetSheetId = String(sheetId || '').trim();
  if (!normalizedEmail || !targetSheetId) return false;

  const rows = await getAccessRowsForEmail(normalizedEmail);
  if (!isRegisteredAccessRows(rows)) return false;

  const roles = typeof collectAccessRoles === 'function' ? collectAccessRoles(rows) : [];
  if (roles.includes('admin')) return true;

  const shared = new Set((sharedWritableSheetIds || []).map((id) => String(id || '').trim()).filter(Boolean));
  if (shared.has(targetSheetId)) return true;

  for (const entry of rows) {
    const url = typeof entry === 'string' ? entry : (entry && entry.url);
    const id = extractGoogleSheetId(url);
    if (id && id === targetSheetId) return true;
  }

  return false;
}

function createRequireSheetsWriteAuth(deps) {
  const {
    enabled = true,
    verifyToken = verifyGoogleAccessToken,
    canWrite = canEmailWriteSheet,
    tokenCache = createTokenIdentityCache(),
    getAccessRowsForEmail,
    extractGoogleSheetId,
    sharedWritableSheetIds = [],
    collectAccessRoles,
    fetchImpl
  } = deps;

  return async function requireSheetsWriteAuth(req, res, next) {
    if (!enabled) return next();

    const token = extractBearerToken(req);
    if (!token) {
      return res.status(401).json({
        error: 'auth_required',
        message: 'Sign in required to save changes.'
      });
    }

    let identity = tokenCache.get(token);
    if (!identity) {
      try {
        identity = await verifyToken(token, { fetchImpl });
        tokenCache.set(token, identity);
      } catch (err) {
        return res.status(401).json({
          error: 'auth_invalid',
          message: 'Your session has expired. Please sign in again.'
        });
      }
    }

    const sheetId = String((req.body && req.body.sheetId) || '').trim();
    if (!sheetId) {
      return res.status(400).json({ error: 'sheetId required' });
    }

    let allowed = false;
    try {
      allowed = await canWrite(identity.email, sheetId, {
        getAccessRowsForEmail,
        extractGoogleSheetId,
        sharedWritableSheetIds,
        collectAccessRoles
      });
    } catch (err) {
      console.error('Sheet write authorization lookup failed:', err.message);
      return res.status(500).json({
        error: 'auth_lookup_failed',
        message: 'Could not verify spreadsheet access right now. Please try again.'
      });
    }

    if (!allowed) {
      return res.status(403).json({
        error: 'forbidden',
        message: 'You do not have permission to edit this spreadsheet.'
      });
    }

    req.authUser = { email: identity.email, sub: identity.sub || '' };
    return next();
  };
}

module.exports = {
  extractBearerToken,
  createTokenIdentityCache,
  verifyGoogleAccessToken,
  isRegisteredAccessRows,
  canEmailWriteSheet,
  createRequireSheetsWriteAuth
};

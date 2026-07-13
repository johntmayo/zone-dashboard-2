require('dotenv').config(); // loads .env for local development (no effect in production)
const express = require('express');
const cors = require('cors');
const path = require('path');
const fs = require('fs');
const { google } = require('googleapis');

const app = express();
const PORT = process.env.PORT || 8000;

// Middleware
app.use(cors());
app.use(express.json());

// Serve NC Directory at root when host is directory.altagether.org (works on Vercel and local)
app.get('/', (req, res, next) => {
  const host = (req.get('host') || req.hostname || '').toLowerCase();
  if (host.startsWith('directory.altagether.org')) {
    return res.sendFile(path.join(__dirname, 'nc-directory.html'));
  }
  next();
});

app.use('/public', express.static(path.join(__dirname, 'public'))); // Static assets at /public (css, js, images)
// Avoid stale single-file dashboard HTML (layers config lives inline in index.html).
const staticRoot = path.join(__dirname);
app.use(express.static(staticRoot, {
  setHeaders(res, filePath) {
    const lower = String(filePath || '').toLowerCase();
    if (lower.endsWith('.html')) {
      res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, max-age=0');
      res.setHeader('Pragma', 'no-cache');
    }
  }
})); // index.html, flyer_tool.html, nc-directory.html, etc.

// Expose Mapbox public token to browser at runtime (from environment, never hardcoded in source).
app.get('/api/mapbox-token', (req, res) => {
  const token = (process.env.MAPBOX_PUBLIC_TOKEN || process.env.MAPBOX_ACCESS_TOKEN || '').trim();
  res.set('Cache-Control', 'no-store');
  res.json({ token });
});

// Expose Google Analytics Measurement ID when set (optional; no tracking if unset).
app.get('/api/ga-config', (req, res) => {
  const measurementId = (process.env.GA_MEASUREMENT_ID || '').trim();
  res.set('Cache-Control', 'no-store');
  res.json({ measurementId });
});

const USERS_FILE_PATH = path.join(__dirname, 'users.json');

function readUsersMapLegacy() {
  let raw = '';
  let sourceName = 'users.json';
  const usersJsonB64 = String(process.env.USERS_JSON_B64 || '').trim();
  const usersJsonInline = String(process.env.USERS_JSON || '').trim();

  if (usersJsonB64) {
    sourceName = 'USERS_JSON_B64';
    try {
      raw = Buffer.from(usersJsonB64, 'base64').toString('utf8');
    } catch (err) {
      throw new Error('USERS_JSON_B64 is not valid base64.');
    }
  } else if (usersJsonInline) {
    sourceName = 'USERS_JSON';
    raw = usersJsonInline;
  } else {
    raw = fs.readFileSync(USERS_FILE_PATH, 'utf8');
  }

  const parsed = JSON.parse(raw);
  const usersMap = {};

  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error(`${sourceName} must contain a JSON object mapping emails to arrays of sheet URLs.`);
  }

  for (const [key, value] of Object.entries(parsed)) {
    if (String(key).startsWith('_')) continue;

    const normalizedEmail = String(key).trim().toLowerCase();
    if (!normalizedEmail) continue;

    if (!Array.isArray(value)) {
      throw new Error(`${sourceName} entry for "${normalizedEmail}" must be an array of sheet URLs.`);
    }

    usersMap[normalizedEmail] = value;
  }

  return usersMap;
}

let cachedUsersMap = null;
let cachedAt = 0;
const USERS_CACHE_TTL_MS = 60 * 1000;
const ROLE_GRANT_PREFIX = 'role:';
const LOT_WEEDING_ADMIN_ROLE = 'lot_weeding_admin';
const ACCESS_SHEET_RANGE = 'Access!A1:Z10000';
const ACCESS_COLUMN_ALIASES = {
  loginEmail: ['login_email', 'login email', 'email'],
  sheetUrl: ['sheet_url', 'sheet url'],
  zoneName: ['zone_name', 'zone name'],
  captainName: ['captain_display_name', 'captain display name', 'captain_name', 'captain name'],
  contactEmail: ['contact_email', 'contact email'],
  role: ['role'],
  active: ['active'],
  lastSeenAt: ['last_seen_at', 'last seen at'],
  loginCount: ['login_count', 'login count']
};
const ACCESS_COLUMN_FALLBACKS = {
  loginEmail: 0,
  sheetUrl: 1,
  zoneName: 2,
  captainName: 3,
  contactEmail: 4,
  role: 5,
  active: 6
};

function normalizeAccessRole(value, fallback = 'captain') {
  return String(value || fallback).trim().toLowerCase();
}

function normalizeAccessHeader(value) {
  return String(value || '').toLowerCase().replace(/[^a-z0-9]/g, '');
}

function getAccessColumnIndex(headers, key) {
  const aliases = ACCESS_COLUMN_ALIASES[key] || [];
  const normalizedAliases = new Set(aliases.map(normalizeAccessHeader));
  const headerIndex = headers.findIndex((header) => normalizedAliases.has(normalizeAccessHeader(header)));
  if (headerIndex >= 0) return headerIndex;
  return Object.prototype.hasOwnProperty.call(ACCESS_COLUMN_FALLBACKS, key)
    ? ACCESS_COLUMN_FALLBACKS[key]
    : -1;
}

function columnIndexToA1(index) {
  let n = Number(index) + 1;
  let label = '';
  while (n > 0) {
    const remainder = (n - 1) % 26;
    label = String.fromCharCode(65 + remainder) + label;
    n = Math.floor((n - 1) / 26);
  }
  return label;
}

function normalizeAccessSheetValues(values) {
  const rows = Array.isArray(values) ? values : [];
  const headers = (rows[0] || []).map((header) => String(header || '').trim());
  const columns = Object.keys(ACCESS_COLUMN_ALIASES).reduce((acc, key) => {
    acc[key] = getAccessColumnIndex(headers, key);
    return acc;
  }, {});
  const records = rows.slice(1)
    .map((row, index) => {
      const valuesRow = Array.isArray(row) ? row : [];
      return {
        rowNumber: index + 2,
        values: valuesRow,
        get(key) {
          const columnIndex = columns[key];
          return columnIndex >= 0 ? valuesRow[columnIndex] : '';
        }
      };
    })
    .filter((record) => record.values.some((cell) => String(cell || '').trim()));

  return { headers, columns, records };
}

async function readAccessSheet() {
  const accessSheetId = (process.env.USER_ACCESS_SHEET_ID || '').trim();
  if (!accessSheetId) return null;

  const sheets = await getSheetsClient();
  const result = await sheets.spreadsheets.values.get({
    spreadsheetId: accessSheetId,
    range: ACCESS_SHEET_RANGE
  });
  return {
    spreadsheetId: accessSheetId,
    ...normalizeAccessSheetValues(result.data && result.data.values)
  };
}

function getRoleGrantFromSheetUrl(rawUrl, role) {
  const value = String(rawUrl || '').trim().toLowerCase();
  if (!value.startsWith(ROLE_GRANT_PREFIX)) return null;
  const roleFromUrl = value.slice(ROLE_GRANT_PREFIX.length).trim();
  return normalizeAccessRole(role === 'captain' ? roleFromUrl : role, roleFromUrl);
}

function collectAccessRoles(rows) {
  const roles = new Set();
  (Array.isArray(rows) ? rows : []).forEach((row) => {
    const role = normalizeAccessRole(row && row.role, '');
    if (role) roles.add(role);
  });
  return Array.from(roles);
}

function collectAccessCapabilities(rows) {
  const roles = collectAccessRoles(rows);
  const capabilities = new Set(roles);
  if (roles.includes('admin')) capabilities.add(LOT_WEEDING_ADMIN_ROLE);
  return Array.from(capabilities);
}

async function getAccessRowsForEmail(email) {
  const map = await readUsersMap();
  return map[String(email || '').trim().toLowerCase()] || [];
}

async function isAdminEmail(email) {
  try {
    const rows = await getAccessRowsForEmail(email);
    return collectAccessRoles(rows).includes('admin');
  } catch (err) {
    console.error('Admin check failed:', err.message);
    return false;
  }
}

async function hasLotWeedingAdminAccess(email) {
  try {
    const rows = await getAccessRowsForEmail(email);
    const capabilities = collectAccessCapabilities(rows);
    return capabilities.includes(LOT_WEEDING_ADMIN_ROLE);
  } catch (err) {
    console.error('Lot weeding admin access check failed:', err.message);
    return false;
  }
}

async function readUsersMap() {
  if (String(process.env.USE_LEGACY_USERS || '').trim() === '1') {
    return readUsersMapLegacy();
  }

  const now = Date.now();
  if (cachedUsersMap && now - cachedAt < USERS_CACHE_TTL_MS) {
    return cachedUsersMap;
  }

  const accessSheetId = (process.env.USER_ACCESS_SHEET_ID || '').trim();
  if (!accessSheetId) return readUsersMapLegacy();

  try {
    const accessSheet = await readAccessSheet();
    const records = accessSheet ? accessSheet.records : [];

    const usersMap = {};
    const zoneByUrl = {};
    const wildcardAdmins = [];
    const seenUrlsByEmail = {};
    const captainAssignmentCount = {};

    for (const record of records) {
      const loginEmailRaw = record.get('loginEmail');
      const sheetUrlRaw = record.get('sheetUrl');
      const zoneNameRaw = record.get('zoneName');
      const captainNameRaw = record.get('captainName');
      const contactEmailRaw = record.get('contactEmail');
      const roleRaw = record.get('role');
      const activeRaw = record.get('active');

      if (!loginEmailRaw || !sheetUrlRaw) continue;
      if (String(activeRaw || '').toUpperCase() !== 'TRUE') continue;

      const loginEmail = String(loginEmailRaw).trim().toLowerCase();
      const rawUrl = String(sheetUrlRaw).trim();
      const role = normalizeAccessRole(roleRaw);
      const roleGrant = getRoleGrantFromSheetUrl(rawUrl, role);

      if (roleGrant) {
        if (!usersMap[loginEmail]) usersMap[loginEmail] = [];
        usersMap[loginEmail].push({
          role: roleGrant,
          capability: roleGrant,
          roleGrant: true
        });
        continue;
      }

      if (rawUrl === '*') {
        if (role === 'admin') {
          if (!usersMap[loginEmail]) usersMap[loginEmail] = [];
          usersMap[loginEmail].push({
            role: 'admin',
            capability: 'admin',
            roleGrant: true
          });
          wildcardAdmins.push(loginEmail);
        }
        continue;
      }

      const url = toCanonicalSheetUrl(rawUrl);
      if (!url) continue;

      if (!seenUrlsByEmail[loginEmail]) seenUrlsByEmail[loginEmail] = new Set();
      if (seenUrlsByEmail[loginEmail].has(url)) continue;
      seenUrlsByEmail[loginEmail].add(url);

      const zoneName = String(zoneNameRaw || '').trim();
      const captainName = String(captainNameRaw || '').trim();
      const contactEmail = String(contactEmailRaw || '').trim();

      if (!zoneByUrl[url]) zoneByUrl[url] = { name: '', captains: [] };
      if (!zoneByUrl[url].name && zoneName) zoneByUrl[url].name = zoneName;
      if (role !== 'admin' && captainName) {
        zoneByUrl[url].captains.push({ name: captainName, contactEmail });
      }

      if (role !== 'admin') {
        captainAssignmentCount[loginEmail] = (captainAssignmentCount[loginEmail] || 0) + 1;
      }

      if (!usersMap[loginEmail]) usersMap[loginEmail] = [];
      usersMap[loginEmail].push({
        url,
        name: zoneName || url,
        captainName,
        contactEmail,
        role
      });
    }

    for (const adminEmail of wildcardAdmins) {
      const adminEntries = [];
      for (const [url, meta] of Object.entries(zoneByUrl)) {
        const primary = meta.captains[0] || { name: '', contactEmail: '' };
        const extras = Math.max(0, meta.captains.length - 1);
        adminEntries.push({
          url,
          name: meta.name || url,
          captainName: primary.name + (extras > 0 ? ` +${extras}` : ''),
          captainNames: meta.captains.map((captain) => captain.name).filter(Boolean),
          contactEmail: primary.contactEmail,
          contactEmails: meta.captains.map((captain) => captain.contactEmail).filter(Boolean),
          role: 'admin'
        });
      }
      adminEntries.sort((a, b) => a.name.localeCompare(b.name));

      const existing = usersMap[adminEmail] || [];
      const existingUrls = new Set(existing.map((entry) => entry.url));
      usersMap[adminEmail] = [
        ...existing,
        ...adminEntries.filter((entry) => !existingUrls.has(entry.url))
      ];
    }

    for (const [loginEmail, count] of Object.entries(captainAssignmentCount)) {
      if (count > 1 && !wildcardAdmins.includes(loginEmail)) {
        console.warn(`WARN: captain ${loginEmail} has ${count} active zone assignments`);
      }
    }

    cachedUsersMap = usersMap;
    cachedAt = now;
    return usersMap;
  } catch (err) {
    console.error('Failed to read user access sheet:', err.message);
    if (cachedUsersMap) return cachedUsersMap;
    throw err;
  }
}

async function recordUserDashboardUse(email) {
  const normalizedEmail = String(email || '').trim().toLowerCase();
  if (!normalizedEmail || String(process.env.USE_LEGACY_USERS || '').trim() === '1') {
    return { updated: 0, skipped: true };
  }

  const accessSheet = await readAccessSheet();
  if (!accessSheet) return { updated: 0, skipped: true };

  const lastSeenColumn = accessSheet.columns.lastSeenAt;
  const loginCountColumn = accessSheet.columns.loginCount;
  if (lastSeenColumn < 0 || loginCountColumn < 0) {
    console.warn('Access Sheet usage tracking skipped: missing last_seen_at or login_count column.');
    return { updated: 0, skipped: true };
  }

  const timestamp = new Date().toISOString();
  const updates = [];
  for (const record of accessSheet.records) {
    const rowEmail = String(record.get('loginEmail') || '').trim().toLowerCase();
    const active = String(record.get('active') || '').trim().toUpperCase();
    if (rowEmail !== normalizedEmail || active !== 'TRUE') continue;

    const currentCount = Number.parseInt(String(record.get('loginCount') || '0').replace(/,/g, ''), 10);
    const nextCount = Number.isFinite(currentCount) ? currentCount + 1 : 1;
    updates.push(
      {
        range: `Access!${columnIndexToA1(lastSeenColumn)}${record.rowNumber}`,
        values: [[timestamp]]
      },
      {
        range: `Access!${columnIndexToA1(loginCountColumn)}${record.rowNumber}`,
        values: [[String(nextCount)]]
      }
    );
  }

  if (!updates.length) return { updated: 0 };

  const sheets = await getSheetsClient();
  await sheets.spreadsheets.values.batchUpdate({
    spreadsheetId: accessSheet.spreadsheetId,
    requestBody: {
      valueInputOption: 'RAW',
      data: updates
    }
  });

  return { updated: updates.length, last_seen_at: timestamp };
}

async function readUserActivityRows() {
  if (String(process.env.USE_LEGACY_USERS || '').trim() === '1') {
    return [];
  }

  const accessSheet = await readAccessSheet();
  if (!accessSheet) return [];

  return accessSheet.records
    .map((record) => {
      const email = String(record.get('loginEmail') || '').trim().toLowerCase();
      const role = normalizeAccessRole(record.get('role'), '');
      const active = String(record.get('active') || '').trim().toUpperCase() === 'TRUE';
      const rawCount = Number.parseInt(String(record.get('loginCount') || '0').replace(/,/g, ''), 10);
      return {
        email,
        zone: String(record.get('zoneName') || '').trim(),
        captainName: String(record.get('captainName') || '').trim(),
        role,
        active,
        last_seen_at: String(record.get('lastSeenAt') || '').trim(),
        login_count: Number.isFinite(rawCount) ? rawCount : 0
      };
    })
    .filter((row) => row.email)
    .sort((a, b) => {
      const aTime = Date.parse(a.last_seen_at || '');
      const bTime = Date.parse(b.last_seen_at || '');
      const aValue = Number.isFinite(aTime) ? aTime : 0;
      const bValue = Number.isFinite(bTime) ? bTime : 0;
      return bValue - aValue || b.login_count - a.login_count || a.email.localeCompare(b.email);
    });
}

function extractGoogleSheetId(rawValue) {
  const value = String(rawValue || '').trim().replace(/^['"]|['"]$/g, '');
  if (!value) return null;

  const standardMatch = value.match(/\/spreadsheets\/d\/([a-zA-Z0-9-_]+)/i);
  if (standardMatch && standardMatch[1]) return standardMatch[1];

  // Some share links use ?id=<SHEET_ID> instead of /d/<SHEET_ID>/...
  const queryIdMatch = value.match(/[?&]id=([a-zA-Z0-9-_]+)/i);
  if (queryIdMatch && queryIdMatch[1]) return queryIdMatch[1];

  // Keep compatibility with published links (d/e style) if admins paste them.
  const publishedMatch = value.match(/\/spreadsheets\/d\/e\/([a-zA-Z0-9-_]+)/i);
  if (publishedMatch && publishedMatch[1]) return publishedMatch[1];

  return null;
}

function toCanonicalSheetUrl(rawValue) {
  const sheetId = extractGoogleSheetId(rawValue);
  if (!sheetId) return null;
  return `https://docs.google.com/spreadsheets/d/${sheetId}/edit`;
}

function normalizeUserSheetEntry(entry) {
  if (typeof entry === 'string') {
    const url = toCanonicalSheetUrl(entry);
    if (!url) return null;
    return { url, name: url };
  }

  if (entry && typeof entry === 'object' && !Array.isArray(entry)) {
    const url = toCanonicalSheetUrl(entry.url);
    if (!url) return null;
    const rawName = String(entry.name || '').trim();
    return { url, name: rawName || url };
  }

  return null;
}

function logUsersConfigStatusAtStartup() {
  readUsersMap()
    .then((map) => {
      const count = Object.keys(map).length;
      const source = String(process.env.USE_LEGACY_USERS || '').trim() === '1'
        ? 'legacy (kill-switch)'
        : (process.env.USER_ACCESS_SHEET_ID || '').trim()
          ? 'USER_ACCESS_SHEET_ID (Google Sheet)'
          : 'legacy (no USER_ACCESS_SHEET_ID set)';
      console.log(`User access config loaded from ${source}. Registered users: ${count}`);
    })
    .catch((err) => {
      if (err && err.code === 'ENOENT') {
        console.warn('No users config found. See USER_ACCESS_SHEET_MIGRATION.md.');
        return;
      }
      console.error(`User access config is malformed or unreadable: ${err.message}`);
    });
}

app.get('/api/user-sheets', async (req, res) => {
  const emailParam = (req.query.email || '').toString().trim().toLowerCase();
  if (!emailParam) {
    return res.status(400).json({ error: 'no_email' });
  }

  try {
    const rawRows = await getAccessRowsForEmail(emailParam);
    const roles = collectAccessRoles(rawRows);
    const capabilities = collectAccessCapabilities(rawRows);
    const rawSheets = rawRows.filter((entry) => entry && (typeof entry === 'string' || entry.url));
    if ((!Array.isArray(rawSheets) || rawSheets.length === 0) && roles.length === 0) {
      return res.status(403).json({ error: 'not_registered' });
    }
    const sheets = rawSheets.map((entry, index) => {
      if (entry && typeof entry === 'object' && entry.url) return entry;
      const normalized = normalizeUserSheetEntry(entry);
      if (!normalized) throw new Error(`invalid sheet at index ${index}`);
      return normalized;
    });
    try {
      await recordUserDashboardUse(emailParam);
    } catch (activityErr) {
      console.error('Failed to record dashboard usage:', activityErr.message);
    }
    return res.status(200).json({ sheets, roles, capabilities });
  } catch (err) {
    const message = err && err.code === 'ENOENT'
      ? 'No users config is available on the server.'
      : `User access config is invalid: ${err.message}`;
    console.error('Error in /api/user-sheets:', message);
    return res.status(500).json({ error: 'users_config_error', message });
  }
});

app.post('/api/admin/refresh-users', async (req, res) => {
  const emailParam = (req.query.email || '').toString().trim().toLowerCase();
  if (!emailParam) return res.status(401).json({ error: 'no_email' });

  try {
    if (!await isAdminEmail(emailParam)) return res.status(401).json({ error: 'not_admin' });

    cachedUsersMap = null;
    cachedAt = 0;
    const fresh = await readUsersMap();
    return res.status(200).json({
      ok: true,
      cleared_at: new Date().toISOString(),
      user_count: Object.keys(fresh).length,
      total_assignments: Object.values(fresh).reduce((count, entries) => count + entries.length, 0)
    });
  } catch (err) {
    return res.status(500).json({ error: 'refresh_failed', message: err.message });
  }
});

app.get('/api/admin/export-users-json', async (req, res) => {
  const emailParam = (req.query.email || '').toString().trim().toLowerCase();
  if (!emailParam) return res.status(401).json({ error: 'no_email' });

  try {
    const usersMap = await readUsersMap();
    if (!await isAdminEmail(emailParam)) return res.status(401).json({ error: 'not_admin' });

    const legacy = {
      _note: `FROZEN SNAPSHOT exported ${new Date().toISOString()} from Access Sheet. See USER_ACCESS_SHEET_MIGRATION.md -> Rollback Plan.`
    };
    for (const [email, entries] of Object.entries(usersMap)) {
      legacy[email] = entries.map((entry) => entry.url).filter(Boolean);
    }
    const raw = JSON.stringify(legacy, null, 2);
    return res.status(200).json({
      json: legacy,
      base64: Buffer.from(raw, 'utf8').toString('base64'),
      raw
    });
  } catch (err) {
    return res.status(500).json({ error: 'export_failed', message: err.message });
  }
});

app.get('/api/admin/user-activity', async (req, res) => {
  const emailParam = (req.query.email || '').toString().trim().toLowerCase();
  if (!emailParam) return res.status(401).json({ error: 'no_email' });

  try {
    if (!await isAdminEmail(emailParam)) return res.status(401).json({ error: 'not_admin' });

    const rows = await readUserActivityRows();
    const activeRows = rows.filter((row) => row.active);
    const seenRows = activeRows.filter((row) => row.last_seen_at);
    const totalLogins = activeRows.reduce((sum, row) => sum + (Number(row.login_count) || 0), 0);
    res.set('Cache-Control', 'no-store');
    return res.status(200).json({
      rows,
      summary: {
        active_users: activeRows.length,
        seen_users: seenRows.length,
        total_logins: totalLogins,
        last_seen_at: seenRows[0]?.last_seen_at || ''
      },
      lastFetchedAt: new Date().toISOString()
    });
  } catch (err) {
    console.error('Error in /api/admin/user-activity:', err.message);
    return res.status(500).json({ error: 'user_activity_failed', message: err.message });
  }
});

// Service account auth for Sheets API (single server-side identity)
let sheetsClientCache = null;
function getSheetsClient() {
  if (sheetsClientCache) return Promise.resolve(sheetsClientCache);
  const json = process.env.GOOGLE_SERVICE_ACCOUNT_JSON;
  const b64 = process.env.GOOGLE_SERVICE_ACCOUNT_JSON_B64;
  const keyPath = process.env.GOOGLE_APPLICATION_CREDENTIALS;
  if (!json && !b64 && !keyPath) {
    return Promise.reject(new Error('Missing GOOGLE_SERVICE_ACCOUNT_JSON, GOOGLE_SERVICE_ACCOUNT_JSON_B64, or GOOGLE_APPLICATION_CREDENTIALS'));
  }
  let credentials = null;
  if (b64) {
    try {
      credentials = JSON.parse(Buffer.from(b64, 'base64').toString('utf8'));
      if (credentials && credentials.client_email) {
        console.log('Sheets auth: using GOOGLE_SERVICE_ACCOUNT_JSON_B64, client_email=', credentials.client_email);
      }
    } catch (e) {
      return Promise.reject(new Error('Invalid GOOGLE_SERVICE_ACCOUNT_JSON_B64'));
    }
  } else if (json) {
    try {
      credentials = JSON.parse(json);
      if (credentials && credentials.client_email) {
        console.log('Sheets auth: using GOOGLE_SERVICE_ACCOUNT_JSON, client_email=', credentials.client_email);
      }
    } catch (e) {
      return Promise.reject(new Error('Invalid GOOGLE_SERVICE_ACCOUNT_JSON'));
    }
  }
  const authOptions = {
    scopes: ['https://www.googleapis.com/auth/spreadsheets']
  };
  if (credentials) {
    authOptions.credentials = credentials;
  } else {
    authOptions.keyFile = keyPath;
  }
  const auth = new google.auth.GoogleAuth(authOptions);
  const sheets = google.sheets({ version: 'v4', auth });
  sheetsClientCache = sheets;
  return Promise.resolve(sheets);
}

// Google Sheets API setup
// Using public sheet access (no auth needed if sheet is set to "Anyone with link can view")
// Set CENTRAL_SHEET_ID environment variable or update the default below
// To get the sheet ID from a Google Sheets URL: https://docs.google.com/spreadsheets/d/SHEET_ID_HERE/edit
const CENTRAL_SHEET_ID = process.env.CENTRAL_SHEET_ID || '1PaqcX2BSypJjLBDMA3DnlAxCHK5y0TWMSbCIkTScIQU';
const ACTIONS_SHEET_ID = process.env.ACTIONS_SHEET_ID || '1g6gmdXF1yjrejpmT3HTY7JI1Zzb7jErYZQ2pwiH37I0';
const NC_DIRECTORY_SHEET_ID = process.env.NC_DIRECTORY_SHEET_ID || '1E77qmT4eGtyokaDvD2wlK3q2NeMcS4itmkbYp6Rz0qM';
const LOT_WEEDING_SHEET_ID = extractSpreadsheetId(process.env.LOT_WEEDING_SHEET_ID || process.env.LOT_WEEDING_SHEET_URL || '');
const LOT_WEEDING_SHEET_NAME = process.env.LOT_WEEDING_SHEET_NAME || '';

function extractSpreadsheetId(value) {
  const clean = String(value || '').trim();
  if (!clean) return '';
  const match = clean.match(/\/spreadsheets\/d\/([a-zA-Z0-9-_]+)/);
  return match ? match[1] : clean;
}

// Gate mutating /api/sheets/* routes: valid Google Bearer token + sheet access.
// Emergency bypass: set SHEETS_WRITE_AUTH=0 in the environment.
const {
  createRequireSheetsWriteAuth,
  verifyGoogleAccessToken
} = require('./sheets-write-auth');
const { createSessionAuth } = require('./session-auth');

const sessionAuth = createSessionAuth({
  verifyGoogleAccessToken
});

const sheetsWriteAuthEnabled = String(process.env.SHEETS_WRITE_AUTH || '1').trim() !== '0';
const requireSheetsWriteAuth = createRequireSheetsWriteAuth({
  enabled: sheetsWriteAuthEnabled,
  getAccessRowsForEmail,
  extractGoogleSheetId,
  collectAccessRoles,
  sharedWritableSheetIds: [NC_DIRECTORY_SHEET_ID].filter(Boolean),
  resolveSessionIdentity(req, res) {
    const session = sessionAuth.readSession(req);
    if (!session) return null;
    sessionAuth.maybeSlideSession(req, res, session);
    return { email: session.email, sub: session.sub || '' };
  }
});
if (!sheetsWriteAuthEnabled) {
  console.warn('SHEETS_WRITE_AUTH=0 — sheet write endpoints are unauthenticated (emergency bypass).');
}

// Durable app session (Phase C): exchange Google access token for httpOnly cookie.
app.post('/api/auth/session', async (req, res) => {
  try {
    const session = await sessionAuth.createSessionFromGoogleToken(req, res);
    return res.status(200).json({
      ok: true,
      email: session.email,
      expiresAt: session.expiresAt
    });
  } catch (err) {
    const code = err && err.code;
    if (code === 'access_token_required') {
      return res.status(400).json({ error: 'access_token_required', message: 'Google access token required.' });
    }
    if (code === 'invalid_token' || code === 'missing_token' || code === 'no_email') {
      return res.status(401).json({ error: 'auth_invalid', message: 'Could not verify Google sign-in. Please try again.' });
    }
    console.error('Create session failed:', err.message);
    return res.status(500).json({ error: 'session_create_failed', message: 'Could not create session.' });
  }
});

app.get('/api/auth/me', (req, res) => {
  const session = sessionAuth.readSession(req);
  if (!session) {
    return res.status(401).json({ error: 'auth_required', message: 'Not signed in.' });
  }
  const slid = sessionAuth.maybeSlideSession(req, res, session);
  return res.status(200).json({
    ok: true,
    email: (slid && slid.email) || session.email,
    expiresAt: (slid && slid.expiresAt) || session.exp
  });
});

app.post('/api/auth/logout', (req, res) => {
  sessionAuth.clearSession(res, req);
  return res.status(200).json({ ok: true });
});

app.delete('/api/auth/session', (req, res) => {
  sessionAuth.clearSession(res, req);
  return res.status(200).json({ ok: true });
});

// Helper function to get sheet gid (grid ID) from sheet name for public sheets
async function getSheetGid(sheetId, sheetName) {
  try {
    const https = require('https');
    const metadataUrl = `https://sheets.googleapis.com/v4/spreadsheets/${sheetId}`;
    
    return new Promise((resolve, reject) => {
      https.get(metadataUrl, (response) => {
        let data = '';
        
        response.on('data', (chunk) => {
          data += chunk.toString();
        });
        
        response.on('end', () => {
          try {
            const metadata = JSON.parse(data);
            if (metadata.sheets) {
              // Find the sheet with matching name (case-insensitive)
              const sheet = metadata.sheets.find(s => 
                s.properties && s.properties.title && 
                s.properties.title.toLowerCase() === sheetName.toLowerCase()
              );
              
              if (sheet && sheet.properties && sheet.properties.sheetId !== undefined) {
                console.log(`Found sheet "${sheetName}" with gid: ${sheet.properties.sheetId}`);
                resolve(sheet.properties.sheetId);
              } else {
                console.log(`Sheet "${sheetName}" not found. Available sheets:`, 
                  metadata.sheets.map(s => s.properties?.title).filter(Boolean));
                reject(new Error(`Sheet "${sheetName}" not found in spreadsheet`));
              }
            } else {
              reject(new Error('Could not parse sheet metadata'));
            }
          } catch (error) {
            reject(error);
          }
        });
      }).on('error', (error) => {
        reject(error);
      });
    });
  } catch (error) {
    throw error;
  }
}

// Helper function to fetch Google Sheet data (public access)
async function fetchPublicSheet(sheetId, range = 'A1:ZZ1000', sheetName = null) {
  try {
    // If sheetName is provided, get the gid for that sheet
    let gid = '0'; // Default to first sheet
    if (sheetName) {
      try {
        gid = await getSheetGid(sheetId, sheetName);
      } catch (error) {
        console.error(`Error getting gid for sheet "${sheetName}":`, error.message);
        // Fall back to default gid=0
        gid = '0';
      }
    }
    
    // For public sheets, we can use CSV export
    // Try multiple URL formats
    const urls = [
      `https://docs.google.com/spreadsheets/d/${sheetId}/export?format=csv&gid=${gid}`,
      `https://docs.google.com/spreadsheets/d/${sheetId}/gviz/tq?tqx=out:csv&gid=${gid}`,
      `https://docs.google.com/spreadsheets/d/${sheetId}/export?format=csv&gid=0`
    ];
    
    const https = require('https');
    const http = require('http');
    
    // Try each URL until one works
    for (const url of urls) {
      try {
        const result = await new Promise((resolve, reject) => {
          const protocol = url.startsWith('https') ? https : http;
          
          const request = protocol.get(url, (response) => {
            // Handle redirects
            if (response.statusCode === 301 || response.statusCode === 302 || response.statusCode === 307 || response.statusCode === 308) {
              const redirectUrl = response.headers.location;
              if (redirectUrl) {
                console.log('Following redirect to:', redirectUrl);
                // Create new request for redirect
                const redirectProtocol = redirectUrl.startsWith('https') ? https : http;
                const redirectRequest = redirectProtocol.get(redirectUrl, (redirectResponse) => {
                  handleResponse(redirectResponse, resolve, reject);
                });
                redirectRequest.on('error', reject);
                redirectRequest.setTimeout(10000, () => {
                  redirectRequest.destroy();
                  reject(new Error('Request timeout'));
                });
                return;
              }
            }
            
            handleResponse(response, resolve, reject);
          });
          
          request.on('error', (error) => {
            console.error('Request error for URL:', url, error);
            reject(error);
          });
          
          request.setTimeout(10000, () => {
            request.destroy();
            reject(new Error('Request timeout'));
          });
        });
        
        // If we got here, the request succeeded
        return result;
      } catch (error) {
        console.log(`Failed to fetch with URL: ${url}`, error.message);
        // Continue to next URL
        continue;
      }
    }
    
    // If all URLs failed, throw error
    throw new Error('All export URL formats failed. Please ensure the sheet is set to "Anyone with the link can view" and try publishing it to web (File > Share > Publish to web).');
    
    function handleResponse(response, resolve, reject) {
      if (response.statusCode !== 200) {
        console.error(`HTTP ${response.statusCode}: ${response.statusMessage}`);
        reject(new Error(`HTTP ${response.statusCode}: ${response.statusMessage}`));
        return;
      }
      
      let csvText = '';
      response.on('data', (chunk) => {
        csvText += chunk.toString();
      });
      
      response.on('end', () => {
        try {
          // Check if we got HTML instead of CSV (common when sheet isn't public)
          if (csvText.trim().startsWith('<!DOCTYPE') || csvText.trim().startsWith('<html')) {
            console.error('Received HTML instead of CSV. Sheet may not be publicly accessible.');
            reject(new Error('Sheet is not publicly accessible. Please ensure it is set to "Anyone with the link can view" and try publishing it to web (File > Share > Publish to web).'));
            return;
          }
          
          // Parse CSV (split into rows respecting quoted fields - newlines inside quotes are part of the cell)
          const lines = splitCSVRows(csvText);
          if (lines.length === 0) {
            resolve({ headers: [], rows: [] });
            return;
          }
          
          // Parse header
          const headers = parseCSVLine(lines[0]);
          console.log('Parsed headers:', headers);
          
          // Parse rows
          const rows = lines.slice(1).map(line => {
            const values = parseCSVLine(line);
            const row = {};
            headers.forEach((header, index) => {
              row[header] = values[index] || '';
            });
            return row;
          });
          
          console.log(`Parsed ${rows.length} rows`);
          resolve({ headers, rows });
        } catch (error) {
          console.error('Error parsing CSV:', error);
          reject(error);
        }
      });
    }
  } catch (error) {
    console.error('Error fetching sheet:', error);
    throw error;
  }
}

// Split CSV text into rows, respecting quoted fields (newlines inside quotes stay in the cell)
function splitCSVRows(csvText) {
  const rows = [];
  let current = '';
  let inQuotes = false;
  for (let i = 0; i < csvText.length; i++) {
    const c = csvText[i];
    if (c === '"') {
      if (inQuotes && csvText[i + 1] === '"') {
        current += '"';
        i++;
      } else {
        inQuotes = !inQuotes;
        current += c;
      }
    } else if ((c === '\n' || c === '\r') && !inQuotes) {
      if (c === '\r' && csvText[i + 1] === '\n') i++;
      if (current.trim()) rows.push(current);
      current = '';
    } else {
      current += c;
    }
  }
  if (current.trim()) rows.push(current);
  return rows;
}

// Simple CSV parser (handles quoted fields)
function parseCSVLine(line) {
  const result = [];
  let current = '';
  let inQuotes = false;
  
  for (let i = 0; i < line.length; i++) {
    const char = line[i];
    
    if (char === '"') {
      if (inQuotes && line[i + 1] === '"') {
        // Escaped quote
        current += '"';
        i++;
      } else {
        // Toggle quote state
        inQuotes = !inQuotes;
      }
    } else if (char === ',' && !inQuotes) {
      // End of field
      result.push(current.trim());
      current = '';
    } else {
      current += char;
    }
  }
  
  // Add last field
  result.push(current.trim());
  
  return result;
}

// API Route: Homepage Feed
app.get('/api/homepage-feed', async (req, res) => {
  try {
    console.log('Fetching homepage feed from central sheet...');
    
    // Fetch the central sheet data
    const { headers, rows } = await fetchPublicSheet(CENTRAL_SHEET_ID);
    
    // The sheet structure: Column A is "Label", Columns B, C, D, etc. are "Content"
    // Each row represents one item with a label and multiple content fields
    
    const result = {
      items: [],
      alert: null
    };
    
    // Column A is the label column
    const labelCol = headers[0] || 'Label';
    // Column B is the first content column
    const contentCol = headers[1] || 'Content';
    
    // Check row 2 (index 0 in rows array) for alert
    // A2 should contain "ALERT" and B2 contains the alert message
    if (rows.length > 0) {
      const alertRow = rows[0]; // First data row = row 2 in spreadsheet
      const alertLabel = (alertRow[labelCol] || '').trim().toUpperCase();
      // Check if A2 is "ALERT" (case-insensitive)
      if (alertLabel === 'ALERT' || alertLabel === 'URGENT') {
        const alertText = (alertRow[contentCol] || '').trim();
        if (alertText) {
          result.alert = alertText;
        }
      }
    }
    
    // Process each row (skip row 2 if it's the alert)
    rows.forEach((row, index) => {
      // Skip row 2 (index 0) as it's reserved for alerts
      if (index === 0) {
        const rowLabel = (row[labelCol] || '').trim().toUpperCase();
        // Only skip if it's actually an alert row
        if (rowLabel === 'ALERT' || rowLabel === 'URGENT') {
          return;
        }
      }
      
      const label = (row[labelCol] || '').trim();
      
      // Skip rows without a label
      if (!label) return;
      
      // Get all content columns (B, C, D, etc.) - everything after the label column
      const content = [];
      for (let i = 1; i < headers.length; i++) {
        const contentValue = (row[headers[i]] || '').trim();
        if (contentValue) {
          content.push(contentValue);
        }
      }
      
      // Only add items that have at least a label
      if (label) {
        result.items.push({
          label: label,
          content: content
        });
      }
    });
    
    console.log('Homepage feed fetched successfully');
    res.json(result);
  } catch (error) {
    console.error('Error fetching homepage feed:', error);
    res.status(500).json({ 
      error: 'Failed to fetch homepage feed',
      message: error.message 
    });
  }
});

// API Route: Actions Feed
app.get('/api/actions-feed', async (req, res) => {
  try {
    console.log('Fetching actions feed from actions sheet...');
    
    // Fetch from the dedicated actions sheet (no tab name needed - uses first sheet)
    const { headers, rows } = await fetchPublicSheet(ACTIONS_SHEET_ID);
    
    console.log('Headers found:', headers);
    console.log('Number of rows:', rows.length);
    
    const result = {
      items: []
    };
    
    // Column A is the label column
    const labelCol = headers[0] || 'Label';
    
    // Look for ContentA, ContentB, ContentC, ContentD columns (case-insensitive)
    const contentCols = ['ContentA', 'ContentB', 'ContentC', 'ContentD'].map(colName => {
      const found = headers.find(h => h.trim().toLowerCase() === colName.toLowerCase());
      if (found) {
        console.log(`Found column: ${found} (looking for ${colName})`);
      }
      return found;
    }).filter(Boolean);
    
    console.log('Content columns found:', contentCols);
    
    // Process each row
    rows.forEach((row, index) => {
      const label = (row[labelCol] || '').trim();
      
      // Skip rows without a label
      if (!label) return;
      
      // Get content from ContentA, ContentB, ContentC, ContentD columns
      const content = [];
      contentCols.forEach(colName => {
        const contentValue = (row[colName] || '').trim();
        if (contentValue) {
          content.push(contentValue);
        }
      });
      
      // Only add items that have at least a label
      if (label) {
        result.items.push({
          label: label,
          content: content
        });
        console.log(`Added action item: ${label} with ${content.length} content fields`);
      }
    });
    
    console.log(`Actions feed fetched successfully. Total items: ${result.items.length}`);
    res.json(result);
  } catch (error) {
    console.error('Error fetching actions feed:', error);
    res.status(500).json({ 
      error: 'Failed to fetch actions feed',
      message: error.message 
    });
  }
});

// API Route: NC Directory (Sheet1 only - for standalone directory site)
app.get('/api/nc-directory', async (req, res) => {
  try {
    const { headers, rows } = await fetchPublicSheet(NC_DIRECTORY_SHEET_ID, 'A1:ZZ500', 'Sheet1');
    res.json({ headers, rows });
  } catch (error) {
    console.error('Error fetching NC Directory:', error);
    res.status(500).json({
      error: 'Failed to fetch NC Directory',
      message: error.message
    });
  }
});

// --- Sheets proxy (service account) ---
function sheetsErrorStatus(err) {
  const code = err.code || (err.response && err.response.status);
  if (code === 403) return 403;
  if (code === 404) return 404;
  if (code === 400) return 400;
  return 500;
}

// GET/POST /api/sheets/values - read range
app.get('/api/sheets/values', async (req, res) => {
  const sheetId = req.query.sheetId;
  const range = req.query.range || 'A1:ZZ1000';
  const sheetName = req.query.sheetName || null;
  if (!sheetId) {
    return res.status(400).json({ error: 'sheetId required' });
  }
  try {
    const sheets = await getSheetsClient();
    const rangeStr = sheetName ? `${sheetName}!${range}` : range;
    const result = await sheets.spreadsheets.values.get({
      spreadsheetId: sheetId,
      range: rangeStr
    });
    res.json(result.data);
  } catch (err) {
    const status = sheetsErrorStatus(err);
    const message = err.message || (err.response && err.response.data && err.response.data.error && err.response.data.error.message) || 'Sheets API error';
    console.error('Sheets values get error:', message);
    console.error('Sheets error details: code=', err.code, 'response=', err.response && err.response.data ? JSON.stringify(err.response.data) : 'none');
    res.status(status).json({ error: 'Failed to fetch sheet values', message });
  }
});

app.post('/api/sheets/values', async (req, res) => {
  const { sheetId, range = 'A1:ZZ1000', sheetName } = req.body || {};
  if (!sheetId) {
    return res.status(400).json({ error: 'sheetId required' });
  }
  try {
    const sheets = await getSheetsClient();
    const rangeStr = sheetName ? `${sheetName}!${range}` : range;
    const result = await sheets.spreadsheets.values.get({
      spreadsheetId: sheetId,
      range: rangeStr
    });
    res.json(result.data);
  } catch (err) {
    const status = sheetsErrorStatus(err);
    const message = err.message || (err.response && err.response.data && err.response.data.error && err.response.data.error.message) || 'Sheets API error';
    console.error('Sheets values get error:', message);
    console.error('Sheets error details: code=', err.code, 'response=', err.response && err.response.data ? JSON.stringify(err.response.data) : 'none');
    res.status(status).json({ error: 'Failed to fetch sheet values', message });
  }
});

// POST /api/sheets/append - append rows
app.post('/api/sheets/append', requireSheetsWriteAuth, async (req, res) => {
  const { sheetId, values, sheetName = 'Sheet1' } = req.body || {};
  if (!sheetId || !values || !Array.isArray(values)) {
    return res.status(400).json({ error: 'sheetId and values (array) required' });
  }
  try {
    const sheets = await getSheetsClient();
    const range = `${sheetName}!A1:ZZ`;
    await sheets.spreadsheets.values.append({
      spreadsheetId: sheetId,
      range,
      valueInputOption: 'USER_ENTERED',
      requestBody: { values }
    });
    res.json({ success: true });
  } catch (err) {
    const status = sheetsErrorStatus(err);
    const message = err.message || (err.response && err.response.data && err.response.data.error && err.response.data.error.message) || 'Sheets API error';
    console.error('Sheets append error:', message);
    res.status(status).json({ error: 'Failed to append rows', message });
  }
});

// POST /api/sheets/append-record - append one row while inheriting validation/format
app.post('/api/sheets/append-record', requireSheetsWriteAuth, async (req, res) => {
  const { sheetId, values, sheetName = 'Sheet1' } = req.body || {};
  if (!sheetId || !Array.isArray(values)) {
    return res.status(400).json({ error: 'sheetId and values (row array) required' });
  }
  try {
    const sheets = await getSheetsClient();

    // Resolve target tab metadata (gid + grid size)
    const metadata = await sheets.spreadsheets.get({ spreadsheetId: sheetId });
    const targetSheet = (metadata.data.sheets || []).find(
      (s) => (s.properties && s.properties.title) === sheetName
    );
    if (!targetSheet || !targetSheet.properties || targetSheet.properties.sheetId === undefined) {
      return res.status(404).json({ error: `Sheet "${sheetName}" not found` });
    }
    const targetSheetId = targetSheet.properties.sheetId;

    // Find the last logical row in use. values.get returns rows up to the last non-empty row.
    const existing = await sheets.spreadsheets.values.get({
      spreadsheetId: sheetId,
      range: `${sheetName}!A1:ZZ`
    });
    const existingRows = (existing.data && existing.data.values) ? existing.data.values : [];
    const insertAtRowNumber = Math.max(existingRows.length + 1, 2); // keep row 1 as header

    // Insert a physical row that inherits data validation/checkbox/dropdown rules from above.
    const insertStartIndex = insertAtRowNumber - 1; // 0-based index where the new row is inserted
    await sheets.spreadsheets.batchUpdate({
      spreadsheetId: sheetId,
      requestBody: {
        requests: [
          {
            insertDimension: {
              range: {
                sheetId: targetSheetId,
                dimension: 'ROWS',
                startIndex: insertStartIndex,
                endIndex: insertStartIndex + 1
              },
              inheritFromBefore: true
            }
          }
        ]
      }
    });

    // Write as RAW so fractional units (e.g. 1/2) and address_id stay plain text
    // instead of being coerced into dates/numbers by Sheets.
    await sheets.spreadsheets.values.update({
      spreadsheetId: sheetId,
      range: `${sheetName}!A${insertAtRowNumber}:ZZ${insertAtRowNumber}`,
      valueInputOption: 'RAW',
      requestBody: { values: [values] }
    });

    res.json({ success: true, rowNumber: insertAtRowNumber });
  } catch (err) {
    const status = sheetsErrorStatus(err);
    const message = err.message || (err.response && err.response.data && err.response.data.error && err.response.data.error.message) || 'Sheets API error';
    console.error('Sheets append-record error:', message);
    res.status(status).json({ error: 'Failed to append record', message });
  }
});

// POST /api/sheets/batch-update - batchUpdate
app.post('/api/sheets/batch-update', requireSheetsWriteAuth, async (req, res) => {
  const { sheetId, valueInputOption = 'USER_ENTERED', data } = req.body || {};
  if (!sheetId || !data || !Array.isArray(data)) {
    return res.status(400).json({ error: 'sheetId and data (array of { range, values }) required' });
  }
  try {
    const sheets = await getSheetsClient();
    await sheets.spreadsheets.values.batchUpdate({
      spreadsheetId: sheetId,
      requestBody: { valueInputOption, data }
    });
    res.json({ success: true });
  } catch (err) {
    const status = sheetsErrorStatus(err);
    const message = err.message || (err.response && err.response.data && err.response.data.error && err.response.data.error.message) || 'Sheets API error';
    console.error('Sheets batch-update error:', message);
    res.status(status).json({ error: 'Failed to batch update', message });
  }
});

// Convert 0-based column index to Sheets column letter (0 -> A, 25 -> Z, 26 -> AA)
function indexToColumnLetter(index) {
  let letter = '';
  let n = index;
  while (n >= 0) {
    letter = String.fromCharCode((n % 26) + 65) + letter;
    n = Math.floor(n / 26) - 1;
  }
  return letter;
}

// Columns that must stay plain text (Sheets USER_ENTERED can turn 1/2 into a date).
const SHEETS_TEXT_SAFE_COLUMNS = new Set([
  '_situshouseno',
  '_situsunit',
  'zip',
  'address_id'
]);

function isSheetsTextSafeColumn(column) {
  return SHEETS_TEXT_SAFE_COLUMNS.has(String(column || '').trim().toLowerCase());
}

// POST /api/sheets/batch-update-by-resident-id - resolve row by resident_id then batch update (sort-safe)
app.post('/api/sheets/batch-update-by-resident-id', requireSheetsWriteAuth, async (req, res) => {
  const { sheetId, sheetName = 'Sheet1', valueInputOption = 'USER_ENTERED', updates } = req.body || {};
  if (!sheetId || !updates || !Array.isArray(updates) || updates.length === 0) {
    return res.status(400).json({ error: 'sheetId and updates (array of { resident_id, column, value }) required' });
  }
  try {
    const sheets = await getSheetsClient();
    const residentIdCol = 'resident_id';

    const [headerRes, dataRes] = await Promise.all([
      sheets.spreadsheets.values.get({ spreadsheetId: sheetId, range: `${sheetName}!1:1` }),
      sheets.spreadsheets.values.get({ spreadsheetId: sheetId, range: `${sheetName}!A2:ZZ` })
    ]);
    const headers = (headerRes.data.values && headerRes.data.values[0]) ? headerRes.data.values[0] : [];
    const rows = (dataRes.data.values) ? dataRes.data.values : [];

    const residentIdColIndex = headers.findIndex(h => String(h || '').trim().toLowerCase() === residentIdCol);
    if (residentIdColIndex === -1) {
      return res.status(400).json({ error: 'Sheet has no resident_id column' });
    }

    const residentIdToRowNumber = new Map();
    rows.forEach((row, i) => {
      const rid = row[residentIdColIndex] != null ? String(row[residentIdColIndex]).trim() : '';
      if (rid) residentIdToRowNumber.set(rid, i + 2);
    });

    const rawData = [];
    const enteredData = [];
    for (const u of updates) {
      const resident_id = u.resident_id != null ? String(u.resident_id).trim() : '';
      const column = u.column;
      const value = u.value;
      if (!resident_id || column === undefined) continue;
      const rowNum = residentIdToRowNumber.get(resident_id);
      if (rowNum == null) {
        console.warn('resident_id not found in sheet:', resident_id);
        continue;
      }
      const colIndex = headers.findIndex(h => String(h || '').trim() === String(column).trim());
      if (colIndex === -1) continue;
      const colLetter = indexToColumnLetter(colIndex);
      const cell = { range: `${sheetName}!${colLetter}${rowNum}`, values: [[value]] };
      if (isSheetsTextSafeColumn(column)) rawData.push(cell);
      else enteredData.push(cell);
    }

    if (rawData.length === 0 && enteredData.length === 0) {
      return res.status(400).json({ error: 'No valid updates after resolving resident_id' });
    }

    if (rawData.length) {
      await sheets.spreadsheets.values.batchUpdate({
        spreadsheetId: sheetId,
        requestBody: { valueInputOption: 'RAW', data: rawData }
      });
    }
    if (enteredData.length) {
      await sheets.spreadsheets.values.batchUpdate({
        spreadsheetId: sheetId,
        requestBody: { valueInputOption, data: enteredData }
      });
    }
    res.json({ success: true });
  } catch (err) {
    const status = sheetsErrorStatus(err);
    const message = err.message || (err.response && err.response.data && err.response.data.error && err.response.data.error.message) || 'Sheets API error';
    console.error('Sheets batch-update-by-resident-id error:', message);
    res.status(status).json({ error: 'Failed to batch update by resident_id', message });
  }
});

// --- Lot Weeding source + admin layer ---
try {
  const { registerLotWeedingRoutes } = require('./lot-weeding/routes');
  registerLotWeedingRoutes(app, {
    getSheetsClient,
    hasLotWeedingAdminAccess
  });
  console.log('Lot weeding routes registered.');
} catch (err) {
  console.error('Failed to register lot weeding routes:', err.message);
}

// --- EPIC-LA integration (read-only cache lookups + admin sync trigger) ---
// The EPIC cache lives in a dedicated Google Sheet (EPIC_CACHE_SHEET_ID) and
// is refreshed by `npm run sync:epic` or POST /api/admin/sync-epic. None of
// this touches captain/master operational sheets. See EPIC_RUNBOOK.md.
try {
  const { registerEpicRoutes } = require('./epic/routes');
  registerEpicRoutes(app, {
    getSheetsClient,
    isAdminEmail
  });
  console.log('EPIC-LA routes registered.');
} catch (err) {
  console.error('Failed to register EPIC-LA routes:', err.message);
}

// --- Godmode admin layer (read-only master spreadsheet) ---
try {
  const { registerGodmodeRoutes } = require('./godmode/routes');
  registerGodmodeRoutes(app, {
    getSheetsClient,
    isAdminEmail
  });
  console.log('Godmode routes registered.');
} catch (err) {
  console.error('Failed to register Godmode routes:', err.message);
}

// --- Contact Check-In (AddressReview progress store) ---
try {
  const { registerContactCheckinRoutes, getContactCheckinConfig } = require('./contact-checkin/routes');
  registerContactCheckinRoutes(app, { getSheetsClient });
  const checkinConfig = getContactCheckinConfig();
  console.log(`Contact Check-In routes registered (sheet: ${checkinConfig.sheetId || 'not configured'}).`);
} catch (err) {
  console.error('Failed to register Contact Check-In routes:', err.message);
}

// Explicit PWA shell files (avoid SPA fallback + keep SW update-friendly).
app.get('/sw.js', (req, res) => {
  res.setHeader('Cache-Control', 'no-cache, max-age=0, must-revalidate');
  res.setHeader('Service-Worker-Allowed', '/');
  res.type('application/javascript');
  res.sendFile(path.join(__dirname, 'sw.js'));
});

app.get('/manifest.webmanifest', (req, res) => {
  res.setHeader('Cache-Control', 'no-cache, max-age=0, must-revalidate');
  res.type('application/manifest+json');
  res.sendFile(path.join(__dirname, 'manifest.webmanifest'));
});

// Explicitly serve standalone HTML pages so they're not caught by the SPA fallback
app.get('/flyer_tool.html', (req, res) => {
  res.sendFile(path.join(__dirname, 'flyer_tool.html'));
});
app.get('/about.html', (req, res) => {
  res.sendFile(path.join(__dirname, 'about.html'));
});
app.get('/help.html', (req, res) => {
  res.sendFile(path.join(__dirname, 'help.html'));
});
app.get('/discord-help.html', (req, res) => {
  res.sendFile(path.join(__dirname, 'discord-help.html'));
});

// Serve index.html for all other routes (SPA fallback)
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
});

// Start server
app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
  console.log(`Central sheet ID (announcements): ${CENTRAL_SHEET_ID}`);
  console.log(`Actions sheet ID: ${ACTIONS_SHEET_ID}`);
  console.log(`NC Directory sheet ID: ${NC_DIRECTORY_SHEET_ID}`);
  try {
    const { getLotWeedingConfig } = require('./lot-weeding/routes');
    const lotWeedingConfig = getLotWeedingConfig();
    console.log(`Lot weeding source (${lotWeedingConfig.source}) sheet ID: ${lotWeedingConfig.sheetId || 'not configured'}`);
  } catch (err) {
    console.log(`Lot weeding mirror sheet ID: ${LOT_WEEDING_SHEET_ID || 'not configured'}`);
  }
  console.log(`To change sheets, update the IDs in server.js or set environment variables`);
  logUsersConfigStatusAtStartup();
});


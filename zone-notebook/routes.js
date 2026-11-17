'use strict';

/**
 * Zone Notebook — zone-level info that any captain of the zone can edit
 * (events hosted in the zone, issues specific to the zone).
 *
 * One Google Sheet (ZONE_NOTEBOOK_SHEET_ID) with two tabs:
 *   Events       ID | Zone | Event | Date | Notes | Added By | Added On | Last Edited By | Last Edited On
 *   Zone Issues  Zone | Issues | Last Updated By | Last Updated On
 *
 * The zone is never taken from the client. The client sends the zone
 * spreadsheet it has open; the server checks the caller is assigned to that
 * spreadsheet in the Access sheet (or is an admin) and resolves the zone name
 * from the Access sheet, so every captain of a zone reads and writes the same rows.
 *
 * Env:
 *   ZONE_NOTEBOOK_SHEET_ID     spreadsheet id or full URL
 *   ZONE_NOTEBOOK_EVENTS_TAB   default "Events"
 *   ZONE_NOTEBOOK_ISSUES_TAB   default "Zone Issues"
 */

const crypto = require('crypto');
const {
  extractBearerToken,
  verifyGoogleAccessToken,
  isRegisteredAccessRows
} = require('../sheets-write-auth');

const DEFAULT_ZONE_NOTEBOOK_SHEET_ID = '1OZcPv_AKdolyDzZKRGk3DgDusj4u1acPcLUNnQQhBYA';
const DEFAULT_NC_DIRECTORY_SHEET_ID = '1E77qmT4eGtyokaDvD2wlK3q2NeMcS4itmkbYp6Rz0qM';
const TAB_CACHE_TTL_MS = 15 * 1000;
const DIRECTORY_CACHE_TTL_MS = 5 * 60 * 1000;

const EVENT_HEADERS = ['ID', 'Zone', 'Event', 'Date', 'Notes', 'Added By', 'Added On', 'Last Edited By', 'Last Edited On'];
const ISSUE_HEADERS = ['Zone', 'Issues', 'Last Updated By', 'Last Updated On'];

const EVENT_FIELD_ALIASES = {
  id: ['id', 'eventid'],
  zone: ['zone', 'zonename'],
  event: ['event', 'eventname', 'title'],
  date: ['date', 'eventdate', 'when'],
  notes: ['notes', 'note', 'details', 'description'],
  addedBy: ['addedby', 'createdby'],
  addedOn: ['addedon', 'createdon', 'createdat', 'timestamp'],
  lastEditedBy: ['lasteditedby', 'editedby', 'updatedby'],
  lastEditedOn: ['lasteditedon', 'editedon', 'updatedon', 'updatedat']
};

const ISSUE_FIELD_ALIASES = {
  zone: ['zone', 'zonename'],
  issues: ['issues', 'zoneissues'],
  lastUpdatedBy: ['lastupdatedby', 'updatedby'],
  lastUpdatedOn: ['lastupdatedon', 'updatedon', 'updatedat']
};

const LIMITS = {
  event: 160,
  notes: 2000,
  issues: 4000
};

const tabCache = new Map();
const tabGidCache = new Map();
let directoryNameCache = null;

function strEnv(name, fallback = '') {
  return String(process.env[name] || fallback).trim();
}

function extractSpreadsheetId(value) {
  const clean = String(value || '').trim();
  if (!clean) return '';
  const match = clean.match(/\/spreadsheets\/d\/([a-zA-Z0-9-_]+)/);
  return match ? match[1] : clean;
}

function getZoneNotebookConfig() {
  return {
    sheetId: extractSpreadsheetId(strEnv('ZONE_NOTEBOOK_SHEET_ID', DEFAULT_ZONE_NOTEBOOK_SHEET_ID)),
    eventsTab: strEnv('ZONE_NOTEBOOK_EVENTS_TAB', 'Events'),
    issuesTab: strEnv('ZONE_NOTEBOOK_ISSUES_TAB', 'Zone Issues'),
    ncDirectorySheetId: extractSpreadsheetId(strEnv('NC_DIRECTORY_SHEET_ID', DEFAULT_NC_DIRECTORY_SHEET_ID))
  };
}

function quoteSheetName(name) {
  return `'${String(name || '').replace(/'/g, "''")}'`;
}

function normalizeKey(value) {
  return String(value || '').trim().toLowerCase().replace(/[^a-z0-9]/g, '');
}

function normalizeText(value) {
  return String(value || '').trim().replace(/\s+/g, ' ');
}

function normalizeMultiline(value) {
  return String(value || '')
    .replace(/\r\n?/g, '\n')
    .split('\n')
    .map((line) => line.replace(/[ \t]+$/g, ''))
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

// "Zone 12", "zone-12", "12" all compare equal.
function normalizeZoneKey(value) {
  return String(value || '').toLowerCase().replace(/\bzone\b/g, '').replace(/[^a-z0-9]/g, '');
}

function columnLetter(index) {
  let n = Number(index) + 1;
  let label = '';
  while (n > 0) {
    const remainder = (n - 1) % 26;
    label = String.fromCharCode(65 + remainder) + label;
    n = Math.floor((n - 1) / 26);
  }
  return label;
}

function headerIndexFor(headers, aliases) {
  const aliasKeys = (aliases || []).map(normalizeKey);
  return (headers || []).findIndex((header) => aliasKeys.includes(normalizeKey(header)));
}

function cellFor(headers, rowValues, aliases) {
  const index = headerIndexFor(headers, aliases);
  if (index < 0) return '';
  const value = rowValues && rowValues[index];
  return value == null ? '' : String(value);
}

// Write record fields into the live header order, keeping any extra columns the
// sheet owner added (existingValues) untouched.
function buildRowValues(headers, existingValues, record, aliasesByField) {
  const values = (headers || []).map((_, i) => {
    const existing = existingValues && existingValues[i];
    return existing == null ? '' : String(existing);
  });
  for (const [field, aliases] of Object.entries(aliasesByField)) {
    if (!Object.prototype.hasOwnProperty.call(record, field)) continue;
    const index = headerIndexFor(headers, aliases);
    if (index >= 0) values[index] = record[field] == null ? '' : String(record[field]);
  }
  return values;
}

// Accepts YYYY-MM-DD or M/D/YYYY. Returns YYYY-MM-DD, '' for blank, or null if unparseable.
function normalizeDateInput(value) {
  const text = normalizeText(value);
  if (!text) return '';
  let year;
  let month;
  let day;
  const iso = text.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
  const us = text.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2}|\d{4})$/);
  if (iso) {
    year = Number(iso[1]);
    month = Number(iso[2]);
    day = Number(iso[3]);
  } else if (us) {
    month = Number(us[1]);
    day = Number(us[2]);
    year = Number(us[3].length === 2 ? `20${us[3]}` : us[3]);
  } else {
    return null;
  }
  const check = new Date(Date.UTC(year, month - 1, day));
  if (check.getUTCFullYear() !== year || check.getUTCMonth() !== month - 1 || check.getUTCDate() !== day) {
    return null;
  }
  return `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

function nameFromEmail(email) {
  const local = String(email || '').split('@')[0] || '';
  return local.replace(/[._-]+/g, ' ').replace(/\b\w/g, (ch) => ch.toUpperCase()).trim();
}

/**
 * Map zone spreadsheet id -> zone name, using the Access sheet's zone_name for
 * captain rows. If captains' rows disagree on spelling, the most common name wins
 * (ties broken alphabetically) so every captain of a zone resolves the same name.
 */
function buildZoneNameIndex(usersMap, extractId) {
  const counts = new Map();
  for (const rows of Object.values(usersMap || {})) {
    for (const entry of (Array.isArray(rows) ? rows : [])) {
      if (!entry || typeof entry !== 'object' || !entry.url) continue;
      if (String(entry.role || '').toLowerCase() === 'admin') continue;
      const sheetId = extractId(entry.url);
      const name = normalizeText(entry.name);
      if (!sheetId || !name || name === entry.url) continue;
      if (!counts.has(sheetId)) counts.set(sheetId, new Map());
      const byName = counts.get(sheetId);
      byName.set(name, (byName.get(name) || 0) + 1);
    }
  }
  const index = new Map();
  for (const [sheetId, byName] of counts.entries()) {
    const best = Array.from(byName.entries())
      .sort((a, b) => (b[1] - a[1]) || a[0].localeCompare(b[0]))[0];
    if (best) index.set(sheetId, best[0]);
  }
  return index;
}

/**
 * Returns the zone name the caller may edit for the given zone spreadsheet, or ''
 * if they are not assigned to it. Admins may edit any zone.
 */
function resolveZoneForCaller({ rows, isAdmin, sheetId, zoneIndex, extractId }) {
  const wanted = String(sheetId || '').trim();
  if (!wanted) return '';
  const match = (Array.isArray(rows) ? rows : []).find((entry) => {
    return entry && typeof entry === 'object' && entry.url && extractId(entry.url) === wanted;
  });
  if (!match && !isAdmin) return '';
  const fromIndex = zoneIndex && zoneIndex.get(wanted);
  if (fromIndex) return fromIndex;
  const fromRow = match ? normalizeText(match.name) : '';
  return fromRow && fromRow !== match.url ? fromRow : '';
}

function mapEventRow(headers, rowValues, rowNumber) {
  const rawDate = cellFor(headers, rowValues, EVENT_FIELD_ALIASES.date);
  const normalizedDate = normalizeDateInput(rawDate);
  return {
    rowNumber,
    id: normalizeText(cellFor(headers, rowValues, EVENT_FIELD_ALIASES.id)),
    zone: normalizeText(cellFor(headers, rowValues, EVENT_FIELD_ALIASES.zone)),
    event: normalizeText(cellFor(headers, rowValues, EVENT_FIELD_ALIASES.event)),
    date: normalizedDate == null ? normalizeText(rawDate) : normalizedDate,
    notes: normalizeMultiline(cellFor(headers, rowValues, EVENT_FIELD_ALIASES.notes)),
    addedBy: normalizeText(cellFor(headers, rowValues, EVENT_FIELD_ALIASES.addedBy)),
    addedOn: normalizeText(cellFor(headers, rowValues, EVENT_FIELD_ALIASES.addedOn)),
    lastEditedBy: normalizeText(cellFor(headers, rowValues, EVENT_FIELD_ALIASES.lastEditedBy)),
    lastEditedOn: normalizeText(cellFor(headers, rowValues, EVENT_FIELD_ALIASES.lastEditedOn))
  };
}

function mapIssueRow(headers, rowValues, rowNumber) {
  return {
    rowNumber,
    zone: normalizeText(cellFor(headers, rowValues, ISSUE_FIELD_ALIASES.zone)),
    issues: normalizeMultiline(cellFor(headers, rowValues, ISSUE_FIELD_ALIASES.issues)),
    lastUpdatedBy: normalizeText(cellFor(headers, rowValues, ISSUE_FIELD_ALIASES.lastUpdatedBy)),
    lastUpdatedOn: normalizeText(cellFor(headers, rowValues, ISSUE_FIELD_ALIASES.lastUpdatedOn))
  };
}

// Newest event first; undated events last, newest-added first.
function sortEvents(items) {
  return items.slice().sort((a, b) => {
    const aDate = /^\d{4}-\d{2}-\d{2}$/.test(a.date) ? a.date : '';
    const bDate = /^\d{4}-\d{2}-\d{2}$/.test(b.date) ? b.date : '';
    if (aDate && bDate && aDate !== bDate) return aDate < bDate ? 1 : -1;
    if (aDate && !bDate) return -1;
    if (!aDate && bDate) return 1;
    return String(b.addedOn || '').localeCompare(String(a.addedOn || ''));
  });
}

function createEventId() {
  return `evt_${crypto.randomBytes(6).toString('hex')}`;
}

function isRetryableSheetsError(err) {
  const msg = String((err && err.message) || err || '').toLowerCase();
  const code = err && (err.code || (err.response && err.response.status));
  if (code === 429 || code === 503 || code === 500) return true;
  if (msg.includes('quota') || msg.includes('rate limit')) return true;
  if (msg.includes('backend error') || msg.includes('internal error')) return true;
  if (msg.includes('unavailable') || msg.includes('timeout')) return true;
  return false;
}

async function withSheetsRetry(fn, { attempts = 4, baseDelayMs = 700 } = {}) {
  let lastErr;
  for (let i = 0; i < attempts; i += 1) {
    try {
      return await fn();
    } catch (err) {
      lastErr = err;
      if (i >= attempts - 1 || !isRetryableSheetsError(err)) throw err;
      const delay = baseDelayMs * (2 ** i) + Math.floor(Math.random() * 250);
      await new Promise((resolve) => setTimeout(resolve, delay));
    }
  }
  throw lastErr;
}

async function loadTab(sheets, config, tabName, { forceRefresh = false } = {}) {
  const cacheKey = `${config.sheetId}::${tabName}`;
  const cached = tabCache.get(cacheKey);
  if (!forceRefresh && cached && cached.expiresAt > Date.now()) return cached;
  const result = await withSheetsRetry(() => sheets.spreadsheets.values.get({
    spreadsheetId: config.sheetId,
    range: `${quoteSheetName(tabName)}!A1:Z`
  }));
  const values = (result.data && result.data.values) ? result.data.values : [];
  const payload = {
    expiresAt: Date.now() + TAB_CACHE_TTL_MS,
    headers: (values[0] || []).map((h) => String(h == null ? '' : h).trim()),
    rows: values.slice(1)
  };
  tabCache.set(cacheKey, payload);
  return payload;
}

function invalidateTab(config, tabName) {
  tabCache.delete(`${config.sheetId}::${tabName}`);
}

async function ensureHeaders(sheets, config, tabName, defaultHeaders, loaded) {
  if (loaded.headers && loaded.headers.some(Boolean)) return loaded.headers;
  await withSheetsRetry(() => sheets.spreadsheets.values.update({
    spreadsheetId: config.sheetId,
    range: `${quoteSheetName(tabName)}!A1`,
    valueInputOption: 'RAW',
    requestBody: { values: [defaultHeaders] }
  }));
  invalidateTab(config, tabName);
  return defaultHeaders.slice();
}

// RAW so captain-entered text is never evaluated as a formula.
async function appendRow(sheets, config, tabName, values) {
  await withSheetsRetry(() => sheets.spreadsheets.values.append({
    spreadsheetId: config.sheetId,
    range: `${quoteSheetName(tabName)}!A1`,
    valueInputOption: 'RAW',
    insertDataOption: 'INSERT_ROWS',
    requestBody: { values: [values] }
  }));
  invalidateTab(config, tabName);
}

async function updateRow(sheets, config, tabName, rowNumber, values) {
  const lastCol = columnLetter(Math.max(values.length - 1, 0));
  await withSheetsRetry(() => sheets.spreadsheets.values.update({
    spreadsheetId: config.sheetId,
    range: `${quoteSheetName(tabName)}!A${rowNumber}:${lastCol}${rowNumber}`,
    valueInputOption: 'RAW',
    requestBody: { values: [values] }
  }));
  invalidateTab(config, tabName);
}

async function getTabGid(sheets, config, tabName) {
  const cacheKey = `${config.sheetId}::${tabName}`;
  if (tabGidCache.has(cacheKey)) return tabGidCache.get(cacheKey);
  const result = await withSheetsRetry(() => sheets.spreadsheets.get({
    spreadsheetId: config.sheetId,
    fields: 'sheets.properties(sheetId,title)'
  }));
  const match = ((result.data && result.data.sheets) || [])
    .map((s) => s.properties || {})
    .find((p) => p.title === tabName);
  if (!match || match.sheetId == null) throw new Error(`Tab "${tabName}" not found in Zone Notebook sheet.`);
  tabGidCache.set(cacheKey, match.sheetId);
  return match.sheetId;
}

async function deleteRow(sheets, config, tabName, rowNumber) {
  const gid = await getTabGid(sheets, config, tabName);
  await withSheetsRetry(() => sheets.spreadsheets.batchUpdate({
    spreadsheetId: config.sheetId,
    requestBody: {
      requests: [{
        deleteDimension: {
          range: { sheetId: gid, dimension: 'ROWS', startIndex: rowNumber - 1, endIndex: rowNumber }
        }
      }]
    }
  }));
  invalidateTab(config, tabName);
}

async function loadDirectoryNames(sheets, config) {
  const now = Date.now();
  if (directoryNameCache && directoryNameCache.expiresAt > now) return directoryNameCache.byEmail;
  const byEmail = new Map();
  try {
    const result = await withSheetsRetry(() => sheets.spreadsheets.values.get({
      spreadsheetId: config.ncDirectorySheetId,
      range: 'Sheet1!A1:Z1000'
    }));
    const values = (result.data && result.data.values) ? result.data.values : [];
    const headers = (values[0] || []).map((h) => String(h || '').trim());
    const emailIdx = headers.findIndex((h) => normalizeKey(h) === 'googleemail');
    const nameIdx = headers.findIndex((h) => normalizeKey(h) === 'name');
    if (emailIdx >= 0 && nameIdx >= 0) {
      values.slice(1).forEach((row) => {
        const email = String(row[emailIdx] || '').trim().toLowerCase();
        const name = normalizeText(row[nameIdx]);
        if (email && name) byEmail.set(email, name);
      });
    }
  } catch (err) {
    console.warn('Zone Notebook: NC Directory name lookup failed:', err.message || err);
  }
  directoryNameCache = { expiresAt: now + DIRECTORY_CACHE_TTL_MS, byEmail };
  return byEmail;
}

function displayName(namesByEmail, email) {
  const key = String(email || '').trim().toLowerCase();
  if (!key) return '';
  return (namesByEmail && namesByEmail.get(key)) || nameFromEmail(key);
}

function toPublicEvent(item, namesByEmail) {
  return {
    id: item.id,
    event: item.event,
    date: item.date,
    notes: item.notes,
    addedBy: displayName(namesByEmail, item.addedBy),
    addedOn: item.addedOn,
    lastEditedBy: displayName(namesByEmail, item.lastEditedBy),
    lastEditedOn: item.lastEditedOn
  };
}

function createZoneNotebook(deps) {
  const {
    getSheetsClient,
    readUsersMap,
    getAccessRowsForEmail,
    collectAccessRoles,
    extractGoogleSheetId,
    sessionAuth,
    verifyToken = verifyGoogleAccessToken
  } = deps || {};
  if (typeof getSheetsClient !== 'function') throw new Error('createZoneNotebook requires getSheetsClient');
  if (typeof readUsersMap !== 'function') throw new Error('createZoneNotebook requires readUsersMap');
  if (typeof getAccessRowsForEmail !== 'function') throw new Error('createZoneNotebook requires getAccessRowsForEmail');
  if (typeof extractGoogleSheetId !== 'function') throw new Error('createZoneNotebook requires extractGoogleSheetId');

  const extractId = (url) => extractGoogleSheetId(url) || '';

  async function requireCaptain(req, res, next) {
    let identity = null;
    const token = extractBearerToken(req);
    if (token) {
      try {
        identity = await verifyToken(token);
      } catch (err) {
        identity = null;
      }
    }
    if (!identity && sessionAuth && typeof sessionAuth.readSession === 'function') {
      const session = sessionAuth.readSession(req);
      if (session && session.email) {
        if (typeof sessionAuth.maybeSlideSession === 'function') {
          sessionAuth.maybeSlideSession(req, res, session);
        }
        identity = { email: session.email, sub: session.sub || '' };
      }
    }
    if (!identity || !identity.email) {
      return res.status(401).json({ error: 'auth_required', message: 'Please sign in again.' });
    }
    let rows = [];
    try {
      rows = await getAccessRowsForEmail(identity.email);
    } catch (err) {
      console.error('Zone Notebook auth lookup failed:', err.message);
      return res.status(500).json({ error: 'auth_lookup_failed', message: 'Could not verify access right now. Please try again.' });
    }
    if (!isRegisteredAccessRows(rows)) {
      return res.status(403).json({ error: 'forbidden', message: 'You do not have access to zone notes.' });
    }
    req.authUser = { email: String(identity.email).trim().toLowerCase(), sub: identity.sub || '' };
    req.accessRows = rows;
    return next();
  }

  async function resolveZone(req, res) {
    const sheetId = String((req.body && req.body.sheetId) || (req.query && req.query.sheetId) || '').trim();
    if (!sheetId) {
      res.status(400).json({ error: 'sheet_required', message: 'Open your zone first.' });
      return '';
    }
    const roles = typeof collectAccessRoles === 'function' ? collectAccessRoles(req.accessRows) : [];
    const usersMap = await readUsersMap();
    const zone = resolveZoneForCaller({
      rows: req.accessRows,
      isAdmin: roles.includes('admin'),
      sheetId,
      zoneIndex: buildZoneNameIndex(usersMap, extractId),
      extractId
    });
    if (!zone) {
      res.status(403).json({ error: 'not_zone_captain', message: 'You can only edit notes for zones you captain.' });
      return '';
    }
    return zone;
  }

  function sheetError(res, err, fallbackMessage) {
    const status = isRetryableSheetsError(err) ? 503 : 500;
    console.error(`Zone Notebook: ${fallbackMessage}:`, err.message || err);
    res.status(status).json({ error: 'zone_notebook_failed', message: `${fallbackMessage}. Please try again.` });
  }

  async function readZone(sheets, config, zone, { forceRefresh = false } = {}) {
    const zoneKey = normalizeZoneKey(zone);
    const [eventsTab, issuesTab, names] = await Promise.all([
      loadTab(sheets, config, config.eventsTab, { forceRefresh }),
      loadTab(sheets, config, config.issuesTab, { forceRefresh }),
      loadDirectoryNames(sheets, config)
    ]);
    const events = eventsTab.rows
      .map((row, i) => mapEventRow(eventsTab.headers, row, i + 2))
      .filter((item) => item.id && item.event && normalizeZoneKey(item.zone) === zoneKey);
    const issueRow = issuesTab.rows
      .map((row, i) => mapIssueRow(issuesTab.headers, row, i + 2))
      .find((item) => normalizeZoneKey(item.zone) === zoneKey);
    return {
      zone,
      issues: {
        text: issueRow ? issueRow.issues : '',
        lastUpdatedBy: issueRow ? displayName(names, issueRow.lastUpdatedBy) : '',
        lastUpdatedOn: issueRow ? issueRow.lastUpdatedOn : ''
      },
      events: sortEvents(events).map((item) => toPublicEvent(item, names))
    };
  }

  function readEventInput(body) {
    const event = normalizeText(body && body.event);
    const date = normalizeDateInput(body && body.date);
    const notes = normalizeMultiline(body && body.notes);
    if (!event) return { error: 'Enter the event name.' };
    if (event.length > LIMITS.event) return { error: `Keep the event name under ${LIMITS.event} characters.` };
    if (date == null) return { error: 'Enter the date as a calendar date, or leave it blank.' };
    if (notes.length > LIMITS.notes) return { error: `Keep notes under ${LIMITS.notes} characters.` };
    return { event, date, notes };
  }

  async function findEvent(sheets, config, zone, id) {
    const loaded = await loadTab(sheets, config, config.eventsTab, { forceRefresh: true });
    const item = loaded.rows
      .map((row, i) => ({ mapped: mapEventRow(loaded.headers, row, i + 2), raw: row }))
      .find((entry) => entry.mapped.id === id);
    if (!item || normalizeZoneKey(item.mapped.zone) !== normalizeZoneKey(zone)) return { loaded, item: null };
    return { loaded, item };
  }

  function register(app) {
    app.get('/api/zone-notebook', requireCaptain, async (req, res) => {
      res.set('Cache-Control', 'no-store');
      try {
        const config = getZoneNotebookConfig();
        const zone = await resolveZone(req, res);
        if (!zone) return;
        const sheets = await getSheetsClient();
        res.json(await readZone(sheets, config, zone));
      } catch (err) {
        sheetError(res, err, 'Could not load zone notes');
      }
    });

    app.put('/api/zone-notebook/issues', requireCaptain, async (req, res) => {
      try {
        const config = getZoneNotebookConfig();
        const zone = await resolveZone(req, res);
        if (!zone) return;
        const issues = normalizeMultiline(req.body && req.body.issues);
        if (issues.length > LIMITS.issues) {
          return res.status(400).json({ error: 'too_long', message: `Keep this under ${LIMITS.issues} characters.` });
        }
        const sheets = await getSheetsClient();
        const loaded = await loadTab(sheets, config, config.issuesTab, { forceRefresh: true });
        const headers = await ensureHeaders(sheets, config, config.issuesTab, ISSUE_HEADERS, loaded);
        const zoneKey = normalizeZoneKey(zone);
        const existingIndex = loaded.rows.findIndex((row) => {
          return normalizeZoneKey(cellFor(headers, row, ISSUE_FIELD_ALIASES.zone)) === zoneKey;
        });
        const existing = existingIndex >= 0 ? mapIssueRow(headers, loaded.rows[existingIndex], existingIndex + 2) : null;

        // Another captain saved since this page loaded: don't silently overwrite.
        const expected = req.body && typeof req.body.expectedLastUpdatedOn === 'string'
          ? req.body.expectedLastUpdatedOn.trim()
          : null;
        if (expected !== null && existing && existing.lastUpdatedOn !== expected && existing.issues !== issues) {
          const names = await loadDirectoryNames(sheets, config);
          return res.status(409).json({
            error: 'conflict',
            message: `${displayName(names, existing.lastUpdatedBy) || 'Another captain'} updated this since you opened the page. Your text is still in the box. Compare it with their version below, keep what you want, and save again.`,
            issues: {
              text: existing.issues,
              lastUpdatedBy: displayName(names, existing.lastUpdatedBy),
              lastUpdatedOn: existing.lastUpdatedOn
            }
          });
        }

        const record = {
          zone,
          issues,
          lastUpdatedBy: req.authUser.email,
          lastUpdatedOn: new Date().toISOString()
        };
        if (existing) {
          await updateRow(sheets, config, config.issuesTab, existing.rowNumber,
            buildRowValues(headers, loaded.rows[existingIndex], record, ISSUE_FIELD_ALIASES));
        } else {
          await appendRow(sheets, config, config.issuesTab, buildRowValues(headers, [], record, ISSUE_FIELD_ALIASES));
        }
        const names = await loadDirectoryNames(sheets, config);
        res.json({
          success: true,
          issues: {
            text: issues,
            lastUpdatedBy: displayName(names, record.lastUpdatedBy),
            lastUpdatedOn: record.lastUpdatedOn
          }
        });
      } catch (err) {
        sheetError(res, err, 'Could not save zone issues');
      }
    });

    app.post('/api/zone-notebook/events', requireCaptain, async (req, res) => {
      try {
        const config = getZoneNotebookConfig();
        const zone = await resolveZone(req, res);
        if (!zone) return;
        const input = readEventInput(req.body);
        if (input.error) return res.status(400).json({ error: 'invalid_event', message: input.error });
        const sheets = await getSheetsClient();
        const loaded = await loadTab(sheets, config, config.eventsTab, { forceRefresh: true });
        const headers = await ensureHeaders(sheets, config, config.eventsTab, EVENT_HEADERS, loaded);
        const now = new Date().toISOString();
        const record = {
          id: createEventId(),
          zone,
          event: input.event,
          date: input.date,
          notes: input.notes,
          addedBy: req.authUser.email,
          addedOn: now,
          lastEditedBy: '',
          lastEditedOn: ''
        };
        await appendRow(sheets, config, config.eventsTab, buildRowValues(headers, [], record, EVENT_FIELD_ALIASES));
        res.json({ success: true, ...(await readZone(sheets, config, zone, { forceRefresh: true })) });
      } catch (err) {
        sheetError(res, err, 'Could not add the event');
      }
    });

    app.put('/api/zone-notebook/events/:id', requireCaptain, async (req, res) => {
      try {
        const config = getZoneNotebookConfig();
        const zone = await resolveZone(req, res);
        if (!zone) return;
        const input = readEventInput(req.body);
        if (input.error) return res.status(400).json({ error: 'invalid_event', message: input.error });
        const sheets = await getSheetsClient();
        const { loaded, item } = await findEvent(sheets, config, zone, String(req.params.id || '').trim());
        if (!item) return res.status(404).json({ error: 'not_found', message: 'That event was not found. It may have been deleted.' });
        const record = {
          event: input.event,
          date: input.date,
          notes: input.notes,
          lastEditedBy: req.authUser.email,
          lastEditedOn: new Date().toISOString()
        };
        await updateRow(sheets, config, config.eventsTab, item.mapped.rowNumber,
          buildRowValues(loaded.headers, item.raw, record, EVENT_FIELD_ALIASES));
        res.json({ success: true, ...(await readZone(sheets, config, zone, { forceRefresh: true })) });
      } catch (err) {
        sheetError(res, err, 'Could not save the event');
      }
    });

    app.delete('/api/zone-notebook/events/:id', requireCaptain, async (req, res) => {
      try {
        const config = getZoneNotebookConfig();
        const zone = await resolveZone(req, res);
        if (!zone) return;
        const sheets = await getSheetsClient();
        const { item } = await findEvent(sheets, config, zone, String(req.params.id || '').trim());
        if (!item) return res.status(404).json({ error: 'not_found', message: 'That event was not found. It may have already been deleted.' });
        await deleteRow(sheets, config, config.eventsTab, item.mapped.rowNumber);
        res.json({ success: true, ...(await readZone(sheets, config, zone, { forceRefresh: true })) });
      } catch (err) {
        sheetError(res, err, 'Could not delete the event');
      }
    });
  }

  /**
   * Adds a "Zone Issues" value to each NC Directory row, matched through the
   * captain's zone assignment in the Access sheet (falling back to the row's
   * free-text Zone column).
   */
  async function attachZoneIssuesToDirectoryRows(rows) {
    const list = Array.isArray(rows) ? rows : [];
    if (!list.length) return list;
    const config = getZoneNotebookConfig();
    const sheets = await getSheetsClient();
    const [usersMap, issuesTab] = await Promise.all([
      readUsersMap(),
      loadTab(sheets, config, config.issuesTab)
    ]);
    const zoneIndex = buildZoneNameIndex(usersMap, extractId);
    const issuesByZoneKey = new Map();
    issuesTab.rows
      .map((row, i) => mapIssueRow(issuesTab.headers, row, i + 2))
      .filter((item) => item.zone && item.issues)
      .forEach((item) => issuesByZoneKey.set(normalizeZoneKey(item.zone), item));

    list.forEach((row) => {
      const keys = Object.keys(row || {});
      const emailKey = keys.find((k) => normalizeKey(k) === 'googleemail');
      const zoneKeyName = keys.find((k) => normalizeKey(k) === 'zone');
      const email = emailKey ? String(row[emailKey] || '').trim().toLowerCase() : '';
      const zoneNames = new Set();
      ((email && usersMap[email]) || []).forEach((entry) => {
        if (!entry || typeof entry !== 'object' || !entry.url) return;
        if (String(entry.role || '').toLowerCase() === 'admin') return;
        const name = zoneIndex.get(extractId(entry.url));
        if (name) zoneNames.add(name);
      });
      if (!zoneNames.size && zoneKeyName && row[zoneKeyName]) zoneNames.add(String(row[zoneKeyName]));
      const found = Array.from(zoneNames)
        .map((name) => issuesByZoneKey.get(normalizeZoneKey(name)))
        .filter(Boolean);
      if (found.length === 1) {
        row['Zone Issues'] = found[0].issues;
      } else if (found.length > 1) {
        row['Zone Issues'] = found.map((item) => `${item.zone}: ${item.issues}`).join('\n\n');
      }
    });
    return list;
  }

  return { register, attachZoneIssuesToDirectoryRows };
}

module.exports = {
  createZoneNotebook,
  getZoneNotebookConfig,
  normalizeZoneKey,
  normalizeDateInput,
  normalizeMultiline,
  buildZoneNameIndex,
  resolveZoneForCaller,
  buildRowValues,
  mapEventRow,
  mapIssueRow,
  sortEvents,
  EVENT_HEADERS,
  ISSUE_HEADERS,
  EVENT_FIELD_ALIASES,
  ISSUE_FIELD_ALIASES
};

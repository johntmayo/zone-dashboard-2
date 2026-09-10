'use strict';

/**
 * Recruitment Drive — Places + Events signups, Phone Bank sessions, and Links.
 *
 * One Google Sheet (RECRUITMENT_SHEET_ID) with four tabs:
 *   Places     Timestamp | Place | Captain Name | Captain Email | Zone
 *   Events     Timestamp | Event | When | Captain Name | Captain Email | Zone
 *   PhoneBank  Date | Time | Title | Virtual Join Link | In-Person Location | Notes
 *   Links      Label | URL | Section
 *
 * Env:
 *   RECRUITMENT_ENABLED   default on; set 0/false/off to hide the tab
 *   RECRUITMENT_SHEET_ID  spreadsheet id or full URL
 */

const {
  extractBearerToken,
  verifyGoogleAccessToken,
  isRegisteredAccessRows
} = require('../sheets-write-auth');

const DEFAULT_CACHE_TTL_MS = 30 * 1000;
const DIRECTORY_CACHE_TTL_MS = 5 * 60 * 1000;
const DEFAULT_NC_DIRECTORY_SHEET_ID = '1E77qmT4eGtyokaDvD2wlK3q2NeMcS4itmkbYp6Rz0qM';

const PLACE_HEADERS = ['Timestamp', 'Place', 'Captain Name', 'Captain Email', 'Zone'];
const EVENT_HEADERS = ['Timestamp', 'Event', 'When', 'Captain Name', 'Captain Email', 'Zone'];
const PHONEBANK_HEADERS = ['Date', 'Time', 'Title', 'Virtual Join Link', 'In-Person Location', 'Notes'];
const LINK_HEADERS = ['Label', 'URL', 'Section'];

const PLACE_FIELD_ALIASES = {
  timestamp: ['timestamp', 'created', 'createdat', 'created_at', 'dateadded'],
  place: ['place', 'placename', 'business', 'businessname', 'location', 'name', 'space'],
  captainName: ['captainname', 'captain', 'name', 'ncname', 'neighborhoodcaptain'],
  captainEmail: ['captainemail', 'email', 'googleemail'],
  zone: ['zone', 'zonename', 'zoneid']
};

const EVENT_FIELD_ALIASES = {
  timestamp: ['timestamp', 'created', 'createdat', 'created_at'],
  event: ['event', 'eventname', 'meeting', 'title', 'name'],
  when: ['when', 'date', 'eventdate', 'meetingdate', 'datetime'],
  captainName: ['captainname', 'captain', 'name', 'ncname', 'neighborhoodcaptain'],
  captainEmail: ['captainemail', 'email', 'googleemail'],
  zone: ['zone', 'zonename', 'zoneid']
};

const PHONEBANK_FIELD_ALIASES = {
  date: ['date', 'day', 'sessiondate'],
  time: ['time', 'start', 'starttime'],
  title: ['title', 'session', 'name', 'label'],
  joinUrl: ['virtualjoinlink', 'virtualurl', 'joinurl', 'url', 'link', 'joinlink', 'zoom', 'zoomlink', 'meetingurl'],
  notes: ['notes', 'note', 'details'],
  inPersonLocation: ['inpersonlocation', 'inpersonaddress', 'location', 'address', 'venue']
};

const LINK_FIELD_ALIASES = {
  label: ['label', 'name', 'filename', 'title', 'file', 'item'],
  url: ['url', 'link', 'href', 'fileurl'],
  section: ['section', 'showon', 'card', 'widget', 'for', 'group']
};

const tabCache = new Map();
let directoryCache = null;

function strEnv(name, fallback = '') {
  return String(process.env[name] || fallback).trim();
}

function intEnv(name, fallback) {
  const value = Number.parseInt(String(process.env[name] || ''), 10);
  return Number.isFinite(value) && value >= 0 ? value : fallback;
}

function extractSpreadsheetId(value) {
  const clean = String(value || '').trim();
  if (!clean) return '';
  const match = clean.match(/\/spreadsheets\/d\/([a-zA-Z0-9-_]+)/);
  return match ? match[1] : clean;
}

function parseEnabledFlag(raw, defaultValue) {
  const value = String(raw || '').trim().toLowerCase();
  if (!value) return defaultValue;
  if (['0', 'false', 'no', 'off'].includes(value)) return false;
  if (['1', 'true', 'yes', 'on'].includes(value)) return true;
  return defaultValue;
}

function getRecruitmentConfig() {
  return {
    enabled: parseEnabledFlag(process.env.RECRUITMENT_ENABLED, true),
    sheetId: extractSpreadsheetId(strEnv('RECRUITMENT_SHEET_ID')),
    placesTab: strEnv('RECRUITMENT_PLACES_TAB', 'Places'),
    eventsTab: strEnv('RECRUITMENT_EVENTS_TAB', 'Events'),
    phoneBankTab: strEnv('RECRUITMENT_PHONEBANK_TAB', 'PhoneBank'),
    linksTab: strEnv('RECRUITMENT_LINKS_TAB', 'Links'),
    cacheTtlMs: intEnv('RECRUITMENT_CACHE_TTL_MS', DEFAULT_CACHE_TTL_MS),
    ncDirectorySheetId: extractSpreadsheetId(
      strEnv('NC_DIRECTORY_SHEET_ID', DEFAULT_NC_DIRECTORY_SHEET_ID)
    )
  };
}

function quoteSheetName(name) {
  return `'${String(name || '').replace(/'/g, "''")}'`;
}

function normalizeHeader(value, index) {
  const text = String(value || '').trim();
  return text || `Column ${index + 1}`;
}

function normalizeKey(value) {
  return String(value || '').trim().toLowerCase().replace(/[^a-z0-9]/g, '');
}

function normalizeText(value) {
  return String(value || '').trim().replace(/\s+/g, ' ');
}

function findField(headers, aliases) {
  const aliasKeys = (aliases || []).map(normalizeKey);
  return headers.find((header) => aliasKeys.includes(normalizeKey(header))) || null;
}

function rowToObject(headers, row) {
  const obj = {};
  headers.forEach((header, i) => {
    obj[header] = row[i] != null ? String(row[i]) : '';
  });
  return obj;
}

function pickField(row, headers, aliases) {
  const header = findField(headers, aliases);
  if (!header) return '';
  return normalizeText(row[header]);
}

function mapRecordToHeaders(headers, record, aliasesByField) {
  return headers.map((header) => {
    const key = normalizeKey(header);
    for (const [field, aliases] of Object.entries(aliasesByField)) {
      if (aliases.map(normalizeKey).includes(key)) {
        return record[field] != null ? String(record[field]) : '';
      }
    }
    return '';
  });
}

function mapPlaceRow(row, headers, rowNumber) {
  return {
    id: `place-${rowNumber}`,
    timestamp: pickField(row, headers, PLACE_FIELD_ALIASES.timestamp),
    place: pickField(row, headers, PLACE_FIELD_ALIASES.place),
    captainName: pickField(row, headers, PLACE_FIELD_ALIASES.captainName),
    zone: pickField(row, headers, PLACE_FIELD_ALIASES.zone)
  };
}

function mapEventRow(row, headers, rowNumber) {
  return {
    id: `event-${rowNumber}`,
    timestamp: pickField(row, headers, EVENT_FIELD_ALIASES.timestamp),
    event: pickField(row, headers, EVENT_FIELD_ALIASES.event),
    when: pickField(row, headers, EVENT_FIELD_ALIASES.when),
    captainName: pickField(row, headers, EVENT_FIELD_ALIASES.captainName),
    zone: pickField(row, headers, EVENT_FIELD_ALIASES.zone)
  };
}

function mapPhoneBankRow(row, headers, rowNumber) {
  return {
    id: `phonebank-${rowNumber}`,
    date: pickField(row, headers, PHONEBANK_FIELD_ALIASES.date),
    time: pickField(row, headers, PHONEBANK_FIELD_ALIASES.time),
    title: pickField(row, headers, PHONEBANK_FIELD_ALIASES.title),
    joinUrl: pickField(row, headers, PHONEBANK_FIELD_ALIASES.joinUrl),
    notes: pickField(row, headers, PHONEBANK_FIELD_ALIASES.notes),
    inPersonLocation: pickField(row, headers, PHONEBANK_FIELD_ALIASES.inPersonLocation)
  };
}

function inferLinkSection(label, explicitSection) {
  const sectionKey = normalizeKey(explicitSection);
  if (['place', 'places', 'flyer', 'flyering', 'adopt'].includes(sectionKey)) return 'places';
  if (['event', 'events', 'meeting', 'meetings'].includes(sectionKey)) return 'events';
  if (['phonebank', 'phone', 'phones', 'call'].includes(sectionKey)) return 'phonebank';
  if (['invite', 'signup', 'share'].includes(sectionKey)) return 'invite';

  const labelKey = normalizeKey(label);
  if (labelKey.includes('invite') || labelKey.includes('signup') || labelKey.includes('joinus') || labelKey.includes('become')) {
    return 'invite';
  }
  if (labelKey.includes('phone')) return 'phonebank';
  if (labelKey.includes('event') || labelKey.includes('meeting') || labelKey.includes('pitch')) {
    return 'events';
  }
  if (labelKey.includes('flyer') || labelKey.includes('place') || labelKey.includes('business')) {
    return 'places';
  }
  if (labelKey.includes('script')) return 'events';
  return 'all';
}

function mapLinkRow(row, headers, rowNumber) {
  const label = pickField(row, headers, LINK_FIELD_ALIASES.label);
  const url = pickField(row, headers, LINK_FIELD_ALIASES.url);
  const section = inferLinkSection(label, pickField(row, headers, LINK_FIELD_ALIASES.section));
  return {
    id: `link-${rowNumber}`,
    label,
    url,
    section
  };
}

function parseLooseDate(value) {
  const text = normalizeText(value);
  if (!text) return null;
  const direct = Date.parse(text);
  if (Number.isFinite(direct)) return new Date(direct);
  const us = text.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})/);
  if (us) {
    const month = Number(us[1]) - 1;
    const day = Number(us[2]);
    const year = Number(us[3].length === 2 ? `20${us[3]}` : us[3]);
    const parsed = new Date(year, month, day);
    if (!Number.isNaN(parsed.getTime())) return parsed;
  }
  return null;
}

function sortPlaces(items) {
  return items.slice().sort((a, b) => {
    const aMs = parseLooseDate(a.timestamp);
    const bMs = parseLooseDate(b.timestamp);
    return (bMs ? bMs.getTime() : 0) - (aMs ? aMs.getTime() : 0);
  });
}

function sortEvents(items) {
  const now = Date.now();
  return items.slice().sort((a, b) => {
    const aWhen = parseLooseDate(a.when);
    const bWhen = parseLooseDate(b.when);
    if (aWhen && bWhen) {
      const aUpcoming = aWhen.getTime() >= now - 12 * 60 * 60 * 1000;
      const bUpcoming = bWhen.getTime() >= now - 12 * 60 * 60 * 1000;
      if (aUpcoming !== bUpcoming) return aUpcoming ? -1 : 1;
      if (aWhen.getTime() !== bWhen.getTime()) return aWhen.getTime() - bWhen.getTime();
    } else if (aWhen) {
      return -1;
    } else if (bWhen) {
      return 1;
    }
    const aMs = parseLooseDate(a.timestamp);
    const bMs = parseLooseDate(b.timestamp);
    return (bMs ? bMs.getTime() : 0) - (aMs ? aMs.getTime() : 0);
  });
}

function isDuplicatePlace(rows, headers, place, email) {
  const wantedPlace = normalizeText(place).toLowerCase();
  const wantedEmail = normalizeText(email).toLowerCase();
  if (!wantedPlace || !wantedEmail) return false;
  return rows.some((row) => {
    const existingPlace = pickField(row, headers, PLACE_FIELD_ALIASES.place).toLowerCase();
    const existingEmail = pickField(row, headers, PLACE_FIELD_ALIASES.captainEmail).toLowerCase();
    return existingPlace === wantedPlace && existingEmail === wantedEmail;
  });
}

function isDuplicateEvent(rows, headers, event, when, email) {
  const wantedEvent = normalizeText(event).toLowerCase();
  const wantedWhen = normalizeText(when).toLowerCase();
  const wantedEmail = normalizeText(email).toLowerCase();
  if (!wantedEvent || !wantedEmail) return false;
  return rows.some((row) => {
    const existingEvent = pickField(row, headers, EVENT_FIELD_ALIASES.event).toLowerCase();
    const existingWhen = pickField(row, headers, EVENT_FIELD_ALIASES.when).toLowerCase();
    const existingEmail = pickField(row, headers, EVENT_FIELD_ALIASES.captainEmail).toLowerCase();
    return existingEvent === wantedEvent && existingWhen === wantedWhen && existingEmail === wantedEmail;
  });
}

function invalidateTabCache(tabName) {
  if (tabName) tabCache.delete(tabName);
  else tabCache.clear();
}

function isRetryableSheetsError(err) {
  const msg = String((err && err.message) || err || '').toLowerCase();
  const code = err && (err.code || (err.response && err.response.status));
  if (code === 429 || code === 503 || code === 500) return true;
  if (msg.includes('quota') || msg.includes('rate limit')) return true;
  if (msg.includes('unable to parse range')) return true;
  if (msg.includes('backend error') || msg.includes('internal error')) return true;
  if (msg.includes('unavailable') || msg.includes('timeout')) return true;
  return false;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
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
      console.warn(
        `Recruitment: Sheets call failed (attempt ${i + 1}/${attempts}), retrying in ${delay}ms:`,
        err.message || err
      );
      await sleep(delay);
    }
  }
  throw lastErr;
}

async function loadTabRows(sheetsClient, config, tabName, options = {}) {
  const forceRefresh = Boolean(options.forceRefresh);
  const now = Date.now();
  const cached = tabCache.get(tabName);
  if (!forceRefresh && cached && cached.expiresAt > now) {
    return cached;
  }

  const range = `${quoteSheetName(tabName)}!A1:Z`;
  const result = await withSheetsRetry(() => sheetsClient.spreadsheets.values.get({
    spreadsheetId: config.sheetId,
    range
  }));
  const values = (result.data && result.data.values) ? result.data.values : [];
  const headers = (values[0] || []).map(normalizeHeader);
  const rows = values.slice(1).map((row) => rowToObject(headers, row));
  const payload = {
    expiresAt: now + config.cacheTtlMs,
    headers,
    rows,
    sheetName: tabName
  };
  tabCache.set(tabName, payload);
  return payload;
}

async function ensureHeaders(sheetsClient, config, tabName, defaultHeaders, loaded) {
  if (loaded.headers && loaded.headers.length) return loaded.headers;
  await withSheetsRetry(() => sheetsClient.spreadsheets.values.update({
    spreadsheetId: config.sheetId,
    range: `${quoteSheetName(tabName)}!A1`,
    valueInputOption: 'RAW',
    requestBody: { values: [defaultHeaders] }
  }));
  invalidateTabCache(tabName);
  return defaultHeaders.slice();
}

async function appendRecord(sheetsClient, config, tabName, defaultHeaders, aliasesByField, record) {
  const loaded = await loadTabRows(sheetsClient, config, tabName, { forceRefresh: true });
  const headers = await ensureHeaders(sheetsClient, config, tabName, defaultHeaders, loaded);
  const values = mapRecordToHeaders(headers, record, aliasesByField);
  await withSheetsRetry(() => sheetsClient.spreadsheets.values.append({
    spreadsheetId: config.sheetId,
    range: `${quoteSheetName(tabName)}!A1`,
    valueInputOption: 'USER_ENTERED',
    insertDataOption: 'INSERT_ROWS',
    requestBody: { values: [values] }
  }));
  invalidateTabCache(tabName);
}

function nameFromEmail(email) {
  const local = String(email || '').split('@')[0] || '';
  return local.replace(/[._-]+/g, ' ').replace(/\b\w/g, (ch) => ch.toUpperCase()).trim();
}

async function lookupDirectoryName(sheetsClient, config, email) {
  const wanted = String(email || '').trim().toLowerCase();
  if (!wanted || !config.ncDirectorySheetId) return '';
  const now = Date.now();
  if (!directoryCache || directoryCache.expiresAt <= now) {
    try {
      const result = await withSheetsRetry(() => sheetsClient.spreadsheets.values.get({
        spreadsheetId: config.ncDirectorySheetId,
        range: 'Sheet1!A1:P500'
      }));
      const values = (result.data && result.data.values) ? result.data.values : [];
      const headers = (values[0] || []).map((h) => String(h || '').trim());
      const emailCol = headers.find((h) => normalizeKey(h) === 'googleemail') ||
        headers.find((h) => normalizeKey(h) === 'email') ||
        'Google email';
      const nameCol = headers.find((h) => normalizeKey(h) === 'name') || 'Name';
      const rows = values.slice(1).map((row) => {
        const obj = {};
        headers.forEach((header, i) => {
          obj[header] = row[i] != null ? String(row[i]).trim() : '';
        });
        return obj;
      });
      directoryCache = { expiresAt: now + DIRECTORY_CACHE_TTL_MS, headers, rows, emailCol, nameCol };
    } catch (err) {
      console.warn('Recruitment: NC Directory lookup failed:', err.message || err);
      return '';
    }
  }
  const match = (directoryCache.rows || []).find((row) => {
    return String(row[directoryCache.emailCol] || '').trim().toLowerCase() === wanted;
  });
  return match ? normalizeText(match[directoryCache.nameCol]) : '';
}

function createRequireRecruitmentAuth(deps) {
  const {
    sessionAuth,
    getAccessRowsForEmail,
    verifyToken = verifyGoogleAccessToken
  } = deps;

  return async function requireRecruitmentAuth(req, res, next) {
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
      return res.status(401).json({
        error: 'auth_required',
        message: 'Sign in required to use Recruitment.'
      });
    }

    let rows = [];
    try {
      rows = await getAccessRowsForEmail(identity.email);
    } catch (err) {
      console.error('Recruitment auth lookup failed:', err.message);
      return res.status(500).json({
        error: 'auth_lookup_failed',
        message: 'Could not verify access right now. Please try again.'
      });
    }
    if (!isRegisteredAccessRows(rows)) {
      return res.status(403).json({
        error: 'forbidden',
        message: 'You do not have permission to use Recruitment.'
      });
    }

    req.authUser = { email: String(identity.email).trim().toLowerCase(), sub: identity.sub || '' };
    return next();
  };
}

function emptyTab() {
  return { headers: [], rows: [] };
}

function registerRecruitmentRoutes(app, deps) {
  const getSheetsClient = deps && deps.getSheetsClient;
  const sessionAuth = deps && deps.sessionAuth;
  const getAccessRowsForEmail = deps && deps.getAccessRowsForEmail;
  if (typeof getSheetsClient !== 'function') {
    throw new Error('registerRecruitmentRoutes requires getSheetsClient');
  }
  if (typeof getAccessRowsForEmail !== 'function') {
    throw new Error('registerRecruitmentRoutes requires getAccessRowsForEmail');
  }

  const requireRecruitmentAuth = createRequireRecruitmentAuth({
    sessionAuth,
    getAccessRowsForEmail
  });

  app.get('/api/recruitment/config', (req, res) => {
    const config = getRecruitmentConfig();
    res.json({
      enabled: Boolean(config.enabled),
      sheetConfigured: Boolean(config.sheetId)
    });
  });

  app.get('/api/recruitment/feed', requireRecruitmentAuth, async (req, res) => {
    try {
      const config = getRecruitmentConfig();
      if (!config.enabled) {
        return res.status(404).json({ error: 'recruitment_disabled', message: 'Recruitment is turned off.' });
      }
      if (!config.sheetId) {
        return res.json({
          sheetConfigured: false,
          places: [],
          events: [],
          phoneBank: [],
          links: []
        });
      }

      const sheets = await getSheetsClient();
      const [placesLoaded, eventsLoaded, phoneLoaded, linksLoaded] = await Promise.all([
        loadTabRows(sheets, config, config.placesTab).catch((err) => {
          console.warn('Recruitment Places read failed:', err.message || err);
          return emptyTab();
        }),
        loadTabRows(sheets, config, config.eventsTab).catch((err) => {
          console.warn('Recruitment Events read failed:', err.message || err);
          return emptyTab();
        }),
        loadTabRows(sheets, config, config.phoneBankTab).catch((err) => {
          console.warn('Recruitment PhoneBank read failed:', err.message || err);
          return emptyTab();
        }),
        loadTabRows(sheets, config, config.linksTab).catch((err) => {
          console.warn('Recruitment Links read failed:', err.message || err);
          return emptyTab();
        })
      ]);

      const places = sortPlaces(
        placesLoaded.rows
          .map((row, index) => mapPlaceRow(row, placesLoaded.headers, index + 2))
          .filter((item) => item.place)
      );
      const events = sortEvents(
        eventsLoaded.rows
          .map((row, index) => mapEventRow(row, eventsLoaded.headers, index + 2))
          .filter((item) => item.event)
      );
      const phoneBank = phoneLoaded.rows
        .map((row, index) => mapPhoneBankRow(row, phoneLoaded.headers, index + 2))
        .filter((item) => item.date || item.title || item.joinUrl);
      const links = linksLoaded.rows
        .map((row, index) => mapLinkRow(row, linksLoaded.headers, index + 2))
        .filter((item) => item.label && item.url);

      res.json({
        sheetConfigured: true,
        places,
        events,
        phoneBank,
        links
      });
    } catch (err) {
      console.error('Recruitment feed error:', err.message || err);
      res.status(500).json({
        error: 'Failed to load recruitment feed',
        message: err.message || String(err)
      });
    }
  });

  async function resolveCaptainName(sheets, config, email, requestedName) {
    const fromClient = normalizeText(requestedName);
    if (fromClient) return fromClient;
    const fromDirectory = await lookupDirectoryName(sheets, config, email);
    if (fromDirectory) return fromDirectory;
    return nameFromEmail(email);
  }

  app.post('/api/recruitment/places', requireRecruitmentAuth, async (req, res) => {
    try {
      const config = getRecruitmentConfig();
      if (!config.enabled) {
        return res.status(404).json({ error: 'recruitment_disabled', message: 'Recruitment is turned off.' });
      }
      if (!config.sheetId) {
        return res.status(503).json({
          error: 'recruitment_not_configured',
          message: 'Recruitment spreadsheet is not configured yet.'
        });
      }

      const place = normalizeText(req.body && req.body.place);
      if (!place) {
        return res.status(400).json({ error: 'place_required', message: 'Enter a business or community space.' });
      }
      if (place.length > 160) {
        return res.status(400).json({ error: 'place_too_long', message: 'Keep the place name under 160 characters.' });
      }

      const email = req.authUser.email;
      const sheets = await getSheetsClient();
      const loaded = await loadTabRows(sheets, config, config.placesTab, { forceRefresh: true });
      if (isDuplicatePlace(loaded.rows, loaded.headers, place, email)) {
        return res.status(409).json({
          error: 'duplicate_place',
          message: 'You have already adopted this place.'
        });
      }

      const captainName = await resolveCaptainName(sheets, config, email, req.body && req.body.captainName);
      const zone = normalizeText(req.body && req.body.zone);
      const record = {
        timestamp: new Date().toISOString(),
        place,
        captainName,
        captainEmail: email,
        zone
      };
      await appendRecord(sheets, config, config.placesTab, PLACE_HEADERS, PLACE_FIELD_ALIASES, record);
      res.json({
        success: true,
        item: {
          place: record.place,
          captainName: record.captainName,
          zone: record.zone,
          timestamp: record.timestamp
        }
      });
    } catch (err) {
      const status = isRetryableSheetsError(err) ? 503 : 500;
      console.error('Recruitment place save error:', err.message || err);
      res.status(status).json({
        error: 'Failed to save place',
        message: err.message || String(err)
      });
    }
  });

  app.post('/api/recruitment/events', requireRecruitmentAuth, async (req, res) => {
    try {
      const config = getRecruitmentConfig();
      if (!config.enabled) {
        return res.status(404).json({ error: 'recruitment_disabled', message: 'Recruitment is turned off.' });
      }
      if (!config.sheetId) {
        return res.status(503).json({
          error: 'recruitment_not_configured',
          message: 'Recruitment spreadsheet is not configured yet.'
        });
      }

      const event = normalizeText(req.body && req.body.event);
      const when = normalizeText(req.body && req.body.when);
      if (!event) {
        return res.status(400).json({ error: 'event_required', message: 'Enter the event or meeting name.' });
      }
      if (!when) {
        return res.status(400).json({ error: 'when_required', message: 'Enter when the event is happening.' });
      }
      if (event.length > 160 || when.length > 160) {
        return res.status(400).json({ error: 'too_long', message: 'Keep each field under 160 characters.' });
      }

      const email = req.authUser.email;
      const sheets = await getSheetsClient();
      const loaded = await loadTabRows(sheets, config, config.eventsTab, { forceRefresh: true });
      if (isDuplicateEvent(loaded.rows, loaded.headers, event, when, email)) {
        return res.status(409).json({
          error: 'duplicate_event',
          message: 'You have already signed up for this event.'
        });
      }

      const captainName = await resolveCaptainName(sheets, config, email, req.body && req.body.captainName);
      const zone = normalizeText(req.body && req.body.zone);
      const record = {
        timestamp: new Date().toISOString(),
        event,
        when,
        captainName,
        captainEmail: email,
        zone
      };
      await appendRecord(sheets, config, config.eventsTab, EVENT_HEADERS, EVENT_FIELD_ALIASES, record);
      res.json({
        success: true,
        item: {
          event: record.event,
          when: record.when,
          captainName: record.captainName,
          zone: record.zone,
          timestamp: record.timestamp
        }
      });
    } catch (err) {
      const status = isRetryableSheetsError(err) ? 503 : 500;
      console.error('Recruitment event save error:', err.message || err);
      res.status(status).json({
        error: 'Failed to save event',
        message: err.message || String(err)
      });
    }
  });
}

module.exports = {
  registerRecruitmentRoutes,
  getRecruitmentConfig,
  extractSpreadsheetId,
  parseEnabledFlag,
  normalizeKey,
  normalizeText,
  mapPlaceRow,
  mapEventRow,
  mapPhoneBankRow,
  mapLinkRow,
  inferLinkSection,
  mapRecordToHeaders,
  sortPlaces,
  sortEvents,
  isDuplicatePlace,
  isDuplicateEvent,
  parseLooseDate,
  nameFromEmail,
  PLACE_HEADERS,
  EVENT_HEADERS,
  PHONEBANK_HEADERS,
  LINK_HEADERS,
  PLACE_FIELD_ALIASES,
  EVENT_FIELD_ALIASES,
  invalidateTabCache
};

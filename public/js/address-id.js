/**
 * address_id helpers — identity for physical addresses (unit-level).
 *
 * Canonical key and normalization must stay aligned with Sheet Smart
 * AddressIdMigration.gs. Do not reuse UI helpers like normalizeStreet /
 * buildAddressString for identity matching.
 *
 * Works in the browser (globals) and in Node tests (module.exports).
 */
(function (global) {
  'use strict';

  var ADDRESS_ID_PREFIX = 'addr_';

  var ADDRESS_ID_CANONICAL_FIELDS = [
    '_SitusHouseNo',
    '_SitusDirection',
    '_SitusStreet',
    '_SitusUnit',
    'City',
    'State',
    'Zip'
  ];

  var ADDRESS_ID_DIRECTION_MAP = {
    N: 'NORTH',
    S: 'SOUTH',
    E: 'EAST',
    W: 'WEST',
    NE: 'NORTHEAST',
    NW: 'NORTHWEST',
    SE: 'SOUTHEAST',
    SW: 'SOUTHWEST'
  };

  var ADDRESS_ID_STREET_SUFFIX_MAP = {
    ALY: 'ALLEY',
    AV: 'AVENUE',
    AVE: 'AVENUE',
    AVEN: 'AVENUE',
    BL: 'BOULEVARD',
    BLVD: 'BOULEVARD',
    CIR: 'CIRCLE',
    CT: 'COURT',
    DR: 'DRIVE',
    DRV: 'DRIVE',
    HWY: 'HIGHWAY',
    LN: 'LANE',
    PL: 'PLACE',
    PKWY: 'PARKWAY',
    RD: 'ROAD',
    SQ: 'SQUARE',
    ST: 'STREET',
    TER: 'TERRACE',
    TRL: 'TRAIL',
    WAY: 'WAY'
  };

  /** Columns that must be written as plain text to avoid Sheets date/number coercion. */
  var ADDRESS_ID_TEXT_SAFE_COLUMNS = [
    '_SitusHouseNo',
    '_SitusUnit',
    'Zip',
    'address_id'
  ];

  function generateUuidV4() {
    if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
      return crypto.randomUUID();
    }
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function (c) {
      var r = (Math.random() * 16) | 0;
      var v = c === 'x' ? r : (r & 0x3) | 0x8;
      return v.toString(16);
    });
  }

  /**
   * Mint a new address_id (opaque prefixed UUID).
   * @returns {string}
   */
  function generateAddressId() {
    return ADDRESS_ID_PREFIX + generateUuidV4();
  }

  /**
   * Basic text normalization shared by all canonical fields.
   * @param {*} value
   * @returns {string}
   */
  function normalizeAddressIdText(value) {
    return String(value == null ? '' : value)
      .trim()
      .toUpperCase()
      .replace(/[.,#]/g, '')
      .replace(/\s+/g, ' ')
      .trim();
  }

  /**
   * Normalize a direction field (exact abbreviation map only).
   * @param {*} value
   * @returns {string}
   */
  function normalizeAddressIdDirection(value) {
    var text = normalizeAddressIdText(value);
    if (!text) return '';
    return ADDRESS_ID_DIRECTION_MAP[text] || text;
  }

  /**
   * Normalize a street name: basic text norm, then exact-token suffix on final token only.
   * @param {*} value
   * @returns {string}
   */
  function normalizeAddressIdStreet(value) {
    var text = normalizeAddressIdText(value);
    if (!text) return '';
    var tokens = text.split(' ');
    var last = tokens[tokens.length - 1];
    if (ADDRESS_ID_STREET_SUFFIX_MAP[last]) {
      tokens[tokens.length - 1] = ADDRESS_ID_STREET_SUFFIX_MAP[last];
    }
    return tokens.join(' ');
  }

  /**
   * Resolve the sheet column header for a canonical field name (exact, then case-insensitive).
   * @param {string[]} headers
   * @param {string} fieldName
   * @returns {string|null}
   */
  function findAddressIdCanonicalColumn(headers, fieldName) {
    if (!Array.isArray(headers) || !fieldName) return null;
    if (headers.includes(fieldName)) return fieldName;
    var lower = fieldName.toLowerCase();
    for (var i = 0; i < headers.length; i++) {
      if (String(headers[i] || '').toLowerCase() === lower) return headers[i];
    }
    return null;
  }

  /**
   * Read and normalize one canonical field from a row / values map.
   * @param {Object} row
   * @param {string[]} headers
   * @param {string} fieldName
   * @returns {string}
   */
  function getNormalizedCanonicalField(row, headers, fieldName) {
    if (!row) return '';
    var col = findAddressIdCanonicalColumn(headers, fieldName);
    var raw = col ? row[col] : row[fieldName];
    if (fieldName === '_SitusDirection') return normalizeAddressIdDirection(raw);
    if (fieldName === '_SitusStreet') return normalizeAddressIdStreet(raw);
    return normalizeAddressIdText(raw);
  }

  /**
   * Build the canonical address identity key (pipe-joined normalized fields).
   * Empty when every field is blank.
   * @param {Object} row
   * @param {string[]} headers
   * @returns {string}
   */
  function buildCanonicalAddressKey(row, headers) {
    var parts = ADDRESS_ID_CANONICAL_FIELDS.map(function (field) {
      return getNormalizedCanonicalField(row, headers || [], field);
    });
    if (parts.every(function (p) { return !p; })) return '';
    return parts.join('|');
  }

  /**
   * Collect distinct non-blank address_id values for rows matching a canonical key.
   * @param {Object[]} rows
   * @param {string[]} headers
   * @param {string} canonicalKey
   * @returns {{ ids: string[], matchingRows: Object[] }}
   */
  function findAddressIdsForCanonicalKey(rows, headers, canonicalKey) {
    var ids = [];
    var seen = Object.create(null);
    var matchingRows = [];
    if (!canonicalKey || !Array.isArray(rows)) {
      return { ids: ids, matchingRows: matchingRows };
    }
    var addressIdCol = findAddressIdCanonicalColumn(headers, 'address_id') || 'address_id';
    rows.forEach(function (row) {
      if (!row) return;
      if (buildCanonicalAddressKey(row, headers) !== canonicalKey) return;
      matchingRows.push(row);
      var id = row[addressIdCol] == null ? '' : String(row[addressIdCol]).trim();
      if (!id || seen[id]) return;
      seen[id] = true;
      ids.push(id);
    });
    return { ids: ids, matchingRows: matchingRows };
  }

  /**
   * Collect distinct address_id values from a set of rows (e.g. one addressMap group).
   * @param {Object[]} rows
   * @param {string[]} [headers]
   * @returns {string[]}
   */
  function collectAddressIdsFromRows(rows, headers) {
    var ids = [];
    var seen = Object.create(null);
    var addressIdCol = findAddressIdCanonicalColumn(headers || [], 'address_id') || 'address_id';
    (Array.isArray(rows) ? rows : []).forEach(function (row) {
      if (!row) return;
      var id = row[addressIdCol] == null ? '' : String(row[addressIdCol]).trim();
      if (!id || seen[id]) return;
      seen[id] = true;
      ids.push(id);
    });
    return ids;
  }

  /**
   * Log / surface a same-address multiple-address_id conflict without silently picking.
   * @param {Object} details
   */
  function reportAddressIdConflict(details) {
    var payload = details || {};
    console.warn('[address_id conflict]', payload);
    if (typeof global !== 'undefined') {
      global.__addressIdConflicts = global.__addressIdConflicts || [];
      global.__addressIdConflicts.push({
        at: new Date().toISOString(),
        ...payload
      });
    }
  }

  /**
   * Resolve address_id for an Add Record row.
   * - Reuse a single existing ID when the canonical address already exists in-sheet
   * - Mint a new addr_ UUID when there is no match
   * - On multi-ID conflict: report and leave blank (do not silently pick)
   * - Blank canonical key (no address): leave blank
   *
   * @param {string[]} headers
   * @param {Object} valuesByColumn
   * @param {Object} [options]
   * @param {Object[]} [options.sheetRows] - all sheet rows for canonical lookup
   * @param {Object[]} [options.existingRows] - rows from a selected existing address
   * @returns {{ addressId: string, status: string }}
   */
  function resolveAddressIdForAddRecord(headers, valuesByColumn, options) {
    options = options || {};
    if (!Array.isArray(headers) || !headers.includes('address_id')) {
      return { addressId: '', status: 'column_absent' };
    }

    var key = buildCanonicalAddressKey(valuesByColumn, headers);
    if (!key) {
      valuesByColumn['address_id'] = '';
      return { addressId: '', status: 'no_address' };
    }

    var ids = [];
    if (options.existingRows && options.existingRows.length) {
      ids = collectAddressIdsFromRows(options.existingRows, headers);
    }
    if (!ids.length && options.sheetRows && options.sheetRows.length) {
      ids = findAddressIdsForCanonicalKey(options.sheetRows, headers, key).ids;
    }

    if (ids.length > 1) {
      reportAddressIdConflict({
        canonicalKey: key,
        addressIds: ids.slice(),
        source: options.existingRows && options.existingRows.length ? 'existing_address' : 'canonical_lookup'
      });
      valuesByColumn['address_id'] = '';
      return { addressId: '', status: 'conflict' };
    }

    if (ids.length === 1) {
      valuesByColumn['address_id'] = ids[0];
      return { addressId: ids[0], status: 'reused' };
    }

    var minted = generateAddressId();
    valuesByColumn['address_id'] = minted;
    return { addressId: minted, status: 'minted' };
  }

  function isAddressIdTextSafeColumn(column) {
    if (!column) return false;
    var lower = String(column).trim().toLowerCase();
    return ADDRESS_ID_TEXT_SAFE_COLUMNS.some(function (name) {
      return name.toLowerCase() === lower;
    });
  }

  var api = {
    ADDRESS_ID_PREFIX: ADDRESS_ID_PREFIX,
    ADDRESS_ID_CANONICAL_FIELDS: ADDRESS_ID_CANONICAL_FIELDS,
    ADDRESS_ID_DIRECTION_MAP: ADDRESS_ID_DIRECTION_MAP,
    ADDRESS_ID_STREET_SUFFIX_MAP: ADDRESS_ID_STREET_SUFFIX_MAP,
    ADDRESS_ID_TEXT_SAFE_COLUMNS: ADDRESS_ID_TEXT_SAFE_COLUMNS,
    generateAddressId: generateAddressId,
    normalizeAddressIdText: normalizeAddressIdText,
    normalizeAddressIdDirection: normalizeAddressIdDirection,
    normalizeAddressIdStreet: normalizeAddressIdStreet,
    findAddressIdCanonicalColumn: findAddressIdCanonicalColumn,
    buildCanonicalAddressKey: buildCanonicalAddressKey,
    findAddressIdsForCanonicalKey: findAddressIdsForCanonicalKey,
    collectAddressIdsFromRows: collectAddressIdsFromRows,
    reportAddressIdConflict: reportAddressIdConflict,
    resolveAddressIdForAddRecord: resolveAddressIdForAddRecord,
    isAddressIdTextSafeColumn: isAddressIdTextSafeColumn
  };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  } else {
    Object.keys(api).forEach(function (key) {
      global[key] = api[key];
    });
  }
})(typeof globalThis !== 'undefined' ? globalThis : this);

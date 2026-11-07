/**
 * Neighbors export helpers: field catalog, contact-list and mailing-label
 * row builders, and mail-merge-friendly CSV formatting.
 *
 * Works in the browser (globals) and in Node tests (module.exports).
 */
(function (global) {
  'use strict';

  var isNode = typeof module !== 'undefined' && module.exports;
  var deps = isNode
    ? Object.assign({}, require('./utils'), require('./resident-placeholder'))
    : global;

  var NEIGHBORS_ADDRESSEE = 'Our Neighbors';
  var MAX_ADDRESSEE_LENGTH = 35;
  var OTHER_COLUMN_PREFIX = 'col:';

  var EXPORT_FIELD_GROUPS = [
    { id: 'address', label: 'Address' },
    { id: 'contact', label: 'Contact' },
    { id: 'property', label: 'Property & rebuild' },
    { id: 'outreach', label: 'Outreach' },
    { id: 'notes', label: 'Notes' },
    { id: 'other', label: 'Other sheet columns (admin only)' }
  ];

  var DEFAULT_CONTACT_FIELD_IDS = [
    'address', 'city', 'state', 'zip',
    'name', 'homePhone', 'cellPhone', 'email',
    'lastOutreach', 'damage', 'buildStatus'
  ];

  function lowerHeader(header) {
    return String(header || '').toLowerCase();
  }

  function headerWords(header) {
    return lowerHeader(header).split(/[^a-z0-9]+/).filter(Boolean);
  }

  function normalizedHeader(header) {
    return lowerHeader(header).replace(/[^a-z0-9]/g, '');
  }

  function findHeader(headers, predicate) {
    return headers.find(function (header) {
      return predicate(lowerHeader(header), header);
    }) || null;
  }

  function isCaptainHeader(lower) {
    return /^nc[\s_-]/.test(lower) || lower.indexOf('captain') !== -1;
  }

  function findResidentNameColumn(headers) {
    return findHeader(headers, function (lower) { return lower.indexOf('resident name') !== -1; }) ||
      findHeader(headers, function (lower) {
        return lower.indexOf('name') !== -1 &&
          !/first|middle|last|zone|street/.test(lower) &&
          !isCaptainHeader(lower);
      });
  }

  function findEmailColumn(headers) {
    return findHeader(headers, function (lower) {
      return lower.indexOf('email address') !== -1 && !isCaptainHeader(lower);
    }) || findHeader(headers, function (lower) {
      return lower.indexOf('email') !== -1 && !isCaptainHeader(lower);
    });
  }

  function findHomePhoneColumn(headers) {
    return findHeader(headers, function (lower) {
      return (lower.indexOf('home phone') !== -1 || lower.indexOf('homephone') !== -1 ||
        (lower.indexOf('phone') !== -1 && lower.indexOf('home') !== -1)) &&
        lower.indexOf('cell') === -1 && lower.indexOf('mobile') === -1 &&
        !isCaptainHeader(lower);
    });
  }

  function findCellPhoneColumn(headers) {
    return findHeader(headers, function (lower) {
      return (lower.indexOf('cell') !== -1 || lower.indexOf('mobile') !== -1) && !isCaptainHeader(lower);
    });
  }

  function findPersonNotesColumns(headers) {
    return headers.filter(function (header) {
      var lower = lowerHeader(header);
      return lower.indexOf('person note') !== -1 &&
        !/outreach|contact/.test(lower);
    });
  }

  /**
   * Catalog of exportable fields. `level: 'address'` values are shared by
   * everyone at an address; `level: 'person'` values come from each resident row.
   */
  var FIELD_DEFINITIONS = [
    { id: 'address', label: 'Address', group: 'address', level: 'address', computed: 'streetAddress' },
    { id: 'city', label: 'City', group: 'address', level: 'address',
      find: function (h) { return findHeader(h, function (l, raw) { return ['city', 'situscity'].indexOf(normalizedHeader(raw)) !== -1; }); } },
    { id: 'state', label: 'State', group: 'address', level: 'address',
      find: function (h) { return findHeader(h, function (l, raw) { return ['state', 'situsstate'].indexOf(normalizedHeader(raw)) !== -1; }); } },
    { id: 'zip', label: 'ZIP', group: 'address', level: 'address',
      find: function (h) { return findHeader(h, function (l) { return /zip|postal/.test(l); }); } },

    { id: 'name', label: 'Name', group: 'contact', level: 'person', computed: 'personName' },
    { id: 'firstName', label: 'First Name', group: 'contact', level: 'person',
      find: function (h) { return findHeader(h, function (l) { return /^first\s*name$/.test(l.trim()); }); } },
    { id: 'lastName', label: 'Last Name', group: 'contact', level: 'person',
      find: function (h) { return findHeader(h, function (l) { return /^last\s*name$/.test(l.trim()); }); } },
    { id: 'homePhone', label: 'Home Phone', group: 'contact', level: 'person', find: findHomePhoneColumn },
    { id: 'cellPhone', label: 'Cell Phone', group: 'contact', level: 'person', find: findCellPhoneColumn },
    { id: 'email', label: 'Email', group: 'contact', level: 'person', find: findEmailColumn },
    { id: 'age', label: 'Age', group: 'contact', level: 'person',
      find: function (h) { return findHeader(h, function (l, raw) { return headerWords(raw).indexOf('age') !== -1; }); } },
    { id: 'gender', label: 'Gender', group: 'contact', level: 'person',
      find: function (h) { return findHeader(h, function (l) { return l.indexOf('gender') !== -1; }); } },
    { id: 'renter', label: 'Renter', group: 'contact', level: 'person', checkbox: true,
      find: function (h) { return deps.findColumn(h, 'renter'); } },
    { id: 'wantsUpdates', label: 'Wants Updates', group: 'contact', level: 'person', checkbox: true,
      find: function (h) {
        return findHeader(h, function (l) {
          var spaced = l.replace(/[_\s]+/g, ' ');
          return spaced.indexOf('wants updates') !== -1 || spaced.indexOf('newsletter subscriber') !== -1;
        });
      } },

    { id: 'damage', label: 'Damage Status', group: 'property', level: 'address',
      find: function (h) { return deps.findColumn(h, 'damage'); } },
    { id: 'buildStatus', label: 'Build Status', group: 'property', level: 'address',
      find: function (h) { return deps.findColumn(h, ['build', 'status'], ['intent']); } },
    { id: 'rebuildStage', label: 'Rebuild Stage', group: 'property', level: 'address',
      find: function (h) { return deps.findColumn(h, ['rebuild', 'stage']); } },
    { id: 'addressPlan', label: 'Address Plan', group: 'property', level: 'address',
      find: function (h) { return deps.findColumn(h, ['address', 'plan'], ['note']); } },
    { id: 'remediationStatus', label: 'Remediation Status', group: 'property', level: 'address',
      find: function (h) { return deps.findColumn(h, ['remediation', 'status'], ['note']); } },
    { id: 'indoorsRemediated', label: 'Indoors Remediated', group: 'property', level: 'address', checkbox: true,
      find: function (h) { return findHeader(h, function (l) { return /indoors?\s*remediat/.test(l); }); } },
    { id: 'soilRemediated', label: 'Soil Remediated', group: 'property', level: 'address', checkbox: true,
      find: function (h) { return findHeader(h, function (l) { return /soil\s*remediat/.test(l); }); } },
    { id: 'householdSize', label: 'Household Size', group: 'property', level: 'address',
      find: function (h) { return deps.findColumn(h, ['household', 'size']); } },
    { id: 'captainAssigned', label: 'Captain Assigned', group: 'property', level: 'address',
      find: function (h) { return deps.findColumn(h, ['captain', 'assign']); } },

    { id: 'lastOutreach', label: 'Last Outreach Attempt', group: 'outreach', level: 'person',
      find: function (h) { return deps.findOutreachDateColumn(h); } },
    { id: 'outreachLog', label: 'Outreach Log', group: 'outreach', level: 'person',
      find: function (h) { return deps.findOutreachLogColumn(h); } },
    { id: 'successfullyContacted', label: 'Successfully Contacted', group: 'outreach', level: 'person', checkbox: true,
      find: function (h) { return deps.findSuccessfullyContactedHeader(h); } },
    { id: 'needsFollowUp', label: 'Needs Follow-Up', group: 'outreach', level: 'person', checkbox: true,
      find: function (h) { return deps.findColumn(h, ['needs', 'follow']); } },

    { id: 'addressNotes', label: 'Address Notes', group: 'notes', level: 'address',
      find: function (h) { return findHeader(h, function (l) { return /address\s*note/.test(l); }); } },
    { id: 'personNotes', label: 'Person Notes', group: 'notes', level: 'person', find: findPersonNotesColumns }
  ];

  function toColumnList(found) {
    if (!found) return [];
    return (Array.isArray(found) ? found : [found]).filter(Boolean);
  }

  /**
   * Column lookups shared by every export for one sheet.
   * @param {string[]} headers
   */
  function createExportContext(headers) {
    var list = Array.isArray(headers) ? headers : [];
    return {
      headers: list,
      addressColumns: deps.findAddressColumns(list),
      nameCol: findResidentNameColumn(list),
      firstNameCol: findHeader(list, function (l) { return /^first\s*name$/.test(l.trim()); }),
      lastNameCol: findHeader(list, function (l) { return /^last\s*name$/.test(l.trim()); }),
      formerCol: deps.findColumn(list, ['former', 'resident'], ['note']),
      deceasedCol: deps.findColumn(list, 'deceased', ['note']),
      damageCol: deps.findColumn(list, 'damage')
    };
  }

  function cellText(row, column) {
    if (!row || !column) return '';
    var value = row[column];
    if (value == null) return '';
    return String(value).trim();
  }

  function isCheckedSheetValue(value) {
    var normalized = String(value == null ? '' : value).trim().toLowerCase();
    return normalized === 'true' ||
      normalized === 'yes' ||
      (normalized !== '' && normalized !== 'false' && normalized !== 'no');
  }

  function formatCheckboxValue(value) {
    var text = String(value == null ? '' : value).trim();
    if (!text) return '';
    var normalized = text.toLowerCase();
    if (['false', 'no', 'n', '0'].indexOf(normalized) !== -1) return 'No';
    if (['true', 'yes', 'y', '1', 'x', '✓', '✔'].indexOf(normalized) !== -1) return 'Yes';
    return text;
  }

  function getPersonName(row, ctx) {
    var name = cellText(row, ctx.nameCol);
    if (name) return name;
    return [cellText(row, ctx.firstNameCol), cellText(row, ctx.lastNameCol)].filter(Boolean).join(' ');
  }

  /** True for a named resident who still lives at the address. */
  function isCurrentResidentRow(row, ctx) {
    if (!row) return false;
    if (deps.isAddressPlaceholder(row, ctx.headers)) return false;
    if (ctx.formerCol && isCheckedSheetValue(row[ctx.formerCol])) return false;
    if (ctx.deceasedCol && isCheckedSheetValue(row[ctx.deceasedCol])) return false;
    return Boolean(getPersonName(row, ctx));
  }

  function getCurrentResidentRows(rows, ctx) {
    return (Array.isArray(rows) ? rows : []).filter(function (row) {
      return isCurrentResidentRow(row, ctx);
    });
  }

  /** "123 N Main St Unit 2": the dashboard's address with the unit on the same line (USPS style). */
  function buildStreetAddress(row, addressColumns) {
    if (!row || !addressColumns) return '';
    var house = deps.getTrimmedAddressValue(row, addressColumns.houseNumCol);
    var hasStructuredStreet = Boolean(
      deps.getTrimmedAddressValue(row, addressColumns.directionCol) ||
      deps.getTrimmedAddressValue(row, addressColumns.streetCol)
    );
    if (!house && !hasStructuredStreet) {
      return deps.getTrimmedAddressValue(row, addressColumns.addressCol);
    }
    var base = [house, deps.buildStreetString(row, addressColumns)].filter(Boolean).join(' ').trim();
    var unit = deps.formatAddressUnit(deps.getTrimmedAddressValue(row, addressColumns.unitCol));
    return [base, unit].filter(Boolean).join(' ');
  }

  function firstNonEmpty(rows, read) {
    for (var i = 0; i < rows.length; i++) {
      var value = read(rows[i]);
      if (value) return value;
    }
    return '';
  }

  /**
   * Fields available for this sheet, in catalog order.
   * @param {string[]} headers
   * @param {{ includeOtherColumns?: boolean }} [options] - admins also get every unclaimed sheet column
   */
  function resolveExportFields(headers, options) {
    var list = Array.isArray(headers) ? headers : [];
    var ctx = createExportContext(list);
    var claimed = new Set();
    var fields = [];

    FIELD_DEFINITIONS.forEach(function (def) {
      var columns;
      if (def.computed === 'streetAddress') {
        var ac = ctx.addressColumns;
        if (!ac.hasAnyAddressSource) return;
        columns = [ac.houseNumCol, ac.directionCol, ac.streetCol, ac.unitCol, ac.addressCol].filter(Boolean);
      } else if (def.computed === 'personName') {
        columns = [ctx.nameCol, ctx.firstNameCol, ctx.lastNameCol].filter(Boolean);
      } else {
        columns = toColumnList(def.find(list));
      }
      if (!columns.length) return;
      columns.forEach(function (col) { claimed.add(col); });
      fields.push({
        id: def.id,
        label: def.label,
        group: def.group,
        level: def.level,
        computed: def.computed || null,
        checkbox: Boolean(def.checkbox),
        columns: columns
      });
    });

    if (options && options.includeOtherColumns) {
      list.forEach(function (header) {
        if (!header || claimed.has(header)) return;
        fields.push({
          id: OTHER_COLUMN_PREFIX + header,
          label: header,
          group: 'other',
          level: 'person',
          computed: null,
          checkbox: false,
          columns: [header]
        });
      });
    }

    return fields;
  }

  /** First matching sheet column for a catalog field, or null. */
  function findExportColumn(headers, fieldId) {
    var def = FIELD_DEFINITIONS.find(function (d) { return d.id === fieldId; });
    if (!def || !def.find) return null;
    return toColumnList(def.find(Array.isArray(headers) ? headers : []))[0] || null;
  }

  /**
   * Keep saved field IDs that exist for this sheet; fall back to defaults.
   * @param {Object[]} fields - from resolveExportFields
   * @param {string[]|null} savedIds
   */
  function resolveSelectedFieldIds(fields, savedIds) {
    var available = new Set(fields.map(function (f) { return f.id; }));
    var picked = Array.isArray(savedIds)
      ? savedIds.filter(function (id) { return available.has(id); })
      : [];
    if (picked.length) return picked;
    return DEFAULT_CONTACT_FIELD_IDS.filter(function (id) { return available.has(id); });
  }

  function readFieldValue(field, row, ctx) {
    if (field.computed === 'streetAddress') return buildStreetAddress(row, ctx.addressColumns);
    if (field.computed === 'personName') return getPersonName(row, ctx);
    var text = field.columns
      .map(function (col) { return cellText(row, col); })
      .filter(Boolean)
      .join(' | ');
    return field.checkbox ? formatCheckboxValue(text) : text;
  }

  /**
   * Counts behind an export: current residents, and addresses with none on file.
   */
  function summarizeExportRows(params) {
    var ctx = createExportContext(params.headers);
    var stats = { addresses: 0, people: 0, emptyAddresses: 0 };
    (params.addresses || []).forEach(function (address) {
      var residents = getCurrentResidentRows(params.addressMap.get(address), ctx);
      stats.addresses++;
      stats.people += residents.length;
      if (!residents.length) stats.emptyAddresses++;
    });
    return stats;
  }

  /**
   * One row per current resident; addresses with no current residents get a
   * single row with person fields blank. Address-level values repeat on every row.
   * @param {{ headers: string[], addressMap: Map, addresses: string[], fieldIds: string[], includeOtherColumns?: boolean }} params
   */
  function buildContactExport(params) {
    var ctx = createExportContext(params.headers);
    var selected = new Set(params.fieldIds || []);
    var fields = resolveExportFields(params.headers, { includeOtherColumns: params.includeOtherColumns })
      .filter(function (f) { return selected.has(f.id); });

    var rows = [];
    (params.addresses || []).forEach(function (address) {
      var addressRows = params.addressMap.get(address) || [];
      var addressValues = {};
      fields.forEach(function (field) {
        if (field.level !== 'address') return;
        addressValues[field.id] = firstNonEmpty(addressRows, function (row) {
          return readFieldValue(field, row, ctx);
        });
      });

      var residents = getCurrentResidentRows(addressRows, ctx);
      var personRows = residents.length ? residents : [null];
      personRows.forEach(function (resident) {
        rows.push(fields.map(function (field) {
          if (field.level === 'address') return addressValues[field.id];
          return resident ? readFieldValue(field, resident, ctx) : '';
        }));
      });
    });

    return {
      headers: fields.map(function (f) { return f.label; }),
      rows: rows
    };
  }

  /**
   * First line of a mailing label.
   * @param {string[]} names - current resident names at the address
   * @param {'neighbors'|'names'|'blank'} mode
   */
  function formatAddressee(names, mode) {
    if (mode === 'blank') return '';
    var list = (names || []).filter(Boolean);
    if (mode !== 'names' || !list.length) return NEIGHBORS_ADDRESSEE;
    if (list.length === 1) return list[0];
    if (list.length === 2) {
      var pair = list[0] + ' & ' + list[1];
      if (pair.length <= MAX_ADDRESSEE_LENGTH) return pair;
    }
    return list[0] + ' & Family';
  }

  /**
   * One row per address for mail merge. Every address is included, whether or
   * not anyone currently lives there.
   * @param {{ headers: string[], addressMap: Map, addresses: string[], addresseeMode: string }} params
   */
  function buildMailingLabelExport(params) {
    var ctx = createExportContext(params.headers);
    var cityCol = findExportColumn(params.headers, 'city');
    var stateCol = findExportColumn(params.headers, 'state');
    var zipCol = findExportColumn(params.headers, 'zip');
    var headerRow = ['Addressee', 'Street Address', 'City', 'State', 'ZIP', 'Resident Names'];
    if (ctx.damageCol) headerRow.push('Damage Status');

    var stats = { labels: 0, missingCity: 0, missingState: 0, missingZip: 0 };
    var rows = [];

    (params.addresses || []).forEach(function (address) {
      var addressRows = params.addressMap.get(address) || [];
      var names = [];
      getCurrentResidentRows(addressRows, ctx).forEach(function (row) {
        var name = getPersonName(row, ctx);
        if (names.indexOf(name) === -1) names.push(name);
      });

      var street = firstNonEmpty(addressRows, function (row) { return buildStreetAddress(row, ctx.addressColumns); }) || address;
      var city = firstNonEmpty(addressRows, function (row) { return cellText(row, cityCol); });
      var state = firstNonEmpty(addressRows, function (row) { return cellText(row, stateCol); });
      var zip = firstNonEmpty(addressRows, function (row) { return cellText(row, zipCol); });

      stats.labels++;
      if (!city) stats.missingCity++;
      if (!state) stats.missingState++;
      if (!zip) stats.missingZip++;

      var row = [formatAddressee(names, params.addresseeMode), street, city, state, zip, names.join('; ')];
      if (ctx.damageCol) row.push(firstNonEmpty(addressRows, function (r) { return cellText(r, ctx.damageCol); }));
      rows.push(row);
    });

    return { headers: headerRow, rows: rows, stats: stats };
  }

  function escapeCsvCell(value) {
    var text = value == null ? '' : String(value);
    // Keep spreadsheet apps from evaluating cell text as a formula.
    if (/^[=@\t\r]/.test(text) || /^[+-][^\d\s(.]/.test(text)) text = "'" + text;
    if (/[",\r\n]/.test(text)) return '"' + text.replace(/"/g, '""') + '"';
    return text;
  }

  /** UTF-8 BOM + CRLF so Excel and Word mail merge read names with accents correctly. */
  function toCsv(headerRow, rows) {
    return '\uFEFF' + [headerRow].concat(rows || []).map(function (row) {
      return row.map(escapeCsvCell).join(',');
    }).join('\r\n') + '\r\n';
  }

  function buildExportFilename(zoneName, kind, date) {
    var slug = String(zoneName || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'zone';
    var d = date || new Date();
    var ymd = [
      d.getFullYear(),
      String(d.getMonth() + 1).padStart(2, '0'),
      String(d.getDate()).padStart(2, '0')
    ].join('-');
    return slug + '-' + kind + '-' + ymd + '.csv';
  }

  var api = {
    NEIGHBORS_ADDRESSEE: NEIGHBORS_ADDRESSEE,
    EXPORT_FIELD_GROUPS: EXPORT_FIELD_GROUPS,
    DEFAULT_CONTACT_FIELD_IDS: DEFAULT_CONTACT_FIELD_IDS,
    createExportContext: createExportContext,
    isCurrentResidentRow: isCurrentResidentRow,
    getExportPersonName: getPersonName,
    buildStreetAddress: buildStreetAddress,
    resolveExportFields: resolveExportFields,
    findExportColumn: findExportColumn,
    resolveSelectedFieldIds: resolveSelectedFieldIds,
    summarizeExportRows: summarizeExportRows,
    buildContactExport: buildContactExport,
    formatAddressee: formatAddressee,
    buildMailingLabelExport: buildMailingLabelExport,
    escapeCsvCell: escapeCsvCell,
    toCsv: toCsv,
    buildExportFilename: buildExportFilename
  };

  if (isNode) {
    module.exports = api;
  } else {
    Object.keys(api).forEach(function (key) {
      global[key] = api[key];
    });
  }
})(typeof globalThis !== 'undefined' ? globalThis : this);

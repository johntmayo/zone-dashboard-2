/**
 * Address-placeholder resident helpers.
 *
 * Works in the browser (globals) and in Node tests (module.exports).
 */
(function (global) {
  'use strict';

  var PLACEHOLDER_RESIDENT_NAME = 'Placeholder Resident';
  var ADDRESS_PLACEHOLDER_HEADER = 'Address Placeholder';

  function generateResidentId() {
    if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
      return crypto.randomUUID();
    }
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function (c) {
      var r = (Math.random() * 16) | 0;
      var v = c === 'y' ? (r & 0x3) | 0x8 : r;
      return v.toString(16);
    });
  }

  function findAddressPlaceholderColumn(headers) {
    if (!Array.isArray(headers)) return null;
    return headers.find(function (header) {
      return String(header || '').trim().toLowerCase() === ADDRESS_PLACEHOLDER_HEADER.toLowerCase();
    }) || null;
  }

  function isTrueSheetBoolean(value) {
    if (value === true) return true;
    return String(value == null ? '' : value).trim().toLowerCase() === 'true';
  }

  function isAddressPlaceholder(row, headers) {
    var column = findAddressPlaceholderColumn(headers);
    return Boolean(column && row && isTrueSheetBoolean(row[column]));
  }

  function setAddressPlaceholderValue(headers, valuesByColumn, isPlaceholder) {
    var column = findAddressPlaceholderColumn(headers);
    if (column && valuesByColumn) valuesByColumn[column] = Boolean(isPlaceholder);
    return column;
  }

  function classifyResidentNameChange(currentName, nextName, placeholder) {
    var current = String(currentName || '').trim();
    var next = String(nextName || '').trim();
    if (current === next) return 'unchanged';
    if (placeholder && next && next !== PLACEHOLDER_RESIDENT_NAME) return 'placeholder_conversion';
    if (!placeholder) return 'real_resident_change';
    return 'placeholder_unchanged';
  }

  var api = {
    PLACEHOLDER_RESIDENT_NAME: PLACEHOLDER_RESIDENT_NAME,
    ADDRESS_PLACEHOLDER_HEADER: ADDRESS_PLACEHOLDER_HEADER,
    generateResidentId: generateResidentId,
    findAddressPlaceholderColumn: findAddressPlaceholderColumn,
    isTrueSheetBoolean: isTrueSheetBoolean,
    isAddressPlaceholder: isAddressPlaceholder,
    setAddressPlaceholderValue: setAddressPlaceholderValue,
    classifyResidentNameChange: classifyResidentNameChange
  };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  } else {
    Object.keys(api).forEach(function (key) {
      global[key] = api[key];
    });
  }
})(typeof globalThis !== 'undefined' ? globalThis : this);

/**
 * Utility Functions for Altagether Neighborhood Dashboard
 * 
 * This module contains reusable utility functions used throughout the application.
 * All functions are available in the global scope.
 */

/**
 * Convert column index to Excel-style letter (A, B, C, ..., Z, AA, AB, etc.)
 * @param {number} index - Zero-based column index
 * @returns {string} Column letter(s)
 * @example
 * indexToColumnLetter(0) // Returns "A"
 * indexToColumnLetter(25) // Returns "Z"
 * indexToColumnLetter(26) // Returns "AA"
 */
function indexToColumnLetter(index) {
  let result = '';
  while (index >= 0) {
    result = String.fromCharCode(65 + (index % 26)) + result;
    index = Math.floor(index / 26) - 1;
  }
  return result;
}

/**
 * Escape HTML special characters to prevent XSS attacks
 * @param {string} text - Text to escape
 * @returns {string} Escaped HTML string
 * @example
 * escapeHtml('<script>alert("xss")</script>') // Returns "&lt;script&gt;alert(&quot;xss&quot;)&lt;/script&gt;"
 */
function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

/**
 * Parse various date formats into a Date object
 * @param {string} dateStr - Date string in various formats
 * @returns {Date|null} Parsed Date object or null if parsing fails
 * @example
 * parseDate('2024-01-15') // Returns Date object
 * parseDate('01/15/2024') // Returns Date object
 */
function parseDate(dateStr) {
  // Try to parse various date formats
  const date = new Date(dateStr);
  if (!isNaN(date.getTime())) {
    return date;
  }
  // Try MM/DD/YYYY format
  const parts = dateStr.split('/');
  if (parts.length === 3) {
    const month = parseInt(parts[0]) - 1;
    const day = parseInt(parts[1]);
    const year = parseInt(parts[2]);
    const date2 = new Date(year, month, day);
    if (!isNaN(date2.getTime())) {
      return date2;
    }
  }
  return null;
}

/**
 * Convert URLs in text to clickable links (supports markdown-style and plain URLs)
 * @param {string} text - Text that may contain URLs
 * @returns {string} Text with URLs converted to HTML anchor tags
 * @example
 * linkifyText('Visit https://example.com for more info')
 * // Returns 'Visit <a href="https://example.com" target="_blank" rel="noopener noreferrer">https://example.com</a> for more info'
 */
function linkifyText(text) {
  if (!text) return '';
  
  // Use placeholders to protect already-converted links
  const placeholders = [];
  let placeholderIndex = 0;
  
  // First, convert markdown-style links [text](url) and replace with placeholder
  let result = text.replace(/\[([^\]]+)\]\(([^)]+)\)/g, (match, linkText, url) => {
    // Only allow http/https URLs for security
    if (url.match(/^https?:\/\//i)) {
      const placeholder = `__LINK_PLACEHOLDER_${placeholderIndex}__`;
      placeholders[placeholderIndex] = `<a href="${url}" target="_blank" rel="noopener noreferrer">${linkText}</a>`;
      placeholderIndex++;
      return placeholder;
    }
    return match; // Return original if not a valid URL
  });
  
  // Then, auto-detect any remaining plain URLs and convert them
  const urlPattern = /(https?:\/\/[^\s<>"']+)/g;
  result = result.replace(urlPattern, (match) => {
    const placeholder = `__LINK_PLACEHOLDER_${placeholderIndex}__`;
    placeholders[placeholderIndex] = `<a href="${match}" target="_blank" rel="noopener noreferrer">${match}</a>`;
    placeholderIndex++;
    return placeholder;
  });
  
  // Replace placeholders with actual HTML
  placeholders.forEach((html, index) => {
    result = result.replace(`__LINK_PLACEHOLDER_${index}__`, html);
  });
  
  return result;
}

/**
 * Normalize street name by removing unit indicators, suffixes, and extra whitespace
 * @param {string} street - Street name to normalize
 * @returns {string} Normalized street name
 * @example
 * normalizeStreet('Madison Ave Unit 2') // Returns "Madison Ave"
 * normalizeStreet('Maple Street Rear') // Returns "Maple Street"
 */
function normalizeStreet(street) {
  if (!street) return '';
  
  let normalized = street.trim();
  
  // Remove common unit indicators and everything after them
  // Patterns like: "Madison Ave Unit", "Madison Ave Apt B", "Madison Ave #2", etc.
  const unitPatterns = [
    /\s+(Unit|Apt|Apartment|Suite|Ste|#|No\.|Number)\s+.*$/i,
    /\s+(Unit|Apt|Apartment|Suite|Ste)\s*$/i,
    /\s+#\s*\d+.*$/i,
    /\s+\d+[A-Z]?\s*$/, // Trailing numbers/letters like "123" or "B"
  ];
  
  for (const pattern of unitPatterns) {
    normalized = normalized.replace(pattern, '');
  }
  
  // Remove common directional/location suffixes
  // Patterns like: "Madison Ave Rear", "Maple Street Front", etc.
  const suffixPatterns = [
    /\s+(Rear|Front|Back|Side|North|South|East|West|N|S|E|W)\s*$/i,
    /\s+[A-Z]\s*$/, // Single letter suffix like "B" or "A"
  ];
  
  for (const pattern of suffixPatterns) {
    normalized = normalized.replace(pattern, '');
  }
  
  // Clean up extra whitespace
  normalized = normalized.trim();
  
  return normalized;
}

/**
 * Safely read and trim a cell value from a row object
 * @param {Object} row - Row object from the sheet
 * @param {string|null} columnName - Header name to read
 * @returns {string} Trimmed string value
 */
function getTrimmedAddressValue(row, columnName) {
  if (!row || !columnName) return '';
  const value = row[columnName];
  if (value == null) return '';
  return String(value).trim();
}

/**
 * Normalize a header name for resilient matching
 * @param {string} value - Header text
 * @returns {string} Lowercase alphanumeric key
 */
function normalizeHeaderKey(value) {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '');
}

/**
 * Identify which columns the dashboard should use for address parsing
 * Supports both the new situs columns and the legacy House/Street format.
 * @param {Array<string>} headers - Sheet headers
 * @returns {Object} Address column metadata
 */
function findAddressColumns(headers) {
  if (!headers || !Array.isArray(headers)) {
    return {
      houseNumCol: null,
      directionCol: null,
      streetCol: null,
      unitCol: null,
      addressCol: null,
      hasAnyAddressSource: false
    };
  }

  const findExact = (names) => {
    const normalizedNames = names.map((name) => normalizeHeaderKey(name));
    return headers.find((header) => normalizedNames.includes(normalizeHeaderKey(header))) || null;
  };

  const houseNumCol =
    findExact(['_SitusHouseNo', 'SitusHouseNo']) ||
    headers.find((h) => {
      const lower = String(h || '').toLowerCase();
      return h === 'House #' ||
             lower === 'house #' ||
             lower.includes('house #') ||
             lower.includes('house#') ||
             lower === 'house number' ||
             lower === 'house num' ||
             (lower === 'house' && !lower.includes('hold'));
    }) ||
    null;

  const directionCol = findExact(['_SitusDirection', 'SitusDirection']);

  const streetCol =
    findExact(['_SitusStreet', 'SitusStreet']) ||
    headers.find((h) => {
      const lower = String(h || '').toLowerCase();
      return h === 'Street' ||
             lower === 'street' ||
             (lower.includes('street') && !lower.includes('address'));
    }) ||
    null;

  const unitCol =
    findExact(['_SitusUnit', 'SitusUnit', 'Unit']) ||
    null;

  const addressCol = headers.find((h) => {
    const lower = String(h || '').toLowerCase().trim();
    if (lower.includes('plan') || lower.includes('note') || lower.includes('sale') || lower.includes('sold') || lower.includes('unit')) {
      return false;
    }
    if (lower.includes('email') || lower.includes('phone')) {
      return false;
    }
    return lower === 'address' ||
           lower === 'full address' ||
           lower === 'street address' ||
           lower === 'property address' ||
           lower === 'location';
  }) || null;

  return {
    houseNumCol,
    directionCol,
    streetCol,
    unitCol,
    addressCol,
    hasAnyAddressSource: Boolean(houseNumCol || directionCol || streetCol || unitCol || addressCol)
  };
}

/**
 * Format a unit value for display in canonical addresses
 * @param {string} unit - Unit cell value
 * @returns {string} Normalized display string
 */
function formatAddressUnit(unit) {
  const value = String(unit || '').trim();
  if (!value) return '';
  if (/^(unit|apt|apartment|suite|ste|#)/i.test(value)) {
    return value.replace(/\s+/g, ' ');
  }
  return `Unit ${value}`;
}

/**
 * Build the street portion of an address using direction + street columns when available
 * @param {Object} row - Sheet row
 * @param {Object} addressColumns - Result of findAddressColumns()
 * @returns {string} Normalized street reference (direction included, unit excluded)
 */
function buildStreetString(row, addressColumns) {
  if (!row || !addressColumns) return '';

  const direction = getTrimmedAddressValue(row, addressColumns.directionCol);
  const street = getTrimmedAddressValue(row, addressColumns.streetCol);
  const structuredStreet = [direction, street].filter(Boolean).join(' ').trim();
  if (structuredStreet) return normalizeStreet(structuredStreet);

  const fullAddress = getTrimmedAddressValue(row, addressColumns.addressCol);
  if (!fullAddress) return '';

  const parts = fullAddress.split(/\s+/);
  const inferredStreet = parts.length > 1 ? parts.slice(1).join(' ') : fullAddress;
  return normalizeStreet(inferredStreet);
}

/**
 * Build the dashboard's canonical address string from the best available columns
 * @param {Object} row - Sheet row
 * @param {Object} addressColumns - Result of findAddressColumns()
 * @returns {string} Canonical address string
 */
function buildAddressString(row, addressColumns) {
  if (!row || !addressColumns) return '';

  const houseNumber = getTrimmedAddressValue(row, addressColumns.houseNumCol);
  const street = buildStreetString(row, addressColumns);
  const baseAddress = [houseNumber, street].filter(Boolean).join(' ').trim();
  if (baseAddress) {
    const unit = formatAddressUnit(getTrimmedAddressValue(row, addressColumns.unitCol));
    return [baseAddress, unit].filter(Boolean).join(', ').trim();
  }

  return getTrimmedAddressValue(row, addressColumns.addressCol);
}

/**
 * Extract street name from full address
 * Note: This function depends on the global sheetData variable
 * @param {string} address - Full address string
 * @returns {string} Extracted street name
 * @example
 * extractStreet('123 Main St, Altadena, CA 91001') // Returns "Main St"
 */
function extractStreet(address) {
  let street = '';
  
  // Use structured address columns if available (preferred method)
  if (sheetData && sheetData.addressMap && sheetData.addressMap.has(address)) {
    const rows = sheetData.addressMap.get(address);
    if (rows && rows.length > 0) {
      if (typeof sheetData.getStreetString === 'function') {
        street = sheetData.getStreetString(rows[0]);
      } else if (sheetData.streetCol && rows[0][sheetData.streetCol]) {
        street = rows[0][sheetData.streetCol].trim();
      }
    }
  }
  
  // Fallback: try to extract from address string (e.g., "2054 MADISON AVE" -> "MADISON AVE")
  if (!street) {
    const parts = address.split(/\s+/);
    if (parts.length > 1) {
      street = parts.slice(1).join(' '); // Everything after the first part (house number)
    } else {
      street = address;
    }
  }
  
  // Normalize the street name to handle units, suffixes, etc.
  return normalizeStreet(street);
}

/**
 * Find a column in headers array by keywords
 * Supports single keyword, multiple keywords (AND), and exclude keywords
 * @param {Array<string>} headers - Array of column headers
 * @param {string|Array<string>} keywords - Keyword(s) to search for. If array, all must match (AND)
 * @param {Array<string>} excludeKeywords - Keywords to exclude (optional)
 * @returns {string|null} - Column name if found, null otherwise
 * @example
 * findColumn(headers, 'damage') // Finds "Damage Status"
 * findColumn(headers, ['contact', 'date']) // Finds "Last Contact Date"
 * findColumn(headers, 'name', ['nc name', 'first', 'last']) // Finds "Resident Name" but not "NC Name"
 */
function findColumn(headers, keywords, excludeKeywords = []) {
  if (!headers || !Array.isArray(headers)) return null;
  
  // Convert single keyword to array
  const keywordArray = Array.isArray(keywords) ? keywords : [keywords];
  
  return headers.find(header => {
    const lowerHeader = header.toLowerCase();
    
    // All keywords must be present (AND logic)
    const allKeywordsMatch = keywordArray.every(keyword => 
      lowerHeader.includes(keyword.toLowerCase())
    );
    
    if (!allKeywordsMatch) return false;
    
    // None of the exclude keywords should be present
    if (excludeKeywords && excludeKeywords.length > 0) {
      const hasExcludedKeyword = excludeKeywords.some(exclude => 
        lowerHeader.includes(exclude.toLowerCase())
      );
      if (hasExcludedKeyword) return false;
    }
    
    return true;
  }) || null;
}

/**
 * Show an element by removing hidden class or setting display style
 * @param {string|HTMLElement} element - Element ID or element reference
 * @param {string} displayType - Display type: 'block', 'flex', 'inline' (default: 'block')
 */
function showElement(element, displayType = 'block') {
  const el = typeof element === 'string' ? document.getElementById(element) : element;
  if (!el) return;
  
  // If element has hidden class, remove it
  if (el.classList.contains('hidden')) {
    el.classList.remove('hidden');
  } else {
    // Otherwise, set display style directly (for dynamically created elements)
    el.style.display = displayType;
  }
}

/**
 * Hide an element by adding hidden class or setting display to none
 * @param {string|HTMLElement} element - Element ID or element reference
 */
function hideElement(element) {
  const el = typeof element === 'string' ? document.getElementById(element) : element;
  if (!el) return;
  
  // If element can use hidden class, use it
  if (el.classList) {
    el.classList.add('hidden');
  } else {
    // Otherwise, set display style directly
    el.style.display = 'none';
  }
}

/**
 * Toggle element visibility
 * @param {string|HTMLElement} element - Element ID or element reference
 * @param {boolean} force - Force show (true) or hide (false), optional
 * @param {string} displayType - Display type when showing (default: 'block')
 */
function toggleElement(element, force = null, displayType = 'block') {
  const el = typeof element === 'string' ? document.getElementById(element) : element;
  if (!el) return;
  
  if (force === null) {
    // Toggle based on current state
    if (el.classList.contains('hidden')) {
      showElement(el, displayType);
    } else {
      hideElement(el);
    }
  } else if (force) {
    showElement(el, displayType);
  } else {
    hideElement(el);
  }
}


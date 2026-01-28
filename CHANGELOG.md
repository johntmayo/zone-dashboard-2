# Changelog

All notable changes to this project will be documented in this file.

## [2.0.0] - 2024

### Major Refactoring & Code Quality Improvements

#### CSS Extraction
- **Extracted all CSS to external file**: Moved ~3,555 lines of embedded CSS from `index.html` to `css/styles.css`
- **Removed inline styles**: Replaced 168+ instances of inline `style=""` attributes with semantic CSS classes
- **Added utility classes**: Created reusable classes (`.hidden`, `.flex`, `.flex-column`, `.margin-auto`, `.header-controls`) for common patterns
- **Improved caching**: External CSS file can now be cached separately by browsers

#### JavaScript Organization
- **Created utilities module**: Extracted 6 core utility functions to `js/utils.js`:
  - `indexToColumnLetter()` - Convert column index to Excel-style letter
  - `escapeHtml()` - XSS prevention for HTML escaping
  - `parseDate()` - Flexible date parsing
  - `linkifyText()` - Convert URLs to clickable links
  - `normalizeStreet()` - Street name normalization
  - `extractStreet()` - Extract street from full address
- **Added helper functions**: Created reusable helpers in `js/utils.js`:
  - `findColumn()` - Find columns by keywords (replaced 80+ instances of repetitive code)
  - `showElement()`, `hideElement()`, `toggleElement()` - Consistent display toggling
- **Improved code maintainability**: Reduced code duplication and improved readability

#### Performance & Stability
- **Removed duplicate Leaflet loads**: Eliminated redundant library imports (was loading Leaflet CSS/JS twice)
- **Fixed event handler memory leaks**: Improved `setupPrintExportHandlers()` to prevent duplicate handlers and DOM issues
- **Reduced console noise**: Removed 100+ debug `console.log` statements while keeping all error/warning logs
- **Better error handling**: Maintained all `console.error` and `console.warn` statements for debugging

#### Bug Fixes
- **Fixed chart carousels**: Zone Overview charts now display correctly on Home page
- **Fixed Zone Analysis report**: Report generation now properly displays results
- **Fixed map visibility**: Map on Map page now displays correctly
- **Fixed freezing issues**: Addressed site crashes/freezing related to CSV export button interactions

### Technical Details

#### File Structure Changes
```
Before:
- index.html (single monolithic file with embedded CSS and JS)

After:
- index.html (HTML structure only)
- css/styles.css (all styling)
- js/utils.js (utility functions)
```

#### Breaking Changes
- None - all functionality preserved, only internal structure changed

#### Migration Notes
- No migration needed - all changes are backward compatible
- External CSS and JS files are automatically loaded
- All existing features work exactly as before

### Developer Experience
- **Easier debugging**: Cleaner console output (errors/warnings only)
- **Better code organization**: Related code grouped in logical files
- **Improved maintainability**: Reduced code duplication makes future changes easier
- **Version tracking**: Added version number to `package.json` (2.0.0)

---

## [1.0.0] - Previous Version

Initial release with all core functionality:
- Google Sheets integration
- Interactive maps with KML boundaries
- Address and people management
- Zone analysis and reporting
- Contact tracking
- Filtering and search capabilities


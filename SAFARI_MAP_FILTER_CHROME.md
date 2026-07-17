# Safari Map/Neighbors Filter Chrome — Tracking Doc

Working branch: `safari`. Files: `index.html` (single-file SPA, ~26k lines) and
`public/css/styles.css`. **Verify every line number with a fresh search before editing —
they drift constantly in this file.**

## Background
This work started from a Safari user report ("can't save changes" and "won't scroll to
show the whole map") and grew into a redesign of the Map/Neighbors filter bar
(`#filterBar`) so the map gets more vertical space and the action buttons live in
sensible places.

Key structures:
- Filter-bar shell (~index.html line 64+): primary row (Streets, Damage, Search,
  "More filters" `#filterMoreToggle`.btn-more-filters), active chips (`#filterBarChips`),
  More-filters panel (`#filterBarMorePanel`), and the action slot
  (`.filter-bar-actions` / `#filterBarActions`).
- `populateFilterBar()` builds the primary row + More panel and wires filter controls.
- `updateFilterChipsAndBadge()` maintains active-filter chips + the More badge.
- `resyncMapLayoutAfterFilterBar()` / `invalidateZoneMapSizeSoon()` keep Leaflet's
  `invalidateSize()` firing after layout changes (Safari map-tearing fix).
- Shared add-record modal: `showAddRecordModal(preselectType)` at ~line 10804.

---

## Directives 1–5 — COMPLETED (verify on branch)
These were implemented in a prior session. Recorded here for history; spot-check before
assuming they're perfect.

1. **Killed the "Actions" dropdown** in the filter bar (removed the naming collision with
   the left-nav "Actions" tab). No more `#filterActionsMenu` / `#filterActionsToggle` /
   `#filterActionsDropdown`.
2. **Add address / Add person → contextual marigold CTA buttons in Details.**
   - `#btnAddMissingAddress` (`.btn-add-record-cta`) renders at the bottom of the address
     list flow (`displayAddressList`, ~line 13189) → `showAddRecordModal('address')`.
   - `#btnAddMissingPerson` renders at the bottom of the people list within an address
     (`displayAddressDetails`, handler ~line 14741) → `showAddRecordModal('person')`.
   - Both use the shared modal with the correct record-type radio pre-selected
     (`input[name="addRecordType"]`, preselect logic ~line 11134).
3. **Removed the bottom "Save Changes" button** from the Details flow; rely on the top
   button (`#saveChangesBtnTop`) + autosave. `saveChanges()` now falls back to the top
   button/status (`const saveBtn = document.getElementById('saveChangesBtn') ||
   document.getElementById('saveChangesBtnTop');`, ~line 15912).
4. **Export is a standalone quiet button** in the filter-bar action slot
   (`#btnExport`, ~line 70), styled dark-navy (`.btn-filter-chrome`), still calling
   `showExportModal()`.
5. **"More filters" restyled** dark-navy to match (`#filterMoreToggle`,
   `.btn-more-filters`, ~line 11891), keeping the active-count badge.

---

## Directive 6 — COMPLETED: pre-select the current address in "Add a person"
**Requested by user; implemented.** When you're viewing a specific address and click the
contextual **Add a missing person** button, the modal opens with the "person" record type
pre-selected AND the currently viewed address pre-selected in the dropdown.

Implemented exactly as planned below:
- `showAddRecordModal(preselectType, preselectAddress)` — new optional 2nd arg (~line 10804).
- After `togglePersonAddressBlocks()` init (~line 11156): when `preselectType === 'person'`
  and `preselectAddress` matches an `#addRecordExistingAddress` option value, set the mode
  to `existing`, set the dropdown, and re-run `togglePersonAddressBlocks()`. Non-matching
  values fall back to "-- Select an address --" (no forced/wrong address).
- Contextual button passes the global `selectedAddress`
  (`showAddRecordModal('person', selectedAddress)`, ~line 14743). `selectedAddress` is
  always an `addressMap` key (set in `displayAddressDetails`, ~line 13616), the same source
  the dropdown options are built from, so the exact-match preselect lands reliably.

### Original plan (kept for reference)

### How the relevant code fits together (verified)
- Contextual person button handler (~line 14741):

```14741:14744:index.html
      // Contextual "Add a missing person" opens the shared add-record modal, person pre-selected
      const addMissingPersonBtn = document.getElementById('btnAddMissingPerson');
      if (addMissingPersonBtn) {
        addMissingPersonBtn.addEventListener('click', () => showAddRecordModal('person'));
      }
```

- Global `selectedAddress` (declared ~line 1303, `let selectedAddress = null;`) holds the
  currently viewed address **string** while in `displayAddressDetails`. Its value comes
  from `sheetData.addressMap` keys.
- Inside `showAddRecordModal`, the person "existing address" dropdown is
  `#addRecordExistingAddress` (~line 11022). Its `<option>` values are the same address
  strings, produced by
  `sortAddressesByStreetThenNumber(Array.from(sheetData.addressMap.keys()))` (~line 10818).
  So `selectedAddress` should match an option value exactly.
- The person address-mode `<select>` is `#addRecordPersonAddressType` (~line 11015) with
  values `existing` / `new` / `none`. `togglePersonAddressBlocks()` (~line 11150) shows the
  matching block. The existing record-type preselect happens at ~line 11134.

### Implementation plan for the future agent
1. Extend the signature:
   `function showAddRecordModal(preselectType, preselectAddress)` (~line 10804).
2. After the person address blocks are initialized (right after the
   `togglePersonAddressBlocks(); ` call, ~line 11156), add preselect logic:
   - Only when `preselectType === 'person'` and `preselectAddress` is a non-empty string.
   - Set `personAddressType.value = 'existing'`.
   - Set the existing-address select:
     `const existingSel = document.getElementById('addRecordExistingAddress');`
     and only assign if an option matches
     (`if (existingSel && [...existingSel.options].some(o => o.value === preselectAddress)) existingSel.value = preselectAddress;`).
   - Call `togglePersonAddressBlocks()` again so the "existing" block is visible.
3. Pass the current address from the contextual button (~line 14743):
   `addMissingPersonBtn.addEventListener('click', () => showAddRecordModal('person', selectedAddress));`

### Guardrails / edge cases
- If `preselectAddress` doesn't exactly match an option value (string drift, trailing
  city/state, casing), fall back gracefully to `-- Select an address --` rather than
  forcing a value. Consider a trimmed/normalized compare, but do NOT silently pick the
  wrong address.
- Leave the `'address'` contextual button and all other callers of `showAddRecordModal`
  working (the new 2nd arg must be optional).
- Don't regress: active chips, More-filters panel open/close, `updateFilterChipsAndBadge`,
  `resyncMapLayoutAfterFilterBar`, or the mobile (`max-width: 767px`) filter-bar rules.
- After editing, run lint on both files and fix anything introduced. Test in Safari at a
  narrow laptop width: open an address → Add a missing person → confirm the modal opens
  with person selected AND that address chosen in the dropdown.

# Zone Dashboard Data Mismatch - Handoff

## Executive Summary
We identified and fixed real data-integrity issues causing dashboard edits to write to the wrong spreadsheet rows.  
Highest-risk paths are now corrected and manually verified.  
`Add Record` has been intentionally disabled pending final validation before re-enable.

---

## What Was Causing the Problem

### 1) Row mapping corruption when blank rows existed inside active data
The app filtered out blank rows while loading, then wrote back using compressed in-memory indexes.  
If a blank row existed above the target row, writes shifted upward (e.g., `X46` -> `X45`).

### 2) `Add Record` writing address blob into `Address Plan`
Address-column detection was too broad (`includes("address")`), so in schemas without a dedicated `Address` column it could incorrectly match `Address Plan` and write combined `House + Street` into column `R`.

### 3) `Add Record` not inheriting checkboxes/dropdowns
Rows were appended as raw values only, so sheet-level validation/checkbox/dropdown rules were not inherited.

### 4) Longer-term risk still open: backend write authorization
Write endpoints currently accept sheet ID + payload without per-user/per-sheet authorization checks.

---

## What Was Changed

### A) Emergency shutdown of `Add Record`
- `Add Record` button hidden.
- Feature flag set off (`ENABLE_ADD_RECORD = false`).
- Button handler only attaches when flag is enabled.
- Modal function guards and shows disabled message.

### B) Row identity stabilization (blank-row-safe)
- Parsing now stores absolute sheet row metadata.
- Write paths use stable row identity instead of compressed display index behavior.
- This resolves the `-1 row shift` bug with internal blank rows.

### C) Address-column detection hardened
- Canonical address detection now excludes `plan`, `notes`, `sale`, `sold`, `unit`, etc.
- Prevents accidental writes of house/street into `Address Plan`.

### D) New append endpoint for validation inheritance
- Added `POST /api/sheets/append-record`.
- Server inserts a physical row with `inheritFromBefore: true`, then writes values.
- Intended to preserve dropdown/checkbox/data validation.

---

## What Was Verified Manually (Passed)

1. **Row integrity test**
   - Insert blank row in middle
   - Edit row below in dashboard
   - Correct spreadsheet row updated (no shift)

2. **Contact button test**
   - `Last Contact Date` updates exact intended row only

3. **Address-level multi-row test**
   - Address with 2 residents
   - Address-level field update correctly updates both related rows

4. **Add Record disabled test**
   - Button hidden/inaccessible in Neighbors view

---

## What Still Needs To Happen

### 1) Validate `Add Record` in staging before re-enable
When flag is turned back on in test environment:
- Add a record
- Confirm dropdown validations exist in `Q/R/S`
- Confirm checkboxes exist in `T/U/V`
- Confirm no address blob is written into `R` (`Address Plan`)
- Confirm row is inserted correctly and maps correctly for future edits

### 2) Temporary sorting/refresh operating rule
Current safe policy:
- Filtering in Sheets is fine.
- Sorting is allowed, but users should refresh dashboard after sorting before editing.
- Risk case: someone sorts in Sheets while another user edits from a stale dashboard session.

### 3) Improve refresh UX
- Add visible “Last synced” timestamp
- Add explicit “Refresh Data” action
- Optional low-frequency auto-refresh only when no unsaved edits

### 4) Long-term stable identity model
- Add `resident_id` (UUID/ULID) per resident row
- For master rollup, use composite key: `source_sheet_id + resident_id`
- Never rely on row position for identity

### 5) Security hardening
- Add server-side authorization for write endpoints so users can only mutate allowed sheet IDs

---

## Do We Need To Claw Back 25 Existing Sheets?
Not immediately, based on current findings and successful tests.

Recommended now:
- Keep `Add Record` OFF until staged validation passes
- Communicate sort-then-refresh behavior
- Quick audit for obvious corruption (e.g., street-like values in `Address Plan`)
- Continue monitoring for mismatches

---

## Temporary User Message (Copy/Paste)
`We deployed an important data-integrity fix. You can continue normal dashboard edits. The Add Record feature is temporarily disabled while we complete final validation. If you sort directly in Google Sheets, please refresh the dashboard before making further edits.`

---

## Cursor / Cross-Computer Workflow Note
A Cursor workspace carries project/files context, but chat history may not carry over reliably across machines/sessions.

Best practice when moving computers:
1. Commit/push code
2. Pull on new machine
3. Paste this handoff file into first prompt for the new agent
4. Continue from the “What Still Needs To Happen” section

---

## Known Relevant Files
- `index.html`
- `server.js`

Key changes include:
- `ENABLE_ADD_RECORD` gate and hidden `btnAddRecord`
- blank-row-safe row identity metadata during parsing
- hardened canonical address-column detection
- new `/api/sheets/append-record` endpoint
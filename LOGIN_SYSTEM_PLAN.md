# Login System Implementation Plan
**Status:** In Progress
**Branch:** `claude/plan-login-system-k95Rc`
**Author:** Claude (Sonnet 4.6)
**Last updated:** 2026-03-02

---

## Overview

We are replacing the current "paste your sheet URL manually" onboarding flow with a proper login system. After a user signs in with Google, the server looks up their email in a config file and returns the sheet(s) they are authorized to access. The manual URL input is removed from the welcome overlay. The admin manages access by editing a JSON file on the server — no admin UI is needed.

---

## Background & Context

### What the app is
**Altagether Zone Dashboard** — a neighborhood captains' tool for LA wildfire recovery. Each neighborhood captain (NC) has a Google Sheets spreadsheet for their zone. The dashboard reads and writes that sheet via a server-side Google service account. Captains sign in with Google OAuth so the server can identify them and confirm they can edit.

### Tech stack
- **Server:** Node.js + Express (`server.js`), deployed on Vercel
- **Client:** Single large `index.html` (~14,000 lines), vanilla JS, no framework
- **Sheets access:** Google service account (credentials in env var `GOOGLE_SERVICE_ACCOUNT_JSON_B64`). All reads/writes go through the server — the user's OAuth token is NOT used for sheet access.
- **Google OAuth:** Client-side only, using `google.accounts.oauth2.initTokenClient` (GSI). The token is used only to call `/oauth2/v2/userinfo` and get the user's email.
- **Persistence:** All client state is in `localStorage` — no server-side sessions.

### Current auth flow (what exists today)
1. App loads → reads `savedSheetUrl` from `localStorage` (and `googleOAuthToken`, `ncProfileUserEmail`)
2. If token valid + sheet URL cached → auto-loads the sheet, skips welcome overlay
3. If no sheet URL → shows **welcome overlay** with two steps:
   - Step 1: Sign in with Google (gets OAuth token, fetches user email)
   - Step 2: Paste Google Sheet URL manually → clicks Load → sheet loads
4. After sign-in, `currentUserEmail` is stored in `localStorage` as `ncProfileUserEmail` — used only to match the captain's row in the NC Directory sheet (for the "My NC Profile" view)
5. The bottom-left nav has a "Link your zone spreadsheet" section (label + input + Load button) — hidden when welcome overlay is active, shown once a sheet is loaded — lets the user change the sheet URL after initial setup

### What's wrong with the current flow
- Captains must know/have their sheet URL
- No access control — anyone who signs in can paste any sheet URL and access it
- No multi-zone support
- Sheet URL can get lost if `localStorage` is cleared

### Key variables and functions in index.html (for reference)
| Name | What it is |
|------|-----------|
| `accessToken` | Current Google OAuth2 access token (or `null`) |
| `currentUserEmail` | Signed-in user's email (lowercase), used for NC Profile matching |
| `currentSheetUrl` | Full Google Sheets URL currently loaded |
| `input` | `#sheetUrlInput` element (bottom-left nav URL input) |
| `signIn()` | Triggers Google OAuth popup, fetches user email, calls `updateSignInUI()` |
| `signOut()` | Clears token + email from memory and localStorage |
| `updateSignInUI()` | Toggles sign-in prompt visibility based on `accessToken` |
| `updateWelcomeMessage()` | Shows/hides welcome overlay based on `currentView` and `currentSheetUrl` |
| `updateSheetLinkLabel()` | Updates bottom-left nav label based on `currentSheetUrl` |
| `updateNavigationState()` | Enables/disables nav items based on `currentSheetUrl` |
| `updateHeaderTitle()` | Sets "Zone XX" in top-left nav header |
| `loadAddressData(url)` | Main data load function — fetches sheet data and renders the whole app |
| `extractSheetId(url)` | Parses sheet ID from a full Google Sheets URL |

---

## Design Decisions (already agreed)

### Users-to-sheets mapping
Store a flat JSON file `users.json` at the project root (server-side, never served to client). Format:

```json
{
  "captain.one@email.com": [
    "https://docs.google.com/spreadsheets/d/SHEET_ID_ZONE4/edit"
  ],
  "captain.two@email.com": [
    "https://docs.google.com/spreadsheets/d/SHEET_ID_ZONE4/edit",
    "https://docs.google.com/spreadsheets/d/SHEET_ID_ZONE7/edit"
  ],
  "admin@altagether.org": [
    "https://docs.google.com/spreadsheets/d/SHEET_ID_ZONE1/edit",
    "https://docs.google.com/spreadsheets/d/SHEET_ID_ZONE2/edit"
  ]
}
```

Rules:
- Keys are lowercase email addresses
- Values are arrays of full Google Sheets URLs (what the admin copies from their browser)
- One URL in array → auto-load, no picker
- Multiple URLs → show zone picker after login
- Email not in file → show "not registered" message, no URL paste option
- Admin manages the file by SSH/editor, no admin UI

### No admin UI
No new admin panel, no user type system. The JSON file IS the admin interface.

### Locked-down access
Users can only see sheets they've been explicitly granted. The manual URL paste input is removed from the welcome overlay entirely. The bottom-left nav URL input is also hidden (or removed) since users no longer need to paste URLs.

### Session persistence
After a user selects a zone (or auto-loads their only zone), save the sheet URL to `localStorage` as usual. This means:
- On refresh, if token is still valid AND `localStorage` has a sheet URL → auto-load without re-hitting `/api/user-sheets`
- On token expiry → re-trigger sign-in flow → re-fetch user sheets → auto-load or show picker again

### No new package dependencies
Implement using existing stack: Express, Node.js, vanilla JS.

---

## Architecture

### New server endpoint

```
GET /api/user-sheets?email=<encoded-email>
```

- Reads `users.json` from disk
- Normalizes email to lowercase, looks up in the map
- Returns `{ sheets: [...urls] }` if found
- Returns `{ error: 'not_registered' }` with HTTP 403 if not found
- Returns `{ error: 'no_email' }` with HTTP 400 if email param is missing
- Does NOT require any auth header — the client already validated the Google OAuth token before calling this (by getting the email from `/oauth2/v2/userinfo`). We trust the email comes from a real Google sign-in.

> **Security note:** The endpoint is not authenticated server-side — it's "security by obscurity + good faith." An attacker who knows a captain's email could call the endpoint and learn which sheet IDs they're authorized to use. However, they still cannot access the sheets themselves without the service account credentials. This is acceptable for this use case.

### New client flow (post sign-in)

```
signIn() completes
  → fetch user email from Google
  → call GET /api/user-sheets?email=<email>
  → if 403 (not_registered):
       show "not registered" message in welcome overlay
       do NOT show URL paste step
  → if ok, sheets.length === 1:
       auto-load that sheet URL (same as before)
       hide welcome overlay
  → if ok, sheets.length > 1:
       show zone picker modal/step
       user picks a zone
       load that sheet URL
       hide welcome overlay
```

### Zone picker UI
A simple additional step in the welcome overlay (after Step 1 completes):
- Replace "Step 2: Paste URL" with "Step 2: Choose your zone"
- List of buttons, one per sheet URL, labeled by zone name
- Zone name is derived from the spreadsheet tab title or a name stored in users.json (see Phase 3 below for labeling options)
- After user clicks a zone button → load that sheet

---

## Implementation Phases

---

### PHASE 1 — Backend: users.json + API endpoint
**Goal:** Create the data file and server endpoint. No client changes yet.

- [x] **1.1** Create `users.json` at project root with placeholder entries
  ```json
  {
    "_note": "Map email (lowercase) to array of Google Sheets URLs this user can access.",
    "example.captain@email.com": [
      "https://docs.google.com/spreadsheets/d/REPLACE_WITH_REAL_SHEET_ID/edit"
    ]
  }
  ```
  Note: `_note` key is informational; server should ignore keys starting with `_`.

- [x] **1.2** Add `GET /api/user-sheets` to `server.js`
  - Read `users.json` synchronously at request time (not cached — keeps changes live without restart)
  - Normalize email param to lowercase, strip whitespace
  - Reject missing email with 400
  - Reject unknown email with 403 + `{ error: 'not_registered' }`
  - Return 200 + `{ sheets: [...urls] }` for known email
  - Wrap in try/catch — if `users.json` is missing or malformed, return 500 with a clear message

- [x] **1.3** Add startup validation in `server.js`
  - On server start, attempt to read and JSON-parse `users.json`
  - If file is missing: log a warning (don't crash — server should still start)
  - If file is present but malformed JSON: log an error with the parse error message
  - Log count of registered users on successful load

- [x] **1.4** Add `users.json` to `.gitignore` (it will contain real email addresses)
  - Check if `.gitignore` exists; if not, create it
  - Add the line `users.json`

---

### PHASE 2 — Client: Post-sign-in flow overhaul
**Goal:** After sign-in, call `/api/user-sheets` instead of waiting for URL paste. Handle all three outcomes (1 sheet, multiple sheets, not registered).

The sign-in callback is in `index.html` around line 1191–1227 inside `signIn()`. After fetching the user email, the current code just checks `localStorage` for a saved sheet URL. We're replacing that logic.

- [x] **2.1** After fetching user email in `signIn()` callback, call `/api/user-sheets`
  - Insert after line ~1210 (where `currentUserEmail` is set)
  - Call `await fetchUserSheets(currentUserEmail)`
  - The result drives what happens next (see 2.2–2.4)
  - Do NOT fall back to `localStorage` for the sheet URL at this point — the server is now authoritative

- [x] **2.2** Create `fetchUserSheets(email)` function
  ```js
  async function fetchUserSheets(email) {
    const res = await fetch(`/api/user-sheets?email=${encodeURIComponent(email)}`);
    if (res.status === 403) return { error: 'not_registered', sheets: [] };
    if (!res.ok) return { error: 'server_error', sheets: [] };
    return await res.json(); // { sheets: [...] }
  }
  ```

- [x] **2.3** Handle "not registered" outcome
  - Update `updateWelcomeMessage()` to accept a state parameter, or add a separate `showNotRegisteredMessage()` function
  - Show message in the welcome overlay: "Your email (`currentUserEmail`) is not registered. Contact your Altagether admin to get access."
  - Do NOT show Step 2 (neither URL paste nor zone picker)

- [x] **2.4** Handle "1 sheet" outcome
  - Set `currentSheetUrl` to `sheets[0]`
  - Save to `localStorage` as `savedSheetUrl`
  - Call `loadAddressData(sheets[0])` — same as before
  - Welcome overlay hides automatically (existing logic: `updateWelcomeMessage()` hides overlay when `currentSheetUrl` is set)

- [x] **2.5** Handle "multiple sheets" outcome
  - Store the sheet list in a variable (e.g., `availableSheets`)
  - Show zone picker (see Phase 3)
  - Do not load any sheet until user picks one

- [x] **2.6** On-load: restore from localStorage if token still valid
  - Keep existing behavior: if token valid + `savedSheetUrl` in localStorage → auto-load
  - This avoids hitting `/api/user-sheets` on every page refresh, which is good
  - Token expiry (50 min) will naturally re-trigger sign-in → re-fetch sheets

---

### PHASE 3 — Zone Picker UI
**Goal:** When a user has multiple sheets, show a clean picker in the welcome overlay instead of Step 2.

- [x] **3.1** Replace Step 2 HTML in `welcomeOverlay` with a zone picker step
  - Remove the URL paste input and Load button from the welcome overlay (keep the bottom-left nav input for now — see Phase 4)
  - Add a new `welcomeStep2` variant that shows zone buttons
  - Zone label: use the zone name from `users.json` if we store it there, OR load it dynamically from the sheet metadata. **Simpler approach:** store a display name alongside each URL in users.json.

  **Revised users.json format (with display names):**
  ```json
  {
    "captain@email.com": [
      { "url": "https://docs.google.com/spreadsheets/d/.../edit", "name": "Zone 4 — Highland Park" }
    ],
    "multicaptain@email.com": [
      { "url": "https://docs.google.com/spreadsheets/d/.../edit", "name": "Zone 4 — Highland Park" },
      { "url": "https://docs.google.com/spreadsheets/d/.../edit", "name": "Zone 7 — Altadena West" }
    ]
  }
  ```
  Server returns `{ sheets: [{ url, name }, ...] }`.
  For backward compat: if an entry is a plain string (not an object), treat it as `{ url: entry, name: entry }`.

- [x] **3.2** Build zone picker step HTML dynamically in JS
  - In `updateWelcomeMessage()` or a new `showZonePicker(sheets)` function
  - Render a list of `<button>` elements, one per zone
  - Each button shows `sheet.name` (or a truncated URL if no name)
  - On click: set `currentSheetUrl = sheet.url`, save to localStorage, call `loadAddressData(sheet.url)`, hide overlay

- [x] **3.3** CSS for zone picker buttons
  - Style as a vertical list inside the welcome overlay
  - Match existing button styles from the welcome overlay (`.welcome-load-btn` style)
  - Keep it simple — no need for search/filter at this stage

---

### PHASE 4 — Cleanup: Remove manual URL paste
**Goal:** Remove the "paste your sheet URL" UI from the welcome overlay. Decide what to do with the bottom-left nav URL input.

- [x] **4.1** Remove Step 2 (URL paste) from welcome overlay HTML
  - The `#welcomeStep2` div with `#welcomeSheetUrlInput` and `#welcomeLoadBtn`
  - Remove associated event listeners (they reference `welcomeLoadBtn`, `welcomeSheetUrlInput`)
  - The welcome overlay now only has Step 1 (sign in) and the new zone picker (or not-registered message)

- [x] **4.2** Evaluate bottom-left nav URL input (`#sheetUrlInput`, `#loadSheetBtn`)
  - This is the "Link your zone spreadsheet" section that appears after initial load
  - Options:
    - **Remove entirely** — cleanest; users can't change their sheet (go through admin)
    - **Keep but hide** — still works for dev/testing; just not shown to normal users
    - **Keep as admin override** — show only if the user is in users.json with multiple sheets, as a "switch zone" button
  - **Recommended:** Remove entirely from production. Simplest. If admin needs to test a specific sheet, they can add their email with that sheet to users.json.
  - This section is in the HTML around line 112–119, and the click handler is around line ~5940 and `#loadSheetBtn` event listener

- [x] **4.3** Update `updateWelcomeMessage()` to remove references to Step 2 URL paste elements

- [x] **4.4** Update `updateNavigationState()` — it currently shows/hides `sheetLinkSection`. If we remove that section, update this function accordingly.

- [x] **4.5** Clean up `signIn()` callback — remove the `savedSheetUrl` localStorage fallback that currently auto-loads the sheet after sign-in (replaced by the `/api/user-sheets` call)

---

### PHASE 5 — Testing & Validation
**Goal:** Verify all paths work correctly before pushing.

- [ ] **5.1** Test: unregistered email
  - Sign in with an email NOT in users.json
  - Should see "not registered" message, no zone picker, no URL paste

- [ ] **5.2** Test: single-zone captain
  - Sign in with email that maps to exactly 1 sheet
  - Should auto-load the sheet immediately, welcome overlay hides

- [ ] **5.3** Test: multi-zone captain
  - Sign in with email that maps to 2+ sheets
  - Should see zone picker, clicking a zone loads it

- [ ] **5.4** Test: session restore on refresh
  - Sign in, load a zone, refresh page
  - If token not expired: should auto-load from localStorage without showing welcome overlay
  - If token expired: should show welcome overlay → sign in again → auto-load or show picker

- [ ] **5.5** Test: sign out and sign back in
  - Should clear localStorage sheet URL and re-run the `/api/user-sheets` flow

- [x] **5.6** Test: users.json missing
  - Remove/rename the file, restart server
  - Sign in → should get a clear error, not a crash

- [x] **5.7** Test: users.json malformed
  - Put invalid JSON in the file
  - Sign in → should get a clear error

- [ ] **5.8** Verify existing functionality unaffected
  - NC Profile view (email matching against NC Directory sheet) still works
  - Sheet reads and writes still work
  - All nav views (Map, Neighbors, Actions, Tools, Resources) still work

---

## Files To Create / Modify

| File | Action | Notes |
|------|--------|-------|
| `users.json` | Create | Email → sheet URL mapping. Add to .gitignore |
| `.gitignore` | Create/Edit | Add `users.json` |
| `server.js` | Edit | Add `GET /api/user-sheets` endpoint (~30 lines) + startup validation |
| `index.html` | Edit | Overhaul sign-in callback, welcome overlay HTML, remove URL paste, add zone picker logic |

---

## What NOT To Build
- Admin UI for managing user-sheet mappings
- Server-side session management
- New user roles / permission levels
- Rate limiting on `/api/user-sheets` (not needed at this scale)
- Email verification on the server (we trust Google's OAuth)

---

## Commit & Push Plan
After each phase is complete and passes basic testing:
- Commit with descriptive message, e.g. `"Phase 1: add users.json and /api/user-sheets endpoint"`
- Push to `claude/plan-login-system-k95Rc`

---

## Open Questions (resolved)
- ~~Admin UI or backend-only?~~ **Backend-only** (users.json)
- ~~One URL per user or list?~~ **List**, to support multi-zone captains and admins
- ~~Store sheet IDs or full URLs?~~ **Full URLs** (with optional display names), easiest for admin copy-paste
- ~~Locked down or user can override?~~ **Locked down** — no URL paste, server is authoritative
- ~~What happens on page refresh?~~ **Restore from localStorage** if token still valid, otherwise re-sign-in

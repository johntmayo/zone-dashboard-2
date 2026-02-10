# NC Directory – Handoff Document

**Purpose:** Handoff document for the Neighborhood Captain (NC) Directory feature set. Captures major themes, decisions, implementation state, and open questions for the next developer or stakeholder.

**Last Updated:** February 2025

---

## 1. Executive Summary

The NC Directory is a two-part system:

1. **Standalone NC Directory** (`nc-directory.html`) — A read-only, searchable directory of Neighborhood Captains for finding and connecting with other captains by zone, census tract, water district, working groups, and interest areas.

2. **My NC Profile** (inside the Zone Dashboard `index.html`) — A profile form where captains sign in with Google, find their row by Google email, and edit their own profile. Saves are written to the same NC Directory spreadsheet via the server’s service account.

Both surfaces read from and (in the case of My NC Profile) write to a single Google Sheet: the NC Directory spreadsheet.

---

## 2. Major Themes

### Privacy & Access

- The directory is intended **only for Neighborhood Captains** to coordinate with each other. The intro blurb explicitly asks captains not to share it outside Altagether.
- Captains do **not** need edit access to the spreadsheet. They sign in for identity; the server uses a service account to update rows. See [AUTH_AND_SPREADSHEET_ACCESS.md](AUTH_AND_SPREADSHEET_ACCESS.md).

### Flexibility for Spreadsheet Layout

- The spreadsheet may have columns in different orders or slightly different header names. The code handles this with:
  - **Standalone directory:** `resolveColumnKey()` for the water district column (and any others with alternate names).
  - **My NC Profile save:** Header-based column mapping: we store the sheet’s actual headers on load and write each field to the column that matches, including aliases (e.g. "Census Tract" for "Predominant Census Tract of Zone").

### Multi-Value Columns

- Working Group Participation, Interest Areas, Water Districts in Zone, and Badges support multiple values.
- Stored as comma-separated values; values with commas are quoted (e.g. `Standing homes, "Modular, Prefab, and Factory-Built Homes"`).
- Legacy pipe-separated format is still supported for reading.
- Water district filter shows **individual districts** (e.g. Las Flores, Rubio Canyon, Lincoln Avenue) — not combinations — and matches captains who have *any* of the selected district(s).

### Terminology Choices

- **"dena native"** — Badge text uses lowercase "n" in "native" (not "Dena Native"). Matching is case-insensitive for backward compatibility.
- **"Homeowner"** — Housing Arrangement uses "Homeowner" to match the spreadsheet; "Owner" is mapped to "Homeowner" when loading legacy data.

---

## 3. Architecture & Components

### Files

| File | Purpose |
|------|---------|
| `nc-directory.html` | Standalone directory: search, filters, cards/list views, export modal. No sign-in. |
| `index.html` | Zone Dashboard including My NC Profile view (sign-in, form, save). |
| `server.js` | Express server: `/api/nc-directory` (read), `/api/sheets/batch-update` (write). NC Directory sheet ID via `NC_DIRECTORY_SHEET_ID` or env. |

### API Endpoints

- **GET `/api/nc-directory`** — Returns `{ headers, rows }` from Sheet1. Uses public CSV export; sheet must be "Anyone with the link can view."
- **POST `/api/sheets/batch-update`** — Writes values to a sheet. Used by My NC Profile with the service account. Requires `sheetId`, `valueInputOption`, and `data` (array of `{ range, values }`).

### Hosting

- **directory.altagether.org** — Vercel rewrites `/` to `/nc-directory.html` (standalone directory).
- **Main dashboard** — Served from the same app; NC Directory link lives under Resources. My NC Profile is a nav item in the dashboard.

---

## 4. Key Decisions

### Read vs Write Access

- **Read (standalone directory):** Public CSV export. Sheet must be "Anyone with the link can view."
- **Write (My NC Profile):** Service account via Sheets API. Sheet must be shared with the service account as Editor.

### Identity for Profile Matching

- My NC Profile matches rows by **Google email** (case-insensitive). Captains must sign in with the Google account that corresponds to their row’s "Google email" column.

### Column Mapping for Saves

- My NC Profile uses the **actual headers** returned from the sheet on load.
- Each field is written to the column whose header matches (with aliases for common variants). This avoids wrong mappings when column order differs from the expected layout.

### Badge Styling

- Special badges: 1 Year of Service (gold ★), Working Group Chair (blue ◆), Newsletter (green ✉), dena native (earth-toned ✦).
- Styling is driven by exact or case-insensitive badge text in the Badges column.

---

## 5. Data Model & Spreadsheet

### Spreadsheet

- **Sheet ID:** `1E77qmT4eGtyokaDvD2wlK3q2NeMcS4itmkbYp6Rz0qM`
- **Tab:** Sheet1 (leftmost)
- **Row 1:** Headers

### Expected Columns (A–P)

| Column | Header | Type | Notes |
|--------|--------|------|-------|
| A | Name | Text | |
| B | Zone | Text | |
| C | Location | Text | Descriptive location |
| D | Predominant Census Tract of Zone | Select | CT 4601, CT 4602, etc. |
| E | Phone | Text | Normalized for display |
| F | Preferred email | Text | |
| G | Working Group Participation | Multi-select | Comma-separated |
| H | Housing Arrangement | Select | Renter, Homeowner, RV, Other |
| I | Damage to home | Select | Standing home, Partial loss, Total loss |
| J | Notes/Bio | Text | |
| K | Interest Areas | Multi-select | Comma-separated |
| L | Expertise (Ask Me About...) | Text | |
| M | Languages Spoken | Text | |
| N | Google email | Text | Used for My NC Profile matching |
| O | Water Districts in Zone | Multi-select | Comma-separated |
| P | Badges | Multi-select | e.g. 1 Year of Service, dena native |

See [NC_DIRECTORY_SETUP.md](NC_DIRECTORY_SETUP.md) for setup and sharing.

---

## 6. Features Implemented

### Standalone NC Directory (`nc-directory.html`)

- Search across name, zone, skills, interests, etc.
- Filters: Zone, Census tract, Water district (individual values, OR logic)
- Working groups filter: Chips; multi-select
- Interest areas filter: Accordion with checkboxes; multi-select
- Cards view: Name, zone·census tract, location, email (with copy), phone, bio, notes, Ask me about…, Working groups, Interest areas, badges
- List/table view: Name, Zone, Phone, Email
- Export modal (List view): Active filters summary, Copy emails, Download CSV (Name, Zone, Phone, Email)
- Per-card email copy button
- Gold intro blurb with privacy note
- Link to spreadsheet for manual edits
- Link to working groups form

### My NC Profile (Zone Dashboard)

- Sign-in with Google
- Match row by Google email
- Form fields for all profile columns except Google email (read-only for matching)
- Multi-select checkboxes for Working Groups and Interest Areas
- "I'm a dena native" checkbox (adds/removes dena native badge)
- Header-based save (writes each field to the correct column)
- Alias support (e.g. "Owner" → "Homeowner", "Census Tract" → "Predominant Census Tract of Zone")

---

## 7. Known Issues / Edge Cases

- **Water district column naming:** Several header variants are supported (`Water Districts in Zone`, `Water District`, etc.). If the spreadsheet uses a different name, `resolveColumnKey()` may need an update.
- **Expertise column:** NC Profile form uses "Expertise (Ask Me About...)". The standalone directory also references a `Skills & Expertise` / `EXPERTISE_ASK_ME_KEY` style field — confirm which column name the spreadsheet uses.
- **CSV export:** NC Directory reads via public CSV. If the sheet is restricted, the endpoint will fail until reads are switched to the service account.

---

## 8. Open Questions

1. **Lock down NC Directory reads:** Should `/api/nc-directory` be changed to use the service account so the sheet can stay restricted (no "Anyone with the link can view")?

2. **Water district on cards:** Should water district(s) be shown on captain cards (e.g. with a water droplet icon)? Currently it is only used for filtering.

3. **Badge management:** Badges like "1 Year of Service", "Working Group Chair", "Newsletter" appear to be admin-managed. Is there a process for adding/removing them, or will that stay manual in the sheet?

4. **Lincoln Avenue naming:** Options use "Lincoln Avenue" for water district; elsewhere "Lincoln Avenue Water Group" is mentioned. Confirm the canonical value for the spreadsheet.

5. **Skills vs Expertise:** The directory uses `SKILLS_KEY = 'Skills & Expertise'` and `EXPERTISE_ASK_ME_KEY = 'Expertise (Ask Me About...)'`. Clarify whether these map to one or two columns and align spreadsheet headers.

---

## 9. Current State

### What Works

- Standalone directory: search, filters, cards, list, export
- My NC Profile: load by Google email, edit, save to correct columns
- Header-based column mapping for saves
- Multi-value parsing (comma and pipe)
- Badge display and styling
- Water district filter (individual values, OR logic)

### Deployment Notes

- NC Directory sheet must be shared with the service account as Editor.
- For `/api/nc-directory`, sheet must be "Anyone with the link can view" (unless reads are migrated to the service account).
- `flyer_tool.html` has an explicit route in `server.js` so it is not served as the SPA fallback.

---

## 10. Related Documentation

- [NC_DIRECTORY_SETUP.md](NC_DIRECTORY_SETUP.md) — Setup, spreadsheet structure, sharing
- [AUTH_AND_SPREADSHEET_ACCESS.md](AUTH_AND_SPREADSHEET_ACCESS.md) — Sign-in and spreadsheet access model
- [SERVICE_ACCOUNT_SETUP.md](SERVICE_ACCOUNT_SETUP.md) — Service account configuration
- [PLATFORM_OVERVIEW.md](PLATFORM_OVERVIEW.md) — Full platform feature overview

---

## 11. Technical Reference

### Key Constants (nc-directory.html)

- `NC_DIRECTORY_SHEET_ID` — In server; env `NC_DIRECTORY_SHEET_ID` overrides
- `WATER_DISTRICT_CANDIDATES` — Alternate header names for water district
- `KNOWN_WATER_DISTRICTS` — Used by `resolveColumnKey()` for fallback detection

### Key Constants (index.html – My NC Profile)

- `NC_PROFILE_HEADERS` — Expected column order (used when header-based mapping falls back)
- `NC_PROFILE_OPTIONS` — Select options for dropdowns and checkboxes
- `ncProfileHeaders` — Stored on load; used for header-based save
- `ncProfileRowIndex` — 1-based row number for the current user
- `ncProfileRowData` — Cached row data for the current user

### Multi-Select Format

- **Write:** Comma-separated; values with commas wrapped in quotes; internal quotes escaped as `""`
- **Read:** Supports comma-separated (with quoted segments) and legacy pipe-separated

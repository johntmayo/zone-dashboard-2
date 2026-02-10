# NC Directory & My NC Profile – Setup

## Spreadsheet

- **Sheet ID:** `1E77qmT4eGtyokaDvD2wlK3q2NeMcS4itmkbYp6Rz0qM`
- **Tab used:** `Sheet1` (leftmost sheet). Other tabs are ignored.
- **Row 1:** Headers. Columns A–P: Name, Zone, Location, Predominant Census Tract of Zone, Phone, Preferred email, Working Group Participation, Housing Arrangement, Damage to home, Notes/Bio, Interest Areas, Expertise (Ask Me About...), Languages Spoken, Google email, Water Districts in Zone, Badges.
- **Multi-value columns** (Working Group Participation, Interest Areas, Badges): store multiple values comma-separated; values that contain commas are quoted (e.g. `Standing homes, "Modular, Prefab, and Factory-Built Homes"`). The nc-directory also accepts legacy pipe-separated format for reading.

## Sharing settings for the NC Directory Google Sheet

**Current implementation:** All reads and writes (including **My NC Profile** saves) go through the server using a **service account**. Captains do **not** need edit access to the sheet with their personal Google account. They sign in for identity only; the server uses the service account to update the matching row.

1. **Share the NC Directory spreadsheet with the service account** (the same one used for zone sheets) as **Editor**. See [SERVICE_ACCOUNT_SETUP.md](SERVICE_ACCOUNT_SETUP.md).
2. **Standalone directory (read-only):** The server's `GET /api/nc-directory` currently uses public CSV export, so the sheet must be **"Anyone with the link can view"** for that endpoint to work. The sheet must also be shared with the service account (see above) so **My NC Profile** saves work.
3. **Optional – locked down later:** The code could be changed so `/api/nc-directory` reads via the service account instead of public CSV; then the sheet could stay restricted and only the service account would need access.

You do **not** need to share the NC Directory sheet with each captain's Google account, or use "Anyone with the link can edit." See [AUTH_AND_SPREADSHEET_ACCESS.md](AUTH_AND_SPREADSHEET_ACCESS.md) for the full access model.

## App pieces

- **Standalone directory:** Open `nc-directory.html` from the same origin as the server (e.g. `http://localhost:8000/nc-directory.html`). It calls `GET /api/nc-directory` to load data. No sign-in.
- **My NC Profile (dashboard):** In the Zone Dashboard, click **My NC Profile**. Sign in with Google. The app finds the row where **Google email** equals your account and shows the form. Save updates only that row via the Sheets API (server uses the service account).

## Server

- NC Directory sheet ID is in `server.js` as `NC_DIRECTORY_SHEET_ID` (or env `NC_DIRECTORY_SHEET_ID`).
- Route `GET /api/nc-directory` returns `{ headers, rows }` from Sheet1. It uses public CSV export, so the sheet must be "Anyone with the link can view". For **My NC Profile** writes, the sheet must also be shared with the service account as Editor.

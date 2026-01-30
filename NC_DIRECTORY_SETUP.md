# NC Directory & My NC Profile – Setup

## Spreadsheet

- **Sheet ID:** `1E77qmT4eGtyokaDvD2wlK3q2NeMcS4itmkbYp6Rz0qM`
- **Tab used:** `Sheet1` (leftmost sheet). Other tabs are ignored.
- **Row 1:** Headers. Cell A1 = **Name**. Columns A–N: Name, Zone, Predominant Census Tract of Zone, Phone, Preferred email, Working Group Participation, Housing Arrangement, Damage to home, Interest Areas, Skills & Expertise, Languages Spoken, Google email, Water District, Badges.
- **Multi-value columns** (Working Group Participation, Interest Areas, Badges): store multiple values in one cell separated by a pipe `|` (e.g. `Trees | Housing | Outreach`).

## Sharing settings for the NC Directory Google Sheet

### Option A – Simple (recommended to start)

1. **Directory (read-only) and Profile (captains edit their row)**  
   - Set the spreadsheet to **“Anyone with the link can view”** so the standalone directory site and server can read it.  
   - For **Profile** (captains editing their own row from the Zone Dashboard), those edits use the captain’s Google account. So the sheet must also allow **edits** by those accounts.  
   - Easiest: set sharing to **“Anyone with the link can edit”**.  
   - The app only updates the row where **Google email** matches the signed-in user; it does not touch other rows. (Anyone with the link could still edit the sheet outside the app.)

2. **If you prefer not to use “Anyone with the link can edit”**  
   - Share the sheet with a **Google Group** (or list of emails) that includes all Neighborhood Captains, with **Editor** access.  
   - Then only those people can open and edit; the directory site can still read if the sheet is also set to “Anyone with the link can view,” or you serve data via the server (see Option B).

### Option B – Locked down (optional later)

- Keep the sheet **restricted** (no “Anyone with the link”).
- Use a **backend (Node) with a service account** that has edit access to the sheet.
- Directory: server reads the sheet and serves data to the standalone directory page.
- Profile: captain signs in; server verifies their email and updates **only** the matching row. Captains never get direct edit access to the sheet.

For the current implementation, **Option A with “Anyone with the link can view”** is enough for the **standalone NC Directory** page (read-only). For **My NC Profile** in the dashboard (captains editing their row), the sheet must be editable by those users: use **“Anyone with the link can edit”** or share with the captains group as Editor.

## App pieces

- **Standalone directory:** Open `nc-directory.html` from the same origin as the server (e.g. `http://localhost:8000/nc-directory.html`). It calls `GET /api/nc-directory` to load data. No sign-in.
- **My NC Profile (dashboard):** In the Zone Dashboard, click **My NC Profile**. Sign in with Google. The app finds the row where **Google email** equals your account and shows the form. Save updates only that row via the Sheets API.

## Server

- NC Directory sheet ID is in `server.js` as `NC_DIRECTORY_SHEET_ID` (or env `NC_DIRECTORY_SHEET_ID`).
- Route `GET /api/nc-directory` returns `{ headers, rows }` from Sheet1. The sheet must be readable (e.g. “Anyone with the link can view”) for this to work without credentials.

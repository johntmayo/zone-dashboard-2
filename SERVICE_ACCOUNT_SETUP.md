# Google Sheets Service Account Setup

The Dashboard uses a **single Google Cloud Service Account** for all read/write access to Google Sheets. Users still sign in with their personal Google account for identity (e.g. NC Profile row matching), but all Sheets API calls are proxied through the server using this service account.

## 1. Create the service account

1. Go to [Google Cloud Console](https://console.cloud.google.com/) and select (or create) a project.
2. Enable the **Google Sheets API**: APIs & Services → Library → search "Google Sheets API" → Enable.
3. Create a service account: APIs & Services → Credentials → Create Credentials → Service Account.
4. Give it a name (e.g. "Zone Dashboard") and optionally a description. Continue and finish.
5. Open the new service account → Keys → Add Key → Create new key → **JSON**. Download the key file.

The JSON file contains a `client_email` (e.g. `dashboard@my-project.iam.gserviceaccount.com`). You will share all relevant Google Sheets with this email.

## 2. Store credentials on the server

**Option A – Environment variable (recommended for Vercel, Railway, etc.)**

Set `GOOGLE_SERVICE_ACCOUNT_JSON` to the **entire contents** of the JSON key file (as a single string). In most hosts you paste the JSON; some allow uploading a file that is then exposed as an env var.

- **Vercel:** Project → Settings → Environment Variables → add `GOOGLE_SERVICE_ACCOUNT_JSON`, paste the JSON (or use a secret).
- **Local:** In a `.env` file (do not commit):  
  `GOOGLE_SERVICE_ACCOUNT_JSON='{"type":"service_account",...}'`

**Option B – Key file path (local development only)**

1. Save the JSON key file somewhere safe (e.g. `./secrets/google-service-account.json`).
2. Set the environment variable:  
   `GOOGLE_APPLICATION_CREDENTIALS=/absolute/path/to/google-service-account.json`  
   (or the path relative to where you run `node`.)
3. Add the path (or `secrets/`) to `.gitignore` so the key is never committed.

The server will use Option A if `GOOGLE_SERVICE_ACCOUNT_JSON` is set; otherwise it will use Option B if `GOOGLE_APPLICATION_CREDENTIALS` is set.

## 3. Share Google Sheets with the service account

The service account must have **Editor** access to every spreadsheet the app reads or writes:

- **Fixed Dashboard sheets** (already configured via env in `server.js`):  
  Central announcements, Actions feed, NC Directory. Share each with the service account email.
- **Zone spreadsheets**: Any spreadsheet a user can “load” in the Dashboard (zone data, Zone Notes, etc.) must also be shared with the service account email. Document this for zone captains: when creating a new zone sheet, share it with the same service account email used for the Dashboard.

To share: open the sheet → Share → add the `client_email` from the JSON (e.g. `dashboard@my-project.iam.gserviceaccount.com`) as **Editor**.

## 4. No admin login or OAuth flow

There is no browser-based “admin auth” step. Setup is:

1. Create the service account and download the JSON key.
2. Set `GOOGLE_SERVICE_ACCOUNT_JSON` (or `GOOGLE_APPLICATION_CREDENTIALS`) in the server environment.
3. Share all relevant sheets with the service account email.

## 5. Security

- **Never** commit the JSON key or put it in client-side code. Keep it only in server env vars or a secrets manager.
- The server does not store or log the key. Restrict who can edit environment variables in your hosting platform.
- Sheet access is controlled by Google Drive sharing: only sheets explicitly shared with the service account email can be read or written.

## 6. Deploy (e.g. Vercel)

1. Set `GOOGLE_SERVICE_ACCOUNT_JSON` in the project’s Environment Variables (paste the full JSON string).
2. Ensure the **Build Command** does not require the Sheets API (no special build step for this).
3. **Root Directory / Output:** Same as before; the server runs `node server.js` and serves static files.
4. If you use serverless (e.g. Vercel serverless functions), ensure `server.js` (or your entry) gets the env var at runtime.

## 7. Testing

1. **Local**
   - Set `GOOGLE_SERVICE_ACCOUNT_JSON` or `GOOGLE_APPLICATION_CREDENTIALS`.
   - Share a test spreadsheet with the service account email.
   - Run `npm start`, open the app, sign in with your Google account, and load that spreadsheet.
   - Confirm you can read data, edit details, append rows, save Zone Notes, and use NC Profile (if using the NC Directory sheet).

2. **After deploy**
   - Confirm the same env var is set in the hosted environment.
   - Confirm all required sheets (central, actions, NC directory, and at least one zone sheet) are shared with the service account email.
   - Run through the same flows (load sheet, edit, append, Zone Notes, NC Profile) against the deployed URL.

## Troubleshooting

- **403 / Permission denied**: The spreadsheet is not shared with the service account email. Add the `client_email` from the JSON as Editor.
- **Missing GOOGLE_SERVICE_ACCOUNT_JSON**: The server will return 500 for `/api/sheets/*` and log that the env var is missing. Set it (or `GOOGLE_APPLICATION_CREDENTIALS`) and restart.
- **Invalid JSON**: If you paste the key, ensure the whole JSON is one string (no truncation) and that special characters are escaped if required by your host’s env var rules.

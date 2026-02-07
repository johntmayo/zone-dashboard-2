# Home Dashboard Setup Instructions

## Overview

The Home Dashboard has been successfully added to the Neighborhood Dashboard. After a captain loads or reconnects their spreadsheet, they will now see a **Home Dashboard** screen with three panels:

1. **Zone Snapshot** - Stats from the captain's own spreadsheet (households, people, damage status, contact status, last updated)
2. **Rebuild Progress Snapshot** - Rebuild stage breakdown from the captain's spreadsheet
3. **From Altagether** - Organization-wide announcements from a central Google Sheet

## Backend Server Setup

### Prerequisites

- Node.js (v14 or higher recommended)
- npm (comes with Node.js)

### Installation

1. Install dependencies:
```bash
npm install
```

### Running the Server

Start the backend server:
```bash
npm start
```

Or for development with auto-reload:
```bash
npm run dev
```

The server will start on `http://localhost:8000` (or the port specified in the PORT environment variable).

### Backend Configuration

**Google Sheets (service account)**  
All Sheets read/write (zone data, NC Profile, Zone Notes, append, batch updates) go through the server using a single **Google Cloud Service Account**. You must:

1. Create a service account and set `GOOGLE_SERVICE_ACCOUNT_JSON` (or `GOOGLE_APPLICATION_CREDENTIALS`) in the server environment.
2. Share every spreadsheet the app uses (central feed, actions feed, NC directory, and each zone spreadsheet) with the service account email as **Editor**.

See **[SERVICE_ACCOUNT_SETUP.md](SERVICE_ACCOUNT_SETUP.md)** for step-by-step creation, credential storage, sheet sharing, deploy, and testing.

**Homepage feed (public CSV fallback)**  
The route `/api/homepage-feed` can still read from a central Google Sheet via public CSV if the sheet is "Anyone with link can view":
- **Sheet ID**: `1PaqcX2BSypJjLBDMA3DnlAxCHK5y0TWMSbCIkTScIQU`
- **Sheet Name**: "Zone Dashboard Homepage Backend"

The backend expects the sheet to have this structure:
- Column A: Labels (Announcements, Next Meeting, Newsletter, Volunteer Asks, Partner Items)
- Column B: Content/Descriptions
- Additional columns: Optional (date, time, location, URLs)

## Frontend Changes

### Navigation

- **Home** is now the first navigation item and the default landing page
- The **Map** view is accessible via:
  - Navigation menu: Click "Map"
  - Home Dashboard: Click the "🗺️ Open Map" button

### Data Flow

- All zone data processing remains **100% client-side**
- No captain zone data is stored on the server
- The central announcements feed is fetched from the backend API on page load

### View Behavior

- When a captain loads/reconnects their spreadsheet, they land on the **Home Dashboard**
- The map remains fully functional and accessible
- All existing features (table view, zone progress, etc.) are unchanged

## Testing

1. Start the backend server: `npm start`
2. Open `index.html` in a browser (or serve via the backend at `http://localhost:8000`)
3. Load a captain's spreadsheet
4. Verify the Home Dashboard displays:
   - Zone stats in Panel A
   - Rebuild progress in Panel B
   - Central announcements in Panel C (if backend is running)
5. Click "Open Map" to verify map view works
6. Navigate between views to ensure all functionality works

## Troubleshooting

### Backend Issues

- **Port already in use**: Change the PORT environment variable or stop other services (default 8000)
- **Sheet access denied / 403 on `/api/sheets/*`**: Ensure each spreadsheet is shared with the service account email (see [SERVICE_ACCOUNT_SETUP.md](SERVICE_ACCOUNT_SETUP.md)).
- **Missing credentials**: Set `GOOGLE_SERVICE_ACCOUNT_JSON` or `GOOGLE_APPLICATION_CREDENTIALS` so the server can call the Sheets API.
- **Central feed / CSV**: For the homepage feed, the central sheet can be "Anyone with link can view" for unauthenticated CSV; otherwise use the service account and share that sheet too.
- **CSV parsing errors**: Check the sheet structure matches the expected format

### Frontend Issues

- **Home dashboard shows "Loading..."**: Check browser console for errors, ensure spreadsheet is loaded
- **No announcements shown**: Verify backend server is running and `/api/homepage-feed` returns data
- **Map not showing**: Check that you've navigated to Map view (click "Map" or "Open Map" button)

## Mapbox Zone Boundaries (Optional)

Zone boundaries can be loaded directly from a **Mapbox dataset** instead of per-spreadsheet KML URLs. This removes the manual KML export/upload workflow.

### Setup

1. **Mapbox account**: You need a Mapbox account and a dataset containing zone polygons. Each feature should have a property **ZoneName** (or "Zone name") matching the zone name in your spreadsheets (e.g. "Zone 55", "Zone 61").
2. **Access token**: Create a Mapbox [access token](https://account.mapbox.com/access-tokens/) with the **`datasets:read`** scope (no write scopes needed).
3. **Config in the app**: In `index.html`, find the `MAPBOX_CONFIG` object (near the top of the main script) and set:
   - **username**: Your Mapbox account username (from Studio URL or account settings).
   - **datasetId**: The dataset ID that contains all zone polygons (from Mapbox Studio → Datasets → copy ID).
   - **accessToken**: Your token with `datasets:read`.

Leave any value empty to disable Mapbox; the app will fall back to the Zone Notes "KML URL" if present.

### Behavior

- When a spreadsheet is loaded, the app reads **currentZoneName** from the data (ZoneName column). It then fetches the Mapbox dataset, finds the feature whose `ZoneName` (or "Zone name") matches, and draws that polygon on the zone map and home map.
- If Mapbox is not configured or no matching zone is found, the app uses the **KML URL** from the Zone Notes sheet as before.

### Security

- The token is used in the browser to call the Mapbox Datasets API. Use a token with **only** `datasets:read` so it cannot modify data. For stricter security, you can proxy the API through your backend (`server.js`) and keep a secret token on the server.

## Future Enhancements

The home dashboard is designed to be easily extensible. Additional panels can be added by:
1. Adding a new panel HTML structure in `homeView`
2. Adding CSS styling for the new panel
3. Adding a JavaScript function to compute/display panel data
4. Calling the function from `updateHomeDashboard()`


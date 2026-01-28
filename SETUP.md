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

The server will start on `http://localhost:3000` (or the port specified in the PORT environment variable).

### Backend Configuration

The backend API route `/api/homepage-feed` reads from a central Google Sheet:
- **Sheet ID**: `1PaqcX2BSypJjLBDMA3DnlAxCHK5y0TWMSbCIkTScIQU`
- **Sheet Name**: "Zone Dashboard Homepage Backend"
- **Access**: Set to "Anyone with link can view"

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
2. Open `index.html` in a browser (or serve via the backend at `http://localhost:3000`)
3. Load a captain's spreadsheet
4. Verify the Home Dashboard displays:
   - Zone stats in Panel A
   - Rebuild progress in Panel B
   - Central announcements in Panel C (if backend is running)
5. Click "Open Map" to verify map view works
6. Navigate between views to ensure all functionality works

## Troubleshooting

### Backend Issues

- **Port already in use**: Change the PORT environment variable or stop other services on port 3000
- **Sheet access denied**: Ensure the central Google Sheet is set to "Anyone with link can view"
- **CSV parsing errors**: Check the sheet structure matches the expected format

### Frontend Issues

- **Home dashboard shows "Loading..."**: Check browser console for errors, ensure spreadsheet is loaded
- **No announcements shown**: Verify backend server is running and `/api/homepage-feed` returns data
- **Map not showing**: Check that you've navigated to Map view (click "Map" or "Open Map" button)

## Future Enhancements

The home dashboard is designed to be easily extensible. Additional panels can be added by:
1. Adding a new panel HTML structure in `homeView`
2. Adding CSS styling for the new panel
3. Adding a JavaScript function to compute/display panel data
4. Calling the function from `updateHomeDashboard()`


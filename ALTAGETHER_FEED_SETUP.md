# Setting Up the "From Altagether" Feed

The "From Altagether" section displays content from a central Google Sheets spreadsheet. Here's how to set it up:

## Step 1: Get Your Spreadsheet ID

1. Open your Google Sheets spreadsheet
2. Look at the URL in your browser. It will look like:
   ```
   https://docs.google.com/spreadsheets/d/YOUR_SHEET_ID_HERE/edit
   ```
3. Copy the `YOUR_SHEET_ID_HERE` part (the long string of letters and numbers)

## Step 2: Update server.js

Open `server.js` and find this line (around line 16):
```javascript
const CENTRAL_SHEET_ID = process.env.CENTRAL_SHEET_ID || '1PaqcX2BSypJjLBDMA3DnlAxCHK5y0TWMSbCIkTScIQU';
```

Replace the default ID (or set the `CENTRAL_SHEET_ID` environment variable) with your spreadsheet ID:
```javascript
const CENTRAL_SHEET_ID = process.env.CENTRAL_SHEET_ID || 'YOUR_SHEET_ID_HERE';
```

## Step 3: Make Your Spreadsheet Public

1. In Google Sheets, click the "Share" button (top right)
2. Click "Change to anyone with the link"
3. Set permission to "Viewer"
4. Click "Done"

## Step 4: Format Your Spreadsheet

Your spreadsheet should have this structure:

| Column A (Label) | Column B (Content/Title) | Column C (Optional) | Column D (Optional) | Column E (Optional) |
|-----------------|------------------------|-------------------|-------------------|-------------------|
| Next Meeting | Meeting description | Date | Time | Location |
| Newsletter | Newsletter title | URL | | |
| Volunteer | Volunteer opportunity title | Description | URL | |
| Partner | Partner item title | Description | URL | |

### Details:

**Next Meeting:**
- Column A: "Next Meeting" (or any text containing "meeting")
- Column B: Meeting description
- Column C: Date (optional)
- Column D: Time (optional)
- Column E: Location (optional)

**Newsletter:**
- Column A: "Newsletter" (or any text containing "newsletter")
- Column B: Newsletter title
- Column C: URL to newsletter (optional)

**Volunteer Opportunities:**
- Column A: "Volunteer" (or any text containing "volunteer")
- Column B: Opportunity title
- Column C: Description (optional)
- Column D: URL (optional)
- You can have multiple volunteer rows - each will be displayed

**Partner Items:**
- Column A: "Partner" (or any text containing "partner")
- Column B: Item title
- Column C: Description (optional)
- Column D: URL (optional)
- You can have multiple partner rows - each will be displayed

## Step 5: Restart the Server

After updating `server.js`, restart your server:
```bash
node server.js
```

The "From Altagether" section should now display content from your spreadsheet!


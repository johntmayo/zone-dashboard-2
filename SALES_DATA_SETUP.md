# Central Sales Data Setup

Property sales are read from the maintained Altagether sales tracker and displayed read-only in the dashboard. Records are matched to zone and master-sheet properties by APN digits; punctuation in the identifier does not matter.

## Server configuration

Set these environment variables:

- `SALES_SOURCE_SHEET_ID` — optional override for the Google spreadsheet ID. The maintained tracker (`10DlHR_AblJPPtnO341WOKyJYJhCHa61UZ2-6whANGwg`) is the default. `SALES_SOURCE_SHEET_URL` is also accepted.
- `SALES_SOURCE_SHEET_NAME` — optional tab override. Defaults to `Sales Rollup by APN`.
- `SALES_SOURCE_RANGE` — optional range; defaults to `A1:ZZ5000`.
- `SALES_CACHE_TTL_MS` — optional server cache duration; defaults to `300000` (five minutes).

Share the source spreadsheet with the dashboard service account as Viewer. Editor access is not required because the sales route has no write endpoint.

## Source columns

The dashboard reads the `Sales Rollup by APN` tab, not the individual `Sales Events` tab. Its first row must contain headers. The required match field is `APN`; malformed values that do not normalize to exactly 10 digits are excluded from the dashboard feed.

- `APN`
- `Address - Sold Since Fire`
- `Latest Sale Date`
- `Latest Sale Price`
- `Latest New Owner`
- `Sales History`

`Address`, `Lot SqFt`, `Sale Count`, `Latitude`, and `Longitude` may remain in the tracker but are not used as dashboard property data. Map coordinates continue to come exclusively from each captain spreadsheet.

The rollup formula is responsible for selecting the newest event for the `Latest` fields and combining all events, newest-first, into the multiline `Sales History` field. The dashboard does not recompute that rollup.

## Dashboard behavior

- Sales fields in Neighborhood Captain and master spreadsheets are ignored.
- Sale details, SOLD badges, sold map labels, filters, and Admin Mode counts use the central source.
- If the source is not configured or temporarily unavailable, sales information is omitted; the app does not fall back to spreadsheet-embedded sales columns.

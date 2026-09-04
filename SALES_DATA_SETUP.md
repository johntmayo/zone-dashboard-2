# Central Sales Data Setup

Property sales are read from one Google spreadsheet and displayed read-only in the dashboard. Records are matched to zone and master-sheet properties by EPN/APN digits; punctuation in the identifier does not matter.

## Server configuration

Set these environment variables:

- `SALES_SOURCE_SHEET_ID` — the Google spreadsheet ID. `SALES_SOURCE_SHEET_URL` is also accepted.
- `SALES_SOURCE_SHEET_NAME` — optional tab name. If omitted, the first tab is read.
- `SALES_SOURCE_RANGE` — optional range; defaults to `A1:ZZ5000`.
- `SALES_CACHE_TTL_MS` — optional server cache duration; defaults to `30000`.

Share the source spreadsheet with the dashboard service account as Viewer. Editor access is not required because the sales route has no write endpoint.

## Source columns

The first row must contain headers. The only required field is an EPN/APN identifier. Recognized names include:

- Identifier: `EPN`, `EPN Number`, `APN`, `AIN`, `Parcel Number`
- Date: `Sale Date`, `Sold Date`, `Recording Date`
- Price: `Sale Price`, `Sold Price`, `Purchase Price`
- Buyer: `Buyer`, `Buyer Name`, `New Owner`, `Grantee`
- Lot size: `Lot SqFt`, `Lot Sq Ft`, `Lot Size`
- History: `Sales History`, `Sale History`
- Notes: `Sale Notes`, `Notes`, `Comments`
- Optional status: `Sold Since Fire`, `Address - Sold Since Fire`

When the optional status column is absent, every row in the curated source is treated as a post-fire sale. When it is present, only truthy values (`TRUE`, `Yes`, `1`, `X`, or `Sold`) count toward the Sold Since Fire filter and badge.

Multiple rows may use the same EPN. The dashboard shows them newest-first and uses the newest row for the summary fields.

## Dashboard behavior

- Sales fields in Neighborhood Captain and master spreadsheets are ignored.
- Sale details, SOLD badges, sold map labels, filters, and Admin Mode counts use the central source.
- If the source is not configured or temporarily unavailable, sales information is omitted; the app does not fall back to spreadsheet-embedded sales columns.

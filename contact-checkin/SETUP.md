# Contact Check-In setup

## Progress sheet (Address Reviews)

Spreadsheet ID (launch default in code):

`1sOWW-OWC4WY8ZMk75jcT9VXFn6LkTSO65EftqJpLOpc`

Tab name: `AddressReviews`

Headers (row 1):

```text
review_key
check_in_id
address_id
zone_id
captain_id
review_status
answer
reviewed_at
updated_at
```

Share the sheet with the dashboard Google service account (Editor).

## Environment variables

Optional overrides (Vercel / local env):

```ini
CONTACT_CHECKIN_SHEET_ID=1sOWW-OWC4WY8ZMk75jcT9VXFn6LkTSO65EftqJpLOpc
CONTACT_CHECKIN_SHEET_NAME=AddressReviews
CONTACT_CHECKIN_CHECK_IN_ID=contact_check_in_2026
CONTACT_CHECKIN_CACHE_TTL_MS=15000
```

If unset, the server uses the launch defaults above.

## Zone sheet columns required

1. `address_id` — seeded from master; used as Check-In progress key
2. `Successfully Contacted` — checkbox / TRUE-FALSE person-level field

## API

- `GET /api/contact-checkin/config`
- `GET /api/contact-checkin/reviews?zone_id=&captain_id=&check_in_id=&total_addresses=`
- `POST /api/contact-checkin/review` — upsert AddressReview row

Person-level writes (Successfully Contacted, outreach, notes) go through existing zone-sheet update endpoints.

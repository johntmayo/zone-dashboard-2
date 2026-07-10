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
CONTACT_CHECKIN_HOME_ENABLED=false
```

If unset, the server uses the launch defaults above.

### Homepage launch gate

Contact Check-In + Community Feed on Home stay **hidden** until you turn them on. Either:

1. Set `CONTACT_CHECKIN_HOME_ENABLED=true` in Vercel (and redeploy / restart), **or**
2. Flip `CONTACT_CHECKIN_HOME_ENABLED` to `true` near the top of `index.html` and deploy

Either one is enough. Leave both false to ship the feature code without showing captains the cards yet.

## Zone sheet columns required

1. `address_id` — seeded from master; used as Check-In progress key
2. `Successfully Contacted` — checkbox / TRUE-FALSE person-level field

## API

- `GET /api/contact-checkin/config`
- `GET /api/contact-checkin/reviews?zone_id=&captain_id=&check_in_id=&total_addresses=`
- `POST /api/contact-checkin/review` — upsert AddressReview row

Person-level writes (Successfully Contacted, outreach, notes) go through existing zone-sheet update endpoints.

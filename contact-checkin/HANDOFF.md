# Contact Check-In — Agent Handoff

**Date:** July 10, 2026  
**Owner / product:** John (non-developer; explain plainly; you are the developer)  
**Goal:** Finish / harden Contact Check-In MVP and related `address_id` work without redesigning the product.

---

## Read these first (in order)

1. **This file** — current engineering state + next work  
2. `contact-checkin/SPEC.md` — locked product decisions (source of truth for behavior)  
3. `contact-checkin/prototype.html` — locked UX / copy / layout  
4. `contact-checkin/SETUP.md` — sheet IDs, env vars, columns  
5. `contact-checkin/STATUS.md` — short checklist (may lag; prefer this handoff if conflict)

Do **not** reopen product design unless John asks. Spec + prototype are final for MVP.

---

## What this feature is (one paragraph)

Neighborhood Captains walk through their zone **one address at a time** and answer: *Have you successfully contacted anyone here?* Yes → pick who (or quick-add someone) → mark only those people `Successfully Contacted`. No → address counts as reviewed; optional outreach/notes stay collapsed. Skip → stays in queue. Progress is **addresses reviewed**, not “everyone contacted.” Contact truth lives on person rows; review/completion truth lives in a central Address Reviews sheet keyed by `address_id`.

---

## Architecture (where data lives)

### Writes happen in exactly two places during Check-In

1. **Central progress sheet** — Address Reviews (Check-In completion)  
   - ID: `1sOWW-OWC4WY8ZMk75jcT9VXFn6LkTSO65EftqJpLOpc`  
   - Preferred tab: `AddressReviews` (code auto-falls back to `Sheet1` / first tab)  
   - Shared with Google service account (Editor)

2. **Captain zone spreadsheet** — person/address fields  
   - `Successfully Contacted`  
   - outreach date / outreach log  
   - unable to reach, person notes, address notes, optional tags  
   - quick-add new resident rows  

**Does not write to master** during Check-In. Master pull-back is Sheet Smart (`fill_blank` for `address_id` — outside this repo).

### Identity

| ID | Meaning | Format / notes |
|----|---------|----------------|
| `resident_id` | Person/row | UUID (existing) |
| `address_id` | Physical address (unit-level) | `addr_` + UUID v4; opaque |
| APN | County parcel join | Separate; not Check-In progress key |

Canonical address match (for mint vs reuse of `address_id`) uses only:

`_SitusHouseNo`, `_SitusDirection`, `_SitusStreet`, `_SitusUnit`, `City`, `State`, `Zip`

Normalization must stay aligned with Sheet Smart `AddressIdMigration.gs` (see `public/js/address-id.js`).

### Progress row schema

```text
review_key = check_in_id + "__" + zone_id + "__" + captain_id + "__" + address_id
```

Fields: `review_key`, `check_in_id`, `address_id`, `zone_id`, `captain_id`, `review_status` (`reviewed`|`skipped`), `answer` (`yes_successful_contact`|`no_successful_contact`|blank), `reviewed_at`, `updated_at`

Default `check_in_id`: `contact_check_in_2026`  
`captain_id` = signed-in email (lowercased)  
`zone_id` = `currentZoneName`

Upsert is server-side (find by `review_key`, update or append). Browser must not invent row numbers.

---

## Code map

| Path | Role |
|------|------|
| `contact-checkin/routes.js` | API: config, list reviews, upsert review |
| `contact-checkin/SPEC.md` | Product spec |
| `contact-checkin/prototype.html` | UX reference |
| `contact-checkin/SETUP.md` | Ops / env |
| `public/js/contact-checkin.js` | Home widget + wizard + zone-sheet writes |
| `public/js/address-id.js` | Canonical key, mint/reuse, conflict logging |
| `public/css/styles.css` | `.cci-*` + `home-panel--checkin` grid |
| `index.html` | Home panel mount; passes context into `refreshContactCheckIn(...)` |
| `server.js` | Registers Contact Check-In routes |
| `test/contact-checkin.test.js` | Key/summary unit tests |
| `test/address-id.test.js` | Normalization / resolve tests |

### Critical client bridge (do not regress)

`accessToken`, `currentUserEmail`, `currentZoneName`, `currentSheetId`, `sheetData` are **`let` in `index.html`**, not on `window`.

`updateHomeDashboard()` must call:

```js
refreshContactCheckIn({
  accessToken,
  currentUserEmail,
  currentZoneName,
  currentSheetId,
  sheetData
})
```

If you call `refreshContactCheckIn()` with no args after a full page load without that context, the widget shows **“Sign in to start Contact Check-In…”** even when signed in. That bug was fixed Jul 10, 2026 — keep the context pass.

---

## API

- `GET /api/contact-checkin/config`  
- `GET /api/contact-checkin/reviews?zone_id=&captain_id=&check_in_id=&total_addresses=`  
- `POST /api/contact-checkin/review` — body: `check_in_id`, `zone_id`, `captain_id`, `address_id`, `review_status`, `answer`

Person-level updates use existing:

- `POST /api/sheets/batch-update-by-resident-id`  
- `POST /api/sheets/append-record` (quick-add; uses `RAW` for text safety)

Env (optional; defaults exist in code):

```ini
CONTACT_CHECKIN_SHEET_ID=1sOWW-OWC4WY8ZMk75jcT9VXFn6LkTSO65EftqJpLOpc
CONTACT_CHECKIN_SHEET_NAME=AddressReviews
CONTACT_CHECKIN_CHECK_IN_ID=contact_check_in_2026
CONTACT_CHECKIN_CACHE_TTL_MS=15000
```

---

## Done vs not done

### Done (MVP core)

- [x] Spec + prototype in repo  
- [x] Progress sheet API + upsert  
- [x] Home widget (top-right); From Altagether moved under it  
- [x] Learn more modal  
- [x] Wizard Yes / No / Skip  
- [x] Yes: multi-select people → `Successfully Contacted`  
- [x] Yes: quick-add “Someone else at this address”  
- [x] Yes: optional person options + address note  
- [x] No: collapsed “Add optional context” hub (outreach / unable / person note / address note)  
- [x] Resume + review skipped  
- [x] `address_id` generate/reuse on Add Record  
- [x] Sign-in context bridge fix  
- [x] Community Feed **placeholder** under widget (not live network stats)  
- [x] Unit tests for address-id + review key/summary  

### Not done / next

| Item | Priority | Notes |
|------|----------|--------|
| Live hardening from John’s staging tests | **High** | He is testing now; expect bugfixes |
| Ensure all zone sheets have `Successfully Contacted` | High | Exact header |
| Ensure `address_id` seeded on zone sheets | High | Progress key; legacy fallback exists but is fragile |
| Real Community Feed / network metrics | Medium | Spec §22 |
| Admin Contact Check-In module | Medium | Spec §22; not in normal captain UI |
| Do Not Contact field | Low / open | Spec left open; UI omits for now |
| Street milestones / delight toasts | Low | Large-zone nicety |
| Checkbox TRUE/FALSE vs Sheets checkbox cosmetics | **Ignore for now** | John decided leave alone; aesthetic only |

### Explicit non-goals for MVP

- No household table, outreach-event table, contact date, primary household contact  
- Don’t switch map/`addressMap` selection to `address_id` unless needed  
- Don’t redesign Check-In UX away from prototype  

---

## Testing notes (for John / agent)

1. Sign in → load zone with `address_id` (+ ideally `Successfully Contacted`)  
2. Home → Start Contact Check-In  
3. Yes / No / Skip a few addresses  
4. Confirm rows appear in Address Reviews sheet  
5. Confirm zone sheet person fields update on Yes / optional No tools  
6. **Test cleanup:** OK to manually delete Address Reviews **data rows** (keep header). Also clear test `Successfully Contacted` on zone sheet if needed. Progress cache ~15s.

### Smoke regression to watch

- Widget says “Sign in…” while user is signed in → context bridge broken  
- Progress not saving → sheet ID / tab / service account share  
- Yes doesn’t stick → missing `Successfully Contacted` column or `resident_id`  

---

## Git / branch context

Work has lived on **`address_id-prep1`** (also includes funding resource copy + address_id). John has merged into **staging** for testing. Confirm current branch before editing; prefer a focused Check-In branch if continuing large changes.

Recent relevant commits (as of handoff): `check-in go live`, sign-in context fix (`fix`), address id prep.

---

## How to talk to John

- Plain language; he is not a developer  
- Prefer short status + concrete next action  
- Don’t invent Sheet Smart / MergeEngine changes in this repo unless asked  
- Ask before broad refactors  

---

## Suggested first tasks for the next agent

1. Ask John what broke or felt wrong in staging testing (if anything).  
2. Reproduce / fix those bugs first.  
3. Only then: Admin module or live Community Feed.  
4. Keep `SPEC.md` / `prototype.html` as UX authority; update `STATUS.md` when shipping slices.

When in doubt: **protect volunteer UX, don’t invent false person-level data, key progress by `address_id`.**

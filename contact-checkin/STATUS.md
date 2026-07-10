# Contact Check-In — Implementation Status

**Last updated:** July 10, 2026  
**Branch:** `address_id-prep1` (includes Check-In + address_id work)  
**Source of truth:** `contact-checkin/SPEC.md` + `contact-checkin/prototype.html`

## Short answer

The MVP is **largely built** from the two files you provided. Those files are already copied into this repo. You do **not** need to move them again.

What remains is mostly: data readiness (`address_id` + `Successfully Contacted` on zone sheets), live smoke-testing, and a few polish/secondary pieces (Community Feed, Admin module).

---

## Already implemented

| Piece | Where | Status |
|-------|--------|--------|
| Spec + prototype archived in repo | `contact-checkin/SPEC.md`, `prototype.html` | Done |
| Setup notes | `contact-checkin/SETUP.md` | Done |
| Progress sheet API (read + upsert) | `contact-checkin/routes.js` | Done |
| Wired into server | `server.js` | Done |
| Progress sheet ID default | `1sOWW-OWC4WY8ZMk75jcT9VXFn6LkTSO65EftqJpLOpc` | Done |
| Home widget (top-right) | `index.html` + CSS | Done |
| Learn more modal | `public/js/contact-checkin.js` | Done |
| Wizard: Yes / No / Skip | same | Done |
| Yes: select people → Successfully Contacted | same | Done |
| Yes: quick-add someone else | same | Done |
| Yes: optional person options / address note | same | Done |
| No: optional hub (outreach, unable, notes) | same | Done |
| Progress resume + skipped queue | same | Done |
| `address_id` mint/reuse on Add Record | `public/js/address-id.js` | Done |
| Unit tests | `test/contact-checkin.test.js`, `test/address-id.test.js` | Done |

## Not done yet (by design / next)

| Piece | Priority | Notes |
|-------|----------|--------|
| Zone sheets have `Successfully Contacted` column | **Blocking for Yes-branch saves** | You said you’d add this |
| Zone sheets fully seeded with `address_id` | **Blocking for stable progress** | You were seeding these |
| Live smoke test in browser | High | Start / Continue / Yes / No / Skip / sheet rows appear |
| Community Feed under widget | Medium | Placeholder added; real network stats not wired yet |
| Admin Contact Check-In module | Medium | Spec §22; not built |
| Network-wide progress metrics | Medium | Needs aggregation across zones |
| Do Not Contact column | Low / open | Spec left this open; UI omits it for now |
| Street milestones / delight toasts | Low | Nice-to-have for large zones |

## Your checklist before first real use

1. Finish `address_id` on captain sheets  
2. Add column **`Successfully Contacted`** (exact header)  
3. Confirm Address Reviews tab is named **`AddressReviews`** (or tell us if it’s `Sheet1`)  
4. Restart local server / redeploy  
5. Sign in → Home → **Start Contact Check-In** → answer 2–3 addresses → check progress sheet for new rows  

**Bugfix (Jul 10, 2026):** Widget always showed “Sign in…” even when signed in, because Check-In looked for `window.accessToken` / email, but those live as script-local `let`s in `index.html`. Fixed by passing context into `refreshContactCheckIn({ accessToken, currentUserEmail, currentZoneName, currentSheetId, sheetData })`.

## Env vars (optional; defaults already set)

```ini
CONTACT_CHECKIN_SHEET_ID=1sOWW-OWC4WY8ZMk75jcT9VXFn6LkTSO65EftqJpLOpc
CONTACT_CHECKIN_SHEET_NAME=AddressReviews
CONTACT_CHECKIN_CHECK_IN_ID=contact_check_in_2026
```

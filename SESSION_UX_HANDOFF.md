# Session UX & Mobile Pick-up-and-Play — Agent Handoff

**Date:** July 13, 2026  
**Owner / product:** John  
**Status:** Phases A–D shipped. A–C verified on staging with `SESSION_SECRET`. Phase D (PWA shell) ready for field install test.

Use this file when context is lost. Prefer this over reconstructing from chat.

---

## Product goal

Captains should open the Zone Dashboard and be productive in a few seconds — especially on phones — without fighting Google login or hourly “session expired” walls.

---

## What shipped (do not re-litigate)

### Phase A — Fix timeout-while-active (roadmap 1.1 expanded)

**File:** mostly `index.html`

- Softened Google sign-in: `prompt: ''` by default; `select_account` only for switch-account
- Silent refresh on tab focus (`visibilitychange` / `pageshow`) + 10-minute watchdog
- Token refresh before `saveChanges` / auto-save
- Sign-out keeps `savedSheetUrl` / `currentView`; only **Switch account** clears zone memory
- Clearer “session expired” copy on welcome screen
- Boot auto-load delay cut 1000ms → 100ms

### Phase B — Write endpoint auth (roadmap 0.2)

**Files:** `sheets-write-auth.js`, `server.js`, `index.html` (`fetchSheetWrite`), `public/js/contact-checkin.js`

- Mutating routes require auth:
  - `POST /api/sheets/append`
  - `POST /api/sheets/append-record`
  - `POST /api/sheets/batch-update`
  - `POST /api/sheets/batch-update-by-resident-id`
- Verifies Google Bearer **or** (after Phase C) durable session cookie
- Checks caller may write that `sheetId` (zone assignment, NC Directory for registered users, admins any)
- Reads (`/api/sheets/values`) still unauthenticated server-side (client still gates on signed-in)
- Emergency bypass: `SHEETS_WRITE_AUTH=0`
- Tests: `npm run test:sheets-write-auth`

### Phase C — Durable server session (pick-up-and-play)

**Files:** `session-auth.js`, `server.js`, `index.html`, `public/js/contact-checkin.js`

- After Google GIS proves identity once → `POST /api/auth/session` sets httpOnly cookie `zd_session`
- Cookie: signed HMAC, **30-day** TTL, slides when &lt; 1 day remains, `SameSite=Lax`, `Secure` on HTTPS/Vercel
- Boot: `GET /api/auth/me` restores signed-in state **without** Google
- Canonical client gate: `isAuthenticated` / `isSignedIn()` (not Google `accessToken` alone)
- `accessToken` remains optional short-lived helper for Bearer; may be null after ~1 hour while session still valid
- Sign-out: `POST /api/auth/logout` clears cookie
- Routes: `POST /api/auth/session`, `GET /api/auth/me`, `POST /api/auth/logout`, `DELETE /api/auth/session`
- Tests: `npm run test:session-auth`
- **Verified:** John set `SESSION_SECRET` on Vercel; staging smoke tests passed (reload stays signed in; save works; sign-out sticks)

### Phase D — PWA shell (home-screen snappiness)

**Intent:** Faster reopen from home screen; cache static shell only — **never** sheet/API data as source of truth.

**Already present before D:**
- `manifest.webmanifest`
- Apple / theme-color meta in `index.html`
- `public/images/app_icon.png`

**Shipped in D:**
- Root `sw.js` service worker (static asset cache; network-first HTML; bypass `/api/*`)
- SW registration in `index.html` (escape hatch: `?nosw=1` unregisters + clears caches)
- Explicit `/sw.js` + `/manifest.webmanifest` routes/headers in `server.js` and `vercel.json`
- Manifest `id` + fuller `name`

**Explicitly not in D:**
- Redirect-based OAuth (still GIS popup for first login)
- Offline editing / offline sheet cache
- Passkeys / biometrics

**When changing precached assets:** bump `SW_VERSION` in `sw.js`.
---

## Critical env vars

| Var | Required | Purpose |
|-----|----------|---------|
| `SESSION_SECRET` | **Yes in production** | Signs `zd_session`. Rotate = everyone re-logins. Never commit. |
| `SHEETS_WRITE_AUTH` | No (default on) | Set `0` only as emergency to disable write auth |
| Existing Google / sheets / Mapbox vars | Yes | Unchanged |

If `SESSION_SECRET` is missing, server uses an unstable fallback and logs a warning — fine for local, bad for prod.

---

## Auth model (current truth)

```text
First visit:
  GIS popup → Google access token → POST /api/auth/session → httpOnly cookie
  + optional localStorage Google token (~1h) for Bearer

Return visit (days later):
  GET /api/auth/me (cookie) → isAuthenticated=true → resume zone from savedSheetUrl

Writes:
  credentials: 'include' (+ Bearer if Google token still alive)
  Server: session cookie OR Bearer → email → canEmailWriteSheet(sheetId)

Reads:
  Client requires isSignedIn(); server /api/sheets/values still open (accepted risk for now)
```

---

## Key files map

| File | Role |
|------|------|
| `index.html` | GIS login, `isSignedIn`, bootAuthAndRestore, fetchSheetWrite, SW register |
| `session-auth.js` | Cookie create/verify/slide/clear |
| `sheets-write-auth.js` | Write middleware (Bearer + session) |
| `server.js` | Auth routes + middleware wiring + static/SW headers |
| `manifest.webmanifest` | Install / standalone display |
| `sw.js` | Static shell cache |
| `public/js/contact-checkin.js` | credentials include + isAuthenticated bridge |
| `test/session-auth.test.js` | Session unit tests |
| `test/sheets-write-auth.test.js` | Write-auth unit tests |

---

## Smoke checklist (staging / prod)

1. Sign in with Google once  
2. Hard reload → still signed in (no Google)  
3. Edit + save / auto-save  
4. Sign out → reload → stays signed out  
5. (Phase D) Add to Home Screen on phone → opens standalone → still signed in  
6. Deploy a CSS/JS change → hard refresh or SW update still picks up new assets within one/two loads  

---

## Known risks / follow-ups

1. **`/api/user-sheets?email=`** still trusts client email query param (pre-existing). Session boot should prefer cookie email. Hardening that endpoint is a separate security item.  
2. **Read endpoints** still open if sheet ID is known (pre-existing; documented in roadmap 0.2 companion risk).  
3. **GIS popup** can still flake on some iOS contexts for *first* login; redirect OAuth is the next auth UX upgrade if field reports say so.  
4. **favicon.ico** is linked in `index.html` but may be missing from repo — cosmetic only.  
5. Do **not** teach the SW to cache `/api/sheets/*` responses as authoritative offline data.
6. **Details panel edit UI** must use `isSignedIn()`, never bare `accessToken` — leftover `isEditable = accessToken` caused read-only Details after session restore (fixed July 13, 2026).

---

## Suggested next work after Phase D

1. Field-test Add to Home Screen on iPhone + Android with a real captain  
2. If first-login popup pain appears → redirect OAuth flow  
3. Optional: validate session on `/api/user-sheets` instead of raw `?email=`  
4. Optional: light read auth once write+session patterns are trusted  

---

## How to talk to John

He is product-primary, not a day-to-day developer. Prefer plain language, short checklists, and “set this Vercel var / click this to test” over architecture essays — unless he asks for depth.

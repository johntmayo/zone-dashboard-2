# Security Overview — Altagether Zone Dashboard

**Audience:** Altagether staff, board members, advisors, and developers.
**Last updated:** 2026-09-16
**Status:** Current and authoritative. This document supersedes the "Critical Security Issues" section of `CURRENT_STATE_AUDIT.md`, which is now stale.

---

## TL;DR (read this if you read nothing else)

- The dashboard and the Neighborhood Captain (NC) Directory are **private**. You must sign in with an approved Google account to see any data.
- **Who can get in is controlled by one place:** the **User Access Sheet**. If an email isn't an active row there, they get nothing.
- All sensitive data flows through the server using a single **service account**; the browser never talks to Google Sheets directly and never holds the keys.
- As of 2026-09-15/16, **every data and admin endpoint requires a verified sign-in.** Knowing a URL, a sheet ID, or someone's email address is no longer enough to see anything.
- The two "master keys" to protect are the **`SESSION_SECRET`** and the **Google service account credentials**, both stored only in environment variables (Vercel + local `.env`), never in the code repository.

---

## Table of contents

1. [What data we handle](#1-what-data-we-handle)
2. [How security works (plain English)](#2-how-security-works-plain-english)
3. [The three layers: Identity, Session, Authorization](#3-the-three-layers-identity-session-authorization)
4. [How each part of the system is protected](#4-how-each-part-of-the-system-is-protected)
5. [The NC Directory](#5-the-nc-directory)
6. [Secrets and configuration](#6-secrets-and-configuration)
7. [Hosting and domains](#7-hosting-and-domains)
8. [Change log — the 2026-09 hardening](#8-change-log--the-2026-09-hardening)
9. [Known risks and recommended follow-ups](#9-known-risks-and-recommended-follow-ups)
10. [Operational how-tos](#10-operational-how-tos)
11. [Incident response runbook](#11-incident-response-runbook)
12. [Technical appendix: endpoint auth reference](#12-technical-appendix-endpoint-auth-reference)

---

## 1. What data we handle

The platform stores and displays sensitive community information. Treat all of it as confidential:

- **Resident data (highest sensitivity):** names, home addresses, contact details, and notes captains collect about residents and properties across Altadena zones. Held in per-zone Google Sheets and aggregated in a **master spreadsheet**.
- **Neighborhood Captain data:** captain names, phone numbers, emails, zones, bios, and areas of expertise (the NC Directory).
- **User access records:** the list of who is allowed to sign in, their roles, and which zone(s) they manage (the User Access Sheet).

Because this is real PII for real neighbors, the security posture below is deliberately "deny by default."

---

## 2. How security works (plain English)

Think of it as three questions the server asks about every request:

1. **Who are you?** — You prove your identity by signing in with Google.
2. **Do you have a valid pass?** — After sign-in, the server gives your browser a tamper-proof "session" ticket (a signed cookie). Every later request carries it.
3. **Are you allowed to do this specific thing?** — The server checks your email against the **User Access Sheet** to decide which zones you can see and whether you're an admin.

Only after all three pass does the server fetch data from Google Sheets on your behalf, using its own service account. The browser never gets direct access to the spreadsheets.

If any question fails, the request is rejected with a "not signed in" (`401`) or "not allowed" (`403`) response and **no data is returned**.

---

## 3. The three layers: Identity, Session, Authorization

### Layer 1 — Identity (Google OAuth)
- Sign-in uses Google Identity Services. Any Google account *can attempt* to sign in; that alone grants nothing.
- Sign-in only works from **authorized origins** registered on the OAuth client (`633926045450-...apps.googleusercontent.com`), e.g. `https://dashboard.altagether.org` and `https://directory.altagether.org`.

### Layer 2 — Session (signed httpOnly cookie)
- After Google verifies you once, the server issues a durable **session cookie** (`zd_session`) — see `session-auth.js`.
- The cookie is **signed with `SESSION_SECRET`** (HMAC-SHA256). It cannot be read or forged by the client, is **`HttpOnly`** (JavaScript can't read it), **`SameSite=Lax`**, and **`Secure`** in production.
- Lifetime is **30 days**, sliding (renewed automatically when less than a day remains).
- **This is why `SESSION_SECRET` matters:** if it were weak or public, someone could forge a valid cookie and skip Google entirely. It must be a long random value, set only in environment variables.

### Layer 3 — Authorization (the User Access Sheet)
- The **User Access Sheet** (`USER_ACCESS_SHEET_ID`, `Access` tab) is the single source of truth for who can do what.
- Each row: `login_email`, `sheet_url` (or `*` for admin-wildcard), `role` (`captain` / `admin`), `active` (must be `TRUE`), plus optional metadata.
- Roles/capabilities: `captain`, `admin`, and `lot_weeding_admin`. Admins with `sheet_url = *` inherit all active zones.
- **Removing access is instant-ish:** set a row's `active` to `FALSE` (cache refreshes within ~60 seconds).

### The golden rule
**The server never trusts a client-supplied email.** Identity always comes from the signed session cookie, never from a `?email=` parameter. (This was the root cause of the vulnerabilities fixed in September 2026 — see the change log.)

---

## 4. How each part of the system is protected

| Category | Protection |
|---|---|
| **Reading zone/master sheet data** (`/api/sheets/values`) | Requires a valid session. |
| **Writing sheet data** (`/api/sheets/append*`, `/batch-update*`) | Requires a verified identity (Google Bearer token *or* session) **and** that the user is allowed to write that specific sheet (admin, owns the zone, or the shared NC Directory sheet). See `sheets-write-auth.js`. |
| **NC Directory data** (`/api/nc-directory`) | Requires a valid session belonging to a **registered captain** (present in the Access Sheet). |
| **User's own zone list** (`/api/user-sheets`) | Requires a valid session; returns only the signed-in user's own zones. |
| **Admin endpoints** (user list export, activity, godmode master, lot-weeding admin, contact check-in admin, EPIC sync) | Require a valid session whose email is an **admin** (or the appropriate capability). |
| **Public content** (`/api/homepage-feed`, `/api/actions-feed`, `/api/mapbox-token`) | Intentionally public: announcements and the browser-safe Mapbox token. No PII. |

Emergency "kill switches" exist for operational recovery (see [§6](#6-secrets-and-configuration)). They should normally stay **off** (i.e., protection **on**).

---

## 5. The NC Directory

The NC Directory (`nc-directory.html`, served at `directory.altagether.org`) is a captains-only roster.

- **Gated:** opening it shows a "Captains only — Sign in with Google" wall. The roster only loads for a signed-in, registered captain.
- **Data is the real lock:** `/api/nc-directory` returns nothing without a valid captain session, so the page URL being publicly known (subdomains always are — see below) is harmless.
- **Underlying sheet is restricted:** the NC Directory Google Sheet must be set to **Restricted** ("only people with access") and shared with the **service account** (as Editor, so profile saves work). It must **not** be "anyone with the link can view/edit."
- **Reads use the service account**, not a public CSV export, so the sheet can stay locked down.
- The page no longer exposes a link to the editable spreadsheet.

> **Historical note:** the directory was previously public, and its Google Sheet was briefly set to "anyone with the link can edit." Both have been corrected. Subdomains like `directory.altagether.org` are **not secret** — they're discoverable via public Certificate Transparency logs and DNS tools — which is exactly why the gate, not the obscure URL, is the protection.

---

## 6. Secrets and configuration

**Secrets live only in environment variables (Vercel + a local, git-ignored `.env`). They are never committed to the repository.** (Verified: no `.env` file is tracked or present anywhere in git history.)

| Variable | Purpose | Notes |
|---|---|---|
| `SESSION_SECRET` | Signs session cookies | **Critical.** Long random value. Store in a password manager. Rotating it logs everyone out once. |
| `GOOGLE_SERVICE_ACCOUNT_JSON` / `_B64` | Service account that reads/writes sheets | **Critical.** If ever exposed, rotate the key in Google Cloud immediately. |
| `USER_ACCESS_SHEET_ID` | The access-control spreadsheet | Controls who can sign in. |
| `MAPBOX_PUBLIC_TOKEN` | Map tiles | Public by design (browser token). |
| `GA_MEASUREMENT_ID` | Analytics | Optional. |
| OAuth Client ID | Google sign-in | `633926045450-...` — not secret, but its **authorized origins** must include every domain the app runs on. |

**Kill switches (leave protection ON in normal operation):**

| Variable | Effect when set |
|---|---|
| `NC_DIRECTORY_AUTH=0` | Makes the NC Directory readable without sign-in. Emergency only. |
| `SHEETS_WRITE_AUTH=0` | Disables the write-permission gate. Emergency only. |
| `USE_LEGACY_USERS=1` | Falls back to a frozen `users.json` snapshot instead of the Access Sheet. Rollback only. |

---

## 7. Hosting and domains

- Hosted on **Vercel** as a Node/Express app (`server.js`) plus static pages.
- `directory.altagether.org` serves the NC Directory (via a host-based rewrite in `vercel.json` and `server.js`).
- **HTTPS certificates are auto-issued by Vercel.** Every subdomain that gets a cert is published to public **Certificate Transparency logs** — meaning all subdomains are publicly discoverable. Never rely on a subdomain being "unknown" as a security measure.
- Authorized JavaScript origins on the OAuth client currently include the production domain(s), the Vercel preview URL, the GitHub Pages origin, and `localhost`/`127.0.0.1` for local development. Localhost origins are safe to keep (only usable from a developer's own machine).

---

## 8. Change log — the 2026-09 hardening

Prompted by an external report that the directory was public and its sheet was world-editable, a security pass on **2026-09-15/16** made the following changes:

**NC Directory**
- Added a Google sign-in wall to `nc-directory.html`; the roster loads only for signed-in registered captains.
- `/api/nc-directory` now requires a valid captain session and reads via the service account (so the sheet can be Restricted).
- Removed the public link to the editable Google Sheet from the page.
- Underlying sheet changed from "anyone can edit" → **Restricted**.

**Closed a critical authorization chain** (previously, an unauthenticated person who knew a public email could read the entire resident database):
- `/api/sheets/values` (read any sheet) — now requires a valid session.
- `/api/user-sheets` — now uses the signed session identity instead of a client-supplied `?email=`, preventing enumeration of other users' zone sheets.
- `/api/admin/export-users-json`, `/api/admin/user-activity`, `/api/admin/refresh-users` — now require a verified **admin session**.
- `/api/admin/godmode-master`, `/api/contact-checkin/admin`, `/api/lot-weeding-admin/*`, `/api/admin/sync-epic` — now derive identity from the session cookie, not a claimed email.

**Session integrity**
- Set a strong random `SESSION_SECRET` in Vercel so session cookies cannot be forged.

**UI**
- Added a "NC Directory" item to the dashboard nav; hid the "Actions" tab pending a redesign.

All changes were verified against a running server: every hardened endpoint returns `401`/`403` to an unauthenticated caller.

---

## 9. Known risks and recommended follow-ups

Not yet done — good candidates for the next pass:

1. **Lower-sensitivity read endpoints are still open** (no sign-in required): `/api/sales/records`, `/api/lot-weeding/values`, `/api/epic/by-apn` + `/by-apns`, `/api/contact-checkin/community`, `/api/contact-checkin/reviews`. Only the signed-in dashboard uses most of these, so they can likely be gated with a session check; the contact-check-in ones need a quick confirmation that they aren't part of a public resident flow first.
2. **CORS is wide open** (`app.use(cors())` allows all origins). Low risk now that sensitive endpoints require the SameSite cookie, but worth restricting to Altagether domains.
3. **Third-party scripts loaded without Subresource Integrity (SRI)** (map/chart/PDF libraries from CDNs). A CDN compromise could inject code. Add SRI hashes or self-host.
4. **Log retention.** Vercel runtime logs are short-lived. For an audit trail of access, consider exporting/retaining logs.

---

## 10. Operational how-tos

**Grant someone access:** add a row to the User Access Sheet with their `login_email`, the zone `sheet_url` (or `*` for admin), `role`, and `active = TRUE`. Ensure the zone sheet is shared with the service account as Editor. Changes take effect within ~60 seconds.

**Revoke access immediately:** set that person's row `active` to `FALSE`. To force-expire their current session too, rotate `SESSION_SECRET` (this logs *everyone* out).

**Lock down a Google Sheet properly:** set sharing to **Restricted** ("only people with access"), then share it with the **service account email** as Editor. Never use "anyone with the link can edit."

**Rotate the `SESSION_SECRET`:** generate a new random value (`node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"`), update it in Vercel → Settings → Environment Variables (mark it **Secret**), and redeploy. Everyone signs in once more.

**Rotate the service account key:** create a new key in Google Cloud Console for the service account, update `GOOGLE_SERVICE_ACCOUNT_JSON(_B64)` in Vercel, redeploy, then delete the old key.

**Add an authorized sign-in origin:** Google Cloud Console → APIs & Services → Credentials → the OAuth client → **Authorized JavaScript origins** → add the full origin (`https://host`, no trailing slash, no path) → Save. Propagation takes a few minutes.

---

## 11. Incident response runbook

If you suspect unauthorized access or a leaked secret:

1. **Contain**
   - Suspected forged/hijacked sessions → **rotate `SESSION_SECRET`** and redeploy (invalidates all sessions).
   - Suspected leaked service account key → **rotate the service account key** in Google Cloud, then redeploy.
   - Need to cut off a specific person → set their Access Sheet row `active = FALSE`.
   - Nuclear option for a single feature → flip the relevant kill switch's protection back on / set the feature to require auth.

2. **Assess**
   - Check **Vercel logs** for requests to sensitive endpoints (`/api/sheets/values`, `/api/admin/*`, `/api/nc-directory`) from unexpected IPs or times.
   - Check **Google Sheets version history** on affected sheets for unexpected edits.
   - Confirm sheet sharing settings are **Restricted** + service account only.

3. **Recover & document**
   - Re-verify the endpoint protections (each should return `401`/`403` when signed out).
   - Write a short incident note: what was exposed, whether it was actually accessed, what was changed, and when.
   - If resident PII may have been accessed, consider whether any notification obligations apply (seek appropriate advice — this document is not legal advice).

---

## 12. Technical appendix: endpoint auth reference

| Endpoint | Method | Auth required | Enforced by |
|---|---|---|---|
| `/api/nc-directory` | GET | Valid session + registered captain | `requireNcDirectoryCaptain` (server.js) |
| `/api/sheets/values` | GET/POST | Valid session | `requireAppSession` |
| `/api/sheets/append`, `/append-record`, `/batch-update`, `/batch-update-by-resident-id` | POST | Verified identity + write permission for that sheet | `requireSheetsWriteAuth` (sheets-write-auth.js) |
| `/api/user-sheets` | GET | Valid session (own identity only) | `requireAppSession` |
| `/api/admin/export-users-json`, `/user-activity` | GET | Admin session | `requireAdminSession` |
| `/api/admin/refresh-users` | POST | Admin session | `requireAdminSession` |
| `/api/admin/godmode-master` | GET | Admin session | `getSessionEmail` + `isAdminEmail` (godmode/routes.js) |
| `/api/admin/sync-epic` | POST | Admin session **or** `x-epic-sync-token` | epic/routes.js |
| `/api/lot-weeding-admin/requests`, `/request-row` | GET/PATCH | Lot-weeding-admin session | `getSessionEmail` + `hasLotWeedingAdminAccess` (lot-weeding/routes.js) |
| `/api/contact-checkin/admin` | GET | Admin session | `getSessionEmail` + `isAdminEmail` (contact-checkin/routes.js) |
| `/api/recruitment/*` | GET/POST | Session-based recruitment auth | `requireRecruitmentAuth` (recruitment/routes.js) |
| `/api/auth/session`, `/me`, `/logout` | POST/GET | Session lifecycle | session-auth.js |
| `/api/sales/records`, `/api/lot-weeding/values`, `/api/epic/by-apn(s)`, `/api/contact-checkin/community`, `/reviews` | GET | **None (see §9)** | — |
| `/api/homepage-feed`, `/api/actions-feed`, `/api/mapbox-token`, `/api/ga-config` | GET | None (intentionally public, no PII) | — |

**Key files:** `server.js` (routing, session helpers, sheet reads/writes), `session-auth.js` (cookie sessions), `sheets-write-auth.js` (write gate), `*/routes.js` (feature modules), `nc-directory.html` (gated directory), `index.html` (dashboard + sign-in).

---

*Maintainers: when you change how authentication or authorization works, update this file in the same change. If the old `CURRENT_STATE_AUDIT.md` security section and this document ever disagree, this document wins.*

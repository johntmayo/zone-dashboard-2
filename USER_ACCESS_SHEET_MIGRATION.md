# User Access Sheet Migration: Implementation Plan

**Status:** Planned — not yet implemented
**Created:** April 20, 2026
**Owner:** John Mayo
**Related files:** `server.js`, `index.html`, `users.json`, `AUTH_AND_SPREADSHEET_ACCESS.md`, `SERVICE_ACCOUNT_SETUP.md`
**Linked from:** `PRIORITY_ROADMAP.md` (Tier 1)

---

## TL;DR

Replace the current env-var-based user access system (`USERS_JSON_B64` on Vercel) with a Google Sheet as the live source of truth. Admins manage users by editing a sheet; no more base64 encoding, no more Vercel env var edits, no more redeploys to add a user.

**One-time migration.** After that, day-to-day user management becomes: open sheet → add/edit row → done.

---

## Background: Why We're Doing This

### The current pain

User access today lives in the `USERS_JSON_B64` environment variable on Vercel. To add/remove a user or change their zone assignment, the admin must:

1. Decode the current env var from base64.
2. Edit the JSON.
3. Re-encode as base64.
4. Paste into Vercel → Settings → Environment Variables.
5. Trigger a redeploy (env var changes don't hot-reload).
6. Wait ~30–60 seconds for the new deploy.

This is painful enough to be a bottleneck, and the admin is anticipating constant onboarding toward a target of ~500 users over the next 5–10 years.

### The April 20 2026 incident

This plan was triggered by a real outage. During a Google Drive cleanup two days earlier (April 18), some zone sheets were moved out of the shared folder that had been granting the service account access via folder inheritance. Those sheets still existed but the service account lost access, producing `403 PERMISSION_DENIED` errors.

Because the dashboard auto-loads whichever sheet is in `localStorage['savedSheetUrl']` (`index.html:1421–1434`), affected users hit the same broken sheet on every reload and felt like the entire dashboard was down.

Root cause: a sheet-sharing issue, not an auth issue. The 403 log line in Vercel (`server.js:668`) was definitive: `code= 403` + `"The caller does not have permission"` + `PERMISSION_DENIED`.

The incident surfaced two separable problems:

1. **The sharing model is fragile** — folder-inheritance means routine Drive reorganization silently breaks access. (This plan does not directly fix that; see "Related improvements" below.)
2. **The user-admin experience is bad** — the admin couldn't quickly edit `users.json` to remove the broken sheets, because editing it requires the Vercel/base64 dance. **This plan fixes #2.**

---

## Goals

- Admin edits user access directly in a Google Sheet. No more env var edits.
- No redeploy required to add/remove users or change zone assignments.
- Login zone picker displays `zone_name` and `captain_name` instead of raw URLs.
- Soft-delete capability via an `active` column (no lost history when captains leave).
- Role awareness (captain / admin distinction) built in from day one.
- Scale cleanly to ~500 users and many zones.
- Maintain a rollback path if the new system ever breaks.

## Non-goals

- **No admin UI (yet).** The Google Sheet is the admin UI. A custom admin page is Phase 2, deferred.
- **No normalization (yet).** Single flat access table; no separate Zones tab. Phase 3 escape hatch documented below.
- **No write-back to the access sheet from the app (yet).** The app reads only. Admin edits happen in Sheets.
- **No auto-fallback to env var on Sheet outage.** See "Rollback Model" — we chose manual emergency rollback over automatic runtime fallback.

---

## Key Decisions & Rationale

These decisions were made through discussion and should not be re-litigated without good reason. If a future implementer disagrees, they should update this section with new reasoning.

### 1. Google Sheet is the source of truth (not KV / DB / custom admin UI)

- **Why:** The stack already uses Google Sheets as the primary data store. The service account already has the infrastructure to read sheets. No new services, credentials, or bills. Admin edits happen in a UI (Google Sheets) that all stakeholders already know.
- **Alternative rejected:** Vercel KV / Supabase / Postgres — overkill for the scale (hundreds, not thousands of users) and adds operational complexity.
- **Alternative rejected:** Custom admin UI in the dashboard — collapses to "Sheet is still the storage backend, UI is a layer on top." Worth building later (Phase 2) but not required for the migration.

### 2. Model B — Manual emergency rollback (not automatic runtime fallback)

Two fallback models were considered:

- **Model A (rejected):** Code tries Sheet, catches error, auto-falls-back to `USERS_JSON_B64` env var. Requires keeping env var periodically synced (otherwise it's stale and useless during an outage). Keeping it synced reintroduces the exact manual-toil problem this migration is meant to eliminate.
- **Model B (chosen):** Sheet is the only source. `USERS_JSON_B64` remains frozen at the time of migration as a disaster-recovery artifact. If the Sheet approach ever breaks catastrophically, manually revert code + update `users.json` + redeploy. Accept ~15–30 min outage in that rare case.

- **Why:** Sheets API outages are rare and short (Google's historical uptime is high). The app is not life-critical. The admin would rather have zero ongoing toil than automatic-but-maintenance-dependent resilience.

### 3. Flat schema — one row per (email, sheet_url) pair

- **Why:** Self-contained rows. Trivial to filter, sort, edit, add per-row metadata (active flag, date added, role). Adding/removing a single zone assignment = delete/add a single row.
- **Alternative rejected:** Multiple URLs in one cell separated by delimiters. Breaks as soon as any entry needs its own metadata; delimiter collisions; no per-entry soft-delete.
- **Trade-off accepted:** `captain_name` is denormalized (duplicated across rows when multiple people have access to the same zone). Find-and-replace handles captain changes until scale makes it painful. Escape hatch: add a Zones tab later (Phase 3).

### 4. `active` column for soft-delete (not hard deletion)

- **Why:** Preserves audit trail. Allows undo. Prevents the "Jane left the zone; I deleted her row; now I need to restore her" problem. Covers the exact incident pattern that motivated this migration.

### 5. `role` column included from day one

- **Why:** Even if almost everyone is a `captain`, at least one admin already exists. Having the column now means no schema migration when advisors/observers/read-only stakeholders are added.
- **Initial values:** `captain`, `admin`. Extensible.

### 6. No `display_name` column

- **Why:** Redundant with Google OAuth, which already provides display name on sign-in. Adding a column just creates drift. The dashboard already uses the OAuth-supplied name for "Welcome, X".

### 7. Single-tab design (no Zones tab yet)

- **Why:** Simpler to set up, simpler to reason about, perfectly workable at current scale.
- **Escape hatch (Phase 3):** When find-and-replace-on-captain-change becomes painful (probably around 100+ zones or when multiple people have access to most zones), introduce a second tab `Zones` with `sheet_url | zone_name | captain_name | captain_email | active | notes`, and the main access tab references `sheet_url` only. Server joins on `sheet_url`.

---

## Target Architecture

```
┌─────────────────────┐
│  Admin (human)      │
│  edits sheet in     │
│  Google Sheets UI   │
└──────────┬──────────┘
           │
           ▼
┌─────────────────────┐
│  Admin Access Sheet │   ← source of truth
│  (Google Sheets)    │
└──────────┬──────────┘
           │ read via Sheets API
           │ (service account)
           ▼
┌─────────────────────┐
│  Server (server.js) │
│  ─ readUsersMap()   │
│    cached ~60s      │
└──────────┬──────────┘
           │
           ▼
┌─────────────────────┐       ┌──────────────────────┐
│  /api/user-sheets   │ ───▶  │  Client zone picker  │
│  returns sheets +   │       │  shows zone_name +   │
│  names + captains   │       │  captain_name        │
└─────────────────────┘       └──────────────────────┘
```

---

## Admin Sheet Schema

### Sheet name
"Zone Dashboard — User Access Registry" (or similar — name is operational, not wired into code)

### Location
A dedicated folder, **separate from the zone sheets folder**. This is config, not zone data. Mixing the two is how cleanups go wrong (see the April 20 incident).

### Sharing
- Service account (`dashboard@nc-dashboard-v1.iam.gserviceaccount.com`) — **Editor** (Editor rather than Viewer so future write-back features don't require re-sharing).
- Admin — Owner.
- No one else initially. Anyone with edit rights to this sheet effectively controls access to every zone — treat like production credentials.

### Tab layout
- Tab 1: `Access` (name this tab explicitly, don't rely on `Sheet1`)
- Optional Tab 2: `Notes` / `Change Log` — free-form admin notes

### Columns (Access tab)

Header row in row 1. Data starts row 2.

| Column | Header | Type | Required | Validation | Notes |
|---|---|---|---|---|---|
| A | `email` | text | Yes | `=ISEMAIL(A2)` | Lowercased. Primary match key. |
| B | `sheet_url` | text | Yes | `=REGEXMATCH(B2, "docs\.google\.com/spreadsheets/d/[a-zA-Z0-9_-]+")` | Full Google Sheets URL for the zone. |
| C | `zone_name` | text | Recommended | none | e.g. "Zone 42 - Briarwood". Drives login UX. |
| D | `captain_name` | text | Recommended | none | Name of the captain of this zone. Denormalized — updated via find-and-replace when captains change. |
| E | `role` | dropdown | Yes | dropdown: `captain` \| `admin` | Default: `captain`. Extensible. |
| F | `active` | checkbox | Yes | Insert → Checkbox | Soft-delete flag. Server filters out rows where active = FALSE. |
| G | `date_added` | date | Recommended | Date format | `=TODAY()` when adding. |
| H | `notes` | text | Optional | none | Free-form. e.g. "Replaced Jane 2026-03-15. On leave Feb–Mar." |

### Initial data load

When populating with the current `users.json` contents:
- `date_added` = date of original setup (or migration date if unknown)
- `active` = TRUE
- `role` = `captain` for most, `admin` for the site admin(s)
- `notes` = "migrated from users.json 2026-04-XX" on all initial rows (makes bulk-imported rows distinguishable from organic growth later)

### Example rows

```
email                          | sheet_url           | zone_name            | captain_name | role    | active | date_added | notes
john@altagether.org            | https://…/edit      | Zone 42 - Briarwood  | Jane Doe     | admin   | TRUE   | 2026-04-20 | migrated
jane@example.com               | https://…/edit      | Zone 42 - Briarwood  | Jane Doe     | captain | TRUE   | 2026-01-15 | (blank)
john@altagether.org            | https://…/edit      | Zone 17 - Oakridge   | Mike Smith   | admin   | TRUE   | 2026-04-20 | migrated
mike@example.com               | https://…/edit      | Zone 17 - Oakridge   | Mike Smith   | captain | TRUE   | 2025-11-02 | (blank)
```

Note that John (admin) has two rows — one per zone he has access to. This is by design.

---

## Manual Setup Checklist (do these once, before shipping code)

1. **Create the sheet** in Google Drive. Name: "Zone Dashboard — User Access Registry".
2. **Put it in a dedicated folder**, separate from the zone sheets folder.
3. **Add the 8 columns** from the schema table above as headers in row 1.
4. **Freeze row 1** — View → Freeze → 1 row.
5. **Apply data validation** per the schema (ISEMAIL, REGEXMATCH, role dropdown, active checkbox).
6. **Share with the service account** `dashboard@nc-dashboard-v1.iam.gserviceaccount.com` as **Editor**.
7. **Populate** by importing current `users.json` contents (see "Initial data load" above).
8. **Get the sheet ID** from the URL (the long string between `/d/` and `/edit`).
9. **Add to Vercel** as `USER_ACCESS_SHEET_ID` env var (Production). Trigger redeploy after code change is shipped (step below).

---

## Code Changes Required

### `server.js`

#### New env var
```
USER_ACCESS_SHEET_ID=<the-sheet-id>
```

#### Replace `readUsersMap()` (currently at ~line 53)

Current: synchronous, reads from `USERS_JSON_B64` / `USERS_JSON` / `users.json` file.
New: async, reads from Google Sheet via existing `getSheetsClient()` (`server.js:187`), with in-memory cache.

Rough shape:

```javascript
let cachedUsersMap = null;
let cachedAt = 0;
const USERS_CACHE_TTL_MS = 60 * 1000; // 60 seconds; tune as desired

async function readUsersMap() {
  const now = Date.now();
  if (cachedUsersMap && now - cachedAt < USERS_CACHE_TTL_MS) {
    return cachedUsersMap;
  }

  const accessSheetId = (process.env.USER_ACCESS_SHEET_ID || '').trim();
  if (!accessSheetId) {
    // If env var missing, fall through to legacy path for local dev safety.
    return readUsersMapLegacy();
  }

  try {
    const sheets = await getSheetsClient();
    const result = await sheets.spreadsheets.values.get({
      spreadsheetId: accessSheetId,
      range: 'Access!A2:H10000'
    });
    const rows = result.data.values || [];
    const map = {};

    for (const row of rows) {
      const [email, sheetUrl, zoneName, captainName, role, active /*, dateAdded, notes */] = row;

      if (!email || !sheetUrl) continue;
      if (String(active || '').toUpperCase() !== 'TRUE') continue; // soft-delete respect

      const key = String(email).trim().toLowerCase();
      const url = toCanonicalSheetUrl(String(sheetUrl).trim());
      if (!url) continue;

      const entry = {
        url,
        name: String(zoneName || '').trim() || url,
        captainName: String(captainName || '').trim(),
        role: String(role || 'captain').trim().toLowerCase()
      };

      if (!map[key]) map[key] = [];
      map[key].push(entry);
    }

    cachedUsersMap = map;
    cachedAt = now;
    return map;
  } catch (err) {
    console.error('Failed to read user access sheet:', err.message);
    // Model B: don't auto-fallback. If we have a stale cache, use it
    // (so a brief Sheets hiccup doesn't lock everyone out). Otherwise propagate.
    if (cachedUsersMap) return cachedUsersMap;
    throw err;
  }
}

// Preserve legacy reader for local dev / emergency disaster recovery.
function readUsersMapLegacy() {
  // ...existing sync logic, renamed...
}
```

**Key design notes for the implementer:**
- Cache is in-process, so each Vercel serverless instance has its own. That's fine — the 60s TTL bounds staleness globally.
- Only `active === TRUE` rows are included. This is the soft-delete enforcement point.
- `toCanonicalSheetUrl()` already exists (`server.js:114`). Reuse it — don't reimplement URL extraction.
- On Sheet fetch failure: serve stale cache if available (graceful degradation for brief hiccups). Propagate error only if we have *no* cached data (typically only on cold start during an active Sheets outage).
- **Do not auto-fall-back to the env var.** That's Model A, which we explicitly rejected. The env var is a manual-rollback artifact, not a runtime failsafe.

#### Update `/api/user-sheets` handler (`server.js:156`)

The current handler calls `readUsersMap()` synchronously. Since it's now async, the handler must `await` it.

```javascript
app.get('/api/user-sheets', async (req, res) => {
  const emailParam = (req.query.email || '').toString().trim().toLowerCase();
  if (!emailParam) return res.status(400).json({ error: 'no_email' });

  try {
    const usersMap = await readUsersMap();
    const rawSheets = usersMap[emailParam];
    if (!Array.isArray(rawSheets)) {
      return res.status(403).json({ error: 'not_registered' });
    }
    // Entries are already normalized objects; return as-is.
    return res.status(200).json({ sheets: rawSheets });
  } catch (err) {
    const message = err && err.code === 'ENOENT'
      ? 'No users config is available...'
      : `User access config is invalid: ${err.message}`;
    console.error('Error in /api/user-sheets:', message);
    return res.status(500).json({ error: 'users_config_error', message });
  }
});
```

#### New endpoint: `/api/admin/refresh-users` (optional but recommended)

A small endpoint that clears the cache so new entries take effect immediately, without waiting for the 60s TTL.

```javascript
app.post('/api/admin/refresh-users', async (req, res) => {
  // Gate by admin: require the caller's email to be in the access map with role=admin.
  const emailParam = (req.query.email || '').toString().trim().toLowerCase();
  if (!emailParam) return res.status(401).json({ error: 'no_email' });

  try {
    const usersMap = await readUsersMap();
    const rows = usersMap[emailParam] || [];
    const isAdmin = rows.some(r => r.role === 'admin');
    if (!isAdmin) return res.status(403).json({ error: 'not_admin' });

    cachedUsersMap = null;
    cachedAt = 0;
    return res.status(200).json({ ok: true, message: 'cache cleared' });
  } catch (err) {
    return res.status(500).json({ error: 'refresh_failed', message: err.message });
  }
});
```

**Security note:** The email comes from a query parameter, which is not authenticated. This is "good enough" for the current app's threat model (the whole app is similar in this regard — see Priority Roadmap 0.2) but should be tightened when write-endpoint auth is added.

### `index.html`

#### Zone picker display

The zone picker is rendered via `showZonePicker()` at `index.html:1538` and displayed by `updateWelcomeMessage()`. Currently it shows raw URLs (or sheet names if passed). After migration, each sheet entry from `/api/user-sheets` has `{ url, name, captainName, role }`.

Update the picker UI to display, per entry:

```
  Zone 42 — Briarwood
  Captain: Jane Doe
```

…with the URL available on hover (tooltip) or only as the click target. Find the current picker render in `index.html` (search for usage of `availableSheets` and `welcomeAuthState === 'zone_picker'`) and swap the rendered label from the URL/name fallback to a structured layout using `name` + `captainName`.

**Keep backward compatibility:** If `captainName` is missing (e.g., during transition or for sheets without captain info yet), just render the name without the "Captain: …" line. Don't show "Captain: undefined".

#### Current user's display name

Already handled by Google OAuth elsewhere in the file. No change needed.

---

## Rollout Plan

Execute in order. Each step is reversible until the final env var update.

1. **Create and populate the admin sheet** per the Manual Setup Checklist above.
2. **Verify service account access** — open the sheet, click Share, confirm `dashboard@nc-dashboard-v1.iam.gserviceaccount.com` is listed as Editor.
3. **Implement code changes** per "Code Changes Required":
   - New `readUsersMap()` (async, cached, Sheets-backed).
   - Rename existing implementation to `readUsersMapLegacy()` (keep it — used for local dev and as documented fallback).
   - `await readUsersMap()` in `/api/user-sheets` handler.
   - Optional: `/api/admin/refresh-users` endpoint.
   - Update zone picker rendering in `index.html` to show `zone_name` and `captain_name`.
4. **Test locally** with `USER_ACCESS_SHEET_ID` set in `.env.local`. Verify:
   - Sign-in works for a user with a single zone → auto-loads that zone.
   - Sign-in works for the admin (multiple zones) → zone picker shows zone names + captain names, no URL gobbledygook.
   - Sign-in fails gracefully for an unregistered email.
   - Flipping `active = FALSE` in the sheet removes access within ~60 seconds (or immediately after hitting `/api/admin/refresh-users`).
5. **Add `USER_ACCESS_SHEET_ID` to Vercel** (Production). **Do not remove `USERS_JSON_B64` yet.**
6. **Deploy.** Vercel redeploy picks up the new env var and new code.
7. **Smoke test production.** Sign in as admin, sign in as at least one captain, verify both work and the picker looks right.
8. **Freeze the env var.** Leave `USERS_JSON_B64` in Vercel as a snapshot. Do not touch it again unless rolling back.
9. **Commit a final `users.json`** to the repo reflecting the migration-day state, with a comment header noting "snapshot as of migration 2026-04-XX; live access now lives in Sheet ID … ". This gives a clear source for emergency rollback.
10. **Update `AUTH_AND_SPREADSHEET_ACCESS.md`** to describe the new flow. The current doc describes the env-var model and will be stale after this change.

---

## Rollback Plan (Model B — Manual Emergency Rollback)

**When to use:** The Sheet-based approach is catastrophically broken (Sheet accidentally deleted, SA access permanently lost, new bug in `readUsersMap()` causes mass sign-in failures that can't be fixed quickly).

**Steps:**

1. **Revert the code change** that replaced `readUsersMap()`. Either:
   - `git revert` the migration commit, or
   - Flip a kill-switch env var like `USE_LEGACY_USERS=1` and code `readUsersMap()` to check it at the top (worth adding during implementation — see "Risk mitigation" below).
2. **Update `users.json`** (or `USERS_JSON_B64`) if significant user additions happened after migration day. If no changes, the frozen snapshot still works as-is.
3. **Redeploy.** Vercel picks up the legacy code + env var. Sign-in works again.
4. **Investigate and fix** the Sheet-based path offline.
5. **Re-roll-forward** when confident.

**Estimated rollback time:** 15–30 minutes assuming the snapshot is still current. Longer if you need to rebuild the user list.

**Risk mitigation during implementation:** Strongly consider adding the `USE_LEGACY_USERS` kill-switch env var during implementation. It's 3 lines of code and makes rollback a single Vercel setting toggle instead of a git revert + redeploy.

---

## Future Phases (Deferred — Do Not Build Now)

### Phase 2: Admin UI in the dashboard

A simple `/admin` page within the dashboard itself: email field, zone dropdown, role dropdown, "Add" button. Behind the scenes it appends a row to the admin sheet via the Sheets API (requires write access for the SA — already Editor, so no change).

**Gated by:** admin email check on the server.
**Value:** One-tap user onboarding from your phone. Removes even the sheet-editing step.
**Cost:** Not worth building until the sheet-editing flow starts feeling slow, which may well be never.

### Phase 3: Normalized Zones tab

When `captain_name` duplication becomes painful (rough threshold: ~100+ zones, or frequent captain turnover, or many advisors-per-zone), introduce:

- New tab: `Zones` with columns `sheet_url | zone_name | captain_name | captain_email | active | notes`
- Main tab (renamed or repurposed): `Access` with columns `email | sheet_url | role | active | date_added | notes`
- Server joins on `sheet_url` when building the access map.

**Signal that it's time:** You find yourself running find-and-replace on `captain_name` more than once a month.

### Phase 4: Write-back from the app

e.g., the app writes `last_sign_in` or `last_active` back to the access sheet. Useful for admin analytics. Easy once the SA already has Editor on the sheet.

**Dependency:** Some form of write-endpoint auth (Priority Roadmap 0.2).

---

## Open Questions / Decisions Deferred

- **Exact cache TTL:** 60 seconds is a starting guess. If new-user onboarding feels slow, drop to 15–30 seconds. If Sheets API costs become a concern (extremely unlikely at this scale), raise to 5 minutes and rely on `/api/admin/refresh-users` for urgency.
- **Access sheet location in Drive:** A dedicated folder separate from zone sheets is recommended. Exact folder TBD by the admin.
- **Admin email(s):** The migration assumes the admin's own email (the one being used to sign in) gets `role = admin` in the sheet. If multiple admins are planned, enumerate them in the initial import.
- **Whether to delete `USERS_JSON_B64` ever:** Recommended to keep indefinitely as a near-zero-cost disaster-recovery artifact. If deleted later, ensure `users.json` (snapshot version) stays in the repo at minimum.

---

## Related Improvements (Out of Scope Here)

These are related problems surfaced by the April 20 incident but not fixed by this migration:

- **Folder-inheritance sharing fragility.** Sheets whose SA access is granted only via folder inheritance silently lose access when moved out of the folder. Consider sharing individual sheets directly with the SA (in addition to folder-level) as defense-in-depth, or documenting this in `SERVICE_ACCOUNT_SETUP.md` as a known gotcha.
- **localStorage-stuck-on-broken-sheet UX.** When `localStorage['savedSheetUrl']` points to a sheet that's now 403ing, users are stuck reloading the same error. Consider: on fetch error, clear `savedSheetUrl` and fall back to the zone picker instead of repeatedly auto-loading the broken sheet.
- **Sheet ID not logged on API errors.** Currently `server.js:667–669` logs the error but not the `sheetId` that failed. Adding `sheetId` to that log line would have immediately told us which sheet was problematic during the April 20 incident.
- **"From Altagether" announcements panel** uses a separate public-CSV path (`fetchPublicSheet()` in `server.js:286`), not the service account. If announcements ever stop loading, it's an unrelated issue — don't conflate with SA-related failures.

These are tracked separately in `PRIORITY_ROADMAP.md` or should be added there.

---

## Implementation Effort Estimate

- Sheet setup and data migration: **30–60 minutes** (manual work, depends on number of current users).
- `server.js` changes (`readUsersMap` replacement, async handler, optional refresh endpoint): **1.5–2 hours**.
- `index.html` changes (zone picker rendering): **30–45 minutes**.
- Testing (local + production smoke test): **30 minutes**.
- Documentation updates (`AUTH_AND_SPREADSHEET_ACCESS.md`): **15–30 minutes**.

**Total: ~3–4 hours of focused work.** One evening.

---

## Acceptance Criteria

The migration is complete when all of the following are true:

- [ ] Admin can add a new user by adding a row to the Access sheet and having that user successfully sign in within ~60 seconds, with no Vercel interaction.
- [ ] Admin can revoke a user by setting `active = FALSE` in the sheet (no row deletion needed) and that user loses access within ~60 seconds.
- [ ] Admin's zone picker displays human-readable zone names and captain names, not URLs.
- [ ] A captain with exactly one assigned zone auto-loads into that zone on sign-in (existing behavior preserved).
- [ ] A captain whose only row has `active = FALSE` sees the "not registered" message.
- [ ] Sign-in works for all previously-active users with no data loss (verified by spot-checking ~5 captains).
- [ ] `USERS_JSON_B64` and `users.json` are frozen snapshots; neither needs to be updated for routine user management.
- [ ] `AUTH_AND_SPREADSHEET_ACCESS.md` reflects the new flow.
- [ ] Rollback path is documented and has been mentally walked through (actual rehearsal not required but recommended).

# User Access Sheet Migration: Implementation Plan

**Status:** Design finalized — ready for implementation.
**Created:** April 20, 2026 | **Refined:** April 21, 2026
**Owner:** John Mayo
**Related files:** `server.js`, `index.html`, `users.json`, `AUTH_AND_SPREADSHEET_ACCESS.md`, `SERVICE_ACCOUNT_SETUP.md`, `migration_import.csv`
**Linked from:** `PRIORITY_ROADMAP.md` (Tier 1 item 1.8)

---

## TL;DR

Replace the current env-var-based user access system (`USERS_JSON_B64` on Vercel) with a Google Sheet as the live source of truth. Admins manage users by editing a single-tab sheet; no more base64 encoding, no more Vercel env var edits, no more redeploys to add a user. The admin uses a single **wildcard row** (`sheet_url = *`) to gain access to every zone without duplicating per-zone rows.

Day-to-day admin flow becomes: open sheet → add/edit row → done (≤60s propagation, or immediate via refresh endpoint).

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
- Admin accesses all zones via a single wildcard row; no per-zone duplication for admin use.
- Login zone picker displays `zone_name` and `captain_display_name` instead of raw URLs, with a search input for scale (~100+ zones).
- Separate login email (Gmail, used for OAuth) from contact email (preferred correspondence).
- Soft-delete capability via an `active` column.
- Role awareness (captain / admin distinction) built in from day one; role column gates admin-only endpoints now and admin-only features later.
- Scale cleanly to ~500 users and 100+ zones.
- Maintain a rollback path if the new system ever breaks (single-click kill-switch in Vercel).

## Non-goals

- **No admin UI (yet).** The Google Sheet is the admin UI. A custom admin page is Phase 2, deferred.
- **No Zones-tab normalization (yet).** Single flat table. Phase 3 escape hatch documented below.
- **No write-back to the access sheet from the app (yet).** The app reads only. Admin edits happen in Sheets.
- **No auto-fallback to env var on Sheet outage.** See "Rollback Model" — we chose manual emergency rollback over automatic runtime fallback.
- **No god mode in this migration.** Roadmap item 3.4. This migration sets up the `role` column so god mode has a hook to gate on, but god mode UX is separate work.

---

## Key Decisions & Rationale

These decisions were made through discussion and should not be re-litigated without strong reason. If a future implementer disagrees, they should update this section with new reasoning.

### 1. Google Sheet is the source of truth (not KV / DB / custom admin UI)

- **Why:** The stack already uses Google Sheets as the primary data store. The service account already has the infrastructure to read sheets. No new services, credentials, or bills. Admin edits happen in a UI (Google Sheets) that all stakeholders already know.
- **Alternative rejected:** Vercel KV / Supabase / Postgres — overkill for the scale (hundreds, not thousands of users) and adds operational complexity.
- **Alternative rejected:** Custom admin UI in the dashboard — collapses to "Sheet is still the storage backend, UI is a layer on top." Worth building later (Phase 2) but not required for the migration.

### 2. Model B — Manual emergency rollback (not automatic runtime fallback)

Two fallback models were considered:

- **Model A (rejected):** Code tries Sheet, catches error, auto-falls-back to `USERS_JSON_B64` env var. Requires keeping env var periodically synced (otherwise it's stale and useless during an outage). Keeping it synced reintroduces the exact manual-toil problem this migration is meant to eliminate.
- **Model B (chosen):** Sheet is the only source. `USERS_JSON_B64` remains frozen at the time of migration as a disaster-recovery artifact. If the Sheet approach ever breaks catastrophically, flip the `USE_LEGACY_USERS=1` kill-switch in Vercel and redeploy. Accept ~5–30 min outage in that rare case.

- **Why:** Sheets API outages are rare and short (Google's historical uptime is high). The app is not life-critical. The admin would rather have zero ongoing toil than automatic-but-maintenance-dependent resilience.

### 3. Single flat tab with admin wildcard (NOT two-tab normalization)

A two-tab schema (Zones tab for zone metadata, Access tab for captain→zone assignments) was considered and rejected:

- The only real drift risk in the single-tab schema is `zone_name` duplication across multi-captain zones. At ~100 zones with occasional renames, find-and-replace is acceptable toil.
- The real pain point driving normalization ("admin shouldn't have to duplicate every zone row for themselves") is solved cleanly by the **admin wildcard convention**, not by schema normalization.
- Two tabs = two places to update when adding a new zone. Admin preference: simpler is better.

**Phase 3 escape hatch (not currently anticipated as necessary):** If drift becomes genuinely painful (rough threshold: ~200+ zones with frequent renaming, or many captains sharing the same zones with inconsistent name conventions), introduce a `Zones` tab with `sheet_url | zone_name | active | notes`, drop `zone_name` from the Access tab, and have the server join on `sheet_url`. Not expected to be needed for years, if ever.

### 4. Admin wildcard convention: `sheet_url = *`

A new convention introduced during design refinement. An admin row whose `sheet_url` cell contains exactly the string `*` grants that admin access to all active zones (derived from other captain rows in the table).

- **Why:** At 100+ zones, requiring the admin to add themselves to every zone creates unacceptable maintenance toil and a real footgun ("I added Zone X but forgot to also grant myself access"). The wildcard row is a one-time setup; every new captain-assigned zone is automatically picked up.
- **Convention is non-standard.** It's documented here so a future maintainer (human or AI) knows `*` is intentional, not a data validation error.
- **Multiple admins:** each admin gets their own wildcard row. 2–3 admin rows total in the sheet.
- **Edge case: zone with no active captains.** Such a zone disappears from the admin's picker too. This is by-design — a zone with no captain is effectively dormant. To "park" a zone alive, add a placeholder captain row or keep the captain row with `active=TRUE` even during transition.

### 5. Separate `login_email` and `contact_email` columns

Many captains use one Gmail for dashboard sign-in (required by Google OAuth) and a different personal / volunteer email for real correspondence. The schema tracks both:

- `login_email`: the Gmail OAuth returns. Used **only** for access matching.
- `contact_email`: the captain's preferred correspondence email. Used for newsletters, admin outreach, etc. Not touched by auth.

These are genuinely different fields and conflating them has caused real-world confusion. Separate columns from day one.

### 6. Flat one-row-per-(login_email, sheet_url) schema for captain rows

- **Why:** Self-contained rows. Trivial to filter, sort, edit. Adding/removing a single zone assignment = delete/add a single row. Supports multi-captain zones (multiple rows referencing the same sheet_url).
- **Alternative rejected:** Multiple URLs in one cell separated by delimiters. Breaks as soon as any entry needs per-entry metadata; delimiter collisions; no per-entry soft-delete.
- **Trade-off accepted:** `zone_name` is denormalized across multi-captain zones. See Decision 3 for the escape hatch.

### 7. `active` column for soft-delete (not hard deletion)

- **Why:** Preserves audit trail. Allows undo. Prevents the "Jane left the zone; I deleted her row; now I need to restore her" problem. Covers the exact incident pattern that motivated this migration.

### 8. `role` column included from day one

- **Why:** Even though admin-only **UI** features aren't built in v1, the role column already does real work: it gates the `/api/admin/refresh-users` and `/api/admin/export-users-json` endpoints, and it's what the admin wildcard resolution requires. Future admin-gated features (god mode, cross-zone views, etc.) will hook into the same column with no schema migration.
- **Initial values:** `captain`, `admin`. Extensible.

### 9. `captain_display_name` is for others, not self

- **Why:** `captain_display_name` is what appears in picker buttons under a zone ("Captain: Jane Doe"). It's Jane's identity as seen by others — including the admin when browsing zones. It's not used for the logged-in user's own name, which still comes from OAuth.
- **Blank for admin wildcard rows:** the admin's own picker doesn't display their name under their own zones; it displays the assigned captain's name pulled from that zone's captain rows.

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
│  single tab:        │
│  - captain rows     │
│  - admin wildcard   │
│    rows             │
└──────────┬──────────┘
           │ read via Sheets API (service account), cached 60s
           ▼
┌─────────────────────────────────┐
│  Server (server.js)             │
│  ─ readUsersMap()               │
│    · expands wildcards          │
│    · dedupes per-user URLs      │
│    · logs captain dup warnings  │
└──────────┬──────────────────────┘
           │
           ├─────► /api/user-sheets ──► Zone picker (with search, 2-line buttons)
           ├─────► /api/admin/refresh-users (cache bust)
           └─────► /api/admin/export-users-json (snapshot for rollback)
```

---

## Admin Sheet Schema

### Sheet name
"Zone Dashboard — User Access Registry" (name is operational, not wired into code).

### Location
A dedicated Drive folder, **separate from the zone sheets folder**. This is config, not zone data. Mixing the two is how the April 20 cleanup caused the original incident.

### Sharing
- Service account (`dashboard@nc-dashboard-v1.iam.gserviceaccount.com`) — **Editor** (Editor rather than Viewer so future write-back features don't require re-sharing).
- Admin(s) — Owner.
- No one else initially. Anyone with edit rights to this sheet effectively controls access to every zone — treat like production credentials.

### Tab layout
- Tab 1: `Access` (name this tab explicitly, don't rely on `Sheet1`)
- Optional Tab 2: `Notes` / `Change Log` — free-form admin notes

### Columns (Access tab)

Header row in row 1. Data starts row 2.

| Col | Header | Type | Required | Validation | Notes |
|---|---|---|---|---|---|
| A | `login_email` | text | Yes | `=ISEMAIL(A2)` | Lowercased at read time. Must be the Gmail the captain uses for OAuth. |
| B | `sheet_url` | text | Yes | see below | Full Google Sheets URL, OR the literal string `*` for admin wildcard rows. |
| C | `zone_name` | text | Recommended (blank for wildcard) | none | e.g. "Zone 42 - Briarwood". Drives picker display. |
| D | `captain_display_name` | text | Recommended (blank for wildcard) | none | Name shown in picker under the zone. |
| E | `contact_email` | text | Optional | `=OR(ISBLANK(E2), ISEMAIL(E2))` | Captain's correspondence email. NOT used for auth. |
| F | `role` | dropdown | Yes | dropdown: `captain` \| `admin` | Default `captain`. Extensible. |
| G | `active` | checkbox | Yes | Insert → Checkbox | Soft-delete flag. Server filters out rows where active ≠ TRUE. |
| H | `date_added` | date | Recommended | Date format | `=TODAY()` when adding. |
| I | `notes` | text | Optional | none | Free-form. e.g. "Replaced Jane 2026-03-15." |

**Validation for `sheet_url` (column B):**
```
=OR(B2="*", REGEXMATCH(B2, "docs\.google\.com/spreadsheets/d/[a-zA-Z0-9_-]+"))
```

### Conditional formatting: duplicate captain guard

Rule (red fill, applied to range `A2:I10000` or similar):
```
=AND($A2<>"", COUNTIF($A$2:$A, $A2)>1, COUNTIFS($A$2:$A, $A2, $F$2:$F, "<>admin")>0)
```

Plain English: **highlight any row whose `login_email` appears more than once AND at least one of those appearances is not role=admin.** Catches accidental duplicate captain assignments (policy: captains get one zone each). Ignores intentional multi-row admin cases. The server logs a corresponding warning at runtime as belt-and-suspenders (see `readUsersMap` spec below).

### Admin wildcard row (special case)

An admin row looks exactly like this:

```
login_email: john@altagether.org
sheet_url: *
zone_name: (blank)
captain_display_name: (blank)
contact_email: (optional, admin's preferred email)
role: admin
active: TRUE
date_added: 2026-04-21
notes: admin wildcard — grants access to all active zones
```

One wildcard row per admin.

### Initial data load

Use `migration_import.csv` at repo root. This was generated from `users.json` as of 2026-04-21 and contains:

- One row per (login_email, sheet_url) pair from current `users.json`.
- **Admin John's six explicit rows collapse into one wildcard row** (`sheet_url = *`). The wildcard picks up all zones automatically because every zone John had access to also has at least one captain-row.
- `role = captain` for all captain rows, `role = admin` for the wildcard row.
- `active = TRUE` on every row.
- `date_added = 2026-04-21`, `notes = "migrated from users.json 2026-04-21"`.
- `zone_name`, `captain_display_name`, `contact_email` left blank — admin fills in during / after paste.

Paste order: import the CSV into the Access tab (File → Import → Upload → `migration_import.csv` → "Replace current sheet"). Then fill in blanks as information becomes available.

---

## Manual Setup Checklist

Do these once, before shipping code. Order matters (especially the Vercel env var timing — see Rollout Plan).

1. **Create the sheet** in Google Drive. Name: "Zone Dashboard — User Access Registry".
2. **Put it in a dedicated folder**, separate from the zone sheets folder.
3. **Rename the default tab to `Access`.** Don't rely on `Sheet1`.
4. **Add the 9 column headers** from the schema table above as row 1.
5. **Freeze row 1** — View → Freeze → 1 row.
6. **Apply data validation** per the schema (ISEMAIL on A, wildcard-aware REGEXMATCH on B, email-or-blank on E, role dropdown on F, checkbox on G, date format on H).
7. **Apply conditional formatting** for the duplicate captain guard per the formula above.
8. **Share with the service account** `dashboard@nc-dashboard-v1.iam.gserviceaccount.com` as **Editor**.
9. **Import** `migration_import.csv` (File → Import → Upload → "Replace current sheet" or "Append to current sheet" as appropriate — replace is cleanest on a fresh tab).
10. **Review the paste.** Confirm the John wildcard row is present and correct. Check for the known `janet.ottersberg` duplicate and decide which to keep (see Data Hygiene below).
11. **Fill in blanks.** At minimum, populate `zone_name` and `captain_display_name` for all rows. `contact_email` can be filled in over time.
12. **Get the sheet ID** from the URL (the long string between `/d/` and `/edit`). Write it down for the Rollout Plan.

Do NOT add the env var to Vercel yet. Code must be deployed first (see Rollout Plan step 7).

---

## Code Changes Required

### New environment variables

```
USER_ACCESS_SHEET_ID=<the-sheet-id>
USE_LEGACY_USERS=<optional; set to "1" to force the legacy users.json path>
```

### `server.js`

#### Rename existing reader to `readUsersMapLegacy()` (currently ~line 53)

The entire current body of `readUsersMap()` is preserved as `readUsersMapLegacy()`. It stays sync, stays file/env-based. It is used for:
- Local development when `USER_ACCESS_SHEET_ID` is not set.
- Emergency rollback when `USE_LEGACY_USERS=1`.

Do not delete it. Do not modify its logic. Just rename.

#### New `readUsersMap()` (async, Sheet-backed, cached)

```javascript
let cachedUsersMap = null;
let cachedAt = 0;
const USERS_CACHE_TTL_MS = 60 * 1000;

async function readUsersMap() {
  // Kill-switch: force legacy path regardless of other env.
  if (String(process.env.USE_LEGACY_USERS || '').trim() === '1') {
    return readUsersMapLegacy();
  }

  const now = Date.now();
  if (cachedUsersMap && now - cachedAt < USERS_CACHE_TTL_MS) {
    return cachedUsersMap;
  }

  const accessSheetId = (process.env.USER_ACCESS_SHEET_ID || '').trim();
  if (!accessSheetId) return readUsersMapLegacy(); // local dev / unset-env safety

  try {
    const sheets = await getSheetsClient();
    const result = await sheets.spreadsheets.values.get({
      spreadsheetId: accessSheetId,
      range: 'Access!A2:I10000'
    });
    const rows = result.data.values || [];

    // First pass: captain rows build the zone catalog; wildcards collected for pass 2.
    const usersMap = {};                    // login_email -> [entry, ...]
    const zoneByUrl = {};                   // url -> { name, captains: [{name, contactEmail}] }
    const wildcardAdmins = [];              // login_emails with wildcard access
    const seenUrlsByEmail = {};             // login_email -> Set(url), per-user dedup
    const captainAssignmentCount = {};      // login_email -> count of captain-role active rows

    for (const row of rows) {
      const [
        loginEmailRaw,
        sheetUrlRaw,
        zoneNameRaw,
        captainNameRaw,
        contactEmailRaw,
        roleRaw,
        activeRaw
      ] = row;

      if (!loginEmailRaw || !sheetUrlRaw) continue;
      if (String(activeRaw || '').toUpperCase() !== 'TRUE') continue;

      const loginEmail = String(loginEmailRaw).trim().toLowerCase();
      const rawUrl = String(sheetUrlRaw).trim();
      const role = String(roleRaw || 'captain').trim().toLowerCase();

      if (rawUrl === '*') {
        if (role === 'admin') wildcardAdmins.push(loginEmail);
        continue; // wildcard rows do not contribute to zoneByUrl
      }

      const url = toCanonicalSheetUrl(rawUrl);
      if (!url) continue;

      if (!seenUrlsByEmail[loginEmail]) seenUrlsByEmail[loginEmail] = new Set();
      if (seenUrlsByEmail[loginEmail].has(url)) continue; // dedup same-user duplicate rows
      seenUrlsByEmail[loginEmail].add(url);

      const zoneName = String(zoneNameRaw || '').trim();
      const captainName = String(captainNameRaw || '').trim();
      const contactEmail = String(contactEmailRaw || '').trim();

      if (!zoneByUrl[url]) zoneByUrl[url] = { name: '', captains: [] };
      if (!zoneByUrl[url].name && zoneName) zoneByUrl[url].name = zoneName;
      if (role !== 'admin' && captainName) {
        zoneByUrl[url].captains.push({ name: captainName, contactEmail });
      }

      if (role !== 'admin') {
        captainAssignmentCount[loginEmail] = (captainAssignmentCount[loginEmail] || 0) + 1;
      }

      if (!usersMap[loginEmail]) usersMap[loginEmail] = [];
      usersMap[loginEmail].push({
        url,
        name: zoneName || url,
        captainName,
        contactEmail,
        role
      });
    }

    // Second pass: expand wildcard admins using zone catalog.
    for (const adminEmail of wildcardAdmins) {
      const adminEntries = [];
      for (const [url, meta] of Object.entries(zoneByUrl)) {
        const primary = meta.captains[0] || { name: '', contactEmail: '' };
        const extras = Math.max(0, meta.captains.length - 1);
        adminEntries.push({
          url,
          name: meta.name || url,
          captainName: primary.name + (extras > 0 ? ` +${extras}` : ''),
          contactEmail: primary.contactEmail,
          role: 'admin'
        });
      }
      adminEntries.sort((a, b) => a.name.localeCompare(b.name));

      // Preserve any explicit entries an admin may have on top of the wildcard
      // (rare, but not disallowed). Dedup by URL.
      const existing = usersMap[adminEmail] || [];
      const existingUrls = new Set(existing.map(e => e.url));
      usersMap[adminEmail] = [
        ...existing,
        ...adminEntries.filter(e => !existingUrls.has(e.url))
      ];
    }

    // Warn: captains with >1 active assignment (policy: captains get one zone).
    for (const [loginEmail, count] of Object.entries(captainAssignmentCount)) {
      if (count > 1 && !wildcardAdmins.includes(loginEmail)) {
        console.warn(`WARN: captain ${loginEmail} has ${count} active zone assignments`);
      }
    }

    cachedUsersMap = usersMap;
    cachedAt = now;
    return usersMap;
  } catch (err) {
    console.error('Failed to read user access sheet:', err.message);
    if (cachedUsersMap) return cachedUsersMap; // graceful degradation on transient failure
    throw err;                                  // propagate on cold-start during outage
  }
}
```

**Key design notes:**
- Cache is per-serverless-instance. 60s TTL bounds staleness globally.
- Only rows with `active === 'TRUE'` contribute.
- `*` in `sheet_url` is the admin wildcard sentinel. Non-admin `*` rows are silently ignored.
- `toCanonicalSheetUrl()` already exists (`server.js:114`). Reuse it — don't reimplement URL extraction.
- Per-user URL dedup prevents accidental duplicate rows from bloating the picker.
- Captain-with-multiple-assignments warning writes to stdout (visible in Vercel logs). Doesn't block — only warns.
- **On Sheet fetch failure:** serve stale cache if available (brief Sheets hiccups don't lock users out); propagate error only if no cached data exists (typically only on cold start during an active Sheets outage).
- **Do not auto-fall-back to the env var on Sheet failure.** That's Model A, explicitly rejected. The kill-switch is the rollback path.

#### Update `/api/user-sheets` handler (~line 156)

Becomes async. Post-migration entries are already rich objects (`{url, name, captainName, contactEmail, role}`) — **do not pass them through the legacy `normalizeUserSheetEntry`**, which strips `captainName`/`contactEmail`/`role`.

```javascript
app.get('/api/user-sheets', async (req, res) => {
  const emailParam = (req.query.email || '').toString().trim().toLowerCase();
  if (!emailParam) return res.status(400).json({ error: 'no_email' });

  try {
    const usersMap = await readUsersMap();
    const rawSheets = usersMap[emailParam];
    if (!Array.isArray(rawSheets) || rawSheets.length === 0) {
      return res.status(403).json({ error: 'not_registered' });
    }
    // Post-migration: entries are already normalized objects.
    // Legacy fallback: entries are strings -> run through the old normalizer.
    const sheets = rawSheets.map((entry, i) => {
      if (entry && typeof entry === 'object' && entry.url) return entry;
      const normalized = normalizeUserSheetEntry(entry);
      if (!normalized) throw new Error(`invalid sheet at index ${i}`);
      return normalized;
    });
    return res.status(200).json({ sheets });
  } catch (err) {
    const message = err && err.code === 'ENOENT'
      ? 'No users config is available on the server.'
      : `User access config is invalid: ${err.message}`;
    console.error('Error in /api/user-sheets:', message);
    return res.status(500).json({ error: 'users_config_error', message });
  }
});
```

#### Update `logUsersConfigStatusAtStartup()` (~line 137)

Must become async-aware (fire-and-forget). Don't block boot.

```javascript
function logUsersConfigStatusAtStartup() {
  readUsersMap()
    .then((map) => {
      const count = Object.keys(map).length;
      const source = String(process.env.USE_LEGACY_USERS || '').trim() === '1'
        ? 'legacy (kill-switch)'
        : (process.env.USER_ACCESS_SHEET_ID || '').trim()
          ? 'USER_ACCESS_SHEET_ID (Google Sheet)'
          : 'legacy (no USER_ACCESS_SHEET_ID set)';
      console.log(`User access config loaded from ${source}. Registered users: ${count}`);
    })
    .catch((err) => {
      if (err && err.code === 'ENOENT') {
        console.warn('No users config found. See USER_ACCESS_SHEET_MIGRATION.md.');
        return;
      }
      console.error(`User access config is malformed or unreadable: ${err.message}`);
    });
}
```

#### NEW endpoint: `/api/admin/refresh-users`

Admin-gated. Clears the cache so recent edits take effect immediately.

```javascript
app.post('/api/admin/refresh-users', async (req, res) => {
  const emailParam = (req.query.email || '').toString().trim().toLowerCase();
  if (!emailParam) return res.status(401).json({ error: 'no_email' });

  try {
    const currentMap = await readUsersMap();
    const rows = currentMap[emailParam] || [];
    const isAdmin = rows.some((r) => r && r.role === 'admin');
    if (!isAdmin) return res.status(401).json({ error: 'not_admin' });

    cachedUsersMap = null;
    cachedAt = 0;
    const fresh = await readUsersMap();
    return res.status(200).json({
      ok: true,
      cleared_at: new Date().toISOString(),
      user_count: Object.keys(fresh).length,
      total_assignments: Object.values(fresh).reduce((n, a) => n + a.length, 0)
    });
  } catch (err) {
    return res.status(500).json({ error: 'refresh_failed', message: err.message });
  }
});
```

**Security note:** email comes from a query param and is not authenticated. Same threat model as the rest of the app (Priority Roadmap 0.2). Both error paths return 401 to avoid leaking "this email exists but isn't admin."

#### NEW endpoint: `/api/admin/export-users-json`

Admin-gated. Returns the current users map in a `USERS_JSON_B64`-compatible shape for snapshot / rollback purposes.

```javascript
app.get('/api/admin/export-users-json', async (req, res) => {
  const emailParam = (req.query.email || '').toString().trim().toLowerCase();
  if (!emailParam) return res.status(401).json({ error: 'no_email' });

  try {
    const usersMap = await readUsersMap();
    const rows = usersMap[emailParam] || [];
    const isAdmin = rows.some((r) => r && r.role === 'admin');
    if (!isAdmin) return res.status(401).json({ error: 'not_admin' });

    const legacy = {
      _note: `FROZEN SNAPSHOT exported ${new Date().toISOString()} from Access Sheet. See USER_ACCESS_SHEET_MIGRATION.md → Rollback Plan.`
    };
    for (const [email, entries] of Object.entries(usersMap)) {
      legacy[email] = entries.map((e) => e.url);
    }
    const raw = JSON.stringify(legacy, null, 2);
    return res.status(200).json({
      json: legacy,
      base64: Buffer.from(raw, 'utf8').toString('base64'),
      raw
    });
  } catch (err) {
    return res.status(500).json({ error: 'export_failed', message: err.message });
  }
});
```

**Usage:** If you ever need to refresh the frozen `users.json` snapshot (e.g., before a risky change, or quarterly hygiene), hit this endpoint as an admin, copy the `raw` field into `users.json`, and copy the `base64` field into `USERS_JSON_B64` in Vercel. Endpoint is an escape valve, not used day-to-day.

### `index.html`

#### Update `normalizeSheetAssignments` (~line 1500)

Currently preserves only `{url, name}`. Must also preserve `captainName`, `contactEmail`, `role`:

```javascript
function normalizeSheetAssignments(sheets) {
  if (!Array.isArray(sheets)) return [];
  return sheets.map((sheet) => {
    if (typeof sheet === 'string') {
      const url = sheet.trim();
      return url ? { url, name: url } : null;
    }
    if (sheet && typeof sheet === 'object') {
      const url = String(sheet.url || '').trim();
      if (!url) return null;
      return {
        url,
        name: String(sheet.name || '').trim() || url,
        captainName: String(sheet.captainName || '').trim(),
        contactEmail: String(sheet.contactEmail || '').trim(),
        role: String(sheet.role || '').trim().toLowerCase()
      };
    }
    return null;
  }).filter(Boolean);
}
```

#### Zone picker rendering (~lines 2355-2378) — upgrade for scale

The current picker is a simple button list keyed off `sheet.name`. At 100+ zones (admin with wildcard), this is unusable. Add:

1. **Search input** above the list. Filters by substring match against `name` OR `captainName` (case-insensitive). Hidden when `availableSheets.length <= 6`.
2. **Two-line button:** zone name primary (bold/larger), captain name secondary (muted). Skip the captain line when blank (don't render "Captain: undefined").
3. **Admin chip** on the right of the button when `role === 'admin'`. Cosmetic but useful when browsing as admin to see "oh, these are my wildcard zones."
4. **Max-height + overflow scroll** on the list container. `max-height: 60vh` is a reasonable starting point.
5. **Sort:** alphabetical by `name`.
6. **URL on hover** via `title` attribute (debug escape valve).

Rough shape:

```javascript
} else if (welcomeAuthState === 'zone_picker') {
  const showSearch = availableSheets.length > 6;
  const renderList = (filter = '') => {
    const filterLower = filter.trim().toLowerCase();
    const filtered = availableSheets.filter((s) => {
      if (!filterLower) return true;
      return (s.name || '').toLowerCase().includes(filterLower)
          || (s.captainName || '').toLowerCase().includes(filterLower);
    });
    const sorted = filtered.slice().sort((a, b) => (a.name || '').localeCompare(b.name || ''));
    return sorted.map((sheet) => {
      const realIndex = availableSheets.indexOf(sheet);
      const zoneName = escapeHtml(sheet.name || `Zone ${realIndex + 1}`);
      const captain = sheet.captainName ? escapeHtml(sheet.captainName) : '';
      const roleChip = sheet.role === 'admin'
        ? '<span class="welcome-zone-role">admin</span>'
        : '';
      const captainLine = captain
        ? `<span class="welcome-zone-captain">Captain: ${captain}</span>`
        : '';
      return `
        <button class="welcome-load-btn welcome-zone-btn"
                data-sheet-index="${realIndex}"
                title="${escapeHtml(sheet.url)}">
          <span class="welcome-zone-name">${zoneName}</span>
          ${captainLine}
          ${roleChip}
        </button>`;
    }).join('') || '<p class="welcome-zone-empty">No zones match your search.</p>';
  };

  welcomeStep2.innerHTML = `
    <div class="welcome-step-header">
      <span class="welcome-step-number">2</span>
      <h3>Choose your zone</h3>
    </div>
    <p class="welcome-step-description">Select one of your authorized zone spreadsheets.</p>
    ${showSearch ? '<input type="text" id="welcomeZoneSearch" class="welcome-zone-search" placeholder="Search by zone or captain name…" autocomplete="off">' : ''}
    <div class="welcome-zone-list" id="welcomeZoneList">${renderList('')}</div>
  `;

  const listEl = document.getElementById('welcomeZoneList');
  const attachClickHandlers = () => {
    listEl.querySelectorAll('.welcome-zone-btn').forEach((button) => {
      button.addEventListener('click', () => {
        const index = Number(button.getAttribute('data-sheet-index'));
        const selectedSheet = Number.isFinite(index) ? availableSheets[index] : null;
        if (!selectedSheet?.url) return;
        welcomeAuthState = 'idle';
        welcomeAuthMessage = '';
        loadAuthorizedSheet(selectedSheet.url);
      });
    });
  };
  attachClickHandlers();

  if (showSearch) {
    const searchEl = document.getElementById('welcomeZoneSearch');
    searchEl.addEventListener('input', (e) => {
      listEl.innerHTML = renderList(e.target.value || '');
      attachClickHandlers();
    });
    searchEl.focus();
  }
}
```

**CSS additions** (roughly ~25 lines — match existing welcome-overlay style tokens):

```css
.welcome-zone-search {
  width: 100%;
  padding: 0.5rem 0.75rem;
  margin-bottom: 0.75rem;
  border: 1px solid /* border color */;
  border-radius: 6px;
  font-size: 1rem;
}
.welcome-zone-list {
  max-height: 60vh;
  overflow-y: auto;
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
}
.welcome-zone-btn {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 0.2rem;
  text-align: left;
  position: relative;
  padding: 0.75rem 1rem;
}
.welcome-zone-name { font-weight: 600; }
.welcome-zone-captain { font-size: 0.85rem; opacity: 0.75; }
.welcome-zone-role {
  position: absolute;
  top: 0.5rem;
  right: 0.75rem;
  font-size: 0.7rem;
  padding: 0.1rem 0.4rem;
  border-radius: 4px;
  background: /* subtle admin color, match app palette */;
}
.welcome-zone-empty { padding: 1rem; opacity: 0.7; }
```

Implementer: reuse existing color tokens, don't invent new ones.

#### Logged-in user's display name

Already handled by Google OAuth elsewhere in the file. No change needed.

---

## Rollout Plan

Zero-downtime cutover. Each step is reversible until step 9. Kill-switch exists from step 6 onward.

1. **Run the CSV generator** (already done: `migration_import.csv` at repo root).
2. **Manual sheet setup** per the "Manual Setup Checklist" above. **Do not yet add the env var to Vercel.**
3. **Verify service account access** — open the sheet, click Share, confirm `dashboard@nc-dashboard-v1.iam.gserviceaccount.com` is listed as Editor.
4. **Implement code changes** per "Code Changes Required."
5. **Test locally.** In `.env.local`, set `USER_ACCESS_SHEET_ID=<the-sheet-id>`. Run the dev server. Verify:
   - Sign-in for a single-zone captain auto-loads that zone.
   - Sign-in for the admin (wildcard row) shows the picker with all zones, search works.
   - Flipping `active=FALSE` on a row + hitting `/api/admin/refresh-users` removes access immediately.
   - `/api/admin/export-users-json` returns a sensible blob.
   - Unsetting `USER_ACCESS_SHEET_ID` locally falls back to `users.json` (legacy path).
   - Setting `USE_LEGACY_USERS=1` forces the legacy path even with `USER_ACCESS_SHEET_ID` set.
6. **Commit and push** code changes. Vercel builds.
7. **Deploy with NO env var change.** Code is live on production; `USER_ACCESS_SHEET_ID` is still unset in Production, so the app falls through to legacy `USERS_JSON_B64`. Production behavior unchanged. **This is your "code landed, nothing broke" checkpoint.** Spot-test a sign-in.
8. **Prepare the cutover.** Have the Vercel dashboard open on Environment Variables and a sign-in tab ready.
9. **Cutover.** Add `USER_ACCESS_SHEET_ID=<sheet-id>` to Vercel Production. Click Redeploy on the latest production deployment (Vercel does NOT auto-deploy on env var change — this is a common footgun).
10. **Smoke test production.** Sign in as admin (should see the picker, with search and proper captain names). Sign in as at least one captain (should auto-load their zone). Flip a captain's `active=FALSE`, hit `/api/admin/refresh-users`, confirm they're locked out.
11. **Freeze `USERS_JSON_B64` in Vercel.** Leave it untouched as a disaster-recovery artifact. Do not delete.
12. **Commit the frozen `users.json` snapshot.** Replace the current `users.json` with a version that has the `_note` field updated to:
    ```json
    "_note": "FROZEN SNAPSHOT as of 2026-04-XX. Live user access lives in the Access Sheet (USER_ACCESS_SHEET_ID env var, see Vercel). DO NOT edit this file during normal operations — changes here have no effect unless USE_LEGACY_USERS=1 is set. See USER_ACCESS_SHEET_MIGRATION.md → Rollback Plan if you're here because something broke.",
    ```
    Content of the data itself reflects the migration-day state (use `/api/admin/export-users-json` to get a consistent snapshot).
13. **Update `AUTH_AND_SPREADSHEET_ACCESS.md`** to describe the new flow.
14. **Update `PRIORITY_ROADMAP.md`** Tier 1 item 1.8: mark shipped with date.

---

## Rollback Plan (Model B — Manual Emergency Rollback)

**When to use:** The Sheet-based approach is catastrophically broken (Sheet deleted, SA access permanently lost, new bug in `readUsersMap()` causing mass sign-in failures).

### Option 1: Kill-switch (preferred, ~5 minutes)

1. In Vercel → Production Environment Variables: add `USE_LEGACY_USERS=1`.
2. Redeploy.
3. App reads from frozen `USERS_JSON_B64`. Sign-ins work again.
4. Investigate Sheet path offline. Remove `USE_LEGACY_USERS` and redeploy when fixed.

### Option 2: Full code revert (~15-30 minutes)

1. `git revert` the migration commit.
2. If `USERS_JSON_B64` has drifted from reality (it shouldn't under normal operation), update it using the last export from `/api/admin/export-users-json` if the endpoint is reachable, or rebuild manually.
3. Redeploy.

### Option 3: Emergency rebuild from CSV (last resort, ~30-60 minutes)

If both the Sheet API and the export endpoint are unreachable but the Sheet itself is accessible in the browser:

1. In Google Sheets: File → Download → Comma-separated values (on the Access tab).
2. Feed the CSV to a capable AI with the recovery prompt in the next section.
3. Paste the resulting JSON into `users.json`, commit.
4. Set `USE_LEGACY_USERS=1` in Vercel, redeploy.

### Recovery Prompt (for future AI agents)

If a future operator needs to rebuild `users.json` from a CSV export of the Access tab, paste the CSV into an AI assistant with this prompt:

```
You are given a CSV export of the Access tab from the Zone Dashboard's user access sheet.
Columns in order: login_email, sheet_url, zone_name, captain_display_name, contact_email, role, active, date_added, notes.

Produce a JSON object in the shape of users.json where each key is a lowercased login_email and each value is an array of canonical Google Sheets URLs in the form https://docs.google.com/spreadsheets/d/<ID>/edit.

Rules:
- Skip any row where `active` is not TRUE (case-insensitive).
- For rows where sheet_url is exactly "*" AND role is "admin": that login_email gets access to ALL unique canonical URLs that appear in active non-wildcard rows.
- For all other rows: canonicalize the URL by extracting the Google Sheets ID (the string after /spreadsheets/d/ matching [a-zA-Z0-9_-]+) and emitting https://docs.google.com/spreadsheets/d/<ID>/edit.
- Deduplicate URLs per user.
- Include a leading "_note" key explaining this is a recovery snapshot generated on <today's date>.
- Output valid JSON only, no prose or explanation.
```

---

## Data Hygiene — Items Flagged During Migration Design

Items the admin should resolve during the sheet-population step (Manual Setup Checklist #10):

1. **`janet.ottersberg@gmail.com` appears twice in `users.json`** (both references the same zone sheet). JSON object semantics silently de-duped this, but the CSV will show both rows. Review and delete one.
2. **`fiona.vajk@claremont.edu` and `fionayajk@gmail.com` both have access to the same zone.** Likely the same person with two Google logins (see Decision 5 — login vs. contact email distinction). Confirm; if it's one person with two Google accounts, both rows should stay.
3. **`john.t.mayo@gmail.com`** has access to one zone in the current `users.json`. It's not wildcarded in the migration CSV. If this is intended as a second admin account for John, change `role` to `admin` and `sheet_url` to `*` after paste.

---

## Future Phases (Deferred — Do Not Build Now)

### Phase 2: Admin UI in the dashboard

A simple `/admin` page: email field, zone dropdown, role dropdown, "Add" button. Appends a row to the admin sheet via the Sheets API (SA is already Editor, no change needed).

**Gated by:** role=admin check on the server.
**Value:** One-tap user onboarding from your phone.
**Cost:** Not worth building until sheet-editing flow starts feeling slow (may be never).

### Phase 3: Normalized Zones tab

When `zone_name` duplication drift becomes actually painful (rough threshold: ~200+ zones with frequent renames, not currently anticipated):

- New tab `Zones`: `sheet_url | zone_name | active | notes`.
- Drop `zone_name` from Access tab.
- Server joins on `sheet_url` when building the users map.

**Signal to revisit:** find-and-replace on `zone_name` happens more than monthly and feels annoying.

### Phase 4: Write-back from the app

`last_sign_in`, `last_active`, usage telemetry written back to the access sheet. Admin analytics. SA already has Editor, so no new permissions.

**Dependency:** Write-endpoint auth (Priority Roadmap 0.2).

### God Mode (Roadmap 3.4 — deferred separately)

The `role` column is the hook on which future god-mode features hang (cross-zone search, all-zones map, admin analytics). This migration deliberately does NOT build god mode; it only sets up the gating infrastructure. When god mode is designed, note that Mapbox GL can cluster-render 13,000+ points without trouble; the technical ceiling is not the blocker, the UX design is. Revisit after Tier 2 is stable.

---

## Open Questions / Decisions Deferred

- **Exact cache TTL:** 60 seconds is a starting guess. If new-user onboarding feels slow, drop to 15–30 seconds. Unlikely we'd raise it above 60.
- **Access sheet location in Drive:** Dedicated folder separate from zone sheets is strongly recommended. Exact folder TBD by admin.
- **Multiple admins:** Migration assumes John as sole admin with one wildcard row. When 2nd/3rd admins are onboarded, add wildcard rows for them.
- **`john.t.mayo@gmail.com`** — is this a second admin account? Decide during sheet population (see Data Hygiene #3).

---

## Related Improvements (Out of Scope Here)

These are related problems surfaced by the April 20 incident but NOT fixed by this migration:

- **Folder-inheritance sharing fragility.** Consider sharing individual sheets directly with the SA as defense-in-depth, or documenting the gotcha in `SERVICE_ACCOUNT_SETUP.md`.
- **localStorage-stuck-on-broken-sheet UX.** When `localStorage['savedSheetUrl']` points to a now-403ing sheet, users are stuck reloading the same error. Should fall back to the zone picker on fetch error.
- **Sheet ID not logged on API errors.** `server.js:667–669` logs the error but not the failing `sheetId`. Adding it would have immediately identified the problem sheet on April 20.
- **"From Altagether" announcements panel** uses a separate public-CSV path (`fetchPublicSheet()`), not the SA. Don't conflate outages.

Track in `PRIORITY_ROADMAP.md`.

---

## Implementation Effort Estimate

- Sheet setup and data migration: **45–75 minutes** (manual work; blank columns need filling).
- `server.js` changes (`readUsersMap` + 2 endpoints + startup logger + kill-switch): **2–2.5 hours**.
- `index.html` changes (picker with search + CSS): **45–60 minutes**.
- Testing (local + production smoke test): **45 minutes**.
- Documentation updates (`AUTH_AND_SPREADSHEET_ACCESS.md`, `PRIORITY_ROADMAP.md`, `users.json` header): **30 minutes**.

**Total: ~4–5 hours of focused work.**

---

## Acceptance Criteria

The migration is complete when all of the following are true:

- [ ] Admin can add a new captain by adding a row to the Access sheet and that captain successfully signs in within ~60 seconds, with no Vercel interaction.
- [ ] Admin can revoke a captain by setting `active=FALSE` (no row deletion) and that captain loses access within ~60 seconds.
- [ ] Admin's own zone picker displays all active zones with human-readable names + captain names, not URLs, with a working search input.
- [ ] A captain with exactly one assigned zone auto-loads into that zone on sign-in (existing behavior preserved).
- [ ] A captain whose only row has `active=FALSE` sees the "not registered" message.
- [ ] Sign-in works for all previously-active users with no data loss (verified by spot-checking ≥5 captains).
- [ ] `/api/admin/refresh-users` clears the cache and returns stats when called as admin; returns 401 otherwise.
- [ ] `/api/admin/export-users-json` returns a valid legacy-shaped blob when called as admin; returns 401 otherwise.
- [ ] Setting `USE_LEGACY_USERS=1` in Vercel + redeploying reverts the app to `USERS_JSON_B64` in ≤5 minutes.
- [ ] Duplicate captain conditional formatting visibly highlights duplicate rows in the Access sheet.
- [ ] Server logs a WARN line for any captain with >1 active assignment.
- [ ] `USERS_JSON_B64` and `users.json` are frozen snapshots; neither needs to be updated for routine user management.
- [ ] `AUTH_AND_SPREADSHEET_ACCESS.md` reflects the new flow.
- [ ] `users.json` header comment clearly marks the file as a frozen snapshot.
- [ ] Rollback path is documented and mentally walked through (actual rehearsal recommended but not required).

---

## Changelog

- **2026-04-20:** Plan first drafted by John Mayo in response to April 20 incident.
- **2026-04-21:** Plan refined after extensive design discussion. Changes:
  - **Added admin wildcard convention** (`sheet_url = *`). Replaces per-zone admin row duplication.
  - **Added `contact_email` column** and renamed `email` → `login_email` to distinguish auth-email from correspondence-email.
  - Renamed `captain_name` → `captain_display_name` for clarity about whose name it is and what it's for.
  - **Zone picker upgraded** with search input, two-line buttons, admin chip, max-height + scroll.
  - **`/api/admin/refresh-users`** promoted from optional to v1.
  - **`/api/admin/export-users-json`** added as a new v1 endpoint for snapshot readiness.
  - **`USE_LEGACY_USERS` kill-switch** promoted from optional to v1.
  - **Sheet-side conditional formatting** for duplicate captain detection added with exact formula.
  - **Server-side duplicate captain warning logs** added.
  - **Per-user URL dedup** at ingest added.
  - **Rollout resequenced** for zero-downtime cutover (deploy code inert, flip env var separately).
  - **Recovery prompt for AI agents** added.
  - **Frozen `users.json` header comment** specified.
  - **Two-tab schema considered and rejected** (over-engineered at current scale given wildcard solves the real pain).
  - **God mode (roadmap 3.4) explicitly deferred**, with note that the `role` column is its future hook.
  - **Data hygiene items** documented (janet dup, fiona email pair, john.t.mayo ambiguity).
  - **`migration_import.csv`** generated as part of the rollout prep artifact.

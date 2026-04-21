# Zone Dashboard: Authentication & Spreadsheet Access

**For advisors and stakeholders.** This document explains who can sign in, how user access is granted, and what to do if access breaks.

---

## Summary (Current Production Model)

- **Sign-in:** Any Google account can sign in with OAuth.
- **User authorization:** Access is granted by rows in the **User Access Sheet** (`Access` tab), not by editing `USERS_JSON_B64`.
- **Zone data access:** Zone spreadsheets still require sharing with the service account as Editor.
- **Admin wildcard:** Admins can have one row with `sheet_url = *` to inherit all active zones.
- **Emergency rollback:** Set `USE_LEGACY_USERS=1` and redeploy to force legacy snapshot mode.

---

## How Access Works

### 1) Identity (OAuth)

Google sign-in identifies the person (`login_email`). This does not grant sheet access by itself.

### 2) Authorization (Access Sheet)

The server reads the user registry from the Google Access Sheet (`Access!A2:I10000`) and builds the per-user zone list from active rows.

Required columns in each access row:

- `login_email`
- `sheet_url` (or `*` for admin wildcard rows)
- `role` (`captain` or `admin`)
- `active` (must be TRUE to count)

Rows with missing required fields or `active != TRUE` do not grant access.

### 3) Zone Spreadsheet Permissions

The dashboard reads/writes zone data through the configured service account. Each zone sheet must be shared with that service account as **Editor**.

---

## Admin Endpoints

These endpoints are role-gated (`role=admin`) and use the current app trust model (`?email=` query param).

- `POST /api/admin/refresh-users?email=<admin_email>`
  - Clears the 60s user-cache and reloads from the Access sheet immediately.
- `GET /api/admin/export-users-json?email=<admin_email>`
  - Exports a rollback snapshot in three formats: `json`, `raw`, `base64`.

---

## Operational Checklist

- Keep the access tab name exactly `Access`.
- Keep column order aligned with migration spec (A:I).
- Use `active=FALSE` for soft-revoke / placeholders.
- Use `/api/admin/refresh-users` after sheet edits when you need immediate propagation.
- Take periodic snapshots with `/api/admin/export-users-json` (quarterly + before risky changes).

---

## Emergency Rollback

If Access-sheet auth fails in production:

1. Set `USE_LEGACY_USERS=1` in Vercel Production.
2. Redeploy.
3. App will use frozen legacy snapshot access data.

Rollback details and recovery prompt live in:

- **[USER_ACCESS_SHEET_MIGRATION.md](USER_ACCESS_SHEET_MIGRATION.md)** (Rollback Plan section)

---

## Related Docs

- **[USER_ACCESS_SHEET_MIGRATION.md](USER_ACCESS_SHEET_MIGRATION.md)** — implementation and rollout source of truth
- **[SERVICE_ACCOUNT_SETUP.md](SERVICE_ACCOUNT_SETUP.md)** — service-account setup and sharing model
- **[PRIORITY_ROADMAP.md](PRIORITY_ROADMAP.md)** — roadmap status tracking

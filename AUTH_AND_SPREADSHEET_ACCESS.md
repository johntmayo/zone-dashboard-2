# Zone Dashboard: Authentication & Spreadsheet Access

**For advisors and stakeholders.** This document explains who can sign in, who can edit zone data, and how spreadsheet access is controlled.

---

## Summary

- **Sign-in:** Any Google account can sign in. There is no need to add users as "test users" in Google Cloud for this app.
- **Who can edit data:** Anyone you give the **spreadsheet URL** to can use the app to view and edit that sheet's data—as long as the sheet is shared with the app's **service account**. You do **not** need to share the spreadsheet with each user's Google account in Drive.

---

## How It Works

### Sign-in (Google)

The app uses "Sign in with Google" only to identify **who** the user is (e.g. for display, NC Profile row matching). It requests only basic identity scopes (email, openid). Google does not require each user to be added as a test user; any Google account can sign in.

### Spreadsheet Access

All reading and writing of spreadsheet data goes through **our server**. The server uses a single **Google service account** to call the Google Sheets API. Therefore:

- The only Google "account" that must have access to a zone spreadsheet is the **service account**. Each zone spreadsheet is shared with the service account email as **Editor**.
- The **user's** Google account does **not** need to be given access to the spreadsheet in Drive. They only need to sign in (for identity) and have the **spreadsheet URL** so the app can send requests to the server for that sheet.

### Implication

If you share the spreadsheet **URL** with someone (e.g. a captain or advisor), they can sign in with any Google account and use the app to view and edit that sheet's data. You do **not** need to add them as editors on the file in Google Drive. Control is: (1) who has the URL, and (2) ensuring the sheet is shared with the service account.

---

## Practical Checklist

- **To let someone use the dashboard for a zone:** Share the zone spreadsheet **URL** with them. Ensure that spreadsheet is shared with the **service account** email as Editor (this is typically done once per zone).
- **You do not need to:** Add users as test users in Google Cloud, or add each user as an editor on the spreadsheet in Google Drive.

---

## User Scale

The app can support 150–300+ users with the current setup. There is no per-user cap from Google for this type of sign-in, and no need to maintain a manual list of allowed users for basic access.

---

## Related Docs

- **[SERVICE_ACCOUNT_SETUP.md](SERVICE_ACCOUNT_SETUP.md)** — How to create the service account and share sheets with it.
- **[PLATFORM_OVERVIEW.md](PLATFORM_OVERVIEW.md)** — Full feature overview.

# Altagether Zone Dashboard

A short orientation for agents working in this repo. It explains what the product is. It is not a feature catalog or a setup guide.

**Last updated:** November 13, 2026

## What it is

The Zone Dashboard is an internal web app for Neighborhood Captains in Altadena, California. Captains use it to track households in their zone after the Eaton Fire: who lives there, what happened to the property, and whether anyone has actually been reached.

Altagether organizes the town into geographic zones. Each zone is a Google Sheet of people and addresses. The dashboard is the working interface on top of that sheet.

## Who uses it

Neighborhood Captains are the everyday users. A captain signs in with Google and sees the zone or zones assigned to them. Altagether admins can see more than one zone.

A separate public page, the NC Directory, lists captains. It is the same app, served at `directory.altagether.org`.

## What a captain does

1. Opens the dashboard and signs in with Google.
2. The server checks the User Access Sheet and loads that captain’s zone spreadsheet.
3. The captain works from a home overview, a map, and a neighbors list.
4. Edits, new records, and outreach logs write back to the zone sheet.

Captains are the source of truth for their zone. The sheet starts from mixed public data (voter rolls, county damage data, sales, and similar records) and will have gaps. Captains add missing addresses and people, correct what is wrong, and log outreach. A successful contact means a real two-way interaction, not a message that was only sent.

Only the captain and Altagether leadership see the full zone record, including names, phones, emails, notes, and outreach logs.

## Main surfaces

- **Home.** A snapshot of the zone: addresses, people, outreach coverage, fire damage, sales since the fire, and county permitting records (EPIC-LA).
- **Map.** Address markers on a Leaflet / Mapbox map, colored by status, with zone and recovery overlays.
- **Neighbors.** A filterable list of people and addresses. Opening a row shows a details panel for the property and the people who live there. Captains edit fields, log outreach, and add records from here.
- **Tools.** Batch updates across many addresses, a short “state of the neighborhood” summary, outreach language, flyers, a newsletter builder, and event templates.
- **Resources.** Links and reference material for helping neighbors and for captain work.
- **My NC Profile.** The captain’s own listing in the NC Directory.

Admin-only areas also exist, including an admin mode and a lot-weeding command center. They are not part of the everyday captain flow.

## How the data works

Google Sheets are the database.

- Each captain’s zone is its own spreadsheet, shared with a Google service account that the server uses to read and write.
- Rows are person-level. Several people often share one address, so property facts repeat across those rows.
- Sign-in proves who the person is. A row in the User Access Sheet is what grants them a zone. An active row needs an email, a sheet URL, a role (`captain` or `admin`), and an active flag. Admins can be granted every active zone.
- Shared feeds (announcements, the NC Directory, county record sync) live in their own sheets or jobs and are pulled into the dashboard by the server.

## How the app is built

An Express server (`server.js`) runs on Vercel. It serves the pages and proxies Google Sheets, map tokens, and a handful of feeds. The captain interface is mostly one large `index.html`, with styles in `public/css/styles.css` and some logic split into `public/js` modules and route folders (`epic`, `sales`, `godmode`, `lot-weeding`, `contact-checkin`, `recruitment`).

| Environment | Where |
|---|---|
| Production | `https://dashboard.altagether.org` (`main`) |
| Staging | `https://staging.dashboard.altagether.org` (`staging`) |
| NC Directory | `https://directory.altagether.org` |

New work happens on a feature branch, gets tested on staging, and reaches production through a pull request into `main`.

## Where to look next

Use this file for orientation. For current behavior, read the code. Other markdown files in the repo are setup notes, feature handoffs, or point-in-time audits, and some of them are older than the app.

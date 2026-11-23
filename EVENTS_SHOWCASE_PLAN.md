# Captain Events Showcase: Plan

Status: **planning**. One decision is still open (where the page lives, see "Open questions"). Nothing below has been built yet.

## Why we're building this

Captains already log events in the Zone Notebook (My Profile → Your zone). Right now only the captains in the same zone see them. This feature shows them to the whole captain network, to:

1. Let captains show off what they've done and feel their impact.
2. Give captains a sense of shared impact and of belonging to a network.
3. Use social proof to gently encourage captains who haven't hosted an event yet.
4. Inspire captains with real event ideas, and make hosting feel easier by showing who they could ask for advice.

It must stay behind sign-in. Only registered captains can see it, the same rule the Captain Directory uses (`requireNcDirectoryCaptain` in `server.js`).

## Decisions made

| Question | Decision |
| --- | --- |
| Who sees an event | **The whole network by default.** When adding or editing an event, a captain can mark it "Only my zone". |
| Photo storage | **A Shared Drive in Altagether's Google Workspace**, written by the existing service account. |
| How events are filed | **By the zone's sheet ID**, with the zone name **also kept in the spreadsheet** so admins can still read it. |
| Where the page lives | **Still open.** See below. |

## Open questions

### 1. Where should the showcase live? (main open decision)

- **Option A: a new sidebar tab in the dashboard, plus a teaser card on Home.**
  - Pros: captains see it every time they open the dashboard, which matters most for goals 2 and 3. No extra sign-in step. The Home card ("12 events across 9 zones this season, see what captains are doing") is the main way people would find it.
  - Cons: adding a sidebar item is a big call; it permanently takes a spot in the nav and on mobile. `index.html` is already very large.
- **Option B: a standalone signed-in page, like `nc-directory.html`, linked from the dashboard.**
  - Pros: no new sidebar item, a separate file that's easier to build and change, and the page can be linked directly in Discord or email.
  - Cons: easier to overlook. People will only find it through links, such as a Home card, a link on My Profile, and links in announcements.
- **Middle option:** start with B, plus a Home teaser card and a link next to the My Profile event form. Promote it to a sidebar tab later if people use it. Very little work is lost either way because the API and data model are the same.

### 2. Events logged before launch

Events added so far were entered under the wording "shared with the captains in your zone". If they all switch to network-visible at launch, announce it in the captain channels first and give captains a week to mark any event "Only my zone". Another option is to make existing rows zone-only and apply the network default only to new events. **Recommendation:** announce, then set existing events to network-visible.

## What captains would see

The data and API are the same whichever placement wins.

- **Header stats:** "N events · M zones · since <earliest year>", plus a count for this season. These counts celebrate the network as a whole and don't single anyone out.
- **Map:** every zone boundary drawn from the existing Mapbox zone dataset (the same source the Map tab uses).
  - Zones that have hosted events are filled in, and darker with more events. Zones that haven't stay outlined. The gentle pressure comes from seeing a filled-in map, never from a list of zones that haven't hosted.
  - Clicking a zone shows its events.
  - Events are placed by zone, not street address, so no event exposes a home address.
- **Feed:** event cards, newest first, with:
  - title, date (approximate dates show as "Spring 2025"), and zone
  - host captain names, each linking to their Captain Directory entry ("Ask them about it")
  - notes and up to 4 photo thumbnails
- **Your zone banner:**
  - If your zone has events: "Your zone has hosted N events", with a shortcut to add one.
  - If it has none: "Your zone hasn't logged an event yet. Log a past one or get ideas below." Then highlight the event types other captains have hosted most.
- **Later, maybe:** a "Kudos" button, filters by season or type (zone-issue tags are on hold, so event-type tags are too).

## Data model changes (Zone Notebook sheet)

Sheet: `1OZcPv_AKdolyDzZKRGk3DgDusj4u1acPcLUNnQQhBYA` (`ZONE_NOTEBOOK_SHEET_ID`), Events and Issues tabs.

### File by sheet ID, keep the name readable

- Add a `Sheet ID` column to **both** the Events and Issues tabs. This becomes the key for reads and writes, replacing `normalizeZoneKey(zone)`. That fixes the problem where other captains' Access rows "outvote" a zone rename, because renaming a zone no longer orphans its events.
- Keep the `Zone` column. The server rewrites it with the current resolved zone name on every write, and a read-time job can refresh it, so admins always see a human-readable name.
- **Backfill:** a one-time script (`scripts/backfill-zone-notebook-sheet-ids.js`) fills `Sheet ID` on existing rows by matching `Zone` to the Access sheet's resolved zone names. Rows that match nothing or more than one zone are left blank and printed for an admin to fix by hand.
- During the switch, reads use `Sheet ID` when present and fall back to the zone name for rows not yet backfilled.

### New Events columns

| Column | Notes |
| --- | --- |
| `Sheet ID` | Zone key (see above). |
| `Visibility` | `network` (default) or `zone`. A blank cell counts as `network`, unless we choose the zone-only option for existing events. |
| `Hosts` | Optional. Comma-separated captain names, defaulting to whoever added the event. Used for the "Ask them about it" links. |
| `Photos` | Comma-separated Drive file IDs, up to 4. |

Existing columns stay: `ID, Zone, Event, Date, Notes, Added By, Added On, Last Edited By, Last Edited On`. Approximate dates (`YYYY-MM`, `Spring YYYY`, `YYYY`) already work.

## API

All routes are signed-in and captain-only. They go in `zone-notebook/routes.js` (or a sibling `events-showcase/` module) and use the existing session-cookie helpers.

- `GET /api/events-showcase`: all `network` events, plus the caller's own zone's `zone` events. Each event comes with its zone name, sheet ID, host names and photo IDs, plus the header stats. Cached about 60s on the server, like `readUsersMap`. Never returns emails.
- `POST /api/zone-notebook/events/:id/photos`: uploads one photo (see the pipeline below). Only captains in that event's zone can call it.
- `DELETE /api/zone-notebook/events/:id/photos/:fileId`: removes a photo from the row and moves the Drive file to trash.
- `GET /api/event-photos/:fileId?size=thumb|full`: an auth-gated proxy that streams the image from Drive with `Cache-Control: private`. The Drive files are never made public.
- The existing event POST/PUT routes accept `visibility` and `hosts`.

## Photo pipeline (Google Shared Drive)

- **Setup (admin, one time):**
  1. Create a Shared Drive, for example "Zone Dashboard – Event Photos".
  2. Add the service account as **Content manager**.
  3. Enable the Drive API on the GCP project.
  4. Set `EVENT_PHOTOS_DRIVE_FOLDER_ID`.
- A Shared Drive is required because service accounts have no storage quota of their own, so uploads to "My Drive" fail.
- **In the browser:** before upload, resize to at most 1600px on the long edge and re-encode as JPEG through a canvas. This keeps each upload under Vercel's ~4.5 MB request limit and **removes EXIF data, including GPS location**.
- **On the server:**
  - Check the session, that the caller belongs to the zone, the MIME type, the size, and the 4-photo limit.
  - Upload to `<folder>/<sheetId>/<eventId>-<n>.jpg` and append the file ID to `Photos`.
  - Thumbnails come from Drive's `thumbnailLink` through the proxy, or from a second smaller upload if `thumbnailLink` proves unreliable.
- **Consent:** a checkbox on upload: "I have permission to share these photos with other captains, and any kids shown are OK with their parents." Captions are optional.
- **Deleting an event** trashes its photos.

## Build phases

1. **Re-key by sheet ID.** Add the `Sheet ID` column, run the backfill, and switch reads and writes over, keeping `Zone` readable. Small, separate PR that's safe to ship first.
2. **Visibility and hosts.** Add the "Only my zone" checkbox and Hosts field to the My Profile event form. Change the Your-zone wording to say events are visible to all captains unless marked otherwise. Announce to captains (see open question 2).
3. **Showcase page (no photos yet).** API, stats header, feed, map, and Your-zone banner, plus whichever placement we pick.
4. **Photos.** Shared Drive setup, upload/delete/proxy routes, client-side resizing, consent checkbox, thumbnails in the feed.
5. **Later:** kudos, filters, event-type tags.

## Risks and notes

- **Sheets write quota:** all writes share one service account (about 60 writes/min). Photo uploads go to Drive, not Sheets, but each one also writes one cell in the Events tab.
- **Zone names on the map:** zone polygons in the Mapbox dataset are matched by name. Names in the Access sheet can drift (the "outvoted rename" issue), so the map needs a name-matching step that tolerates small differences. Zones that can't be matched still show in the feed and are logged for an admin.
- **Local testing:** the local service-account key currently fails with `invalid_grant: Invalid JWT Signature`. We need a working key before we can test Sheets or Drive writes end to end; until then we test with stubbed endpoints.
- **Privacy:** events are placed only at the zone level, photos are served only through the auth-gated proxy, emails are never sent to the browser, and EXIF data is stripped before upload.

# Lot Weeding Admin Handoff

**Status:** Lot Weeding Command Center is feature-complete for the confirmed console design (June 2026). Staging validation completed on a copied intake sheet with revised columns and service-account Editor access. Recent work is **operator-driven UX polish** (filters bar, single-lot editor layout, contact formatting) plus the **Calendar-in-Map Planner view (Phase 1)** — in-panel calendar on the Map tab with day click/hover map highlighting, behind a reversible feature flag. Production cutover and write-flow tests remain when ready.

**Latest pass (calendar width, context bar, report copy, July 2026):**
- **Calendar tab sidebar fixed width** — day panel column locked at 380px (no minmax shrink/grow when day content changes).
- **Selection context chip removed** — no more "N selected" bar when switching away from Planner with a pin selected.
- **Impact report copy** — Altadena Talks Foundation branding; updated hero sub-header, About this program blurb, and footer.

**Previous pass (post-batch map reset + Clear selection, July 2026):**
- **Batch apply cleanup** — successful batch writes clear selection, drawn polygon, and day filter (batch schedule no longer sets `dayFilter`, which was dimming unrelated pins). Show filter auto-switches to match the action (e.g. Schedule → **Scheduled**).
- **Map: Clear selection** — after a draw-area group (or any multi-select), **Draw area** hides and **Clear selection** appears on the map until the group is cleared.

**Previous pass (day-filter tab hygiene + logo, July 2026):**
- **Day filter clears when opening Planner** — selecting a day on the full Calendar tab no longer leaves map dimming active after switching back to Planner.
- **No day chip on Planner or Calendar tabs** — the context bar no longer shows "Date selected" on either (day is visible in the calendar UI itself).
- **Partner logo doubled** — `.nav-header-partner-logo` `max-height` 144px → 288px.

**Previous pass (Planner polish + calendar UX, July 2026):**
- **Map tab renamed to Planner** (display label; internal `activeTab` id stays `map`). Standalone **Calendar** tab kept for wide-screen use.
- **Calendar visuals simplified (both instances):** removed light-blue "has lots" cell tint (count badge is enough); today is a small dot under the date (not a yellow box); selected day stays solid blue.
- **Default calendar month = current month** (not earliest scheduled month).
- **Redundant instructional copy removed** between grid and day panel.
- **Compact panel day list** — no nested card strokes inside the side panel; lot rows use light dividers only.
- **Side panel scroll** — Details/Calendar toggle stays pinned; only the panel body scrolls.
- **Day filter clears when leaving Calendar panel** — switching to Details (toggle or pin click) clears map dimming so editing doesn't fight a stale date highlight.
- **Draw-area selection lock** — shift+click on pins is ignored while a finished draw polygon is active; Clear removes the polygon.
- **Multi-selected pin ring** — charcoal/black instead of amber (no clash with Requested status color).

**Previous pass (Calendar-in-Map Planner view, Phase 1, July 2026):**
- **In-panel calendar on the Map tab** — when `LOT_WEEDING_PLANNER_CALENDAR_ENABLED` is `true` (default), the Map side panel gets a lightweight segmented **`[ Details ] [ Calendar ]`** toggle (distinct from the top tab bar). Map stays full-size on the left; calendar shares the row so operators see geography + schedule together.
- **Reversible by design** — set `LOT_WEEDING_PLANNER_CALENDAR_ENABLED = false` near the top of `index.html` to restore the pre-Planner Map panel instantly (no code removal). Standalone **Calendar** tab unchanged in Phase 1.
- **Shared calendar renderer** — extracted `renderLotWeedingAdminCalendarCore` / grid / day-panel HTML so the full Calendar tab and compact panel share one code path (month grid w/ counts, selected-day lot list, Copy day list + include-contact checkbox).
- **Day click → map highlight without map rebuild** — in-panel day selection sets `dayFilter` and calls `refreshLotWeedingAdminMapDayFilter()` (marker restyle + panel/context-bar swap only). Does **not** call `renderLotWeedingAdminView()` on the Map tab (avoids Leaflet teardown jank).
- **Hover-to-preview** — day-cell `mouseenter` sets transient `hoverDayFilter`; matching pins emphasize (grow) without dimming others. Click commits `dayFilter` (grow + dim non-matches). Cleared on mouseleave / day click / pin click.
- **Pin click auto-switches to Details** — `focusLotWeedingAdminLot` sets `panelTab = 'details'` so editing always shows the lot editor.
- **Panel width** — `.lot-weeding-admin-map-shell--planner` widens the side column cap to **420px** (fixed for both sub-tabs; map gives up ~5–8%). Flag off → original `360px` shell.
- **State** — `panelTab` (`details` | `calendar`), `hoverDayFilter`; switching sub-tabs preserves selection/batch state.
- **Copy note** — compact calendar hint clarifies only lots with **Date Scheduled** respond to day highlighting.
- **Map tab: no day context bar** — "Date selected" chip suppressed on **Planner** and **Calendar** tabs; clears when returning to Planner from Calendar.

**Previous pass (copy-button restyle + contact ordering, July 2026):**
- **Contact ordering unified to phone-first.** The requester contact line in the single-lot editor (`renderLotWeedingAdminContactHtml`) previously read **email · phone** while the Follow-ups line read **phone · email**. Both now render **phone · email**, and captain rows (`renderLotWeedingAdminCaptainsHtml`) were aligned to **name · phone · email** to match.
- **Email copy button now matches the rest of the app.** The lot-weeding copy button (`renderLotWeedingAdminCopyEmailButton`, used in the single-lot editor, captain rows, and Follow-ups contact lines) was rendering with the browser's default `<button>` chrome (grey box/border) because its markup only carried classes and neither `.copy-email-btn` nor `.lot-weeding-admin-copy-email` reset the native chrome — most visible/"weird" in the **Follow-ups** tab. Fixed purely in CSS: `.lot-weeding-admin-copy-email` now mirrors the Details-panel button (`.address-details .person-card__contact .copy-email-btn`) — `background:none; border:none; padding:0; margin-left:6px; inline-flex; vertical-align:-2px; color:var(--primary); opacity:0.5 → 1 on hover; 13px SVG`. Markup/JS unchanged (still hooks `.lot-weeding-admin-copy-email` for `attachLotWeedingAdminCopyEmailHandlers`), so it's a one-place fix that updates every copy button in the lot-weeding UI.

**Previous pass (login-landing consistency, July 2026):**
- **Signed-out users always land on the canonical Home login page.** The app previously restored the last-visited tab from `localStorage.currentView` on load *regardless of auth state*, so an expired session could drop you on a remembered tab (Admin/Profile/Tools/etc.) with an inconsistent or missing sign-in affordance — you'd have to click Home to actually log in. The init restore now requires a valid `accessToken` (`index.html`, the `savedView` restore block ~14406); otherwise it forces `home`. Tab memory still works for signed-in reloads. Note: this affects the whole app, not just lot-weeding — but zoneless **lot-weeding-only** users now reliably land on the Home welcome overlay when signed out, then get routed to the Command Center by `completeSignInAfterToken` after sign-in (unchanged).
- **No tab is a sign-in dead-end.** The global sign-in overlay (`#homeSigninPrompt`) now shows on any signed-out view that doesn't already render its own sign-in affordance, and is **no longer gated on a saved sheet URL** (`updateSignInUI`, ~2752). It's suppressed only for **Admin Mode** and **Lot Weeding Command Center** (own sign-in cards) and for **Home *when the welcome overlay is actually showing*** (i.e. no linked sheet / zone loading / zone picker). Important subtlety: the Home welcome overlay only appears when there's **no** `currentSheetUrl`, but a non-admin's saved sheet is restored into `currentSheetUrl` on load even while signed out — so on Home-with-a-remembered-sheet the welcome overlay is hidden and this overlay covers it instead (don't just exclude `home` unconditionally, or you recreate the dead-end). This fixed the Profile-tab dead-end and the admin case (admins have no saved sheet URL, so the overlay used to stay hidden on the middle tabs).
- **Verified** the Lot Weeding feature does **not** break login for normal users: capability flags default off, nav item is gated by `canAccessLotWeedingAdminView()`, `canOpenView`/`canOpenViewWithoutSheet` force `home` for unauthorized views, and the server independently enforces access on both GET and PATCH (`hasLotWeedingAdminAccess`, fails safe). `applyLotWeedingOnlyNavChrome` is a no-op for normal users and stays wrapped in try/catch.

**Previous pass (Stats "Generate Report" PDF, July 2026):**
- **Stats tab → "Generate Report" button** — one click produces a polished, **funder-facing PDF** ("Program Impact Report") intended to be attached to an email to potential funders (e.g. the County of Los Angeles) to show the program is thriving. Downloads directly; not an in-dashboard scrollable report.
- **Cover/hero banner** with the **ATF logo** (`public/images/atf-logo.png` via `LOT_WEEDING_PARTNER_LOGO_SRC`, embedded as a data URL so html2canvas renders it reliably), program title, mission tagline, and the generated date + time.
- **Contents:** today's date/time; an "at a glance" row (Total Requests, Lots Cleaned, Active Pipeline, Completion Rate); full **status breakdown** table (counts + % share, colored with the shared status palette); **program progress** cards (scheduled, needs attention, ROE returned, homeowners notified); **operational health** cards (ROE outstanding, scheduled-but-not-notified, missing APN, mapped coverage); **zones served** (top zones bar table + zone/captain counts); and **upcoming scheduled cleanings** (next work days). Report HTML is fully **inline-styled** so it's independent of the app stylesheet.
- **Filenames include date AND time** (multiple reports per day won't collide): `altadena-lot-weeding-report-YYYY-MM-DD-HHMM.pdf`.
- Reuses the already-loaded **`html2pdf.bundle.min.js`** (same lib as the Tools → Zone Analysis generator) — portrait letter, `page-break-inside:avoid` on card groups. New functions in `index.html`: `computeLotWeedingReportData`, `loadLotWeedingReportLogoDataUrl`, `buildLotWeedingReportHtml`, `generateLotWeedingAdminReport`; button wired in `attachLotWeedingAdminHandlers`. New CSS: `.lot-weeding-admin-report-cta*` / `.lot-weeding-admin-report-btn` / `.lot-weeding-admin-report-status`.

**Previous pass (UX polish + hardening, July 2026):**
- **Fifth tab: Help** — "How to Use This Tool" instructions (navigate map, edit a lot, group via Shift+click/Draw-area lasso, other tabs) + a "View Spreadsheet" link (`LOT_WEEDING_SPREADSHEET_URL`). ⚠️ The linked URL is the Altadena-Talks *original*; the tool actually reads a copy with revised headers. Confirm/repoint that link before relying on it.
- **Details card** — split into separate **Zone** and **Captain** rows. Captain row shows each captain's name + email (with small copy button); multiple captains are **semicolon-separated and aligned by index** across `captainName`/`captainEmail`. Phone numbers are now plain text (not tap-to-call). Email copy button is smaller/subtler. Follow-ups emails got the same copy button.
- **Context bar** — label is now contextual (**Date selected** / **Selection** / **Active filters**); day chip reads **Date:** not Day:. Fixed a bug where the bar/date lingered after clearing the last chip.
- **No auto-select on load** — the side panel opens on a "No lot selected" instructions state instead of auto-picking the top row.
- **Map height is fixed (700px)** again, with the side panel scrolling internally. (Reverted a variable-height experiment that caused scroll jank when selecting pins.)
- **Altagether Zones** overlay (renamed from "Zones") is **non-interactive**, sits under the pins, and shows **permanent, click-through labels** (zone name + captain names), lightly transparent so pins stay visible. Marker click focus outline removed.
- **Action dropdown labels standardized:** Schedule for a date / Mark Schedule Next / **Mark Cleaned** / **Mark Needs Attention**.
- **Pin/status palette + style now match the main app** — statuses recolored to the main map's `colorPalette` (Requested light-caramel `#fdba77`, Schedule Next soft-blush `#f9d6d3`, Scheduled sky-blue-light `#81bdc3`, Cleaned dry-sage `#afc892`, Needs Attention dusty-mauve `#bc455a`, Cancelled ash-grey `#e5e5e5`), and map markers converted from Leaflet `circleMarker` to the main app's SVG `divIcon` (offset charcoal shadow + charcoal stroke, grow-on-emphasis; amber ring for multi-selected). Badges echo the hues with darker legible text.
- **Captain phone** now shown in the details card (from the master sheet's `NC Phone` column, wired through `lot-weeding/routes.js`). **ⓘ** affordance added to the tooltipped Homeowner Notified / UWS Contract labels. Details card gained a heavy divider between Contact and Altagether Zone; "Zone"→"Altagether Zone", "Captain"→"Neighborhood Captain". Header kicker "Townwide operations"→"Neighbors helping neighbors". Partner logo path corrected to `public/images/atf-logo.png`.
- **Lot-weeding-only nav white-labeling** — for zoneless `lot_weeding_admin` users the left nav is stripped to just **Lot Weeding Command Center** + Sign out (no blur, other tabs/links hidden), and the partner logo (`public/images/atf-logo.png`, via `LOT_WEEDING_PARTNER_LOGO_SRC`) replaces the "Zone XX / Altagether" header. Falls back to the text title if the PNG is missing/fails to load. Logo sized via `.nav-header-partner-logo` (`max-height: 288px`, centered with `margin: 0 auto`; the ATF asset is a 700×1000 portrait so height is the binding constraint).
- **Sign out restyled (all nav variants, not just lot-weeding)** — no longer a full-width nav-tab; now a compact **centered pill** in the bottom cluster **below the Altagether logo, above Send feedback** (`#signOutBtn.nav-item` overrides in styles.css: auto width, centered, small text, pill border, no left accent bar, no hover slide). HTML order in `.nav-section-bottom` is logo → Sign out → feedback.
- **Bug fixes:** (1) fixed a **TDZ crash on load** — `LOT_WEEDING_PARTNER_LOGO_SRC` was used by `updateNavigationState()` during initial synchronous execution before its `const` was initialized, which halted init and trapped users on "Checking your zone access" unless they cleared cache; the const now lives near the top and the nav-chrome call is wrapped in try/catch. (2) **Expired-session recovery** — the Command Center error state now shows **"Sign in with Google"** (calls `signIn()`) when there's no token, instead of a dead "Try again".

**Previous pass:** grouping/batch overhaul — multi-select side panel rebuilt as one **Action picker → single form → summary → collapsible preview → one Apply button** (added **Mark Schedule Next** batch; "Date Scheduled"; removed "Writes … only" pills and duplicate lot lists). Unified selection language to **"N lots selected"**. Map controls simplified to Draw area / Finish + Cancel. **Shift+click** pins to add/remove; queue button **Add to selection / Remove**. Show dropdown + helper text; revised status colors; Schedule Next rename; tooltips; single-lot editor layout.

**Earlier passes:** batch completion/attention, NC zone overlay, draw-to-select, Follow-up writes, batch scheduling, tabbed console, local post-save refresh.

This document captures what was built, how it is configured, what was validated in staging, and what still needs attention before calling the workflow production-ready.

**Maintenance rule:** Always update this handoff document after making any Lot Weeding Admin changes — keep Status, Latest pass, What We Built, UX Expectations, Current Limitations, and the Handoff Prompt accurate for the next agent.

---

## Purpose

The **Lot Weeding Command Center** is a townwide operations console for managing post-fire lot-weeding requests in Altadena. Homeowners submit requests through an intake process; those rows land in a shared spreadsheet. This tool gives a dedicated lot-weeding administrator (or full admin) a single place to run the program — without pretending they are a Neighborhood Captain assigned to one zone sheet.

**What the admin is trying to accomplish:**

1. **See the whole pipeline geographically** — every open request on a map, colored by status, with enough context (address, APN, zone, contact info) to reason about where work should happen.
2. **Schedule volunteer weeding runs** — assign lots to cleaning dates, individually or in spatial clusters (draw an area, select lots, batch-schedule a work day).
3. **Run the calendar** — see what is scheduled when, highlight a day on the map, copy a day’s lot list for volunteers (address-only or with contact info).
4. **Clear follow-up queues** — missing APNs, ROE not returned, scheduled lots where the homeowner has not yet been marked notified; fix or record state without hunting through the spreadsheet.
5. **Close the loop on work** — mark lots cleaned (with date), flag blockers as needs attention, edit any row details in one side-panel editor backed by controlled sheet writes.

The spreadsheet remains the source of truth. The command center is the **operator UI** for triage, scheduling, follow-through, and completion — map-first for geography, calendar for timing, follow-ups for exceptions.

**Who uses it:** users with the `lot_weeding_admin` role (zoneless, curtailed dashboard) or full `admin` users who also see the normal NC dashboard.

---

## UX Expectations (Product Owner)

**Feature-complete is not the same as done.** The product owner places a high priority on **clear, usable UI/UX**. Operators should be able to pick up the tool without memorizing hidden multi-step flows or reconciling duplicate controls that do the same thing differently.

**Guiding principles for any future work:**

- **One obvious path per task** — if scheduling a group takes Draw → points → Select, the UI must say so inline; controls should not look broken or inert when idle.
- **No redundant competing controls** — prefer one clear edit/save pattern; removed single-lot status quick-actions and selection buttons from the filters bar for this reason.
- **Visible state** — active filters, selection count, and calendar day filter must never be hidden; the context bar exists for this reason.
- **Preview before writes** — batch operations show what will change; partial failures are reported per lot.
- **Labels match behavior** — “Select” on the map means “close drawn polygon and select lots inside,” not generic multi-select; naming and affordances must match.
- **Polish is first-class work** — copy, layout density, disabled/hidden states, and operator testing feedback should be treated as priorities alongside new features.

**Resolved (June–July 2026):**
- Single-lot status quick-actions removed.
- Map view filter is a **Show** dropdown + helper text (replaced the status chips/filter bar).
- Map heading bar removed (“Map workspace / Townwide lot-weeding requests / mapped counts”).
- Single-lot editor layout: editable fields top, read-only requester/contact/zone/captain bottom, Notes last; Map status lat/lon line removed from editor.
- Map **Select** button removed; drawing now uses **Draw area → Finish/Cancel** with inline hints. Build a selection via draw, **Shift+click** pins, or queue **Add to selection / Remove**.
- Multi-select side panel collapsed from three stacked batch cards into one **Action picker → form → summary → preview → Apply** flow; selection language unified to **"N lots selected"** (no duplicate count in the map box).
- **Help tab** added with getting-started instructions and the source-spreadsheet link.
- Side panel no longer auto-selects the top lot; opens on instructions instead.
- Map height fixed (no more variable-height scroll jank); side panel scrolls internally.
- Altagether Zones overlay is non-interactive with click-through name+captain labels (doesn't block the lasso or cover pins).
- Lot-weeding-only users get a stripped, white-labelable nav; expired sessions recover via an in-view "Sign in with Google" button.

Improvements in these areas are **expected next work**, not optional cosmetic fixes.

---

## What We Built

The dashboard supports a specialty, zoneless **Lot Weeding Command Center** inside the existing Zone Dashboard.

Key pieces:

- New top-level `Lot Weeding Admin` tab in `index.html`.
- New `lot_weeding_admin` role/capability in the access flow.
- Full `admin` users automatically inherit Lot Weeding Admin access.
- Users with only `lot_weeding_admin` can sign in without a zone sheet and land in a curtailed dashboard.
- Dedicated backend module at `lot-weeding/routes.js`.
- Role-gated request APIs:
  - `GET /api/lot-weeding-admin/requests`
  - `PATCH /api/lot-weeding-admin/request-row`
- Captain-facing lot-weeding reads still use `GET /api/lot-weeding/values`.
- Normalization layer maps messy spreadsheet headers into stable request fields (revised intake columns + mirror-era aliases).

### Tabbed operations console

`#lotWeedingAdminView` is a five-tab console — **Map / Calendar / Follow-ups / Stats / Help** — over one shared `lotWeedingAdminState`. Switching tabs preserves selection and calendar day filter.

- **Context bar** — selection count and calendar day filter chips (each clearable). Label is contextual: **Date selected** / **Selection** / **Active filters**. Reliably removed when the last chip is cleared.
- **Map tab** — **Show** dropdown (Active default + per-status views + All), helper text explaining the current view, search + Refresh, Leaflet map (no heading bar above map), status legend, sortable request queue, single-lot or multi-select side panel. Calendar day filter dims non-matching lots on the map.
- **Map controls** — **Altagether Zones** (overlay, informational only) and **Draw area** (click corners). While drawing the control swaps to **Finish** (close shape, select lots inside) + **Cancel**; a transient hint line appears only during drawing. No standalone "Select" button, no persistent selection count in the map box (the side panel owns selection state/language). Control cluster is fixed-width so it never reflows as buttons/labels change.
- **Altagether Zones overlay** — non-interactive (never captures clicks/hover, so the lasso works and it can't block pins), rendered under the pins, with **click-through labels** showing zone name + captain first names (`buildLotWeedingZoneTooltipLabel`), styled lightly transparent (`.lot-weeding-zone-label`). Off by default. **Labels are zoom-gated** — hidden until zoom ≥ `LOT_WEEDING_ZONE_LABEL_MIN_ZOOM` (reuses the main Map tab's `MAPBOX_ADDITIONAL_LAYER_CONFIG.labelMinZoom`, currently 16) via `updateLotWeedingZoneLabelVisibility()` on `zoomend`, which toggles `.lw-show-zone-labels` on the map container (same tooltip-hidden-by-CSS pattern as the main map's `show-nearby-zone-labels`). Keeps names from stacking up when zoomed out.
- **Building a selection** — draw an area (primary, bulk), **Shift+click** pins to add/remove individually, or use the queue **Add to selection / Remove** buttons. A plain pin click opens the single-lot editor (replaces selection). On load nothing is auto-selected — the panel shows a "No lot selected" instructions state.
- **Calendar tab (read-only)** — month grid on `Date Scheduled`, day selection → shared `dayFilter`, **Copy day list** with optional contact info (clipboard only).
- **Follow-ups tab** — **Missing APN**, **Scheduled but not notified**, **ROE outstanding** queues with inline contact info (email has a copy button), **Open & edit**, and one-click **Mark notified** (`Homeowner notified = Yes`) / **Mark ROE returned** (`ROE Status = Returned`).
- **Stats tab** — workload cards (Active, Schedule Next, Scheduled, Needs Attention, Missing APN, Cleaned, Total), plus a **"Generate Report"** button that downloads a funder-facing PDF (see Latest pass) — hero banner with ATF logo, date+time, all stats plus deeper breakdowns. Filenames include date + time.
- **Help tab** — "How to Use This Tool": navigate the map, edit a single lot, work several lots at once (Shift+click / Draw-area lasso), and what the other tabs do; plus the source-spreadsheet link (`LOT_WEEDING_SPREADSHEET_URL`). ⚠️ That link currently points at the Altadena-Talks original, not the revised-header copy the tool actually reads — verify before relying on it.
- **Single side-panel editor** — one lot at a time on the Map tab; **Save lot**. Layout (top → bottom): editable grid → hint → read-only Requester / Contact → heavy divider → **Altagether Zone** / **Neighborhood Captain** → **Notes** → Save. Panel is a fixed height and scrolls internally (map stays a fixed 700px; no layout reflow when selecting).
  - **Editable field order** (2 columns): Status | ROE Status; Date Scheduled | Date Cleaned; Homeowner Notified | UWS Contract; APN.
  - Tri-state fields (UWS Contract, Homeowner Notified, ROE Status) show **(unknown)** when blank (writes empty string). **Homeowner Notified** and **UWS Contract** labels have hover tooltips explaining each field.
  - **Contact:** requester email with a small/subtle copy button; **phone is plain text** (not tap-to-call).
  - **Neighborhood Captain:** separate row (below a heavy divider); each captain's name + email (with copy button) + phone (plain text, formatted). Multiple captains are **semicolon-separated in `captainName`/`captainEmail`/`captainPhone`, aligned by index** (`renderLotWeedingAdminCaptainsHtml`). Captain phone is mapped in `lot-weeding/routes.js` (request + context columns via `nc phone`/`captain phone`/`captain_phone`/`contact phone` aliases; name matcher excludes email/phone columns).
  - Tooltipped labels (**Homeowner Notified**, **UWS Contract**) show a subtle **ⓘ** affordance (`.lot-weeding-admin-tip-icon`) next to the text; the tooltip itself is still the native `title` attribute.
  - **Last Contact Date** removed from UI and PATCH (no longer on intake sheet).
  - Assigning `Date Scheduled` auto-sets `Status = Scheduled`. `Homeowner notified` is manual only — never auto-set by scheduling or batch actions.
- **Map view filter** — **Show** dropdown (not status chips); helper text below explains Active vs each status view. Not a selection/scheduling toolbar.
- **Multi-select side panel** — single panel for 2+ selected lots: header **"N lots selected"** + **Clear**, status-mix/mapped summary, collapsible **View selected lots** list, then one **Action** picker → one form → plain-language summary → collapsible per-lot preview → one **Apply** button + per-lot results. Replaced the old three stacked batch cards (no more "Writes … only" pills, no duplicate lot lists).
- **Batch group actions** (action picker) — all use sequential `PATCH /api/lot-weeding-admin/request-row` with summary, collapsible preview, single confirm, and per-lot partial-failure reporting:
  - Schedule for a date → `Date Scheduled` + `Status = Scheduled`
  - Mark Schedule Next → `Status = Schedule Next` only
  - Mark Cleaned → `Status = Cleaned` + `Date Cleaned`
  - Mark Needs Attention → `Status = Needs Attention`; optional note appended to Request notes (`details`)

Saves PATCH the sheet, merge into `lotWeedingAdminState.requests`, recompute stats locally, and refresh map/table/side panel in place (no full reload after every save).

Focused normalization/config tests live in `test/lot-weeding.test.js`.

---

## Staging / Source Sheet Setup (Completed)

The product owner completed staging setup and validation:

1. **Copied** the intake spreadsheet (live original left unchanged).
2. **Revised** the copy to the target column schema (see Recognized Intake Columns below).
3. **Shared** the copy with the service account as **Editor**.
4. Pointed staging at the copy via `LOT_WEEDING_SOURCE_SHEET_ID` or `LOT_WEEDING_SOURCE_SHEET_URL` (and `LOT_WEEDING_SOURCE_SHEET_NAME` if needed).
5. **Validated:**
   - `lot_weeding_admin`-only login (Access Sheet row with `role:lot_weeding_admin`)
   - Full admin access (normal dashboard + Lot Weeding Admin tab)
   - Controlled writes against the revised source (single-lot and batch flows)
   - Captain-facing lot-weeding surfaces after source/schema switch
   - Revised status vocabulary in live data
   - Map with APN-matched coordinates

Do not treat the central mirror (`LOT_WEEDING_SHEET_ID`) as the write target for real admin work — edits there may not flow back to the partner-owned sheet and mirror refreshes can overwrite changes.

---

## Important Architecture Decision

Lot Weeding Admin is modeled as a role-based specialty workflow, not as a fake Neighborhood Captain assignment.

A Lot Weeding Admin may not belong to Altagether, be an NC, have an assigned zone, or need the normal Map / Neighbors / Actions / Tools workflow.

The access model allows roles/capabilities even when `sheets: []`.

---

## Access Sheet Setup

Full admins do not need a new Access Sheet row — `admin` grants Lot Weeding Admin access.

For a specialty Lot Weeding Admin user:

| Column | Value |
|---|---|
| `login_email` | Their Google login email |
| `sheet_url` | `role:lot_weeding_admin` |
| `role` | `lot_weeding_admin` |
| `active` | `TRUE` |

The `role:lot_weeding_admin` value is a sentinel; the server does not parse it as a Google Sheet URL.

---

## Environment Variables

Source sheet priority:

```ini
LOT_WEEDING_SOURCE_SHEET_ID=
LOT_WEEDING_SOURCE_SHEET_URL=
LOT_WEEDING_SOURCE_SHEET_NAME=
LOT_WEEDING_SOURCE_RANGE=A1:ZZ5000
LOT_WEEDING_SOURCE_LABEL=original
```

Aliases: `LOT_WEEDING_INTAKE_SHEET_*`

Mirror fallback (smoke-test only; avoid writes):

```ini
LOT_WEEDING_SHEET_ID=
LOT_WEEDING_SHEET_URL=
LOT_WEEDING_SHEET_NAME=
```

---

## Service Account Access

- **Viewer** — read-only smoke testing
- **Editor** — required for admin PATCH writes on the configured source sheet

---

## Recognized Intake Columns

Target revised fields:

- `Request Submission Date Stamp`
- `Name of Homeowner`
- `Address of Property`
- `Phone Number of Homeowner`
- `Email of Homeowner`
- `Universal Waste Systems contract Y/N`
- `Last contact date` (legacy reads only; not editable in admin UI)
- `Date Scheduled`
- `Homeowner notified of schedule`
- `Date Cleaned`
- `ROE Status`
- `Notes`
- `APN`
- `Status`

Mirror-era aliases remain supported (`Timestamp`, `lot_weeding_*_spring_2026`, etc.).

Editable PATCH fields: `apn`, `status`, `scheduledDate`, `homeownerNotified`, `dateCleaned`, `roeStatus`, `universalWasteContract`, `details`.

---

## Status Vocabulary

Pin/status colors reuse the **main app's palette** (`colorPalette` in the non-lot-weeding map):

- `Requested` — submitted, not prioritized (`#fdba77` light-caramel)
- `Schedule Next` — look at next (`#f9d6d3` soft-blush); legacy `On-Deck` normalizes to this
- `Scheduled` — assigned to a date (`#81bdc3` sky-blue-light)
- `Cleaned` — weeding completed (`#afc892` dry-sage)
- `Needs Attention` — blocker / manual review (`#bc455a` dusty-mauve)
- `Cancelled` — no longer active (`#e5e5e5` ash-grey)

Map markers use the main app's SVG pin style (`buildLotWeedingAdminMarkerIcon`): status-colored circle + hard offset charcoal shadow + charcoal stroke, growing when emphasized (focused/day-hit/selected); multi-selected pins get an amber (`#FBBF24`) ring. Dimmed (day filter non-match) via marker opacity. Admin badges echo the same hues (background tint + border) but use a **darker text of each hue** so small pill text stays legible (`.lot-weeding-admin-status--*` in styles.css).

Legacy: `Completed` → `Cleaned`, `Flagged` → `Needs Attention`, `Open` → `Requested`.

`ROE Status` is separate: blank, `Requested`, `Returned` (legacy booleans → `Returned`).

---

## Zone/Captain Context

Enrichment by APN from `GODMODE_MASTER_SHEET_ID` / `GODMODE_MASTER_RANGE`, or overrides:

```ini
LOT_WEEDING_CONTEXT_SHEET_ID=
LOT_WEEDING_CONTEXT_RANGE=
```

Coordinates come from the **intake sheet** (`Latitude`/`Lat`, `Longitude`/`Lng`/etc.) when present; otherwise from **APN join to the godmode master/context sheet** (`GODMODE_MASTER_SHEET_ID` or `LOT_WEEDING_CONTEXT_SHEET_ID`). The API returns `latitude` and `longitude` on each request; the map uses those for markers. There is **no client-side geocoding** — lots without usable coordinates are unmapped (still in queue/Follow-ups). Missing APN or context → blank zone/captain.

---

## Files Changed

- `server.js`
- `index.html`
- `public/css/styles.css`
- `lot-weeding/routes.js`
- `test/lot-weeding.test.js`
- `public/images/atf-logo.png` (partner logo for lot-weeding-only nav; app degrades gracefully if absent)

---

## Confirmed Console Design (June 25, 2026)

Settled with the product owner. All items below are **implemented** unless noted under Current Limitations.

### Build order — all DONE

1. Tab split + active context bar — June 25, 2026  
2. Calendar tab (read-only, day filter, copy list) — June 25, 2026  
3. Follow-up queues + one-click Mark notified / Mark ROE returned — June 2026  
4. Batch scheduling writes — June 25, 2026  
5. NC zone overlay — June 2026  
6. Drawn polygon selection → group batch actions — June 2026  
7. Batch completion / attention workflows — June 26, 2026  

### Locked design rules

- **Tabbed console:** Map / Calendar / Follow-ups / Stats / Help (five tabs); shared state across tabs.
- **Single editor** on Map tab; no per-row inline editing in the queue; no status quick-action buttons.
- **Assigning `Date Scheduled` auto-sets `Scheduled`**; **`Homeowner notified of schedule` is always manual** (side panel, Follow-ups Mark notified, or spreadsheet — never set by schedule/clean/attention batch writes).
- **Date pickers** for all date fields in the UI.
- **Day export** — address-only or with contact info; clipboard only.
- **NC zones** — overlay only, off by default, not a filter.
- **Batch writes** — preview before commit; partial-failure reporting per lot.

Single-lot and batch writes use `PATCH /api/lot-weeding-admin/request-row` (batch iterates single-row PATCHs intentionally).

---

## Current Limitations

The command center is operational but **UX polish is still needed** based on operator testing. Known rough edges:

- No dedicated map warning layer for edge cases (e.g. Scheduled without date).
- No address geocode fallback for unmapped lots (coordinates from APN/context join only).
- No batch PATCH endpoint (sequential writes only).
- No audit log or row conflict detection.
- No polished mobile workflow for heavy editing.
- Write-flow automated tests are thin (normalization only in `test/lot-weeding.test.js`).

Not planned: persistent named Groups / deployment-group object model; generic sheet-write API beyond the narrow PATCH path.

---

## Next Work

1. **Planner polish** — operator feedback iterations (ongoing).
2. **UX polish** from real operator use — copy/help text, edge-case warnings, mobile workflow.
3. **Production cutover** when ready — point production env at the validated source sheet (staging copy or approved production intake); do not switch env vars casually.
4. **Write-flow tests** — PATCH field mapping, batch partial-failure, date round-trip, note append.
5. **Optional:** narrow batch PATCH endpoint if large group sizes become slow.

---

## Planned Feature (Phase 1 DONE): Calendar-in-Map "Planner" view

> ✅ **Phase 1 implemented (July 2026)** behind `LOT_WEEDING_PLANNER_CALENDAR_ENABLED` (default `true`). Set to `false` to revert instantly. **Planner** tab label shipped; standalone **Calendar** tab retained for wide-screen. Day filter auto-clears when switching back to Details.

**The goal in one sentence:** let the operator see the **map and the calendar at the same time**, and have clicking/hovering a calendar day **highlight that day's lots on the map** — turning scheduling into a spatial+temporal activity on one screen.

**Why this is mostly a layout/wiring job, not new logic:** the highlight already works. When `lotWeedingAdminState.dayFilter` is set, `applyLotWeedingAdminMarkerStyle` (`index.html` ~4914) already computes `dayHit` (grow matching pins) + `dimmed` (fade the rest), and `refreshLotWeedingAdminMarkerStyles()` (~4936) restyles all markers **in place with no map rebuild**. The Calendar tab already writes `dayFilter` on day click (~6672). The only reason the "magic" isn't visible today is that Map and Calendar are separate tabs that never appear together.

### Agreed design (from the discussion)

- **Do NOT duplicate the map onto the Calendar tab.** (Rejected — a second Leaflet instance means double markers/memory and sync bugs; reparenting the one map is fiddly.)
- **Put the calendar in the Map tab's right-hand side panel as a second sub-tab** — a small **`[ Details ] [ Calendar ]`** toggle at the top of the side panel. Map stays full-size on the left and is always visible (same row = visible together, no scrolling). The map/panel already sit side-by-side via `.lot-weeding-admin-map-shell` (`public/css/styles.css` ~3932, `grid-template-columns: minmax(0, 1fr) minmax(310px, 360px)`).
  - **Style it as a lightweight segmented control, NOT a second tab bar.** The "tab-within-a-tab" worry dissolves as long as the in-panel toggle looks clearly *different* from the top-level tabs (Map/Calendar/Follow-ups/Stats/Help): the top tabs are the primary nav (underlined tabs); the panel toggle should read as a small segmented pill — different shape/weight/size — with only the two options. Nested tabs are a smell only when the inner control mimics the outer one; a differentiated segmented control is a standard, accepted pattern (Figma inspector, devtools side panels, etc.).
  - **Framing:** it's really "Details is home + Calendar is one alternate mode," not two coequal nested tabs. "Details" encompasses the panel's existing three states (single-lot editor / multi-select batch / idle); "Calendar" is the toggle-away mode. That mental model keeps it from feeling like duplicated navigation.
  - **State persistence:** switching Details↔Calendar must swap only the panel *body* — do NOT reset selection/batch state. If the operator is mid-batch-selection, flips to Calendar, then back, the batch form + selection must still be there. (Use a `panelTab` state field; don't tear down batch state on toggle.)
  - The **Phase 2 rename (Map→"Planner") reinforces this** — "Planner → Details / Calendar" reads more naturally than "Map → Details / Calendar" (a calendar under a tab literally named "Map" is slightly odd). Consider doing the rename early if the compact calendar reaches parity quickly.
- **Give the calendar more room by widening the side panel to a FIXED width (map gives up ~10%).** Bump the panel column cap from `360px` to roughly **400–430px** in `.lot-weeding-admin-map-shell` (`public/css/styles.css` ~3932, currently `grid-template-columns: minmax(0, 1fr) minmax(310px, 360px)`). At ~360px a 7-col month grid is ~38px cells (tight); ~400–430px gets ~50–55px cells (comfortable). The map barely notices (~5–8% on a typical workspace) and Leaflet's existing `invalidateSize()` keeps the resize clean.
  - **⚠️ The width is FIXED — do NOT make the panel width change depending on which sub-tab (Details vs Calendar) is active.** The product owner was explicit about this: a width that shifts on toggle would force the map to resize on every switch (the exact scroll/layout jank the team already fought and reverted). One stable split for both sub-tabs.
  - This widening is a **nice-to-have, not a blocker** — a compact calendar can fit at 360px; if the wider panel crowds the map on smaller laptops it's fine to dial back.
- **Compact-calendar must carry over everything the Calendar tab does:** the month grid with per-day scheduled-lot **counts**, the **list of lots scheduled** for the selected day, and the **Copy day list** button + the **"include contact info"** checkbox. Reuse/extract from `renderLotWeedingAdminCalendarTab` (`index.html` ~6007) into a compact renderer that fits the ~310–360px-wide, 700px-tall panel (`.lot-weeding-admin-side-panel` ~4099).
- **Clicking a map pin auto-switches the side panel back to the Details (lot) sub-tab** so the operator can edit that lot. (A plain pin click already calls `focusLotWeedingAdminLot`; just also flip the panel's sub-tab to Details.)
- **Hover-to-preview (nice-to-have, cheap):** on a day cell `mouseenter`, set a transient hover-day (separate from the committed `dayFilter`), and call `refreshLotWeedingAdminMarkerStyles()`; clear on `mouseleave`. For hover, prefer emphasizing matches only (grow / ring) rather than also dimming everything, so it reads as a light preview vs. click = commit. This is a small branch in `applyLotWeedingAdminMarkerStyle`.

### Phasing / the Calendar-tab redundancy

- **Phase 1 (build now):** add the in-panel Calendar sub-tab on the Map tab; **keep the standalone Calendar tab for now.** They share render code so the duplication is cheap. Wire click-a-day → highlight (mostly already works) and the pin-click → Details auto-switch.
- **Phase 2 (likely, product owner leaning this way):** remove the redundancy by **renaming the "Map" tab to "Planner"** (map + in-panel calendar) and **retiring the standalone Calendar tab** once the compact calendar reaches parity (it should, since the Calendar tab is just: grid w/ counts, day's lot list, copy button + optional-contact checkbox). Don't do this until the in-panel version is confirmed to feel good.

### Implementation pointers (files/functions)

- Side-panel sub-tab state: add something like `lotWeedingAdminState.panelTab` (`details` | `calendar`); default `details`. Reset to `details` on pin click (`focusLotWeedingAdminLot`).
- Map tab renderer: `renderLotWeedingAdminMapTab` (`index.html` ~5880) — add the sub-tab toggle + conditional panel body.
- Side panel renderer: `renderLotWeedingAdminSidePanel` — branch on `panelTab`.
- Calendar rendering to reuse/compact: `renderLotWeedingAdminCalendarTab` (~6007); day-click handler pattern (~6672); Copy-day-list handler + `includeContactInfo` toggle (~6688).
- Marker highlight: `applyLotWeedingAdminMarkerStyle` (~4914) + `refreshLotWeedingAdminMarkerStyles` (~4936); shared `dayFilter` state (~1270).
- Layout: `.lot-weeding-admin-map-shell` columns (~3932) for the ~10% map→panel width shift; `.lot-weeding-admin-side-panel` (~4099, 700px tall, scrolls) for the compact calendar fit.
- **Mobile:** the map is a deliberate fixed 700px with an internally-scrolling panel (don't reintroduce variable map height). On narrow screens the panel stacks under the map (`.lot-weeding-admin-map-shell` collapses to one column ~4982) — make sure the sub-tab + compact calendar degrade sensibly there.

### Watch-outs

- Only **scheduled** lots (those with `Date Scheduled`) respond to day highlight; Requested/Schedule-Next lots have no date and won't light up — add a touch of copy so that doesn't read as a bug.
- Keep the existing context-bar **Date chip** behavior (it already reflects `dayFilter` and clears cleanly) working with the in-panel calendar.
- Don't regress the single-map / Map-tab-only init model (`initializeLotWeedingAdminMap` runs only when `activeTab === 'map'`, ~5349; `destroyLotWeedingAdminMap` on re-render). The in-panel calendar must not rebuild the map on day click/hover — use `refreshLotWeedingAdminMarkerStyles()`.

---

## Possible Future Work: View-Only Role (`lot_weeding_viewer`)

> ⚠️ **Status: NOT COMMITTED — may or may not ever be built.** A single stakeholder asked for a read-only way to share the command center more broadly. As of July 2026 the product owner is undecided; the value and the number of potential view-only users are being assessed (stakeholder meeting pending). Do **not** implement this proactively — only build it if the product owner explicitly greenlights it. Documented here so the plan isn't lost.

**Goal:** a `lot_weeding_viewer` role that can open the command center and see everything (map, pins, Details card, Calendar, Follow-ups, Stats, Help) but **cannot write anything**.

**Why it's low-risk:** reads and writes are already gated by *separate* server checks. The `GET /api/lot-weeding-admin/requests` and `PATCH /api/lot-weeding-admin/request-row` endpoints each independently call `hasLotWeedingAdminAccess(email)` (`lot-weeding/routes.js` ~676 and ~699). A viewer only needs the **read** gate loosened while the **write** gate stays admin-only — so even if a write control is missed in the UI, the server rejects the PATCH with `401` (fails safe, never a bad write).

**Intended UX (deliberately minimal — same app, controls disabled in place; do NOT build a separate screen):**
- Viewer sees the identical interface, nothing hidden or restructured.
- Editable fields (Status, ROE Status, dates, APN, Notes, tri-states) render **`disabled`** (native greyed-out read-only look — near-zero new CSS).
- The three write buttons simply **do not render** for viewers: single-lot **Save lot** (`index.html` ~5169), batch **Apply** (`#lotWeedingBatchApplyBtn`, ~4306), and Follow-ups **Mark notified / Mark ROE returned** (~5817).
- Add a small **"View only"** banner/kicker so the disabled state reads as intentional.

**Implementation sketch:**

_Backend (`server.js`, `lot-weeding/routes.js`) — small, low-risk:_
1. Add `LOT_WEEDING_VIEWER_ROLE = 'lot_weeding_viewer'`.
2. Add `hasLotWeedingViewAccess(email)` → true for `admin`, `lot_weeding_admin`, OR `lot_weeding_viewer`. (Mirror `hasLotWeedingAdminAccess`, `server.js` ~144; pass it into `registerLotWeedingRoutes` deps alongside the existing one.)
3. Gate **GET** `/api/lot-weeding-admin/requests` with `hasLotWeedingViewAccess`; leave **PATCH** `/api/lot-weeding-admin/request-row` on `hasLotWeedingAdminAccess`. **This swap is the actual security boundary.**
4. `collectAccessCapabilities` (`server.js` ~122): optionally have `lot_weeding_admin`/`admin` imply the viewer capability too (so admins still read). The `role:lot_weeding_viewer` sentinel already works for zoneless login via the generic `getRoleGrantFromSheetUrl`.

_Frontend (`index.html`) — moderate, but contained (3 write surfaces):_
1. Derive `isCurrentUserLotWeedingViewer` from `currentUserCapabilities` (populated ~1776).
2. Let `canAccessLotWeedingAdminView()` (~3015) include viewers so the tab shows and data loads (viewers are also zoneless → reuse the stripped `applyLotWeedingOnlyNavChrome` nav treatment).
3. When viewer: add `disabled` to editable fields in the single-lot editor + batch form; skip rendering the Save / Apply / Mark-notified / Mark-ROE buttons; show the "View only" banner.
4. Fail-safe already covered server-side, so a missed control is harmless.

_Access Sheet:_ new row pattern — `sheet_url = role:lot_weeding_viewer`, `role = lot_weeding_viewer`, `active = TRUE` (same shape as the `lot_weeding_admin` row documented under **Access Sheet Setup**).

_Docs/tests:_ update Access Sheet Setup + Status/role notes; add a route test asserting a viewer email is allowed on GET but rejected (401) on PATCH.

**Effort:** backend ~1 hr; frontend ~half day of careful-but-simple work. No new layout/design.

**Alternative if only 1–2 users:** skip the role entirely — give a normal `lot_weeding_admin` login and rely on trust (accept the no-audit-log risk). The viewer role earns its keep mainly when sharing *broadly*. Note the role governs only this tool, not direct Google Sheet access.

---

## Verification Commands

Run after touching lot-weeding code (PowerShell — one command per line):

```powershell
node --check "server.js"
node --check "lot-weeding/routes.js"
node --test "test/lot-weeding.test.js"
node --test "test/godmode.test.js"
node -e "const fs=require('fs'); const vm=require('vm'); const html=fs.readFileSync('index.html','utf8'); const scripts=[...html.matchAll(/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/gi)].map((m)=>m[1]); scripts.forEach((script,index)=>new vm.Script(script,{filename:'index.html#inline-script-'+index})); console.log('checked '+scripts.length+' inline scripts');"
```

Read lints on touched files (`index.html`, `public/css/styles.css`, `lot-weeding/routes.js`).

---

## Implementation Notes

### Shared state (`lotWeedingAdminState`)

- Tabs: `activeTab` (`map` | `calendar` | `followups` | `stats` | `help`)
- Panel sub-tab (Map only, when `LOT_WEEDING_PLANNER_CALENDAR_ENABLED`): `panelTab` (`details` | `calendar`)
- Filters: `filter`, `query`, `dayFilter`, `hoverDayFilter`, `calendarMonth`, `includeContactInfo`
- Selection: `selectedRowNumbers`, `selectedRowNumber` (no auto-select on load — cleared if the prior lot no longer exists)
- Batch: `batchSchedule*`, `batchClean*`, `batchAttention*`, `batchScheduleNext*`, `batchAction`
- Map: `map`, `markers`, zone overlay, draw polygon (`drawEnabled`, `drawLatLngs`, etc.)

### Nav chrome & auth recovery for lot-weeding-only users

- `isZonelessLotWeedingOnlyUser()` = `lot_weeding_admin` capability, not `admin`, no `currentSheetUrl` (driven partly by the cached `lotWeedingAdmin` localStorage flag).
- `applyLotWeedingOnlyNavChrome()` (called at the end of `updateNavigationState`, wrapped in try/catch) toggles `left-nav--lot-weeding-only` (CSS hides all nav items except `#navLotWeedingAdmin` + `#signOutBtn`, and removes the disabled blur) and swaps the header for the partner logo when it loads.
- `LOT_WEEDING_PARTNER_LOGO_SRC` (`public/images/atf-logo.png`) is declared **near the top of the script** on purpose — `updateNavigationState()` runs during initial synchronous load, so any `const` it transitively reads must be initialized first (this caused a TDZ crash when declared late).
- **Expired-session recovery:** when `loadLotWeedingAdminData` has no `accessToken`/`currentUserEmail`, the error card shows **"Sign in with Google"** → `signIn()`; on success `completeSignInAfterToken()` re-routes a zoneless lot-weeding user back via `switchView('lotWeedingAdmin')`.

### Dates

Intake stores free-text dates. `parseLotWeedingDate` / `toLotWeedingDateKey` normalize for grouping and pickers; writes use `formatLotWeedingDateForSheet` (`M/D/YYYY`). Unparseable sheet values (e.g. "TBD") are preserved when the picker is empty (`data-lot-weeding-date-original`).

### Map interaction

- **Plain marker click** → `focusLotWeedingAdminLot` (single lot, replaces selection).
- **Shift+click marker** → `toggleLotWeedingAdminRequestSelection` (add/remove from multi-selection).
- **Multi-select** → Draw area → **Finish**, Shift+click pins, or queue **Add to selection / Remove**.
- **Selection changes** on Map tab update in place via `refreshLotWeedingAdminMapSelection` (no full map rebuild on click).
- **Batch action panel** → `renderLotWeedingBatchActions` reads `lotWeedingAdminState.batchAction`; `applyLotWeedingSelectedBatchAction` dispatches to the schedule/scheduleNext/clean/attention writers.

### Batch completion / attention (June 26, 2026)

- Batch clean: requires Date Cleaned; writes `status` + `dateCleaned` only.
- Batch attention: writes `status: Needs Attention`; optional note appended to `details`.
- Clearing selection resets batch message/result state.

---

## Handoff Prompt For Next Agent

```text
Continue the Lot Weeding Admin work. Read LOT_WEEDING_ADMIN_HANDOFF.md (Purpose, UX Expectations, What We Built) and CODEBASE_FIELD_GUIDE.md.

Context: Lot Weeding Command Center — Map / Calendar / Follow-ups / Stats / Help over shared lotWeedingAdminState. Staging validation done (copied intake sheet, revised columns, service-account Editor). Core features shipped: batch schedule/clean/attention, Follow-up Mark notified / Mark ROE returned, NC zone overlay, draw-to-select, local post-save refresh.

Recent UX (do not regress):
- Five tabs incl. **Help** ("How to Use This Tool" + spreadsheet link `LOT_WEEDING_SPREADSHEET_URL`). Note: that link points at the Altadena-Talks original, NOT the revised-header copy the tool actually reads — verify before relying on it.
- Map tab: **Show** dropdown + helper text (not filter chips). Status colors reuse the main app palette: Requested #fdba77, Schedule Next #f9d6d3, Scheduled #81bdc3, Cleaned #afc892, Needs Attention #bc455a, Cancelled #e5e5e5. Pins use the main app's SVG style (offset charcoal shadow + charcoal stroke, grow-on-emphasis); badges echo the hues with darker legible text.
- Multi-select side panel = one Action picker (Schedule for a date / Mark Schedule Next / Mark Cleaned / Mark Needs Attention) → single form → summary → collapsible preview → one Apply button + per-lot results. Header "N lots selected" + Clear. Do not bring back the three stacked batch cards or "Writes … only" pills.
- Selection language is "N lots selected" everywhere; map box shows NO persistent selection count.
- Map controls: **Altagether Zones** + Draw area; while drawing → Finish + Cancel. No standalone Select button. Fixed-width control cluster. Zones overlay is NON-interactive (under pins, click-through name+captain labels) — don't make it clickable/hoverable (breaks the lasso).
- Build selection via: draw area, Shift+click pins, or queue Add to selection / Remove. Plain pin click opens single-lot editor. Nothing auto-selects on load (panel shows instructions).
- Map is fixed 700px height; side panel scrolls internally. Do NOT reintroduce variable map height (caused scroll jank).
- Single-lot editor: editable fields top (Status, ROE Status, Date Scheduled, Date Cleaned, Homeowner Notified, UWS Contract, APN), read-only Requester/Contact then a heavy divider then Altagether Zone/Neighborhood Captain below, Notes at bottom. Requester email has a subtle copy button; phone is PLAIN TEXT (not tap-to-call). Captain row = name+email+phone per captain (semicolon-separated, index-aligned; phone mapped through routes.js). Homeowner Notified / UWS Contract labels have hover tooltips + a subtle ⓘ icon.
- Context bar label is contextual (Date selected / Selection / Active filters) and disappears when the last chip is cleared.
- Lot-weeding-only users: stripped left nav (only Lot Weeding Command Center + Sign out, no blur) + partner logo `public/images/atf-logo.png` (`LOT_WEEDING_PARTNER_LOGO_SRC`, `.nav-header-partner-logo` max-height 288px, centered). Keep `applyLotWeedingOnlyNavChrome` in try/catch and any const it reads declared before `updateNavigationState` runs (TDZ crash risk). Expired session → error card offers "Sign in with Google" (signIn()).
- Sign out button is a compact centered pill (all nav variants) below the logo, above Send feedback (`#signOutBtn.nav-item` in styles.css) — don't revert it to a full-width nav tab.
- **Login landing:** signed-out users must always land on the **Home** login page — the `savedView` restore on load is gated on a valid `accessToken` (don't restore a remembered tab when signed out). The global `#homeSigninPrompt` overlay shows on every view *except* Home/Admin Mode/Lot Weeding (which render their own sign-in UI) and is NOT gated on a saved sheet URL. Don't reintroduce per-tab sign-in dead-ends.
- Stats tab has a **Generate Report** button → funder-facing PDF (hero banner w/ ATF logo, date+time, all stats + status/progress/health/zones/upcoming breakdowns). Uses the already-loaded `html2pdf` lib; report HTML is inline-styled; filenames include date AND time (`altadena-lot-weeding-report-YYYY-MM-DD-HHMM.pdf`). Functions: `computeLotWeedingReportData` / `loadLotWeedingReportLogoDataUrl` / `buildLotWeedingReportHtml` / `generateLotWeedingAdminReport`. Do not turn this into a long in-dashboard scrollable report — it's a downloadable PDF by design.
- Status **Schedule Next** (not On-Deck); legacy On-Deck sheet values normalize on read.
- No status quick-actions; no Last Contact Date in UI/PATCH; tri-state fields use (unknown) default.
- Homeowner notified always manual.

Goal: Continue UX polish from operator feedback (see UX Expectations). **Planner Phase 1 is live** — in-panel calendar on Map tab (`LOT_WEEDING_PLANNER_CALENDAR_ENABLED`, default true; set false to revert). Phase 2 when asked: rename Map→Planner, retire standalone Calendar tab. Optional: write-flow tests, batch PATCH endpoint, production cutover when asked.

Do not: invent sheet columns; remove mirror compatibility; change Access Sheet or production env vars without explicit request.

Always update LOT_WEEDING_ADMIN_HANDOFF.md after any changes you make (Status, Latest pass, relevant sections, and Handoff Prompt).

Run verification commands in handoff after code changes.
```

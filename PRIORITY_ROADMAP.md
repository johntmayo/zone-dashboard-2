# Altagether Zone Dashboard: Priority Roadmap

**Created:** April 11, 2026
**Based on:** Codebase forensic audit + Airtable kanban export (`kanban.csv`) + product/UX assessment
**Companion docs:** `CURRENT_STATE_AUDIT.md`, `CODEBASE_FIELD_GUIDE.md`, `EPIC_DATA_INTEGRATION_PLAN.md`

---

## How This Roadmap Is Organized

This is not a feature wishlist in prettier formatting. It is an opinionated priority stack based on three questions:

1. **What protects you and your users right now?** (Security, trust, reliability)
2. **What makes the tool more useful for the 50 people using it today?** (Daily workflow, clarity, correctness)
3. **What expands what the tool can do?** (New capabilities, engagement, growth)

Every item from your kanban is accounted for below, but I've reordered aggressively based on what the audit revealed. Some items you marked Critical I've kept Critical. Some items you marked High I've moved down because they depend on foundational work. Some items you marked Low I've moved up because they're quick wins that improve trust.

I've also added items that weren't in your kanban but that the audit surfaced as necessary.

---

## Tier 0: Stop-Everything Security

**Do before anything else. Not negotiable.**

### 0.1 — Remove secrets from git and rotate credentials
- **Source:** Audit finding
- **What:** `.env.local` contains your real Google service account private key, all user emails with sheet mappings, Mapbox token, and Vercel OIDC token — committed to the repo.
- **Why this is urgent:** If this repo is ever made public, shared with a contractor, or compromised, every user's data is exposed. The service account has Editor access to every zone sheet.
- **Action:**
  1. Add `.env.local` to `.gitignore`
  2. Remove it from git tracking (`git rm --cached .env.local`)
  3. Go to Google Cloud Console and rotate (delete + recreate) the service account key
  4. Update the new key in Vercel environment variables
  5. Consider whether `users.json` (real emails) should also be removed from git and managed only via Vercel env vars
- **Effort:** 1 hour
- **Risk of not doing it:** Catastrophic

### 0.2 — Understand your write endpoint exposure
- **Source:** Audit finding
- **What:** `/api/sheets/append`, `/api/sheets/batch-update`, `/api/sheets/batch-update-by-resident-id`, and `/api/sheets/append-record` accept requests from anyone. No authentication. If someone discovers a sheet ID, they can write arbitrary data.
- **Why this matters:** This is an internal tool and the risk is currently low, but as the user base grows and the tool becomes more visible, this becomes a real attack surface.
- **Action:** At minimum, document this as an accepted risk. Ideally, add a lightweight check (e.g., require the Google OAuth token in a header, validate it server-side before allowing writes).
- **Effort:** 2–4 hours for a basic check; documenting the risk takes 10 minutes
- **Priority within tier:** After 0.1 but before feature work

---

## Tier 1: Fix What's Broken and Build Trust

**These items directly affect whether users trust and rely on the tool. They are preconditions for everything else.**

### 1.1 — Fix session timeout while active
- **Kanban:** "Timing out while active?" — Bug, High priority, reported by Steph Pinto
- **What the audit found:** OAuth tokens are stored in localStorage with an expiry. The token refresh logic in `ensureValidGoogleAccessToken` may not be triggering correctly during active use. A recent commit (`b7a2ee9` — "change how long sessions last") attempted to address this but the bug may persist.
- **Why it matters:** Nothing kills trust faster than getting kicked out while you're working. This is a real user reporting a real problem.
- **Action:** Trace the token refresh logic, ensure it proactively refreshes before expiry during active sessions, and test with a timer.
- **Effort:** 2–4 hours

### 1.2 — Revise the numbers at the top of Home page
- **Kanban:** Critical priority
- **What:** The stats cards on the Home view appear to show misleading or unclear numbers. You're not sure what they should say, but you know the current state isn't right.
- **My recommendation:** These cards are the first thing every captain sees. They set the tone. Show:
  - **Total properties** in the zone
  - **Contacted** (count + percentage)
  - **Total loss / Major damage** (count)
  - **Rebuilding or planning to rebuild** (count)
- Keep it to 3–4 numbers max. Each should have a clear label and be unambiguous. Don't show numbers you can't confidently derive from the sheet data.
- **Effort:** 2–3 hours

### 1.3 — Fix the print layout for Neighbors
- **Kanban:** Critical priority
- **What:** The print/export from the Neighbors view is not legible enough.
- **Why it matters:** Captains do door-to-door outreach. A printed list they can carry is a core workflow tool, not a nice-to-have.
- **Action:** Redesign the print CSS. Prioritize: address, resident name, contact status, phone/email. Use a compact table layout optimized for paper. Test at actual print size.
- **Effort:** 3–4 hours

### 1.4 — Batch Tagging overhaul — **Shipped (April 2026)**
- **Kanban:** Critical priority — Contacted, Newsletter Subscriber, Moved Away
- **Original scope:** Bulk-tag residents as Contacted, Newsletter Subscriber, or Moved Away.
- **What actually shipped:** A full UX overhaul well beyond the original kanban scope. The batch tagging tool now supports two modes — Address Tags and Person Tags — with a shared filter bar and a dedicated two-pane workspace (scan list on the left, sticky action rail on the right). Branch: `batch-tag-overhaul`.
  - **Layout & structure**
    - Two-pane workspace: left scan area, right sticky action rail with Selected-summary card + Apply card.
    - Mode switcher implemented as a **segmented toggle** (not a button pair) so it doesn't compete with the existing button families. No translate/lift on click — resolves the prior "top gets cut off" behavior.
    - Button hierarchy formalized: **teal** = tool main action (Apply, matches Zone Analysis / Export to PDF), **navy** (`.btn-copy-emails`) = secondary/utility (Select all/none, Draw on map, Back to list), **marigold** = app-level CTAs only.
  - **Address tab**
    - Select addresses by checkbox or by drawing a polygon on the map (polygon preview retains the dashed cursor segment from last-placed point; map toolbar has breathing room above the map container).
    - Apply Damage, Address Plan, and Build Status to selected addresses.
    - Each row shows its current Damage / Plan / Build values as small low-contrast chips **under the address** — only when values exist (untagged addresses stay clutter-free).
    - Top-bar filters: Damage, Address Plan, Build Status — each includes "Not set" so captains can easily find untagged properties. Filters hide gracefully if the underlying column is missing.
    - Resident-name summaries replace the old blank metadata rows.
  - **Person tab**
    - People grouped by address (address-order sort; in-group sort is A→Z by surname).
    - Apply "Log contact (today's date)" / clear contact, **Subscribe to updates** (display label; the sheet column was renamed from `Newsletter Subscriber` to `Wants_Updates` — column detection now matches the new name with a fallback to the old one for transition), and **Former Resident** (renamed from Moved Away across labels, column detection, missing-column warnings, and write logic).
    - Contact-status filter ("Already contacted" / "Not yet contacted") scoped to the Person tab.
  - **Feedback clarity**
    - **Active filters** get a yellow highlight, visually matching the Neighbors filter-bar pattern.
    - **Armed apply-dropdowns** get a teal highlight, echoing the Apply button — clear visual signal that a value is "loaded".
    - **Selection clears** after a successful apply (prevents accidental re-apply); filters and dropdown intent persist so you keep your working context.
    - **Optimistic in-memory updates** — chips and "Last contact logged: …" labels refresh instantly in place after apply; a background `loadAddressData` still runs so Neighbors/Map stay in sync, but the captain is never bumped out of the tool.
    - Person apply dropdowns now reset on every re-entry into the tool (parity with address dropdowns).
  - **Carryover / preserved:** map/list exclusivity, core hooks (`batchTaggingTool`, `batchTaggingApply`, `batchTaggingAddressList`, `batchTaggingDrawOnMap`, `.batch-tag-address-cb[data-address]`, `.batch-person-cb[data-row-index][data-resident-id]`), helpers like `getResidentNameColumn` / `sortAddressesByStreetThenNumber` / `buildAddressString` / `extractStreet`.
- **Effort (actual):** Multi-session iterative UX work; substantially more than the original 3–5h estimate, but delivered a production-ready tool rather than a narrow feature add.

### 1.5 — Remove Zone Notes (confirmed defunct)
- **Kanban:** "Zone Notes is a defunct feature. Remove?" — Medium priority
- **What the audit found:** The Zone Notes tab toggle is already broken — the `#addressesTab` element it depends on doesn't exist in the HTML, so the tab handler never attaches. The feature is invisible to users but the code is still running (fetching metadata, attempting to load notes).
- **Action:** Remove the Zone Notes UI, the `fetchMetadata` call for notes, and the save logic. Keep the metadata fetch if it's needed for the KML URL and zone name (it is).
- **Effort:** 1–2 hours
- **Risk:** Low — feature is already broken and invisible

### 1.6 — Clean up dead code and broken features from audit
- **Source:** Audit finding
- **What:** Remove confirmed dead code: `initializeContactListCreator`, `updateSheetLinkLabel`, `switchView('progress')` branch, commented-out KML URL input UI. Fix `about.html` broken Discord modal script.
- **Why:** Every line of dead code makes the 16,942-line file harder to work in. This is low-risk cleanup that makes future work safer.
- **Effort:** 1–2 hours

### 1.7 — Fix documentation truth
- **Source:** Audit finding
- **What:** Rewrite `README.md`. Add staleness warnings to `PLATFORM_OVERVIEW.md`, `AUTH_AND_SPREADSHEET_ACCESS.md`, `DATA_PROBLEM_HANDOFF.md`. Delete `context handoff.txt`. This is for your own sanity and for anyone else who might touch this repo.
- **Effort:** 1–2 hours

### 1.8 — Migrate user access from env var to Google Sheet — **Shipped (April 21, 2026)**
- **Source:** April 20 2026 incident — a Drive cleanup moved zone sheets out of the shared folder, silently revoking the service account's folder-inherited access. The incident exposed two problems: a sharing fragility (tracked separately) and, more importantly, the pain of the current user-admin flow — editing `USERS_JSON_B64` in Vercel, base64-encoding, and redeploying just to add a single user.
- **What shipped:** `readUsersMapLegacy()` preserved for fallback; async sheet-backed `readUsersMap()` added with cache, wildcard admin expansion (`sheet_url=*`), per-user URL dedupe, and duplicate-captain warning logs. `/api/user-sheets` now preserves rich entry metadata. New admin endpoints `/api/admin/refresh-users` and `/api/admin/export-users-json` are live. Login zone picker now supports search, two-line zone cards, captain subline, and admin chip for wildcard-expanded users.
- **Why this is Tier 1:** The admin expects constant onboarding toward ~500 users over 5–10 years. The current flow is a growth-limiting bottleneck *and* it contributed to the April 20 outage (the admin couldn't quickly edit `users.json` to remove broken sheets). This fixes the chokepoint.
- **Current operating model:** Access is managed in the Access Sheet (`USER_ACCESS_SHEET_ID`), with `USE_LEGACY_USERS=1` as emergency kill-switch rollback. `USERS_JSON_B64` and `users.json` are retained as frozen rollback artifacts.
- **Effort (actual):** Completed across planning + implementation + staging + production rollout, including live smoke tests and rollback validation endpoints.
- **Full implementation plan:** See **[USER_ACCESS_SHEET_MIGRATION.md](USER_ACCESS_SHEET_MIGRATION.md)**. That document is the source of truth for this work — schema, code-change shape, rollout ordering, rollback plan, acceptance criteria, and deferred future phases all live there.
- **Dependency:** None. Can ship independently.
- **Related but out of scope here:** folder-inheritance sharing fragility, localStorage-stuck-on-broken-sheet UX, `sheetId` not logged on API errors. Documented in the migration plan's "Related Improvements" section.

---

## Tier 2: Core UX — Make the Daily Workflow Better

**These items improve the experience for captains who are already using the tool every day. Prioritized by impact on the most common workflows.**

### 2.1 — Person Details modal
- **Kanban:** High priority, detailed spec provided
- **What:** Click a person's name → modal with all their info + full tag set ("All Tags" vs "Quick Tags" in the Details panel) + Former Resident checkbox + notes field.
- **Why this is high-value:** This is the bridge between the current "view-only details panel" and real per-person case management. It makes the tool feel like a real CRM instead of a spreadsheet viewer.
- **My UX note:** Keep the modal focused. Don't overload it. The spec mentions "All Tags" — be disciplined about what goes in. If a tag isn't actionable for the captain, don't show it. The Former Resident flow is good — make it feel reversible (undo-friendly) so captains aren't afraid to use it.
- **Dependency:** This partially depends on deciding the Former Resident / Deceased logic (2.3).
- **Effort:** 6–10 hours

### 2.2 — Address Details modal
- **Kanban:** High priority
- **What:** A modal for the address itself (as opposed to the person). Could show: all residents at that address, property status, damage assessment, rebuild status, contact history, notes.
- **My recommendation:** This makes the most sense as a richer expansion of what the Details panel already shows when you click an address. The panel is cramped; a modal gives room to show the full picture. Consider whether this replaces the panel or supplements it.
- **Effort:** 4–6 hours

### 2.3 — Former Resident and Deceased logic
- **Kanban:** High priority — "Should these people count toward contact rates? Should their emails be dropped out entirely?"
- **My recommendation:**
  - **Former residents:** Do not count toward contact rates. Do not include in email exports. Show in a collapsed "Former Residents" section at the bottom of address details (as your spec describes). Keep their data — don't delete rows.
  - **Deceased:** Same treatment as former residents but with a distinct visual marker. Absolutely exclude from any email/contact exports. Handle with care in the UI — a small, respectful indicator.
  - **Implementation:** Add a status column (or use an existing one) with values like Active / Moved Away / Deceased. Filter these out of counts and exports. The Person Details modal (2.1) is where you'd set this status.
- **Effort:** 4–6 hours (after 2.1 is built)

### 2.4 — Hover tooltips and explainers
- **Kanban:** Two items, both High — tooltips on filters and details panel, plus About page hover-overs
- **What:** Add contextual help so users understand what "Contact" means, what "Address Plan" means, what the damage categories are, etc.
- **Why this matters a lot:** Your users are volunteers, not data professionals. The dashboard uses jargon and categories that aren't self-explanatory. Tooltips are the cheapest way to make the tool self-documenting.
- **My UX note:** Use a consistent tooltip pattern (e.g., small `?` icon next to the label, tooltip on hover/tap). Keep explanations to 1–2 sentences. Don't tooltip everything — just the things that are genuinely ambiguous.
- **Effort:** 3–5 hours

### 2.5 — Fix interests display in NC Directory + Profile
- **Kanban:** High priority — "You rearranged Utilities in the Google Sheet on 3.23"
- **What:** The interest categories in the NC Directory sheet were reorganized, but the Profile page and Directory page may not reflect the new options.
- **Why this is urgent:** If a captain fills out their profile and the options don't match the sheet, data gets corrupted or lost.
- **Action:** Audit the interest/skill taxonomy in the live sheet, update the Profile form options in `index.html`, update the filter/display logic in `nc-directory.html`.
- **Effort:** 2–3 hours

### 2.6 — "Last Contact Date" → "Last Outreach Attempt Date" (and "Contact Notes" → "Outreach Log") — **Shipped (April 22, 2026)**
- **Kanban:** High priority — rename "Last Contact Date"
- **Original scope:** Rename the single label. Small but meaningful — making it clearer that this is a logged outreach attempt, not a passive "contact date."
- **What actually shipped:** A coordinated rename across two coupled columns plus codebase migration safety.
  - **Spreadsheet column renames (backend):** `Last Contact Date` → `Last Outreach Attempt Date`; `Contact Notes` → `Outreach Log`.
  - **App-side migration safety:** Added two centralized helpers in `public/js/utils.js` — `findOutreachDateColumn(headers)` and `findOutreachLogColumn(headers)` — that accept both the legacy names AND the new names, so zones renamed mid-migration never break. Replaced 9 narrow matchers across `index.html` (7 `findColumn(headers, ['contact', 'date'])` calls + 2 `/contact\s*note/i` regexes) with calls to these helpers.
  - **Result:** The spreadsheet can be renamed any time, in any order across zones, with no code change required before or after. Pre-migration and post-migration sheets both work simultaneously. If a third naming convention is ever chosen, it's a one-line addition to each helper.
- **Why this matters beyond the label:** These two columns are referenced in ~25 places across the monolithic `index.html`. Without the helper layer, a rename would have silently broken outreach logging for any zone sheet until every call site was found and updated. The helpers turn a fragile rename into a safe one.
- **Effort (actual):** ~30 minutes for the label change itself; an additional ~1 hour to audit the codebase, add the helpers, and replace the narrow matchers.

### 2.6.1 — Details Panel redesign (case-management UI) — **Shipped (April 22, 2026)**
- **Source:** Captains reported the Details Panel felt cramped, visually inconsistent, and unstable during save states.
- **What shipped:** A full redesign of the right-side Details Panel, layered as three passes on a single feature branch:
  - **Pass 1 — Structural redesign.** Introduced a three-level hierarchy: panel-level toolbar (Back + Save + Refresh) → Address section card → "People at this address" section divider → per-person cards. Stacked-label form fields (`.details-field` — label above textarea) replaced the old inline label-left/value-right pattern for long-form fields (Address Notes, Sales History, Person Notes). The inline outreach-logging state became a contained sub-panel inside the person card (`.outreach-composer`) with a title, date chip, notes field, and submit/cancel — and only one composer can be open panel-wide at a time.
  - **Pass 2 — Polish, density, visual rhythm.** Reduced vertical spacing 10–20% across the panel, removed unnecessary horizontal rules inside person cards (grouping now done with spacing + typography + labels), softened card borders and shadows, tightened the outreach composer footprint, and reviewed bold usage so emphasis is intentional.
  - **Pass 3 — Typography and save-state stabilization.** Replaced the mixed serif/sans inheritance inside `.address-details` with a unified, documented Chivo typography ladder (section title → field label → data value → checkbox item name → status text). This fixed the prior inconsistency where `Home:` / `Cell:` labels rendered in Merriweather-500 (inherited) while `Email:` rendered in Chivo-600 (overridden). Also restructured the top toolbar into a 2-row layout with a **reserved status slot** (`min-height: 16px`, `aria-live="polite"`) so save-state messages (`Saving changes…`, `Auto-saving…`, `Saved`, `No changes to save`) never reflow the button row — the long-standing "Save Changes drops under Back to List" bug is gone.
- **Preserved:** The existing data contract, all editable-inline / editable-notes / editable-checkbox / editable-dropdown handlers, the per-person outreach logging system (`.outreach-log-toggle` + composer + `data-contact-column` / `data-log-column` attributes), the one-composer-at-a-time behavior, and the Former Residents deferred section. No data migration required.
- **Constraints honored:** No chips or toggles (checkboxes preserved per low-tech-user guidance); no hidden interactions; architecture unchanged between passes.
- **CSS location:** All redesign styles live in a single block in `public/css/styles.css` (~lines 6813–7430) under the banner comment `Details Panel Redesign`.
- **Effort (actual):** Three iterative passes across multiple sessions; the final result is a production-grade case-management panel that is layout-stable in every save state.

### 2.7 — Actions effort tiers
- **Kanban:** In Progress, Medium priority
- **What:** Categorize actions as Low / Medium / High Lift. Already in progress.
- **My note:** Good idea. This helps captains who are overwhelmed pick something manageable. Make the tiers visually distinct (color or icon) and default-sort with Low Lift at the top.
- **Effort:** Already underway

### 2.8 — Add person without an address
- **Kanban:** High priority (no status set)
- **What:** Allow adding a resident who doesn't have a physical address in the zone (e.g., community volunteers, displaced residents still involved).
- **My note:** This is a data model change. Currently, addresses are the primary grouping key for everything — the map, the table, the details panel. A person without an address breaks that assumption. Implementation options: (a) allow a blank address and handle the null case everywhere, or (b) create a virtual "No Address" group. Option (b) is safer for the current architecture.
- **Effort:** 4–6 hours
- **Risk:** Medium — touches the core data model

### 2.9 — Property Sales Data: Badge + Sale Information Section
- **Kanban:** High priority
- **What:** Surface post-fire property sales data in the Details panel and address list. Three components:
  1. **"SOLD" badge** — a visible tag next to the address in both the address list and the detail view header whenever `Address - Sold Since Fire` is TRUE. Makes sold status immediately obvious without expanding anything.
  2. **"Sale Information" section** in the Details panel — a new collapsible section (expanded by default when sale data exists, hidden when it doesn't) placed after address-level fields and before person entries. Displays: last sale date, sale price, buyer, lot size, and a running sales history log.
  3. **Column recognition** — teach the header-matching code to recognize `Sale Price`, `Lot SqFt`, and `Sales History` alongside the already-recognized `Sale Date`, `Sale Notes`, and `New Owner`.
- **Data design:** The master spreadsheet gets a small number of new columns:
  - `Sale Price` — most recent sale price (enables filtering/sorting)
  - `Lot SqFt` — stable property fact, doesn't change between sales
  - `Sales History` — free-text running log formatted as `[YYYY-MM-DD] narrative | [YYYY-MM-DD] narrative`, newest first. This is the solution to the multiple-sales-over-time problem: the "current" columns (`Sale Date`, `Sale Price`, `New Owner`) always reflect the latest sale and power filtering/sorting, while `Sales History` preserves the full record. Buyer notes from the sales spreadsheet are folded into each log entry's narrative rather than stored as a separate column.
  - Existing columns `Sale Date`, `Sale Notes`, `New Owner`, `Address - Sold Since Fire`, `Address - For Sale` are already recognized by the app.
- **Column editability rules:**
  - **System-written (not captain-editable):** `Sales History`, `Sale Date`, `Sale Price` — these are populated at merge time and reflect the official record. `Sales History` in particular should not be hand-edited; it's the immutable log.
  - **Captain-editable:** `New Owner` (captains may learn the buyer's identity after a sale is imported as "unknown"), `Sale Notes` (the captain's living scratchpad for observations about the sale or new owner), `Address - Sold Since Fire` and `Address - For Sale` (toggles a captain can set manually if they learn about a sale before the next data merge).
  - This separation means the system record and the captain's knowledge coexist without conflict. If `Sales History` says "sold to unknown" but a captain discovers the buyer, they update `New Owner` — the log preserves what was known at import time, the live field reflects current knowledge.
- **Merge workflow:** Sales CSV is matched into the master spreadsheet by APN. On merge: set `Sold Since Fire` = TRUE, `For Sale` = FALSE, populate the "current" sale fields, and compose a `Sales History` entry. `Sale Notes` is left empty at merge time so captains have a clean field. Existing `Sale Notes` content is never overwritten by a merge.
- **Future extensions:** Sold properties as a map marker color-by option; re-enabling the existing `soldProperties` Mapbox overlay with click-to-detail behavior; filtering the address list by sale status.
- **Dependency:** None — can be built independently. Complements the Address Details modal (2.2) when that's built.
- **Effort:** 4–6 hours for the app-side UI work (column recognition + badge + Sale Information section). Spreadsheet column additions and data merge are a separate manual/scripting step.

---

## Tier 3: Expand Capabilities

**New features that make the tool more powerful. Only tackle these after Tiers 1–2 are stable.**

### 3.1 — Communications Support Hub
- **Kanban:** Critical priority — "Build this out ASAP"
- **What:** A centralized place for captains to manage outreach: email templates, text templates, newsletter tools, contact list generation.
- **My honest assessment:** This is labeled Critical but it's really a *platform feature* — it's a new section of the app, not a fix to something broken. I'd reframe this as the anchor feature of your next major release rather than an emergency.
- **Recommended approach:** Start with the Outreach Helper (`outreach-helper.html`) — it already exists as an orphan page with copy templates. Integrate it into the main dashboard as the seed of this hub. Then layer on: contact list export (the broken Contact List Creator has JS scaffolding at ~14329), email/text template customization, newsletter subscriber management.
- **Effort:** 15–25 hours total; break into phases

### 3.2 — Refine Send Newsletter action
- **Kanban:** High priority (Back Burner) — add subscriber tag, exclude deceased
- **What:** Make the newsletter workflow smarter: track who's subscribed, prevent sending to deceased residents.
- **Dependency:** Needs the Former Resident / Deceased logic (2.3) first.
- **Effort:** 4–6 hours

### 3.3 — More Actions
- **Kanban:** High priority
- **What:** Add more action cards to the Actions view.
- **My note:** The Actions feed comes from a Google Sheet. Adding actions is an editorial task (add rows to the sheet), not necessarily a code task — unless you want new action *types* with different behaviors. Clarify what "more actions" means before building.
- **Effort:** Depends on scope

### 3.4 — Admin Mode
- **Kanban:** Medium priority — "see every zone, every captain, access other zones, search every person + address"
- **What:** A superuser view that crosses zone boundaries.
- **My honest assessment:** This is architecturally significant. The current system is designed around one-user-one-zone (or a few zones). An admin mode that aggregates across all zones would need to either: (a) iterate over all sheets in `users.json` and merge data client-side, or (b) build a separate aggregation layer. Neither is trivial.
- **Recommended approach:** Start small — an admin page that shows all captains (from the NC Directory sheet), their zones, and their last login. Don't try to aggregate zone data across sheets yet.
- **Effort:** 8–15 hours for a useful v1; much more for full cross-zone search

### 3.5 — Expand Google Analytics
- **Kanban:** High priority — returning users, time on site, actions performed, data fields updated
- **What:** The GA4 integration exists but only sends page views. You want behavioral analytics.
- **My note:** GA4 already supports most of what you want out of the box (returning users, session duration). What you'd need to add: custom events for specific actions (e.g., `trackAnalyticsEvent('contact_logged', { zone: '...' })`, `trackAnalyticsEvent('record_added', ...)`). The `trackAnalyticsEvent` wrapper already exists in `index.html` line 29. You just need to call it in the right places.
- **Effort:** 2–4 hours to instrument the key events; GA4 dashboard setup is separate

### 3.6 — Event Planner Wizard
- **Kanban:** High priority — "Idk how the data storage element is gonna work tho"
- **My honest note:** You're right to be uncertain. The current architecture has no general-purpose data storage beyond Google Sheets. An event planner needs: event creation, date/time, RSVP tracking, reminders. Storing this in a sheet tab is possible but ugly. Consider whether a lightweight external service (Airtable, Google Forms + Sheets, or even a simple Supabase table) would be more appropriate than trying to force this into the zone sheet.
- **Effort:** 10–20 hours depending on storage decision
- **Recommendation:** Defer until after the Communications Hub has a foundation

### 3.7 — Drip Campaign for Engagement
- **Kanban:** High priority — "6 weeks?"
- **What:** A structured onboarding/engagement sequence for new captains.
- **My note:** This is a product/ops initiative more than a code feature. You could build a fancy in-app drip system, or you could set up a 6-email sequence in your existing Mailer Light account triggered when a new captain is added. The latter is 10x cheaper to build and probably more effective.
- **Effort:** If in-app: 15–20 hours. If email-based via Mailer Light: 2–3 hours of content writing + Mailer Light setup.

### 3.8 — EPIC-LA Fire Recovery data integration (dashboard-only)
- **Source:** Product planning and architecture review (April 2026)
- **What:** Add a third data source for county permitting progress (EPIC-LA), matched by APN, and surfaced in the Address Details panel.
- **Operating model:** Keep EPIC data in a **separate cache source** (daily refresh), and enrich dashboard reads at render time. Do **not** write EPIC rows into captain sheets or the master operational spreadsheet.
- **Why this matters:** High demo value, immediate captain utility, and better rebuild visibility without disrupting existing spreadsheet workflows.
- **Performance note:** This should query EPIC data by APN (or small APN batches) so users never download full county datasets on login.
- **Primary plan doc:** **[EPIC_DATA_INTEGRATION_PLAN.md](EPIC_DATA_INTEGRATION_PLAN.md)**
- **Effort:** 8–16 hours for v1 (sync + API + panel section), depending on cache implementation details.

---

## Tier 4: Back Burner (Validated)

**These items are real ideas but should wait. I've added notes on each.**

| Item | Kanban Priority | My Assessment |
|------|----------------|---------------|
| **Tutorial mode** | High (Back Burner) | Good idea, but premature. Stabilize the product first — tutorials for unstable features waste effort. Revisit after Tier 2 is done. |
| **Newsletter Builder** | Low | Massive scope. This is practically a separate product. The spec in the kanban is thoughtful but this is months of work. Keep it as a separate project, not a dashboard feature. |
| **Cross-zone insights** | Medium (Back Burner) | Depends on Admin Mode (3.4). Way too early. |
| **Power User Map** | Medium (Back Burner) | Unclear scope. The current map is already fairly powerful. Clarify what this means before prioritizing. |
| **News Feed** | Low | Nice-to-have. Would need a content source and editorial process. Low impact for the current user base. |
| **Custom layout** | Low | Premature. The current layout works. Customization adds complexity for 50 users who need consistency. |
| **Logo in Flyer Generator** | Low | Quick win but low impact. Do it when you're in the flyer code for another reason. |
| **Former Residents tab** | Low | The Person Details modal (2.1) + Former Resident logic (2.3) is a better approach than a separate tab. |
| **Resource Navigator** | Low | Unclear scope. Resources page already exists. |
| **Ideas Portal / Bank** | Low | Nice idea but you have Airtable for this already. Don't build a second tracker. |
| **Normalize column widths** | Low | Noted "DID NOT IMPLEMENT" — revisit if the table gets a redesign. |
| **Actions name styling** | Low | Cosmetic. Low priority but quick fix when you're in the Actions code. |
| **Move a pin after placing it** | Low | Legitimate request. Queue for when you're in the map code. |
| **Mini map color key spacing** | Low | Cosmetic. Quick fix. |
| **Directory profile picture** | Low | Nice-to-have. Needs image storage (Google Drive? Cloudinary?). Not trivial. |
| **Combine water district maps** | Medium | Map layer work. Do it when you're in the Mapbox config. |
| **Add SCE undergrounding map** | Medium | Needs the tileset/data source. Do it when you have the data. |
| **Release Roadmap (public)** | Medium | Meta-task. This document is a start. Turn it into a user-facing version when ready. |

---

## Sequencing Recommendation

Here's how I'd spend the next 4–6 weeks if I were you:

**Week 1: Security + Foundation**
- 0.1 Rotate credentials, fix `.env.local`
- 1.5 Remove Zone Notes (already broken)
- 1.6 Clean up dead code from audit
- 1.7 Fix documentation truth
- ~~2.6 Rename "Last Contact Date" label~~ — **Shipped (April 22, 2026)**; expanded scope: renamed to `Last Outreach Attempt Date` + renamed `Contact Notes` → `Outreach Log`, with helper functions in `utils.js` so both old and new names continue to resolve.
- 1.1 Fix session timeout bug

**Week 2: Daily Workflow**
- 1.2 Revise Home page numbers
- 1.3 Fix print layout
- ~~1.4 Expand batch tagging~~ — **Shipped (April 2026)**; scope expanded into a full UX overhaul.
- 2.5 Fix interests in directory/profile
- 2.4 Start adding tooltips (filters first)

**Week 3–4: Person & Address Experience**
- 2.9 Property Sales Data: badge + Sale Information section (once spreadsheet merge is done)
- 2.1 Person Details modal
- 2.3 Former Resident + Deceased logic
- 2.2 Address Details modal
- 2.8 Person without address

**Week 5–6: Communications Foundation**
- 3.1 Communications Hub v1 (integrate Outreach Helper, contact list export)
- 3.2 Newsletter refinements
- 3.5 GA4 event instrumentation
- 0.2 Add basic write endpoint authentication

---

## A Note on Architecture

You're going to hit a wall soon with `index.html` at 16,942 lines. Every feature you add makes it worse. I'm not going to tell you to refactor now — that's not what you asked for and it's not what you need this week. But I want to flag: **somewhere around the end of Tier 2 or beginning of Tier 3 is when the cost of working in a monolithic file will start exceeding the cost of splitting it up.** When that moment comes, the audit documents will give you a map of what to split and where.

The other architectural pressure point is **data storage**. Right now everything lives in Google Sheets, which is fine for the current feature set. But the Event Planner, the Communications Hub, and cross-zone features will all push against the limits of sheets-as-database. You don't need to solve this now, but start thinking about when a lightweight database layer (even just Supabase or Airtable) would be worth the complexity.

---

## The Last Item in the Kanban

> "Thank you for creating this."

That's from a real user. That's the signal. The product is working. Now make it better.

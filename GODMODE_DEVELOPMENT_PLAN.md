# Godmode Development Plan

**Status:** Living product/engineering plan  
**Created:** May 6, 2026  
**Purpose:** Guide future agents and collaborators as the Zone Dashboard grows a true admin intelligence layer for Altagether managers.

This document is the source of truth for Godmode product intent. Update it whenever Godmode behavior, data contracts, priorities, or implementation status changes.

---

## 1. Product Intent

Godmode is the manager-facing layer of the Zone Dashboard. It is not a separate app and not merely "admin access to every captain zone." It should help Altagether leadership quickly understand:

- What is happening across all covered zones.
- Which people and addresses have captain coverage.
- Which records are unzoned because Altagether does not yet have coverage in that area.
- How zones compare on outreach, address plans, rebuilding stages, and sale activity.
- Which captains are responsible for which zones, including co-captains.
- Where data quality issues or operational outliers deserve attention.
- How to instantly find a person, address, APN, zone, or captain.

The current MVP is read-only and powered by a master Google Sheet. That is intentional for the first phase. Future versions may add admin editing, but only after the write path is designed around stable IDs, source-zone routing, and auditability.

---

## 2. Current Implementation Snapshot

Godmode currently exists as a read-only admin view inside `index.html`.

Implemented pieces:

- `GET /api/admin/godmode-master?email=...` reads a configured master spreadsheet.
- Backend module: `godmode/routes.js`.
- Tests: `test/godmode.test.js`.
- Required env var: `GODMODE_MASTER_SHEET_ID`.
- Recommended env var: `GODMODE_MASTER_RANGE`.
- Optional env var: `GODMODE_MASTER_CACHE_TTL_MS`.
- Frontend view: `#godmodeView`.
- Desktop nav item: `#navGodmode`, shown only when the current user has `role: admin`.
- Mobile More drawer item: `#mobileMoreGodmode`.
- Current UI includes summary cards, basic breakdowns, global search, result list, and a read-only profile panel.

Important limitation:

- The current frontend loads the master range into the browser and filters client-side. With ~35k rows, initial load and rendering can feel clunky. This is acceptable for the MVP, but not the final architecture.

---

## 3. Core Product Principles

### 3.1 Godmode should reveal patterns, not just expose rows

The admin user should not have to manually inspect hundreds of records to understand the organization. The dashboard should surface:

- broad trends,
- zone-level comparisons,
- captain/zone coverage,
- outliers,
- data quality problems,
- high-priority lists,
- fast drilldowns.

### 3.2 Zone and captain are inextricable

In Altagether's current model, a zone cannot meaningfully exist without a captain assignment. Do not build watchlist logic that says "zones with no captain assigned" unless the underlying organizational model changes.

Uncovered areas should be represented as **unzoned people/addresses**, not as captainless zones.

### 3.3 Avoid metrics that the organization cannot interpret yet

Do not over-emphasize metrics like "zone has had no update in 30 days" unless the data architecture can distinguish captain activity from backend/admin edits.

Current caveat:

- The app may know rows changed, but not reliably **who** changed them.
- Google Analytics may help understand login/activity, but that is different from spreadsheet edit authorship.
- Future engagement metrics should be framed carefully as "dashboard usage" or "observed data freshness," not as definitive captain performance.

### 3.4 Read-only is useful, but may not be sufficient forever

Godmode will expose incorrect or stale data. Admins will naturally want to fix it. Future editing should be considered, but not bolted on casually.

Future edit paths should prefer:

- stable `resident_id` matching,
- source sheet routing,
- clear field ownership,
- audit logging,
- one-record-at-a-time edits before bulk edits.

---

## 4. Priority Dashboard Layout

The first serious Godmode dashboard should have these sections.

### 4.1 Townwide Trend Cards

Top-level cards should answer: "What is the state of Altagether coverage right now?"

Desired cards:

- Total number of people with a captain.
- Total number of addresses with a captain.
- Total people in master.
- Total unique addresses in master.
- Unzoned people.
- Unzoned addresses.
- Active covered zones.
- Total captains.
- Addresses sold since fire.
- Address Plan totals.
- Build Stage totals.
- Outreach coverage across covered addresses.

Notes:

- "With a captain" should mean the record belongs to a zone with captain coverage.
- "Unzoned" should mean outside current coverage or not assigned to a covered zone.
- Use unique addresses for address-level counts, not person rows.

### 4.2 Operational Watchlist

The watchlist should surface things worth looking at today.

Good watchlist candidates:

- Unzoned people/addresses.
- Zones with low outreach coverage.
- Zones with unusually high total-loss counts.
- Zones with high follow-up burden.
- Addresses with multiple people and no outreach.
- Sold-since-fire addresses that may need review.
- EPIC-active properties with missing or stale local rebuild/build-stage info.
- Missing APNs.
- Missing damage status.
- Missing address plan.
- Missing build stage.
- Duplicate-looking addresses or people.
- Records missing `resident_id`.

Avoid for now:

- "Zones with no captain assigned."
- "No update in 30 days" as a captain accountability metric.
- Any metric that implies captain performance unless the data actually supports it.

### 4.3 Zone Directory

This should be a full table where **one row = one zone**.

Minimum useful columns:

- Zone name / number.
- Captain(s), including co-captains.
- Captain contact info.
- People count.
- Unique address count.
- Outreach count and outreach percentage.
- Sold-since-fire address count.
- Address Plan breakdown.
- Build Stage breakdown.
- Damage breakdown.
- Follow-up count, if available.
- Uncontacted address count.
- EPIC/permitting count, if available.
- Source zone sheet link.

This table should be sortable and searchable. Clicking a zone should open a Zone Profile.

### 4.4 Captain Directory / Workload Table

This should be a full table where **one row = one captain**.

Minimum useful columns:

- Captain name.
- Zone(s).
- Co-captain relationships.
- Email.
- Phone.
- Onboarding month.
- How new they are, derived from onboarding month.
- People covered.
- Unique addresses covered.
- Outreach percentage for their zone.
- Follow-up burden, if available.
- Missing profile/contact fields.

This table is not meant to be punitive. It should help leadership understand workload, support needs, and coverage structure.

### 4.5 Search And Profile

Global search should support:

- person name,
- address,
- APN,
- phone,
- email,
- zone,
- captain.

Search results should more clearly surface:

- the person's captain,
- all co-captains,
- their zone,
- whether they are unzoned,
- address/APN,
- relevant status fields.

The selected profile should include:

- person details,
- address details,
- zone,
- captain/co-captains,
- source sheet,
- `resident_id`,
- APN,
- outreach fields,
- damage/address plan/build stage,
- sold-since-fire status,
- any EPIC/permitting summary available.

### 4.6 Zone Profile Page

Clicking a zone should open a dedicated zone profile, not merely filter a table.

Desired zone profile sections:

- Zone header: zone name, captain(s), source sheet link.
- Topline numbers: people, unique addresses, outreach percentage, sold-since-fire, damage, address plan, build stage.
- Captain card(s): contact info, onboarding month, co-captain structure.
- Priority addresses: uncontacted, follow-up, sold-since-fire, EPIC-active, missing APN/status.
- Data quality warnings.
- Search/filter within the zone.

### 4.7 Data Quality Dashboard

This should be a first-class section because it directly improves the usefulness of the whole system.

Track:

- Missing `resident_id`.
- Duplicate `resident_id`.
- Missing APN.
- Missing address.
- Missing normalized address.
- Missing zone.
- Missing captain/captain metadata on covered rows.
- Missing damage status.
- Missing address plan.
- Missing build stage.
- Duplicate-looking people.
- Duplicate-looking addresses.
- People/address rows that appear in conflicting zones.
- Source sheet missing or invalid.

Data quality findings should be drillable to the underlying rows.

---

## 5. Metrics The User Explicitly Wants

These should be treated as priority requirements.

### Townwide

- Total number of people with a captain.
- Total number of addresses with a captain.
- Total people and addresses, including unzoned.
- Unzoned people and addresses.
- Addresses sold since fire.
- Address Plan totals.
- Build Stage totals.

### Per Zone

- People per zone.
- Unique addresses per zone.
- Outreach per zone, as count and percentage.
- Addresses sold since fire.
- Address Plan totals.
- Build Stage totals.

### Per Captain

- One row per captain table.
- Zone(s) covered.
- Co-captains visible.
- Onboarding month.
- "How new they are" derived from onboarding month.
- People/address workload.
- Outreach percentage for their zone(s).

---

## 6. Data Source Expectations

The master sheet should ideally include enough fields to compute zone/captain rollups without querying every zone sheet live.

Recommended fields:

- `resident_id`
- person name fields
- normalized full address
- APN
- zone name / zone id
- captain name
- co-captain names or captain group fields
- captain email
- captain phone
- captain onboarding month
- source zone sheet URL or ID
- damage status
- address plan
- build stage / rebuild status
- sold-since-fire flag/date
- outreach date/status/log fields
- follow-up tags
- EPIC/permitting summary fields, if available
- sync timestamp / generated-at timestamp

The system should tolerate missing optional fields but should make missing data visible rather than silently pretending it does not matter.

---

## 7. Implementation Roadmap

### Phase 1: Make Current MVP More Useful

- Improve the search result cards to make captain/co-captains and zone obvious.
- Add explicit unzoned labeling in search/profile results.
- Add more accurate townwide trend cards using the user's priority metrics.
- Add better empty/config/error states for missing master columns.
- Tune performance for 35k rows:
  - narrower range,
  - longer server cache TTL,
  - debounced search,
  - avoid excessive re-rendering.

### Phase 2: Zone And Captain Tables

- Add "1 row = 1 zone" table.
- Add "1 row = 1 captain" table.
- Add sortable columns.
- Add quick filters for unzoned, low outreach, sold-since-fire, missing APN, etc.
- Add CSV/export later if useful.

### Phase 3: Zone Profiles

- Add zone profile drilldown.
- Show captain/co-captain cards.
- Show topline metrics and breakdowns for the selected zone.
- Show priority rows and data quality warnings for that zone.

### Phase 4: Data Quality And Watchlist

- Add data quality dashboard.
- Add operational watchlist based on metrics the organization can trust.
- Make every warning drillable.
- Avoid unsupported behavioral assumptions.

### Phase 5: Performance And Backend Search

If the 35k-row browser payload becomes too slow:

- Add a server-side cached search endpoint.
- Return only top search matches instead of all rows.
- Precompute zone/captain rollups server-side.
- Consider a generated JSON index or lightweight database only if Google Sheets becomes the bottleneck.

### Phase 6: Admin Editing Exploration

Not part of the current read-only MVP, but likely future pressure.

Potential approach:

- Start with admin-owned fields only.
- Save by `resident_id`, not row number.
- Route edits to the source zone sheet where appropriate.
- Optionally patch the master sheet if it becomes canonical.
- Add audit log.
- Avoid bulk editing until single-record editing is safe.

---

## 8. Current Caveats And Open Questions

- What exact columns will the master sheet expose for co-captains?
- Is "outreach" address-level, person-level, or both in the master sheet?
- How should sold-since-fire be represented: boolean, date, sale status, or multiple columns?
- Which Address Plan values are canonical?
- Which Build Stage values are canonical?
- Will onboarding month live in the master sheet, Access Sheet, NC Directory, or a joined export?
- How should unzoned addresses be identified reliably?
- Should Godmode eventually include EPIC rollups directly, or only per-profile/per-address EPIC detail?

---

## 9. Instructions For Future Agents

When working on Godmode:

1. Read this file before making changes.
2. Update this file when product decisions, data contracts, or implementation status changes.
3. Do not invent captain-performance metrics that the data cannot support.
4. Treat unzoned people/addresses as a coverage concept, not as captainless zones.
5. Preserve the distinction between read-only intelligence and future admin editing.
6. Prefer clear drilldowns over opaque scores.
7. Use `resident_id` and source sheet fields as the foundation for any future write path.
8. Keep the frontend scoped and careful; `index.html` is a large monolith.
9. Add or update tests for backend Godmode logic when changing route/data parsing behavior.


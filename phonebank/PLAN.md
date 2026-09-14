# Phone Bank — Implementation Plan

**Status:** Draft for review  
**Author:** Agent plan (Sep 14, 2026)  
**Target event:** Hosted NC recruitment phone bank (~3 days out)  
**First use case:** Use case 1 — org-hosted phone bank with prospect list  
**Explicit non-goal for v1:** Zone-captain self-serve phone bank (use case 2) — deferred to v2

---

## Executive summary

Build a **standalone, mobile-friendly phone bank** inside the zone dashboard repo that lets Neighborhood Captains call through a shared prospect list from a **desktop browser**, log structured call results, and **launch follow-up texts** with one tap. The design deliberately avoids TurboVPB's extension/relay/pairing stack because we own the data and the backend.

For the first event, scope is ruthlessly minimal: one Google Sheet as the system of record, pre-assigned list slices (no live claim/lease), append-only call logging, and per-contact QR codes for dial + SMS on desktop. No changes to zone spreadsheets, no map, no concurrency infrastructure.

---

## Problem statement

At a hosted recruitment phone bank, captains need to:

1. See a **script** and **context** about each prospect (name, phone, notes, source info).
2. **Dial and text** from their personal phone without retyping numbers or messages.
3. **Log call results** quickly with structured buttons (not free-text-only).
4. **Advance** to the next person without confusion about who already called whom.

Today the dashboard has person-level phones and outreach logging in the Details Panel, but nothing resembling a call queue, disposition picker, `tel:`/`sms:` links, or a shared recruitment dial list.

---

## Architectural decision: why not TurboVPB?

TurboVPB solves a problem we do not have: bridging into NGP VAN / OpenVPB where the campaign does not control the data or API. Its hard parts — browser extension, DOM scraping, encrypted relay, QR session pairing — are workarounds for third-party lock-in.

| TurboVPB component | Needed here? | Our alternative |
|---|---|---|
| Browser extension | No | Standalone web page we control |
| QR session pairing | No | Per-contact `tel:` / `sms:` QR codes (no persistent channel) |
| Encrypted relay server | No | Our Express backend + Google Sheets |
| DOM adapters for VAN | No | We read our own sheet via service account |
| Mobile companion app | No | Same page works on phone; desktop uses QR for dial/text |

The closer analogue is **Turbo Phonebank** (sheet → dialer → write results back). That is what we are building, adapted to Altagether auth, styling, and recruitment workflow.

---

## Guiding constraints

1. **Do not grow `index.html`.** New feature lives in its own directory and files. Optional: one Tools-module link later (~1 line).
2. **Server assembles the queue.** Client never parses zone `sheetData` or duplicates fuzzy column matching from `utils.js`.
3. **Google Sheet is system of record for v1.** No new database. Acceptable for <10 callers and a one-night event.
4. **Call log is append-only.** Avoid row-update contention; mirror summary into zone sheets only in v2.
5. **Mobile-first page, desktop workflow.** Page must work on a phone; desktop captains use QR + copy fallbacks to dial/text.
6. **Event must not depend on the tool.** If the app fails, volunteers fall back to the raw Google Sheet + their phones.

---

## File layout (new module)

```
phonebank/
  PLAN.md              ← this document
  SETUP.md             ← env vars, sheet setup (write at implementation time)
  routes.js            ← API: config, queue, log, script/templates
  phonebank.html       ← standalone page (root-level or served from here)
public/
  js/phonebank.js      ← IIFE client; exposes window.Phonebank
  css/phonebank.css    ← scoped styles; do not touch styles.css
```

**Registration in `server.js`:** ~10-line `registerPhonebankRoutes(app, deps)` block, same pattern as `recruitment/routes.js` and `contact-checkin/routes.js`.

**No edits required to `index.html` for v1.** Share direct URL: `/phonebank.html` (or `/phonebank/`).

---

## Data model — Google Sheet

One spreadsheet (`PHONEBANK_SHEET_ID`), four tabs.

### Tab 1: `Prospects` (read by app, edited by organizer)

Organizer builds this from Airtable export + manual cleanup. Required columns (flexible header aliases on server):

| Column | Required | Purpose |
|---|---|---|
| `First Name` | Yes | Display + SMS merge |
| `Last Name` | Yes | Display |
| `Phone` | Yes | Dial/text target (normalize on server) |
| `Notes` | No | Freeform context shown on call card |
| `Source` | No | e.g. "Airtable — expressed interest" |
| `Zone` | No | If known; helps captains contextualize |
| `Assigned To` | No | Pre-assignment: captain email or name slice |
| `Status` | No | Optional organizer flag: `pending`, `done`, `skip` |
| `Prospect ID` | Auto or manual | Stable row key for logging (UUID or `prospect_` prefix) |

**Row inclusion rules (server-side):**

- Must have a parseable phone number.
- `Status` not in (`done`, `skip`, `do not call`) unless organizer overrides.
- If `Assigned To` is set, only show rows matching signed-in captain (case-insensitive email match; fallback to name match).

**Pre-assignment strategy (v1 — no claim/lease):**

- Organizer adds `Assigned To` column before or during kickoff.
- Unknown roster at start: assign slices live ("you take rows 1–15, you take 16–30").
- With <10 callers, double-calling is unlikely; if it happens, dedupe in post-event review via CallLog.

### Tab 2: `CallLog` (append-only, written by app)

| Column | Purpose |
|---|---|
| `Timestamp` | ISO or locale datetime, server-generated |
| `Prospect ID` | FK to Prospects row |
| `Captain Email` | From auth |
| `Captain Name` | From NC Directory lookup or email local-part |
| `Disposition` | One of the fixed set (below) |
| `Notes` | Optional free-text from captain |
| `Phone Used` | Normalized number dialed |
| `Session ID` | Optional; groups calls from one sitting |

**Dispositions (v1 — locked):**

- `Reached – Interested`
- `Reached – Maybe`
- `Reached – Not interested`
- `Left voicemail`
- `No answer`
- `Wrong number`
- `Call back later`
- `Do not call`

When disposition is `Do not call`, server optionally sets `Status` on the Prospects row to `do not call` (single-row update — acceptable at this volume).

### Tab 3: `Config` (read by app, edited by organizer)

Key-value rows for runtime content without redeploy:

| Key | Example value |
|---|---|
| `script_intro` | "Hi, my name is {captain_name} and I'm calling from Altagether..." |
| `script_body` | Main talking points (markdown or plain text) |
| `script_close` | Ask + thank-you |
| `sms_no_answer` | "Hi {first_name}, this is {captain_name} from Altagether..." |
| `sms_followup` | Alternate template |
| `event_title` | "NC Recruitment Phone Bank — Sep 2026" |
| `event_instructions` | "Use QR to dial. Log every attempt." |

Template merge fields: `{first_name}`, `{last_name}`, `{captain_name}`, `{zone}`, plus any non-empty column from the current prospect row exposed as `{column_name}`.

### Tab 4: `Captains` (optional, v1.1)

If roster is unknown until start, organizer can add rows at kickoff:

| Email | Display Name | Assigned Rows |
|---|---|---|

Defer unless pre-assignment via `Prospects.Assigned To` proves insufficient during rehearsal.

---

## API design

Base path: `/api/phonebank/`

Auth: copy `recruitment/routes.js` pattern — `createRequirePhonebankAuth`:

- Accept Google Bearer token **or** httpOnly session cookie (`session-auth.js`).
- Require registered dashboard user (`isRegisteredAccessRows`).
- Attach `req.authUser = { email, sub }`.

| Method | Path | Auth | Purpose |
|---|---|---|---|
| `GET` | `/config` | Public | `{ enabled, sheetConfigured, eventTitle }` |
| `GET` | `/queue` | Required | Returns assigned prospects + config + captain identity |
| `POST` | `/log` | Required | Append CallLog row; optional Status update |
| `GET` | `/stats` | Required | Session stats: calls logged, by disposition (optional v1) |

### `GET /api/phonebank/queue` response shape

```json
{
  "eventTitle": "NC Recruitment Phone Bank",
  "captain": { "email": "...", "name": "..." },
  "script": { "intro": "...", "body": "...", "close": "..." },
  "templates": {
    "sms_no_answer": "...",
    "sms_followup": "..."
  },
  "prospects": [
    {
      "id": "prospect_abc123",
      "firstName": "Maria",
      "lastName": "Lopez",
      "phone": "+16265551234",
      "phoneDisplay": "(626) 555-1234",
      "notes": "...",
      "source": "Airtable",
      "zone": "",
      "extraFields": {}
    }
  ],
  "calledIds": ["prospect_xyz"]
}
```

`calledIds` derived from CallLog for this captain (or globally — organizer choice; recommend **per-captain** for v1 so progress is personal).

### `POST /api/phonebank/log` body

```json
{
  "prospectId": "prospect_abc123",
  "disposition": "Left voicemail",
  "notes": "Will try again in an hour",
  "phone": "+16265551234"
}
```

Server appends to CallLog; returns `{ success: true }`.

**Caching:** In-memory tab cache, 15–30s TTL (match recruitment module). Invalidate on append. Acceptable for serverless; stale queue up to 30s is fine for this event.

**Rate limiting:** None in v1. At <10 users × ~30 calls each, Sheets API stays well under quota.

---

## Client UX — call card (desktop + phone)

Standalone page: sign in → load queue → one prospect at a time.

### Layout (desktop, single column + optional sidebar)

```
┌─────────────────────────────────────────────────────────┐
│  [Event title]                    Captain: Jane · 3/12  │
├─────────────────────────────────────────────────────────┤
│  SCRIPT (collapsible)                                   │
│  Intro / body / close from Config tab                   │
├─────────────────────────────────────────────────────────┤
│  MARIA LOPEZ                                            │
│  (626) 555-1234  [Copy number]                          │
│                                                         │
│  Notes: Expressed interest at community meeting         │
│  Source: Airtable                                       │
├─────────────────────────────────────────────────────────┤
│  CALL / TEXT                                            │
│  ┌──────────┐  ┌──────────┐                             │
│  │ QR Dial  │  │ QR Text  │   ← encode tel: / sms:     │
│  └──────────┘  └──────────┘                             │
│  [Open dialer]  [Open Messages]  ← direct links         │
│  [Copy SMS text]                  ← clipboard fallback  │
├─────────────────────────────────────────────────────────┤
│  RESULT                                                 │
│  [Reached – Interested] [Reached – Maybe] [Not inter.]  │
│  [Left voicemail] [No answer] [Wrong number]            │
│  [Call back later] [Do not call]                        │
│  Notes: [________________________]                      │
│  [Log & Next →]                                         │
└─────────────────────────────────────────────────────────┘
```

### Desktop → phone workflow

1. Captain reads script and context on laptop (Zoom share or solo screen).
2. Points phone camera at **QR Dial** → taps notification → native dialer opens.
3. After no answer, points at **QR Text** → Messages opens with pre-filled body (`sms:` URI with merged template).
4. Captain taps disposition + optional note → **Log & Next** → next prospect.

**Why per-contact QR (not session pairing):** Session pairing requires a persistent WebSocket or KV store across Vercel serverless instances — too much for three days. Per-contact QR is ~20 lines with any QR library, zero server state, and works offline after page load.

**Platform caveats (document in SETUP.md):**

- iOS and Android Camera app recognize `tel:` and `sms:` QR codes.
- Some Android SMS apps ignore `body=` parameter → **Copy SMS text** button is mandatory fallback.
- Captain sends from **personal number**; replies go to their phone, not logged in app.

### Mobile-direct workflow

Same page on phone: tap **Open dialer** / **Open Messages** (no QR needed). Useful if a captain is remote on phone only.

---

## Auth for standalone page

`phonebank.html` must implement sign-in without `index.html` globals.

**Reuse existing backend:**

1. Google Identity Services (same OAuth client ID as dashboard).
2. `POST /api/auth/session` with `{ accessToken }`, `credentials: 'include'`.
3. `GET /api/auth/me` on load to restore session.
4. All `/api/phonebank/*` calls with `credentials: 'include'`.

Extract minimal shared helper → `public/js/auth-lite.js` (optional, ~80 lines). Both `phonebank.html` and future standalone pages can use it.

**Security note:** Bulk phone exposure makes tightening `/api/user-sheets` email verification more important long-term. Not blocking for v1 if phonebank routes use proper auth middleware and do not expose queue to unauthenticated users.

---

## Phone normalization

Server-side helper in `phonebank/routes.js`:

- Strip non-digits except leading `+`.
- Assume US `+1` if 10 digits.
- Reject rows with <10 digits.
- Store/display: E.164 internally, `(XXX) XXX-XXXX` for display.
- Prefer **Cell** over **Home** if both exist (v2 zone integration); v1 sheet has single `Phone` column.

---

## SMS template merge

On each prospect render, client (or server in queue response) merges:

```
Template: "Hi {first_name}, this is {captain_name} from Altagether..."
Prospect: Maria Lopez
Captain: Jane Smith
→ "Hi Maria, this is Jane Smith from Altagether..."
```

Build `sms:` URI:

```
sms:+16265551234?body=Hi%20Maria%2C%20this...
```

Also render QR encoding the same URI. Provide **Copy SMS text** for clipboard.

Seed templates from existing copy in `outreach-helper.html`; recruitment-specific wording in Config tab.

---

## What we are NOT building in v1

| Feature | Reason | Target |
|---|---|---|
| Live claim/lease / locking | Hard on serverless; unnecessary at <10 callers | v2 or never |
| Zone sheet write-back | Scope; CallLog is enough for event | v2 |
| Map on call card | Nice; addresses may be sparse on prospect list | v1.1 |
| TurboVPB-style session pairing | Infrastructure cost | Never (unless strong demand) |
| SMS gateway / auto-send | Compliance + cost | Never for P2P workflow |
| Contact List Creator resurrection in index.html | Wrong surface | v2 as zone phone bank |
| Structured disposition → zone Outreach Log | Needs schema agreement | v2 |

---

## v2 preview — zone captain phone bank (use case 2)

After the hosted event, extend the same module:

- **List source:** Captain's zone sheet via existing sheet access (`currentSheetId`).
- **Filters:** Port logic from dead Contact List Creator (~lines 25025–25805 in `index.html`) — uncontacted, needs follow-up, stale contact — into server-side queue builder.
- **Writes:** Append to CallLog **and** mirror to zone sheet via `batch-update-by-resident-id` using `findOutreachDateColumn` / `findOutreachLogColumn` from `utils.js`.
- **Phones:** Home + Cell columns, prefer Cell for dial/text.
- **Entry point:** Link from Tools module or Home panel widget (minimal `index.html` bridge, Contact Check-In pattern).

No new architecture required — same routes, parameterized by `mode=recruitment|zone`.

---

## Implementation phases

### Phase 0 — Organizer prep (parallel, no code)

- [ ] Create Google Sheet with tabs: Prospects, CallLog, Config
- [ ] Share sheet with service account (`dashboard@nc-dashboard-v1.iam.gserviceaccount.com`) as Editor
- [ ] Build Prospects list from Airtable export; verify phones
- [ ] Write recruitment script + SMS templates into Config tab
- [ ] Set `PHONEBANK_SHEET_ID` in Vercel env (when ready)

### Phase 1 — Vertical slice (day 1)

- [ ] `phonebank/routes.js`: config, queue (read Prospects + Config), log (append CallLog)
- [ ] `phonebank.html` + `public/js/phonebank.js` + `public/css/phonebank.css`
- [ ] Auth-lite sign-in flow
- [ ] Single prospect display: name, phone, notes, script
- [ ] Disposition buttons → log → advance
- [ ] Register routes in `server.js`
- [ ] `phonebank/SETUP.md` with env vars and sheet template

### Phase 2 — Dial/text (day 1–2)

- [ ] Phone normalization
- [ ] Template merge for SMS body
- [ ] `tel:` / `sms:` links
- [ ] Per-contact QR codes (dial + text)
- [ ] Copy number + copy SMS fallbacks
- [ ] Progress counter (N of M in assigned slice)

### Phase 3 — Hardening (day 2)

- [ ] `Assigned To` filtering
- [ ] Mark already-called prospects (dim or skip)
- [ ] `Do not call` → update Prospects.Status
- [ ] Error states: empty queue, auth failure, sheet misconfigured
- [ ] Mobile layout pass
- [ ] Basic tests in `test/phonebank.test.js` (normalization, merge, disposition validation)

### Phase 4 — Event rehearsal (day 3)

- [ ] Deploy to staging/production
- [ ] Organizer test with 5–10 real rows
- [ ] One captain dry-run on desktop + phone
- [ ] Confirm CallLog rows appear correctly
- [ ] Print fallback runbook (below)

---

## Event runbook (fallback)

If the app is down or a captain cannot sign in:

1. Open the Prospects Google Sheet directly.
2. Filter to your `Assigned To` rows.
3. Call from the sheet; log results in the CallLog tab manually (Timestamp, Prospect ID, your email, disposition, notes).
4. Use `outreach-helper.html` or a pasted SMS template for follow-up texts.

The phone bank should speed up the event, not gate it.

---

## Environment variables

```ini
PHONEBANK_ENABLED=1
PHONEBANK_SHEET_ID=<google sheet id>
PHONEBANK_PROSPECTS_TAB=Prospects
PHONEBANK_CALLLOG_TAB=CallLog
PHONEBANK_CONFIG_TAB=Config
PHONEBANK_CACHE_TTL_MS=30000
NC_DIRECTORY_SHEET_ID=<existing default>
```

---

## Testing checklist

- [ ] Unauthenticated user cannot load queue
- [ ] Registered captain sees only their `Assigned To` rows
- [ ] Captain with no assignment sees all rows (or empty — decide and document)
- [ ] Invalid phone rows excluded from queue
- [ ] Each disposition appends exactly one CallLog row
- [ ] QR dial opens dialer on iOS and Android
- [ ] QR text opens Messages with body on iOS; copy fallback works on Android
- [ ] `Do not call` removes prospect from subsequent queue loads
- [ ] Page usable at 375px width (phone)
- [ ] Page usable at 1280px width (laptop)

---

## Open decisions (resolve before coding)

1. **Unassigned rows:** If `Assigned To` is blank, show to all captains or hide? Recommend: **show to all** with organizer warning — simpler for kickoff reassignment.
2. **Called prospect behavior:** Skip automatically or show grayed with "already called"? Recommend: **skip by default**, toggle "Show completed".
3. **Global vs per-captain calledIds:** Recommend **per-captain** for v1.
4. **Prospect ID generation:** Organizer adds UUID column, or server hashes normalized phone + name? Recommend: **organizer adds `Prospect ID` column** with `=ROW()` or UUID for simplicity.

---

## Success criteria for first event

- [ ] Every captain can sign in and see their list slice in <2 minutes
- [ ] Dial + SMS follow-up without typing phone number or message from scratch
- [ ] Every call attempt logged with disposition in CallLog
- [ ] Organizer can export CallLog for follow-up after the event
- [ ] Zero dependency on `index.html` changes for the event to run

---

## References

- TurboVPB architecture brief (user-provided): extension + relay pattern; informs what to avoid
- `recruitment/routes.js` — auth + Sheets read/write pattern
- `contact-checkin/routes.js` — central log sheet + append pattern
- `contact-checkin/HANDOFF.md` — module isolation conventions
- `outreach-helper.html` — SMS/email template seed copy
- `CODEBASE_FIELD_GUIDE.md` — do-not-touch zones in index.html

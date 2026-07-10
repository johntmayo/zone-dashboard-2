# Contact Check-In / Check-In Framework

**Working decision log and product spec**  
**Status:** Draft — evolving through guided Q&A  
**Date:** July 7, 2026

## 1. Purpose

Altagether is building a new **Contact Check-In** workflow in the Neighborhood Captain Zone Dashboard.

The immediate goal is to help Neighborhood Captains review their zones and identify:

> Which households have been successfully contacted, and which have not?

This project was prompted in part by a cross-organization cohort, but the cohort is only a catalyst and one current reporting use case. The architecture should serve Altagether’s long-term needs rather than being designed around the cohort.

The Contact Check-In is also intended to be the first implementation of a broader, reusable **Check-In framework** that could later support other focused passes through a captain’s zone, such as resident, APN, address-plan, or rebuild-stage check-ins.

---

## 2. Product North Star

> Build a humane, volunteer-friendly interface that gathers enough true information to answer the household-contact question without making captains do fake CRM labor.

The system should protect volunteer time, attention, and goodwill. It should favor simplicity, truthfulness, and momentum over perfect relational data modeling.

---

## 3. Core Experience Principles

The Check-In experience should be:

- smooth
- easy to understand
- resumable
- useful in short bursts
- explicit about progress
- satisfying to complete
- low in cognitive load

It should use **mobile-style interaction principles** even if the dashboard is not yet fully mobile-optimized.

Captains should be able to:

- open the Check-In and immediately understand what to do
- complete a few addresses at a time
- stop without losing progress
- return later and resume easily
- feel forward momentum and accomplishment

---

## 4. Naming

The preferred user-facing term is **Check-In**.

Examples:

- Contact Check-In
- Resident Check-In
- APN Check-In
- Rebuild Check-In

“Pass” may remain useful as an internal architectural concept, but “Check-In” is the preferred language shown to volunteers because it feels casual and approachable.

---

## 5. Foundational Data Model Reality

The existing backend is person-based:

- one spreadsheet row per resident
- multiple residents can share an address
- address-level information is currently represented by repeating the same value across residents at that address
- the dashboard groups residents into address cards and derives some address-level display states from resident rows

The central data challenge is:

> We need to determine household-level contact coverage using data stored at the person level—without forcing captains to make claims about individual residents that they do not actually know.

Example:

- Maria, Luis, and Sofia are listed at one address.
- A captain calls the household landline and speaks with Maria.
- The captain knows Maria was contacted.
- The captain knows someone at the address was reached.
- The captain does **not** necessarily know whether outreach was attempted to Luis or Sofia individually.

The system must not manufacture false person-level data in order to create a household-level rollup.

---

## 6. Definition of Successful Contact

A successful contact requires **interaction**.

Examples that count:

- a resident replies to an email
- a resident replies to a text
- a resident answers a phone call
- a resident speaks with the captain at the door or in person
- a resident asks a question in a zone group
- a resident joins a communication channel and actively identifies or engages themselves
- a resident responds only to say they do not wish to be contacted again

Examples that do **not** count:

- sending an email with no reply
- sending a text with no reply
- leaving a voicemail
- leaving a flyer or note
- knocking with no answer
- posting something the resident may or may not have seen

This definition must be made very clear in the Check-In interface through concise instructions, tooltips, examples, and training materials.

---

## 7. Current Outreach System

The current outreach system should remain intact for the MVP unless the Q&A process reveals a compelling reason to change it.

Existing person-level data includes:

- Last Outreach Attempt Date
- Outreach Log
- Person — Unable to Reach
- Person — Needs Follow-Up
- Wants_Updates
- Former Resident
- Deceased
- Person Notes
- Address Notes

Current behavior:

- outreach attempts are logged against an individual resident row
- any non-empty outreach date counts as outreach attempted
- an address is displayed as having outreach attempted if any active resident at that address has outreach data
- outreach history can include notes

Important distinction:

- **Outreach** records effort.
- **Successful Contact** records outcome.

These should remain separate concepts.

---

## 8. Current MVP Direction

### 8.1 Person-level permanent data

The strongest current direction is to add a single simple field:

- **Successfully Contacted** — checkbox / boolean

A checkbox is preferred over a multi-value Contact Status field if it can answer the real questions without adding ambiguity.

Blank or unchecked should not automatically mean:

- no outreach was attempted
- the person is unreachable
- the person refused contact
- the person was reviewed and confirmed not contacted

It simply means there is no affirmative record that this individual has been successfully contacted.

### 8.2 No contact date

Current decision: do **not** add a contact date for MVP.

Reasons:

- it adds friction
- captains are unlikely to maintain it consistently
- it becomes stale quickly
- it invites CRM-like expectations
- “Historical / date unknown” would add more complexity without clear value

### 8.3 Address-level contact status

Address-level contact status should be **derived by the dashboard**, not stored as a duplicated backend field.

Current intended logic:

- if at least one active resident at an address is marked Successfully Contacted, the dashboard may display the address as contacted/reached
- residents who were not specifically identified as contacted remain unchanged

This lets the system answer the household-level coverage question without falsely marking every resident at the address as contacted.

### 8.4 Core Check-In question flow

The core interaction currently appears to be:

> Have you successfully contacted anyone at this address?

If **Yes**:

> Who did you contact?

The captain selects one or more actual people from the resident list. Multiple selections should be allowed.

The system then:

- marks only the selected person or people as Successfully Contacted
- derives the address-level status from those person-level facts

The interface should not allow a free-floating “household contacted” status with no identified person attached.

### 8.5 Someone not listed

The workflow should support:

> Someone else at this address

If selected, the captain should be able to quickly add a new resident without leaving the Check-In, then mark that new person as Successfully Contacted and continue.

This should use or integrate with the dashboard’s existing create-resident functionality, but in a lightweight inline form rather than forcing the captain to exit the Check-In.

Current preferred quick-add fields:

- First name
- Last name
- Phone/email optional
- Notes optional

After save, the system should:

- create the resident at the current Address_ID
- mark the new resident as Successfully Contacted
- return to the current Check-In card
- keep the new resident selected

This should feel like a constrained quick-add path, not a full resident-management workflow.

---

## 9. Data and Features Explicitly Out of Scope for MVP

Current decisions:

- no household table
- no outreach-event table
- no full event logging overhaul
- no representation-confidence field
- no contact date
- no “primary household contact” field
- no “primary contact for address” field
- no custom list-building system
- no full CRM

The concepts of “head of household” or “primary household contact” are not aligned with Altagether’s values or the reality of grassroots recovery and should not be formalized in the data model.

---

## 10. Notes as a Pressure-Release Valve

The existing fields are probably sufficient:

- Person Notes
- Address Notes

The Check-In should expose these contextually, without creating additional overlapping note fields.

Possible UI labels:

- Add a note about this person
- Add a note about this address

Notes should be:

- optional
- visually secondary
- easy to access
- available for complicated or emotionally important context that does not belong in structured fields

Supporting a captain’s own memory and judgment is a legitimate function of the dashboard even when the note has little analytical value.


---

## 10A. Optional Fields UX Rule

Optional resident details should never compete with the primary Check-In question.

They should be:

- collapsed by default
- visually quiet
- placed below the main person-selection action
- framed through design as contextual escape hatches, not required steps
- excluded from progress/completion logic

Preferred pattern:

```text
☐ Amelia Sanders
   Options / notes
```

“Options / notes” should read as a small muted text control, likely with a chevron, rather than a prominent button. The interface should communicate optionality through placement, styling, and behavior rather than explanatory copy like “Most captains can skip this.”

When expanded under a specific person, the controls should apply only to that person. This avoids confusion about which resident a tag or note belongs to.

Potential expanded person-level controls:

- Wants updates
- Do not contact
- Needs follow-up
- Unable to reach
- Former resident
- Deceased
- Person Notes

Address Notes should remain separate from person-level options and appear as an optional address-level context area.

The main hierarchy should remain clear:

1. Answer the address contact question.
2. Select who was contacted.
3. Add optional context only if useful.

---

## 11. Related Dispositions and Preferences

### 11.1 Do Not Contact

Current thinking:

- Do Not Contact is **not** a Contact Status.
- It is a separate resident disposition or preference.
- A person can be Successfully Contacted and also Do Not Contact.
- A resident who responds only to request no further contact still counts as successfully contacted.

The system does not currently have a Do Not Contact field. Adding one during this project may be useful, but the exact implementation remains open.

### 11.2 Wants Updates

The database already includes Wants_Updates.

Potentially useful related values include:

- wants updates
- does not want updates
- do not contact

These are not necessarily the same thing:

- someone may not want newsletters but may still be open to direct communication
- someone may explicitly request no future contact

Current direction: the Check-In may expose these options opportunistically, but they should not become the center of the workflow.

### 11.3 Unable to Reach / Needs Follow-Up

Existing person-level fields:

- Person — Unable to Reach
- Person — Needs Follow-Up

“Unable to Reach” is intended for someone a captain has tried multiple times to reach unsuccessfully.

These fields may be useful during Contact Check-In, but their exact role remains to be decided.

---

## 12. Check-In Framework Architecture

The Check-In framework should be modular:

- shared shell
- different check-in types
- different question sets
- different completion logic
- different fields updated

Likely reusable components:

- check-in type
- captain
- zone
- item universe
- progress state
- completion state
- resume position
- last activity
- completion date

The first implementation should solve Contact Check-In concretely without over-abstracting, but it should avoid hard-coding the experience so tightly that future check-ins require a rebuild.

---

## 13. Address IDs

Current decision:

The Check-In framework needs a stable internal **Address_ID**.

This ID should be:

- globally unique across Altagether
- separate from APN
- separate from formatted address text
- generated and managed by Altagether
- stable even if address text is corrected
- preserved if residents move, are added, or are removed
- used as the anchor for Check-In progress and future address-based workflows

Rationale:

The existing database has unique resident IDs but no unique address IDs. APN cannot serve this role because parcel data is messy: some addresses have multiple APNs, some APNs cover multiple addresses, and some address-like units may not map cleanly to APNs.

The Address_ID does not require creating a full Address table for MVP. It can begin as a new column duplicated across resident rows that share the same address grouping.

However, because Check-In completion is based on addresses reviewed, progress should not rely on fragile address text or on resident IDs alone.

The working assumption is that Altagether will do the necessary address normalization and push a global Address_ID field into existing captain spreadsheets before or as part of the Check-In rollout.

Important clarification:

Address_ID creation should **not** depend on perfect address normalization. That would become a trap and could block the Check-In launch.

The Address_ID should be understood as Altagether’s stable identifier for the current operational address grouping, not as a claim that the address data is perfectly clean or that the grouping is permanently correct.

The system should tolerate later cleanup:

- **Correct address text:** keep the same Address_ID.
- **Merge duplicate address records:** choose a surviving Address_ID and retire or redirect the duplicate.
- **Split a messy address group:** create a new Address_ID and move the appropriate residents to it.
- **Same APN, multiple addresses:** allowed.
- **Same address, multiple APNs:** allowed.
- **Unknown or missing APN:** allowed.

This is especially important because the existing data contains inconsistencies such as fractional addresses, legacy units, incomplete APNs, and assessor data that does not cleanly map one-to-one with resident records.

The purpose of Address_ID is not to make the address database perfect. The purpose is to give the Check-In framework and future dashboard workflows a stable handle that can survive imperfect data and later correction.

---

## 14. Progress Tracking Architecture

The Check-In needs to support:

- progress bars
- short resumable sessions
- automatic resume
- admin-level visibility into network progress
- completion reporting

The Check-In workflow should not become the authoritative source of contact truth. Permanent person-level fields remain the source of truth. Check-In progress data exists to support the experience and reporting on completion of the review process.

Core distinction:

- **Contact truth:** stored on resident records
- **Review/completion truth:** stored in Check-In progress records

### 14.1 Lazy creation

Current decision:

Check-In AddressReview records are created **lazily** when a captain reviews or skips an address. The table does not need to be pre-seeded with every address in the database.

The total universe of addresses is derived from the captain’s zone spreadsheet using `Address_ID`.

This means:

- if an address has no review record, it has not yet been touched in this Check-In
- if a captain answers **Yes**, create/update a review record
- if a captain answers **No**, create/update a review record
- if a captain chooses **Skip for now**, create/update a skipped review record

Progress can be calculated as:

> reviewed addresses / total active addresses in the zone

Skipped addresses are tracked separately and do not count as reviewed.

### 14.2 Physical storage

The AddressReview schema is a reusable table shape, not necessarily one immortal spreadsheet forever.

For MVP, use one central spreadsheet/table for the Contact Check-In launch. Future Check-Ins can use the same schema but live in separate spreadsheets, tabs, or tables as needed to avoid Google Sheets size limits.

Examples:

- Contact Check-In 2026 Address Reviews
- APN Check-In 2026 Address Reviews
- Rebuild Stage Check-In 2027 Address Reviews

### 14.3 AddressReview fields

Recommended MVP fields:

```text
review_key
check_in_id
address_id
zone_id
captain_id
review_status
answer
reviewed_at
updated_at
```

Where:

- `review_status` = `reviewed` or `skipped`
- `answer` = `yes_successful_contact`, `no_successful_contact`, or blank if skipped

### 14.4 Deterministic review_key

Current decision:

Use a deterministic `review_key`, not a random `review_id`.

Because captains can share zones, the safest key is:

```text
review_key = check_in_id + "__" + zone_id + "__" + captain_id + "__" + address_id
```

This ties the review record to:

> this Check-In, this zone, this captain, this address

If two co-captains both review the same address, they should not overwrite each other unless Altagether explicitly decides to merge their work later. Each captain gets their own review record because their `captain_id` is part of the key.

### 14.5 Upsert behavior and concurrency

The backend should use an **upsert** pattern:

> Find the row with this `review_key`. If it exists, update it. If it does not exist, append a new row.

The browser should not independently decide spreadsheet row numbers. The browser should submit the answer to the server, and the server should generate the `review_key`, find-or-append the row, and write the update.

This avoids captains overwriting one another if many volunteers use the Check-In at the same time. It also prevents duplicate records when one captain changes an answer later.

### 14.6 Editing answers later

Current decision:

Captains should be able to change answers later. The latest answer should replace the previous answer in the same review record, and `updated_at` should change. No version history is required for MVP.

---

## 15. Open Questions for Guided Q&A

### A. Person inclusion in the Check-In

Current decision:

- every listed resident should appear as eligible to be marked Successfully Contacted
- the MVP should not add an Outreach Target / Outreachable field
- children are expected to be uncommon in the database and do not require a special structural solution
- the interface may expose the existing Person Notes field as an optional place for context

Rationale:

A formal outreach-target classification risks inviting captains to exclude people from recovery or make unnecessary judgments about who counts. The system should not require captains to explain why every unchecked person was not contacted.

### B. No successful contact scenario

Current direction:

The Check-In should require an explicit answer to the address-level workflow question:

> Have you successfully contacted anyone at this address?

If the captain answers **No**:

- no resident is marked Successfully Contacted
- no person-level “Not Contacted” status is written
- the address is marked **reviewed for this Check-In**
- the system preserves the distinction between contact truth and review/completion truth

Leaving all resident checkboxes blank is not enough to count as reviewed, because blank could mean either “no one was contacted” or “the captain has not reviewed this address yet.”

The existing outreach system remains a separate dimension. The preferred UI direction is:

- show one compact **address-level outreach summary** near the main contact question
- do **not** show full outreach history under every resident by default
- allow the captain to expand the summary to see which residents have outreach records and review their details
- if the captain answers **No**, the interface may make that outreach summary and related optional actions more prominent

Example collapsed summaries:

- Outreach logged for this address
- No outreach currently logged

An expanded view could show person-level details such as the resident name, last outreach attempt, and outreach history. This preserves the existing person-level truth without cluttering the main decision.

The **No** branch may also expose optional actions such as Log Outreach, Unable to Reach, or Needs Follow-Up, but those should not become required second questions in the core flow.

### C. Multiple households at one address

The system currently groups people by address, not household.

Questions:

- how common is this in the actual dataset?
- does the MVP need to represent multiple households explicitly?
- can notes and resident selection handle this adequately for now?
- are there cases where one contacted resident should not make the address display as reached?

### D. Opportunistic fields

Current direction:

- opportunistic fields should be hidden behind small expandable **Options / notes** controls
- person-level options should appear under the relevant person, not in one global section
- address-level notes should appear separately as address-level context
- optional fields should be available but unobtrusive

Potentially expose during Contact Check-In:

- Wants Updates
- Does Not Want Updates
- Do Not Contact
- Unable to Reach
- Needs Follow-Up
- Former Resident
- Deceased
- Person Notes
- Address Notes
- Quick-add resident

Need to decide:

- which of these are useful enough to include in MVP
- whether any should appear conditionally based on Yes/No branch
- whether “Does Not Want Updates” exists as its own field/value or remains out of scope

### E. Progress and completion logic

Current decisions:

- Check-In completion is based on addresses reviewed, not the percentage of individual residents marked Successfully Contacted.
- Contact coverage and Check-In completion are different metrics.
- A captain can complete 100% of the review even when many residents remain uncontacted or unchecked.
- Every reviewed address must receive an explicit workflow answer:
  - Yes, someone here was successfully contacted → select one or more people
  - No, no one here has been successfully contacted
- **Skip for now** does not count as reviewed and returns the address to the remaining queue.
- A “No” answer completes the review item without writing a false person-level status.

Still unresolved:

- where address-review progress should be stored
- what admins can see
- whether a Check-In can be reopened or refreshed later

### F. How the boolean ages

Current decision:

- **Successfully Contacted** is a durable person-level fact.
- It means this person has been successfully contacted at some point by the captain/network.
- It is not intended to represent the current freshness, strength, or health of the relationship.
- It should not be maintained through contact dates or ongoing interaction logging in the MVP.
- If Altagether later needs to know whether relationships are current, that should be handled through a future Check-In or refresh workflow, not by adding date-maintenance labor now.

Implication:

- Contact truth is durable.
- Check-In completion/review truth is tied to a specific Check-In run.
- Recency/currentness is deliberately not tracked in MVP.

---

## 16. Research Takeaway

External research recommended a formal person + household + outreach-event model.

Altagether’s current conclusion is:

- the formal model is intellectually clean
- it is likely operationally excessive for volunteers
- the most valuable principle is to avoid falsely assigning contact or outreach to every resident at an address
- the MVP should preserve truth through selective person-level marking and derived address-level display, without introducing household and event tables

This approach may be genuinely novel because it prioritizes volunteer experience, grassroots practice, and minimal truthful data over conventional CRM completeness.

---

## 17. Immediate Next Step

Because the intended launch window is short, the next decisions should focus on the minimum viable Contact Check-In rather than broader data-cleanup or address-normalization work.

Resume the guided Q&A, one concrete scenario at a time, while updating this document after each resolved decision.

Recommended next question:

> What should the admin and captain progress views show for Contact Check-In?

Then continue refining the UI branch question:

> When a captain answers “No successful contact,” which existing optional actions or fields—if any—should be surfaced immediately without turning that branch into a second required workflow?

Current UI hypothesis to test in that discussion:

- keep the main decision focused on successful contact
- show a compact address-level outreach summary nearby
- keep person-level outreach details behind an expandable view
- reveal optional follow-up actions more prominently only after a **No** answer

---

## 18. Locked UI Decision: “Someone Else at This Address”

When a captain answers **Yes** to successful contact but the person they contacted is not listed, the Check-In must support a lightweight inline add-person flow.

User-facing pattern:

- Person list includes **Someone else at this address**
- Selecting it opens a constrained quick-add form, not the full resident-management workflow
- Required fields should be minimal, ideally only first name if the backend allows it
- Optional fields may include last name, phone/email, and person note

On save, the system should:

- create a new resident record at the current `Address_ID`
- mark that new resident as `Successfully Contacted = true`
- keep the new person selected in the Check-In flow
- return the captain to the current Check-In card

The captain should not have to exit the modal, open the normal resident creation interface, create a person, and then return to the Check-In. This is an escape hatch designed to preserve flow and reduce friction.


---

## 19. Locked Decision: Historical Outreach Logging During Contact Check-In

In the **No successful contact** branch, captains should have an optional way to record that they attempted outreach even if they do not know the exact date.

This resolves a key volunteer-experience problem: a captain may correctly answer **No, I have not successfully contacted anyone here**, while still wanting to record that they tried.

The existing outreach system should remain in place, but it should become more flexible around date certainty.

Recommended pattern:

> Want to record an outreach attempt?
> Use this if you tried to reach someone here but never got a response.

Possible date options:

- Today
- Approximate / sometime before today
- I don’t remember when

The `Last Outreach Attempt Date` field does **not** need to remain date-only. Human-language values such as `Historical`, `Approximate`, or `Date unknown` are acceptable if they reduce friction and better reflect what the captain actually knows.

The `Outreach Log` remains the richer record. Historical or date-uncertain outreach attempts should be appended to the rolling outreach log with a clear prefix, for example:

- `[Historical] Emailed but did not receive a response.`
- `[Date unknown] Left voicemail sometime earlier this year.`

Metric implication:

Outreach-attempted metrics should be updated so that **any non-empty Outreach Log entry counts as outreach attempted**, even if `Last Outreach Attempt Date` is blank, approximate, or non-date text.

This gives captains a way to get accurate “I tried” credit without forcing false precision, corrupting contact status, or turning Contact Check-In into a full CRM.

---

## 20. Locked Decision: No Successful Contact Branch and Person-Based Outreach

When a captain answers **No, I haven’t successfully contacted anyone at this address**, that answer only resolves the contact question. It does **not** imply that outreach was attempted.

The No branch should remain simple:

1. Captain answers **No**
2. Interface confirms: “Got it. This address will count as reviewed, but not yet successfully contacted.”
3. Optional tools are made available, but not required:
   - Log outreach attempt
   - Mark someone unable to reach
   - Add address note
   - Add person note
4. On **Save & Next**, the system writes:
   - no person contact-status changes
   - Check-In address review record = reviewed / no successful contact

Outreach logging remains person-specific for MVP. The system should not create a general household-level outreach attempt, and it should not attach household outreach to the first listed resident as a workaround.

If a captain believes an outreach attempt applies to multiple residents, such as a shared landline or duplicate phone number, they can log the attempt for those residents individually or use existing batch tools.

Working rule:

> Contact Check-In is address-guided, but outreach logging remains person-based.

---

## 21. Required Tooltips and Microcopy

The Contact Check-In must include clear, accessible explanations for key terms. These definitions are central to data quality and should appear close to the relevant controls as tooltips, help text, or compact inline explanations.

Important definitions to include:

### Contact / Successfully Contacted

Suggested tooltip:

> Contact means a two-way interaction. They replied, answered, spoke with you, asked a question, joined a conversation, or otherwise confirmed they received your message. Sending an email, leaving a voicemail, or dropping off a flyer does not count unless they responded.

### Outreach Attempt

Suggested tooltip:

> An outreach attempt means you tried to reach someone, even if they did not respond. Examples include sending an email, calling, texting, leaving a voicemail, knocking on the door, mailing a note, or leaving a flyer.

### Unable to Reach

Suggested tooltip:

> Use this only when you have tried multiple times and still have not been able to reach this person. This is stronger than “not contacted yet.”

### Wants Updates

Suggested tooltip:

> Use this when someone has said they want to receive updates from you or from the zone.

### Do Not Contact

Suggested tooltip:

> Use this when someone has clearly asked not to be contacted again. This is different from simply not wanting regular updates.

### Skip for Now

Suggested tooltip:

> Skip leaves this address unfinished and keeps it in your queue for later.

Design rule:

Tooltips should clarify terms without making the interface feel instructional or heavy. They should be noticeable when needed but not compete with the main Check-In question.

---

## 22. Locked Decision: Progress Views and Campaign Engagement

Contact Check-In should include both individual progress tracking and network-wide campaign visibility.

### Captain-facing progress

Captains should see clear progress through their own zone, focused on completion and forward momentum.

Suggested captain-facing metrics:

- addresses reviewed
- addresses remaining
- skipped addresses
- households successfully reached
- households reviewed but not yet successfully reached

Completion should be based on **addresses reviewed**, not people contacted. This lets captains complete the assignment without implying they have contacted every individual resident.

### Network-wide progress widget

For the launch campaign, the dashboard home page should include a temporary or semi-temporary network-wide Contact Check-In widget.

Purpose:

> Help captains feel that they are part of a coordinated town-wide effort, not merely completing an isolated data-entry task.

Possible metrics:

- total unique addresses in the Altagether database
- Altagether-wide percentage of addresses reviewed through Contact Check-In
- percentage of unique addresses with at least one successful contact logged
- percentage of unique addresses with outreach logged
- total addresses reviewed
- total households successfully reached
- total households reviewed but not yet successfully reached
- zones completed
- captains participating
- recent progress, such as addresses reviewed in the last 48 hours

The tone should be communal and motivating rather than punitive or shame-based. These metrics belong in the Community Feed or admin module, not inside the captain’s zone-specific Contact Check-In card.

### Leaderboard / highlights

A hard leaderboard should be treated carefully. Avoid ranking captains by number of households contacted, because that could reward easier zones or create incentives to mark contact carelessly.

If a leaderboard or progress board is used, prefer metrics based on completion and momentum, such as:

- zones completed
- zones nearing completion
- captains who completed their Check-In
- recent progress milestones
- collective milestones

A softer “celebration feed” may be preferable to a strict ranking:

- “Zone 12 completed Contact Check-In”
- “14 captains made progress this week”
- “Altagether passed 50% of addresses reviewed”
- “Madison Ave complete”
- “A captain reviewed 25 addresses today”
- “328 addresses reviewed in the last 48 hours”

### Admin-facing progress

Admins can use the existing admin tab, with a new Contact Check-In module added there.

Suggested admin-facing metrics:

- progress by captain
- progress by zone
- town-wide reviewed percentage
- town-wide contacted/reached percentage
- skipped count
- no successful contact count
- last activity by captain / zone
- zones or captains with no activity

This admin module can be more detailed than the home-page widget because it is not part of the volunteer-facing core Check-In experience.

---

## Prototype Feedback Decisions — Home Placement, Optional Tools, and Copy

### Home page placement
The Contact Check-In widget should occupy the top-right slot of the dashboard home page for the launch period. The existing “From Altagether” content can move below the Zone Overview. A small Community Feed can appear beneath the Contact Check-In widget to reinforce communal momentum.

The Contact Check-In widget itself should be about the captain’s zone progress. Altagether-wide progress, town-wide milestones, and completion highlights belong in the Community Feed or admin reporting, not inside the zone-specific Check-In card.

### Learn more modal
The Contact Check-In widget should include a quiet “Learn more” link that opens a dedicated modal explaining:
- what Contact Check-In is,
- why Altagether is asking captains to complete it,
- what counts as successful contact,
- the broader cohort/community context,
- the participating groups currently named for the cohort:
  - Altagether
  - Clergy Community Coalition + PostFire
  - Community Women Vital Voices
  - Eaton Fire Residents United + EF Surviving Structures
- and exactly what data may be shared with Department of Angels / cohort partners.

Sharing language should be explicit and reassuring. Altagether may share address-level contact coverage: whether someone at each address has been successfully contacted. Altagether should not share resident names, individual contact details, phone numbers, email addresses, notes, or outreach logs. The modal should avoid internal jargon like “CRM.”

### Address title behavior
The address shown inside Contact Check-In should not invite unrelated address editing. It should read as a label, not as a primary clickable action. Adding damage status, build status, or other address-editing fields to this flow is considered mission creep for MVP.

### Optional panels
Optional tools should remain collapsed, quiet, and secondary. Panels should expand only when intentionally clicked and should not create confusing “half-expanded” white space. Optional tools are available as escape hatches, not as required steps.

### No-branch optional tools
When a captain answers “No, I haven’t successfully contacted anyone at this address,” the main experience should remain extremely light: the captain can simply click **Save & Next**. Optional tools should be presented as a single collapsed escape hatch, not as a second form the captain feels obligated to complete.

Recommended label:

> Add optional context

When expanded, use an **action-oriented hub** rather than showing every resident and every optional field at once. The hub may offer four compact actions:

- Log outreach attempt
- Mark unable to reach
- Add person note
- Add address note

This layout should avoid repeated resident names, mixed type treatments, and visually busy rows. The user chooses the action first, then selects the relevant person only inside that focused action.

Behavior by action:

- **Log outreach attempt**: choose one person, choose Today / Specific date / I don’t remember when, add a note, then add the entry. The captain may add multiple outreach entries for different people, each with its own note/date.
- **Mark unable to reach**: show a simple checkbox list of residents. This is the only no-branch tool that can reasonably operate as a list because it is a lightweight tag.
- **Add person note**: choose one person, add note, then add the note. The captain may add multiple notes for different people.
- **Add address note**: one address-level textarea.

Do not support a generic household-level outreach log for MVP. Outreach logging remains person-row-backed.

The design goal is to preserve the speed of the first prototype while still allowing unique per-person detail when a captain intentionally chooses to add it.

### Outreach attempt date language
Avoid “Historical” as user-facing language. The prototype should support:
- Today
- Specific date
- I don’t remember when / Date unknown

Do not offer both “sometime before today” and “date unknown” as separate choices in the MVP, because they are likely to feel too similar to users. If the captain knows the past date, they can choose Specific date. If not, they can choose Date unknown.

### Captain-facing progress and skipped queue
The captain-facing widget should stay focused on the captain’s own zone progress. It should include:
- reviewed / remaining / reached / skipped counts,
- a visible progress bar,
- a primary Start / Continue action,
- and a direct “Review skipped addresses” action when skipped addresses exist.

Avoid adding a prominent time estimate to the home widget for MVP. If a time estimate is used later, it should be subtle and should not compete with the core progress display.

### Required vs optional work
The UI should communicate that the required task is simply answering the contact question for each address, but it should not over-explain this in the home widget. The clearest approach is to make the core flow itself obvious: Yes, No, or Skip are the primary actions; optional tools are collapsed and visually secondary.

### Admin access
The “View admin preview” button belongs only in the prototype/demo. It should not appear for normal users. Admin reporting should live in the existing Admin Mode area as its own Contact Check-In module.

### Tooltip copy
Avoid implementation-facing language such as “It remains person-specific.” Tooltip language should explain what the captain needs to know, not the data model.

---

## Large-Zone Considerations

Most zones may have around 60 addresses, but some captains may have substantially larger zones with 200+ addresses. The Contact Check-In should still use the same core flow for MVP; no separate large-zone tool is required for launch.

However, the design should support larger zones by emphasizing resumability, street-based order, and small milestones.

### MVP guidance
- Sort addresses in a predictable order, ideally by street and then house number.
- Preserve progress automatically so captains can stop and resume without anxiety.
- Keep skipped addresses easy to revisit.
- Avoid presenting the total workload in a way that feels punitive or overwhelming.

### Potential enhancements
For larger zones, consider adding lightweight street-based progress cues and small moments of delight:

- “Now reviewing Madison Ave”
- “Madison Ave complete”
- “12 addresses left on this street”
- “You’ve reviewed 25 addresses”
- “50% of your zone reviewed”
- “Nice momentum: 10 addresses reviewed”

These should feel like encouragement, not pressure. The goal is to help captains break the work into natural chunks while keeping the core Check-In flow unchanged. Gamification should reward completion, momentum, and persistence, not the number of households successfully contacted.

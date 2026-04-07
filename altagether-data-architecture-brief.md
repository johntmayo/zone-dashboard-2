# Altagether Data Architecture Brief

## Purpose

This brief captures the main conclusions, concerns, and recommendations from our discussion about Altagether's current spreadsheet architecture, future data synchronization, and the proposed APN enrichment tool. It is meant to be saved and revisited later, especially if a future agent or collaborator helps design a more ambitious data restructure or sync system.

## Current Context

Altagether currently operates with:
- A large master spreadsheet containing person-level records.
- Many individual zone spreadsheets distributed to Neighborhood Captains.
- Repeated property-level data inside the master sheet because the primary record is a person, not a property.
- A workflow where zone spreadsheets are created and sent out individually.
- A service-account-based system that, in theory, could automate changes across those spreadsheets.

The current scale is manageable:
- About 178 zones / potential users today.
- Likely fewer than 250 in practice.
- Very unlikely to exceed 500.

This means a full database rebuild is not immediately necessary. A disciplined spreadsheet-based system can remain viable for quite a while.

## Immediate Project Focus

The immediate problem is not a full data-system redesign. It is the development of an **APN enrichment tool** that can:
1. Fill missing APNs into a sold-properties list.
2. Use APN to write property-level sale data back into the master data file.
3. Eventually support additional property-level enrichments such as permitting, inspections, or construction status.

## Two-Way Merge Requirement

The APN workflow is explicitly two-directional:

### Direction 1: Master -> Sold Properties
Use the master file to fill missing APNs into the sold-properties file when APNs are absent.

### Direction 2: Sold Properties -> Master
Once APNs are present in the sold-properties file, use APN as the match key to write sale-related information back into **every row in the master file** that carries that APN, even when multiple people are associated with the same property.

This is not just one enrichment pass. It is a repeated property-level synchronization pattern.

## Key Recommendation: Build an APN-Centered Property Enrichment Tool

Rather than building a one-off "sold properties merge" utility, the recommended direction is to build a broader, durable tool:

**APN-centered property enrichment tool**

This tool should be designed so that "sold properties" is only the first module or use case.

### Why this approach makes sense
- APN is the strongest shared identifier for property-level data.
- The sold-properties use case is likely just the first of many.
- Other future data sources could include:
  - permit records
  - construction status
  - inspections
  - parcel characteristics
  - ownership/entity information
  - other county or civic datasets
- The tool should therefore be designed around **property identity** first, not around one specific data import.

## Official APN Sources Matter

A major design insight is that the master spreadsheet should not necessarily be treated as the only APN authority.

Because these are Los Angeles County properties, official parcel/assessor sources may be a better source of truth for APN derivation.

### Recommended APN source hierarchy
1. Official county parcel / assessor source
2. Master spreadsheet as a fallback reference
3. Manual review / manual entry

This is better than relying only on the master file, because the master file is:
- person-level
- repetitive
- derivative rather than property-native

## Proposed Structure for the APN Tool

The recommended structure is one small tool or suite with three conceptual layers.

### Layer 1: Parcel Identity
- Normalize address
- Resolve APN
- Prefer official APN source when possible
- Fall back to master-file APN when necessary
- Assign confidence levels
- Create review queues for ambiguous or missing matches

### Layer 2: Event / Data Import Modules
Examples:
- sold properties
- permits
- inspections
- construction / rebuild status
- future property-level datasets

### Layer 3: Write-Back Rules
Once APN is known:
- push selected property-level facts into every matching master row
- maintain logs of what changed
- avoid silent overwrites
- keep imported topics organized in separate columns or namespaces

## Important Design Principle: Add a Property Layer

Longer-term, one of the cleanest conceptual improvements would be to distinguish between:
- **People**
- **Properties**
- **People <-> Properties relationship**

Right now, property information is embedded in a person-level table, which causes repetition and complexity.

Even if this does not become a full relational database, the architecture should at least start thinking in those layers.

For the APN enrichment work, a strong intermediate concept would be:

**Property events table keyed by APN**

That table could hold imported facts like:
- sale status
- sale date
- buyer / seller info
- permit stage
- construction status
- inspection status

Then selected facts could be pushed into the master people file as needed.

## Recommendation on the Zone Spreadsheet System

This was discussed as broader context, not the immediate focus.

### Main recommendation
Do **not** rush into a full rebuild.

At the current scale, the most reasonable near-term architecture is:
- keep the individual zone spreadsheets
- designate a central master dataset as canonical for core fields
- define clear field ownership
- use scripts to sync only the appropriate fields
- protect captain-owned fields from system overwrites

### Core principle
Separate:
- **system-of-record fields**
- **captain-owned fields**
- **local-only or helper fields**

### Example categories
**Master-owned / system-owned fields**
- APN
- normalized address
- parcel flags
- sale status
- permit status
- zone assignment

**Captain-owned fields**
- notes
- outreach attempts
- local observations
- relationship notes
- follow-up details

**Local-only / helper fields**
- formulas
- sorting aids
- temporary scratch fields

## Major Concern Raised About Syncing Zone Sheets

A very important concern was identified:

Neighborhood Captains may:
- edit existing rows
- add rows
- add new addresses or people
- reorder content

That means a naive push-down sync from master into zone sheets would be dangerous.

### What should NOT happen
- no syncing by row number
- no whole-sheet overwrites
- no assumption that master and zone sheets are perfectly aligned structurally
- no overwriting captain-owned fields

### Safer rule
Sync must be based on:
- stable row identity
- field ownership
- review status for new records

### Important conclusion
If captain-added rows exist, they should likely be treated as **proposed records** or **needs review** items, not automatically canonical records.

This is an important future design issue, but it is outside the immediate APN tool scope.

## Scale Considerations

The user clarified that the system likely tops out around:
- 178 current zones / potential users
- perhaps 250 in practice
- very unlikely more than 500

This changes the tone of the recommendation:
- a full custom app or database is not urgently required
- Google Sheets plus Apps Script remains realistic
- the real risks are schema drift and sync confusion, not raw scale

### Practical implication
The best near-term move is:
- professionalize the current spreadsheet system
- do not panic and migrate everything
- improve discipline around keys, ownership, sync, and logs

## Final Recommendation Summary

### For the immediate problem
Build a **small APN enrichment / property sync tool** that:
- resolves APN
- supports two-way merge workflows
- is deterministic where possible
- creates review queues for ambiguity
- logs all changes
- is designed for future property-level data modules

### For the broader data architecture
Do not undertake a major restructure yet.
Instead:
- keep the spreadsheet model for now
- move toward a more explicit canonical-core + distributed-workspace architecture
- separate person-level and property-level thinking
- define ownership rules before expanding automation further

## Suggested Next Steps

### Immediate next steps
1. Draft a tighter spec for the APN enrichment tool.
2. Define the exact columns involved in:
   - APN fill into sold-properties file
   - sold-data write-back into master file
3. Identify preferred official LA County APN lookup sources.
4. Design the review queue / audit log behavior.

### Later / revisit later
1. Revisit the zone-sheet sync architecture.
2. Define stable IDs for rows / people / properties.
3. Clarify whether captain-added rows are canonical or proposed.
4. Consider introducing a property table or property-events table.
5. Potentially centralize or reduce spreadsheet sprawl only if the current model becomes too painful.

## Working Mental Model Going Forward

A helpful way to think about this is:

- **Now:** build an APN enrichment tool
- **Soon:** treat property-level imports as a reusable system
- **Later:** improve the overall sync architecture across master and zone sheets
- **Eventually:** only consider a larger migration if the spreadsheet model truly becomes the bottleneck

This lets the work proceed incrementally without overcommitting to a scary rebuild.

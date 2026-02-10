# Altagether Zone Dashboard — Platform Overview

## 1. Introduction

- **Product:** Altagether Zone Dashboard
- **Purpose:** Neighborhood Captain (NC) tool for viewing and managing zone/neighbor data, maps, and resources.
- **Data source:** Google Sheets (zone spreadsheet); optional backend for homepage/actions feeds.
- **Auth:** Google Sign-In for identity (any Google account); spreadsheet access is via the server’s service account—see [AUTH_AND_SPREADSHEET_ACCESS.md](AUTH_AND_SPREADSHEET_ACCESS.md). Spreadsheet link (URL) required for most features.

---

## 2. Entry & Setup

- **Welcome overlay** (when no spreadsheet is linked): two-step flow — Sign in with Google → Paste Google Sheet URL → Load.
- **Get Help** and **Beta Testers** links.
- **Left nav:** persistent sheet URL input and Load button.
- **Filter bar:** shown on Map and Neighbors when a spreadsheet is loaded; hidden on other views.

---

## 3. Navigation & Views

- **Left nav:** Home, Map, Neighbors, Actions, Tools, Resources, About the Dashboard, My NC Profile, ★ Beta Testers.
- **Content views:** One active at a time; others hidden.
- **Floating right panel:** Details (address list / selection), Zone Notes tab, Contact Mode button; sign-in prompt when not signed in.

---

## 4. Home

- **Zone Overview:** Snapshot stats and chart carousels (e.g. Addresses Contacted, Streets, People per Address; Damage, Rebuild, Address Plan).
- **Alert card:** Optional “Important Update” with Acknowledge.
- **From Altagether:** Announcements from central backend/homepage feed.
- **Quick Actions:** Links/shortcuts.
- **Zone Map:** Embedded map of zone.
- **Rebuild Progress:** Address Plan and Rebuild Status charts (and optional funnel).
- **Zone Leadership:** Zone leadership content.
- **Sign-in prompt:** Shown when spreadsheet is linked but user is not signed in.

---

## 5. Map

- **Full-screen map:** Zone map (Leaflet); KML/GeoJSON if used.
- **Floating panel:** Address list, Details, Zone Notes, Contact Mode.
- **Filter bar:** Street, Damage, Address Plan, Rebuild Status, Captain (if multiple), Contact status (contacted/uncontacted). Filters apply to map and Neighbors.

---

## 6. Neighbors (People)

- **Header:** “Neighbors” plus actions: **Add Record**, Print, Export CSV.
- **Table:** Address/neighbor table driven by zone spreadsheet; respects same filters as Map (Street, Damage, Address Plan, Rebuild Status, Captain, Contact).
- **Add Record modal:** Add address or add person; House number, Street, Damage, Address Plan, Rebuild Status, Renter, Needs Follow-Up, Person/Address notes; geocode/minimap; writes to Sheet (e.g. `Sheet1`).
- **Filter bar:** Same as Map; shown when view is active.

---

## 7. Actions

- **Title:** “Actions”.
- **Content:** Fetched from Actions feed (backend API or direct Google Sheet).
- **Display:** Card-based list of action items (label + content).
- **Quick action:** From Home, “Open Map” (or similar) can switch to Map view.

---

## 8. Tools

- **Zone Tools section:** Expandable/collapsible modules.
  - **Zone Analysis:** Expand to generate a zone report (PDF export), with “Generate Zone Analysis” and export actions.
  - **Batch Tagging:** Expand to see addresses matching current Neighbors filters; Select all/none; checkboxes per address; dropdowns for Damage, Address Plan, Rebuild Status; “Apply to selected addresses” (batch update via Sheets API); status/error message area.
  - **Flyer Creator:** Link out to `flyer_tool.html` (no expand).
- **Contact List Creator:** Referenced in code (e.g. init on Tools view); may be hidden or legacy — document separately if present in UI.
- **Hidden tools (for reference):** Buildnotes, Data Transfer Tool.

---

## 9. Resources

- **Altagether Resources:**
  - Neighborhood Captain Directory (link to external captain directory).
- **Community Resources:**
  - Altadena Community Recovery Calendar.
  - Altadena Recovery Wiki.
  - Property Sales Info (Zillow links, Sold list).
- All as link cards; no expand logic.

---

## 10. About the Dashboard

- **What This Tool Is:** Short explanation of purpose and audience.
- **Your Data Promise:** Where data lives (user-owned Google Sheets), who owns it, who has access, no hidden databases.
- **Our Intentions Around Data:** Values and guardrails; power stays with NCs.
- **How the App Works:** Sign in → Link sheet → Read/write → Session-based access.
- **Tutorials:** Collapsible walkthroughs (Getting started, Loading sheet, Map, Common mistakes).
- **Common Issues:** Troubleshooting (session expired, sheet not loading, permissions, re-linking).
- **Standalone page:** `about.html` — publicly accessible, no login required. Shareable URL for app verification and orientation.
- **More Help & Community:** Zone Dashboard Documentation (link to `help.html`), Discord Quick Start modal, Discord Tutorial link to `discord-help.html`.

---

## 11. My NC Profile

- **Purpose:** Edit Neighborhood Captain profile; saved to NC Directory (separate sheet/source).
- **States:** Sign-in prompt, “No profile found” (contact admin), or profile form.
- **Form fields:** Name, Zone, Predominant Census Tract, Phone, Preferred email, Working Group Participation, Housing Arrangement, Damage to home, Interest Areas, Skills & Expertise, Languages Spoken, Water District; read-only badges if any.
- **Actions:** Save profile; status message.

---

## 12. Beta Testers Hub

- **Intro:** Thank-you copy and link to 15-minute overview video.
- **Cards:** Submit Feedback (opens Beta Feedback modal), Community Feedback (Airtable embed), Shared Notes (Google Doc), Beta Tester Guide (Doc), Beta Resources (Drive folders, e.g. Find Your Zone Spreadsheet).
- **Beta Feedback modal:** In-app form; may submit to Airtable or similar.

---

## 13. Cross-Cutting Features

- **Google Sign-In:** Enables editing and write operations (Add Record, Batch Tagging, Zone Notes, NC Profile, etc.).
- **Spreadsheet link:** Load by URL; data read from linked sheet (e.g. `Sheet1`); zone identifier in nav header.
- **Filter bar:** Street, Damage, Address Plan, Rebuild Status, Captain, Contact (contacted/uncontacted); affects Map, Neighbors, and Batch Tagging address list.
- **Floating panel:** Details (address list + selection), Zone Notes (editable, save to sheet), Contact Mode toggle.
- **Toasts:** In-app success messages (e.g. after Add Record, Batch Tagging) instead of `alert()`.
- **Backend (optional):** Node server for homepage feed, actions feed; can fall back to direct Sheets fetch (e.g. for static hosting).

---

## 14. Related Files / Surfaces

- **Standalone pages:** `about.html`, `help.html`, `discord-help.html`, `flyer_tool.html`, `nc-directory.html`, `documentation.html`.
- **Backend:** `server.js` (e.g. `/api/homepage-feed`, `/api/actions-feed`).
- **Docs:** `SETUP.md`, `SERVICE_ACCOUNT_SETUP.md`, `AUTH_AND_SPREADSHEET_ACCESS.md`, `ALTAGETHER_FEED_SETUP.md`, `NC_DIRECTORY_SETUP.md`, `DEV_PLAN.md`, `CHANGELOG.md`.

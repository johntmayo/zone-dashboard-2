# Zone + NC Directory Style Guide (Brief)

- **Overall vibe:** community-first civic tool with a warm paper base plus editorial/zine contrast; feels practical, trustworthy, and slightly handcrafted.
- **Tone split:** the main dashboard is more bold and structural (thick borders, square cards), while the captain directory is slightly softer (rounded cards, lighter borders) but in the same brand family.

## Colors

- **Core neutrals**
  - `#FDFBF7` paper background
  - `#FFFFFF` card background
  - `#1F2937` primary ink/text
  - `#4B5563` secondary text
  - `#314059` brand navy (major headers/nav)
  - `#D0CFC8` neutral section rule (`--rule-neutral`)
- **Accent system**
  - `#F59E0B` gold (active states, highlights, key CTAs)
  - `#BC5838` clay (support/help CTAs, genuine alerts, campaign callouts — never ambient section rules)
  - `#283618` Altagether green (links, positive/action accents)
  - `#347072` earthy teal (non-button accents only: EPIC band, data viz fills, map markers — never buttons)
- **Directory-specific soft UI**
  - border gray `#E5E7EB`
  - info tags like `#EEF2FF`, plus badge fills (gold/blue/green gradients)

## Typography

- **Display/UI font:** `Chivo`, loaded at weights **400 / 700 / 900 only**. Used for headings, nav, buttons, panel labels, and all structural/data/functional contexts.
- **Body/content font:** `Lora`, loaded at weights **400 / 700 only**. Used for genuine reading material only.
- **Weight rule:** never request weights that aren't loaded (no 500/600/800). Collapse: 500 → 400, 600 → 700, 800 → 900 (Chivo); 600 → 700 (Lora).
- **The structure/reading boundary:**
  - **Lora (reading):** announcements body copy, Contact Check-In explanatory prose (`.cci-serif`), Help/About/Docs/Discord long-form, directory bios, any future editorial content.
  - **Chivo (structure):** table cells (Neighbors table is data scanning, not reading), tool/resource card descriptions, filter labels, panel headers, modal form contexts, the Details panel (all-Chivo by design), NC Directory structural UI.
- **Style rule:** sans for structure plus serif for reading gives an organized but human feel. When in doubt, ask "does someone *read* this, or *scan* it?" — scanning is Chivo.

## Buttons (three-tier system)

| Tier | Treatment | Use |
|---|---|---|
| **Primary / commit** | Gold (`#F59E0B`), filled | Save Changes, Continue Check-In, Add Record |
| **Navigation / secondary** | Navy (`#314059`), filled | Back to List, tool launches, external resource links |
| **Tertiary** | Outlined or text link | Close, Export, Print, More Actions →, Explore build status → |

- **Teal is not a button color.** If external links need distinction, use an external-link icon, not a color change.
- Clay remains for support/help CTAs (Help page) and alert/campaign contexts.

## Section Rules

- Card/section title underlines use `1px solid var(--rule-neutral)` (`#D0CFC8`).
- Orange/red (clay) rules are reserved for genuine alerts, CTAs, and campaign callouts (e.g. campaign card titles keep the clay rule deliberately).

## Campaign Cards

- `home-panel--campaign` and `home-panel--campaign-feed` share identical treatment: cream `#FFF9E8` background, navy border, heavier offset shadow, and the clay "TOWN-WIDE CAMPAIGN" eyebrow badge.
- They read as a paired system, visually distinct from ambient reference cards. Reuse this treatment for future campaigns.

## Form Controls

- Selects use the custom treatment (no native browser chrome): `appearance: none`, custom ink chevron, right padding.
- Border language is preserved per context: dashed = editable field (matches sibling inputs), solid = filter chrome.

## Visual Language

- **Primary motif:** 2px borders plus offset print-like shadows (often `6px 6px 0`) for tactile depth.
- **Shape language:** dashboard leans square (`border-radius: 0` often); directory uses mild rounding (`4px-8px`).
- **Interaction style:** subtle physical motion on hover (`translate(-2px, -2px)`) with stronger shadow; active nav has a left accent bar.

## Anything Else Relevant

- Treat this as a design-token system: keep using existing CSS variables for consistency.
- Preserve the hierarchy model on tools/cards (`featured`, default, `compact`) rather than inventing new card patterns.
- If adding new screens, default to:
  - paper background plus navy structure
  - gold as primary highlight
  - Chivo headings and Lora body (reading contexts only)
  - strong border plus simple shadow (avoid glassy or over-modern styles)

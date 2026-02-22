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
- **Accent system**
  - `#F59E0B` gold (active states, highlights, key CTAs)
  - `#BC5838` clay (support/help CTAs, warnings/emphasis)
  - `#283618` Altagether green (links, positive/action accents)
  - `#347072` earthy teal (tools CTAs)
- **Directory-specific soft UI**
  - border gray `#E5E7EB`
  - info tags like `#EEF2FF`, plus badge fills (gold/blue/green gradients)

## Typography

- **Display/UI font:** `Chivo` (700-900), used for headings, nav, buttons, and panel labels.
- **Body/content font:** `Merriweather` (400-700), used for body copy, form text, and table/content details.
- **Style rule:** sans for structure plus serif for reading gives an organized but human feel.

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
  - Chivo headings and Merriweather body
  - strong border plus simple shadow (avoid glassy or over-modern styles)

# UX & Responsive Layout Audit — Zone Dashboard

**Scope:** Layout, scroll behavior, and responsive quality-of-life across screen sizes (small laptop → 4K).  
**Approach:** Targeted critique and prioritized fixes; no redesign.

---

## 1. Scroll Behavior & Ownership

### 1.1 Document / root

| Element | Scroll | Why | Intentional? |
|--------|--------|-----|---------------|
| `html, body` | `overflow-y: auto`, `overflow-x: hidden` | Body can scroll if content exceeds viewport. | **Unclear.** App shell is `position: fixed` and fills the viewport, so body *should* not scroll. If something overflows (e.g. a modal or content view), body scroll appears as a fallback. That can feel accidental when the intended scroll is inside a panel. |

**Recommendation:** Keep `overflow-x: hidden` on body. Prefer `overflow-y: hidden` on `body` when the app is in “dashboard” mode so the only scroll is inside defined regions (content view, left nav, right panel). If you need body scroll for edge cases (e.g. welcome overlay), restrict it to that state with a class on `body`.

---

### 1.2 Left nav (`.left-nav`)

| Element | Scroll | Why | Intentional? |
|--------|--------|-----|---------------|
| `.left-nav` | `overflow-y: auto`, `overflow-x: hidden` | Nav items + sheet URL section + logo can exceed viewport height on short or narrow-aspect screens. | **Yes.** Sidebar should scroll when content doesn’t fit. |

**Note:** On very short viewports (e.g. 768px height), the nav becomes a scrollable strip. Consider ensuring “Load” and sheet input stay usable (e.g. sticky at bottom or always in view) for long sessions.

---

### 1.3 Main content (`.content-view`)

| Element | Scroll | Why | Intentional? |
|--------|--------|-----|---------------|
| `.content-view` | `overflow-y: auto` | Home, Neighbors, Tools, etc. can be long. | **Yes.** Main content area is the primary scroll for most views. |

**Note:** Content views use `position: absolute` with `top`/`left`/`right`/`bottom` and are inset from left (240px) and, for `#peopleView`, from right (420px). They fill the remaining area and scroll their contents. This is the correct place for “page” scroll.

---

### 1.4 Floating right panel (`.floating-panel` → `.address-panel`)

| Element | Scroll | Why | Intentional? |
|--------|--------|-----|---------------|
| `.floating-panel` | `overflow: hidden` | No scroll at panel root; children control scroll. | **Yes.** |
| `.address-panel-content` | `overflow-y: auto` | Details list (addresses/people) can be long. | **Yes.** |
| `.zone-notes-content` | `overflow-y: auto` | Zone Notes tab content + textarea. | **Yes.** |

**Conclusion:** One scroll owner per tab (Details vs Zone Notes) is clear and intentional.

---

### 1.5 Neighbors view: table (`.address-table-container`)

| Element | Scroll | Why | Intentional? |
|--------|--------|-----|---------------|
| `.address-table-container` | `overflow-x: auto`, `overflow-y: auto`, `max-height: calc(100vh - 260px)` | Table is constrained in height and scrolls inside the people view. | **Partially.** Goal (table-in-a-box with sticky header) is good, but this creates **nested scroll**: the `.content-view` also has `overflow-y: auto`, so both the view and the table container can scroll. |

**Why it’s a problem:** On Neighbors, the user can scroll the content view (header + table wrapper) and also scroll inside the table. Two scrollbars and two scroll contexts cause friction and confusion, especially on small laptops.

---

### 1.6 Modals and overlays

| Element | Scroll | Why | Intentional? |
|--------|--------|-----|---------------|
| `.beta-feedback-modal-content` | `overflow: hidden` (content is iframe) | Modal has `max-height: 90vh`. | **Yes.** |
| `.newsletter-modal` | `max-height: 90vh`, `overflow-y: auto` | Long email list / instructions. | **Yes.** |
| `.newsletter-email-list` | `max-height: 300px`, `overflow-y: auto` | Scrollable email list inside modal. | **Yes** (nested scroll inside a modal is acceptable). |
| `.discord-modal` | `max-height: 90vh`, `overflow-y: auto` | Long instructions. | **Yes.** |

**Recommendation:** Modal heights use `90vh`. Consider `90dvh` (dynamic viewport height) so height adapts when browser chrome (e.g. mobile URL bar) shows/hides, reducing jumpiness.

---

### 1.7 Other scroll regions

| Element | Scroll | Why | Intentional? |
|--------|--------|-----|---------------|
| `.checkbox-group` (Tools) | `max-height: 200px`, `overflow-y: auto` | Long filter list in Contact List Creator. | **Yes.** |
| `.list-results-content` | `max-height: 600px`, `overflow-y: auto` | Generated list output. | **Yes.** |
| `.chart-carousel-track` | `overflow: hidden` | Carousel; no scroll, content swapped. | **Yes.** |
| `.home-map-container` | `overflow: hidden` | Map fills panel; no scroll. | **Yes.** |
| `.zone-report-content` | `overflow-x: auto`, `overflow-y: visible` | Wide report; horizontal scroll only. | **Yes.** |

---

## 2. Scrollbar Issues

### 2.1 Nested scrollbars

- **Neighbors view:** `.content-view` (peopleView) scrolls and `.address-table-container` also scrolls. Same vertical space has two vertical scroll contexts. **Fix:** Make the Neighbors view a single scroll owner: either (a) let the content view scroll everything (remove max-height/overflow from the table container, use sticky thead inside the scrolling view), or (b) give the table container a fixed height that fills the content view and make the content view non-scrolling for that view (e.g. `overflow: hidden` on peopleView and only the table container scrolls). Option (b) matches the current “table in a box” idea but requires the table container height to be computed from the content view height (e.g. flex or CSS so the table area gets the remaining space).

### 2.2 Sidebar / nav scrolling

- **Left nav:** Scroll is intentional. No bug, but on small viewports the nav can feel tight; consider a compact mode or collapsible sections if you add more nav items later.

### 2.3 Scrollbars on resize

- **Filter bar:** When switching to Map or Neighbors, `adjustContentViewsForFilterBar()` runs (with short timeouts) and sets `top` on content views and map. If the user resizes the window while on Map/Neighbors, filter bar height can change (e.g. wrap) but there is **no resize listener** calling `adjustContentViewsForFilterBar()`. So after resize, `top` can be wrong and the map/content can sit under the filter bar or leave a gap. **Fix:** Call `adjustContentViewsForFilterBar()` on `window.resize` when the filter bar is visible (and optionally debounce).

- **Table height:** `.address-table-container` uses `max-height: calc(100vh - 260px)`. It does not account for (1) the filter bar when visible, (2) the content view’s dynamic `top`. So the table height is wrong when the filter bar is shown and can change when the window is resized. **Fix:** Either derive the table container height from the content view (flex layout so the table area fills “remaining” space) or use a CSS variable / small JS that sets the subtractive value based on filter bar and header.

---

## 3. Screen Size Evaluation

### 3.1 Small laptop (~1366×768)

- **Layout:** Fixed widths: left nav 240px, right panel 420px. Content area ≈ 706px. No media query changes these, so layout is three columns at all widths.
- **Issues:**
  - **Horizontal space:** 706px for main content + filter bar is tight. Filter bar uses `flex-wrap`, so it can wrap and grow in height, which then affects `top` for content/map (and the 260px in the table calc).
  - **Vertical space:** 768px height with filter bar + content view padding leaves little for the table; the “260px” offset may be too small (filter + header + padding), so the table can feel short and nested scroll more noticeable.
  - **Floating panel:** 420px is a large share of 1366px; address list and details compete with the main content.
- **Recommendations:** Add a breakpoint (e.g. `max-width: 1400px` or `1200px`) that narrows the right panel (e.g. 320–360px) or makes it collapsible. Ensure filter bar wrap doesn’t break `adjustContentViewsForFilterBar()` and that table height accounts for filter bar.

### 3.2 Standard laptop (~1440×900)

- **Layout:** Content width ≈ 780px. Generally comfortable; same structural issues as above but less severe.
- **Issues:** Same nested scroll on Neighbors; table `100vh - 260px` still doesn’t account for filter bar when visible.
- **Recommendations:** Same as above: single scroll owner for Neighbors, resize handling for filter bar, and correct table height.

### 3.3 Large / 4K monitors

- **Layout:** Content area can be 2000px+ wide. No `max-width` on `.content-view` or `.home-dashboard`, so content stretches.
- **Issues:**
  - **Readability:** Very long lines of text (e.g. Help, Resources, long paragraphs on Home) hurt readability.
  - **Wasted space:** Fixed 240px nav and 420px panel don’t scale; the middle area becomes very wide with no content max-width or centering.
  - **Home:** `.home-dashboard` has `max-width: 1400px` and `margin: 0 auto`, which is good; other views (Help, Actions, Tools, etc.) do not, so they stretch on 4K.
- **Recommendations:** Apply a sensible `max-width` (e.g. 1200–1400px) and `margin: 0 auto` to the main content wrapper for views that are primarily text/cards (Help, Actions, Resources, Tools, Profile). Keep map and table full-width of their content area if desired, but cap readable content width.

---

## 4. Best-Practice Recommendations

### 4.1 Flexbox / Grid for shell height

- **App container:** Already `position: fixed; top: 0; left: 0; right: 0; bottom: 0; display: flex`. Good.
- **Content view:** Uses `position: absolute` with four insets. To avoid magic numbers and make the table fill remaining height on Neighbors, consider making the people view a flex column:
  - `.content-view#peopleView`: `display: flex; flex-direction: column; overflow: hidden`.
  - Header: `flex-shrink: 0`.
  - Wrapper for table: `flex: 1; min-height: 0; overflow: auto` (so the table container is the only scroll and gets the rest of the height). Then remove `max-height: calc(100vh - 260px)` from `.address-table-container` and use `height: 100%` or `flex: 1; min-height: 0; overflow: auto` on the container so it fills the wrapper.

### 4.2 Height management

- **`100vh` vs `100dvh`:** Only one use of viewport height: `.address-table-container` uses `calc(100vh - 260px)`. Prefer `100dvh` where you want the “visible” viewport (e.g. modals: `max-height: 90dvh`), especially for mobile/short sessions. For the table, once the height comes from the flex layout above, you won’t need this calc.
- **Min-height:** Avoid `min-height: 100vh` on full-page content when the shell is fixed; it can force body scroll. Current use of `min-height` on panels (e.g. 300px) is fine.

### 4.3 Overflow strategy

- **Body:** Consider `overflow-y: hidden` when the app is in the main dashboard state so only intentional regions scroll.
- **Content view:** Keep `overflow-y: auto` for most views. For Neighbors, after refactor, use `overflow: hidden` on the view and `overflow: auto` only on the table wrapper.
- **Floating panel:** Keep `overflow: hidden` on the panel and `overflow-y: auto` on tab content areas.

### 4.4 Large screens

- **Content max-width:** Use a single class (e.g. `.content-inner` or per-view wrapper) with `max-width: 1200px` or `1400px` and `margin: 0 auto` for Help, Actions, Resources, Tools, Profile. Home already has `.home-dashboard` with `max-width: 1400px`.
- **Map/table:** Can stay full width of their content area; only cap the “readable” content.

### 4.5 Filter bar and resize

- **Resize:** On `window.resize`, if the filter bar is visible, call `adjustContentViewsForFilterBar()` (debounced, e.g. 100–150 ms).
- **Table height:** Remove the magic `260px` by driving table container height from layout (flex) or from a JS-measured content area height when the filter bar is visible.

---

## 5. UX Risk Areas

### 5.1 Layout / visual instability

- **Filter bar show/hide:** When switching to/from Map or Neighbors, `top` is set with a short delay. If layout is slow (e.g. many filters), content can jump or sit under the bar briefly.
- **Resize:** No resize handler for filter bar height or table height → incorrect `top` and table height after resize.
- **Sticky header in table:** `.address-table thead` is `position: sticky; top: 0`. It’s inside a scrollable `.address-table-container`. If the container is ever not the scroll owner (e.g. content view scrolls and the container is just “tall”), sticky won’t work as intended. Making the table container the only scroll owner (as above) keeps sticky behavior correct.

### 5.2 Inconsistent behavior across devices

- **Fixed pixel layout:** 240px + 420px don’t adapt. On narrow screens the middle column is small; on very wide screens it’s huge with no content constraint. Behavior is consistent in structure but not in usability across devices.
- **Touch:** `-webkit-overflow-scrolling: touch` is set on `.address-table-container`, which is good. No issues identified for other scroll areas.

### 5.3 Long-session friction

- **Nested scroll on Neighbors:** Repeated use increases confusion (“which part scrolls?”).
- **Left nav scroll on short viewports:** Sheet URL and Load can scroll out of view; consider keeping them visible (e.g. sticky bottom section).
- **No “back to top” or keyboard shortcuts:** Minor; optional improvement for long lists.

---

## 6. Prioritized Fix List

### P0 (High impact, layout correctness)

1. **Neighbors: single scroll owner**  
   Refactor Neighbors so only one element scrolls (either content view or table container). Prefer flex layout: peopleView = column, header fixed, table wrapper `flex: 1; min-height: 0; overflow: auto`, and remove `max-height: calc(100vh - 260px)` from `.address-table-container`.

2. **Resize: keep filter bar and content in sync**  
   On `window.resize`, when the filter bar is visible, call `adjustContentViewsForFilterBar()` (debounced). Ensures `top` for content view and map stays correct after resize.

3. **Table height when filter bar is visible**  
   Either (a) derive table container height from the content view via flex (recommended) so no magic number, or (b) have JS set a CSS variable or inline style for the “offset” (filter bar height + header) and use it in the table container max-height.

### P1 (UX quality, no layout break)

4. **Content max-width on large screens**  
   Add a wrapper with `max-width: 1200px` or `1400px` and `margin: 0 auto` for Help, Actions, Resources, Tools, Profile (and any other text-heavy views). Home already constrained.

5. **Modal height: use `dvh`**  
   Replace `90vh` with `90dvh` on `.beta-feedback-modal-content`, `.newsletter-modal`, `.discord-modal` for better behavior when browser UI shows/hides.

6. **Body scroll in dashboard state**  
   When the main app is shown (no welcome overlay), set `body { overflow-y: hidden }` (e.g. via class on `body`) so only nav, content view, and panel scroll. Reduces accidental double scroll.

### P2 (Polish, responsive)

7. **Narrow viewports (< ~1200px)**  
   Consider reducing floating panel width (e.g. 320–360px) or adding a collapse toggle so the main content has more room.

8. **Left nav on short viewports**  
   Consider making the sheet URL + Load section sticky at the bottom of the nav so they stay visible when the nav scrolls.

9. **Filter bar wrap**  
   Ensure when the filter bar wraps to multiple lines, `adjustContentViewsForFilterBar()` uses the actual rendered height (it already uses `getBoundingClientRect()`, so it should; verify after resize and after filter options change).

---

## Summary

- **Scroll:** One main issue—Neighbors has two scroll owners (content view + table container). Fix by making the table container the only scroll owner and driving its height from flex layout.
- **Scrollbars:** Nested vertical scroll on Neighbors; filter bar/content view `top` and table height can be wrong after resize or when the filter bar is visible. Fix with resize handler and flex-based table height.
- **Screen sizes:** Small laptops are tight (fixed 240 + 420px); 4K lacks content max-width for text views. Add breakpoints for the panel and max-width + centering for readable content.
- **Risks:** Resize not handled, magic number for table height, and body potentially scrolling when it shouldn’t. Addressing P0 and P1 gives a stable, predictable layout and better behavior across devices and session length.

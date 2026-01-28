# Altagether Neighborhood Dashboard - Development Plan

**Last Updated:** November 25, 2024  
**Status:** Active Development

---

## 🎯 Current Status

The dashboard has been successfully redesigned with:
- ✅ Full-screen map with floating panel
- ✅ Single-page navigation system
- ✅ New color palette and Alegreya Extra Bold typography
- ✅ Enhanced styling with gradients, shadows, and animations
- ✅ Map view, People & Addresses table view, Zone Progress charts
- ✅ Contact mode functionality (basic implementation)

---

## 📋 Development Tasks

### 1. Contact Tracking System Enhancement

**Priority:** High  
**Status:** 🔴 Planning  
**Estimated Time:** 4-6 hours  
**Complexity:** Medium-High

**Current State:**
- Basic "Mark as Contacted" functionality exists
- Saves to "Last Contact Date" and "Contact Notes" columns
- Quick contact notes field available

**Questions to Resolve:**
- [ ] Do we log every contact attempt, or just the most recent?
- [ ] Should we create a contact history log (new rows/columns)?
- [ ] Can we dynamically add columns to Google Sheets via API?
- [ ] What data should be tracked? (Date, Time, Method, Notes, Outcome, Follow-up needed?)

**Technical Considerations:**
- Google Sheets API v4 supports adding columns via `batchUpdate` with `insertDimension` requests
- Could create a "Contact History" sheet with one row per contact attempt
- Alternative: Use a single "Contact History" column with JSON/structured text
- Consider: Contact frequency limits, duplicate prevention, audit trail

**Proposed Approach:**
1. Research Google Sheets API column insertion capabilities (30 min)
2. Design contact log structure (separate sheet vs. columns) (1 hour)
3. Implement contact history UI (timeline view?) (2-3 hours)
4. Add contact method tracking (phone, email, in-person, etc.) (1 hour)
5. Add filtering/sorting by contact date (1 hour)

**Dependencies:**
- Google Sheets API v4 documentation
- User feedback on contact tracking needs

**Time Breakdown:**
- Research & Planning: 1-1.5 hours
- API Integration: 1-2 hours
- UI Development: 2-2.5 hours
- Testing & Refinement: 1 hour

---

### 2. Map Library Decision: Leaflet vs. Mapbox

**Priority:** Medium  
**Status:** 🟡 Discussion Needed  
**Estimated Time:** 2-4 hours (if migrating)  
**Complexity:** Low-Medium

**Current State:**
- Using Leaflet.js with Google Satellite tiles
- Working smoothly, good performance
- Satellite imagery is up-to-date (shows post-fire state)

**Considerations:**

**Leaflet (Current):**
- ✅ Already implemented and working
- ✅ Google Satellite tiles are current
- ✅ Lightweight, no API key needed for basic use
- ✅ Good plugin ecosystem
- ❌ Less polished default styling
- ❌ May need custom styling for professional look

**Mapbox:**
- ✅ Professional styling and UI
- ✅ Better mobile experience
- ✅ Advanced features (3D, custom styles)
- ❌ Satellite imagery outdated (pre-fire)
- ❌ Requires API key
- ❌ Would need to integrate Google tiles via plugin anyway
- ❌ Additional migration work

**Recommendation:**
- **Stick with Leaflet** for now since:
  1. It's working well
  2. Google Satellite imagery is current (critical for showing burned houses)
  3. Mapbox would require Google tiles plugin anyway
  4. Migration effort not worth it unless Mapbox adds current satellite imagery

**Action Items:**
- [ ] Confirm Mapbox satellite imagery update timeline (if any) (30 min)
- [ ] If staying with Leaflet: Enhance styling to match professional look (1-2 hours)
- [ ] Consider Mapbox for future if they update imagery

**Time Breakdown (if enhancing Leaflet):**
- Research styling options: 30 min
- CSS/styling updates: 1-1.5 hours
- Testing: 30 min

**Time Breakdown (if migrating to Mapbox):**
- Setup & API key: 30 min
- Migration: 2-3 hours
- Testing: 1 hour

---

### 3. People & Addresses Table Enhancement

**Priority:** High  
**Status:** 🔴 Planning  
**Estimated Time:** 6-8 hours  
**Complexity:** Medium

**Current State:**
- Basic table with Address, Residents, Damage, Household Status
- Filters for Street, Damage, Status
- Click row to view details in floating panel

**Enhancements Needed:**

**Phase 1 - Core Functionality (3-4 hours):**
- [ ] Add more columns (Contact Status, Last Contact Date, Notes preview) (1 hour)
- [ ] Sortable columns (click header to sort) (1 hour)
- [ ] Search/filter bar (search across all fields) (1 hour)
- [ ] Contact status indicators (color-coded badges) (30 min)
- [ ] Last contact date sorting/filtering (30 min)

**Phase 2 - Advanced Features (2-3 hours):**
- [ ] Column visibility toggle (show/hide columns) (1 hour)
- [ ] Export to CSV functionality (1 hour)
- [ ] Bulk actions (select multiple, mark as contacted, etc.) (1-2 hours)

**Phase 3 - Polish (1-2 hours):**
- [ ] Pagination or virtual scrolling for large datasets (1 hour)
- [ ] Row actions menu (quick actions dropdown) (30 min)
- [ ] Quick edit inline (edit damage/status directly in table) (1 hour)
- [ ] Sticky header on scroll (30 min)

**Technical Approach:**
- Use a table library (DataTables.js, AG Grid, or custom)
- Implement column management system
- Add search/filter state management
- Create export utility function

**UI/UX Improvements:**
- Loading states (30 min)
- Empty states with helpful messages (30 min)
- Responsive table (horizontal scroll on mobile) (1 hour)

**Time Breakdown:**
- Phase 1: 3-4 hours
- Phase 2: 2-3 hours
- Phase 3: 1-2 hours
- Testing & Refinement: 1 hour

---

### 4. Help Section - Explainer/About This Tool

**Priority:** Medium  
**Status:** 🔴 Planning  
**Estimated Time:** 3-4 hours  
**Complexity:** Low-Medium

**Content Needed:**
- [ ] What is this tool? (15 min)
- [ ] Who is it for? (15 min)
- [ ] How to get started (step-by-step guide) (30 min)
- [ ] How to link your spreadsheet (15 min)
- [ ] How to sign in with Google (15 min)
- [ ] Feature explanations:
  - [ ] Map view and markers (20 min)
  - [ ] Address details panel (20 min)
  - [ ] Contact mode (20 min)
  - [ ] Zone notes (15 min)
  - [ ] Zone progress charts (15 min)
  - [ ] Table view (20 min)
- [ ] FAQ section (1 hour)
- [ ] Troubleshooting guide (30 min)
- [ ] Data privacy/security information (15 min)
- [ ] Support contact information (15 min)

**Design Considerations:**
- Accordion-style sections for easy navigation (1 hour)
- Screenshots or GIFs for visual guides (30 min - if creating)
- Code examples for spreadsheet column requirements (30 min)
- Links to external resources (15 min)

**Implementation:**
- Create structured HTML content in Help view (1 hour)
- Add navigation within help section (30 min)
- Style with existing design system (30 min)

**Time Breakdown:**
- Content Writing: 2-2.5 hours
- HTML Structure: 1 hour
- Styling: 30 min
- Testing: 30 min

---

### 5. Logo Integration

**Priority:** Low-Medium  
**Status:** 🔴 Planning  
**Estimated Time:** 1-2 hours  
**Complexity:** Low

**Locations to Consider:**
- [ ] Top header (left side, next to "Altagether Zone Dashboard") (30 min)
- [ ] Navigation bar (top of left nav) (30 min)
- [ ] Floating panel header (15 min)
- [ ] Help section (15 min)
- [ ] Favicon (15 min)

**Technical Requirements:**
- [ ] Get logo file (SVG preferred, or PNG with transparent background)
- [ ] Determine optimal size and placement (15 min)
- [ ] Ensure logo doesn't clash with new color scheme (15 min)
- [ ] Make logo clickable (link to main website?) (15 min)
- [ ] Responsive sizing (30 min)

**Design Considerations:**
- Logo should complement new color palette
- May need color adjustments if logo colors clash
- Consider logo + text combination

**Time Breakdown:**
- Asset preparation: 30 min
- Implementation: 1 hour
- Testing & adjustments: 30 min

---

### 6. Mobile Functionality

**Priority:** Medium  
**Status:** 🔴 Planning  
**Estimated Time:** 8-12 hours  
**Complexity:** High

**Current State:**
- Desktop-first design
- Fixed widths may not work on mobile
- Navigation bar may be too wide
- Floating panel may overlap on small screens

**Mobile Considerations:**

**Layout Adjustments (3-4 hours):**
- [ ] Responsive navigation (hamburger menu on mobile?) (1-2 hours)
- [ ] Stack floating panel below map on mobile (1 hour)
- [ ] Full-width table with horizontal scroll (30 min)
- [ ] Touch-friendly button sizes (30 min)
- [ ] Swipe gestures for panel open/close (1 hour)

**Map on Mobile (1-2 hours):**
- [ ] Touch-optimized map controls (30 min)
- [ ] Larger marker tap targets (30 min)
- [ ] Mobile-friendly popups (30 min)
- [ ] Map resize on orientation change (30 min)

**Table on Mobile (2-3 hours):**
- [ ] Card-based layout instead of table (1-2 hours)
- [ ] Swipeable cards (1 hour)
- [ ] Collapsible sections (30 min)

**Performance (1-2 hours):**
- [ ] Lazy loading for large datasets (1 hour)
- [ ] Optimize images/assets (30 min)
- [ ] Reduce animations on mobile (30 min)

**Testing (2-3 hours):**
- [ ] Test on iOS Safari (30 min)
- [ ] Test on Android Chrome (30 min)
- [ ] Test on tablets (30 min)
- [ ] Test various screen sizes (1 hour)
- [ ] Fix mobile-specific bugs (1 hour)

**Breakpoints to Define:**
- Mobile: < 768px
- Tablet: 768px - 1024px
- Desktop: > 1024px

**Time Breakdown:**
- Layout adjustments: 3-4 hours
- Map optimization: 1-2 hours
- Table mobile view: 2-3 hours
- Performance: 1-2 hours
- Testing: 2-3 hours

---

### 7. Custom Flyer Generator

**Priority:** Low (Nice to Have)  
**Status:** 🔴 Exploration Phase  
**Estimated Time:** 10-15 hours  
**Complexity:** High

**Concept:**
Create event flyer templates that auto-fill with data from the dashboard and can be exported as PDF.

**Use Cases:**
- Community meetings
- Resource distribution events
- Volunteer opportunities
- Emergency notifications

**Features to Explore:**

**Phase 1 - Basic Generator (5-7 hours):**
- [ ] Template library (pre-designed flyer templates) (2-3 hours)
- [ ] Modal/form to input event details (1-2 hours)
- [ ] Auto-populate from spreadsheet data (zone name, contact info) (1 hour)
- [ ] Customizable fields (date, time, location, description) (1 hour)
- [ ] PDF export functionality (1-2 hours)

**Phase 2 - Advanced Features (3-4 hours):**
- [ ] QR code generation (link to event, resources, etc.) (1 hour)
- [ ] Print optimization (30 min)
- [ ] Multiple template designs (2-3 hours)

**Phase 3 - Polish (2-4 hours):**
- [ ] Template preview in modal (1 hour)
- [ ] Save templates for reuse (1-2 hours)
- [ ] Custom branding options (1 hour)

**Technical Approach:**

**Option 1: Client-Side PDF Generation**
- Use `jsPDF` or `pdfmake` library
- Generate PDF in browser
- Pros: No server needed, fast
- Cons: Limited styling, browser compatibility
- **Time:** 5-7 hours

**Option 2: HTML to PDF**
- Use `html2pdf.js` or `puppeteer` (would need backend)
- Render HTML template, convert to PDF
- Pros: Full CSS styling, professional output
- Cons: More complex, may need backend
- **Time:** 8-12 hours

**Option 3: Template Engine + PDF Service**
- Use template engine (Handlebars, Mustache)
- Fill template with data
- Convert to PDF via service
- Pros: Most flexible
- Cons: Most complex, requires backend
- **Time:** 12-18 hours

**Recommended Approach:**
- Start with `html2pdf.js` for client-side generation
- Create 2-3 template designs
- Allow customization of key fields
- Add QR code via `qrcode.js` library

**Data Integration:**
- Pull zone name from spreadsheet (30 min)
- Pull contact info (NC Name, NC Phone, NC Email) (30 min)
- Allow manual entry of event-specific details (1 hour)
- Save templates for reuse (1-2 hours)

**UI Flow:**
1. User clicks "Create Flyer" button (in Tools section?) (30 min)
2. Modal opens with template selection (1 hour)
3. Form fields populate (some auto-filled from spreadsheet) (1 hour)
4. Preview flyer in modal (1-2 hours)
5. Download as PDF or Print (1 hour)

**Time Breakdown:**
- Research & planning: 1-2 hours
- Template design: 2-3 hours
- PDF generation setup: 2-3 hours
- Form & data integration: 2-3 hours
- UI/UX: 2-3 hours
- Testing & refinement: 1-2 hours

---

## 🔄 Development Workflow

**Sprint Planning:**
- Review this document weekly
- Prioritize tasks based on user needs
- Update status as tasks progress
- Move completed items to "Completed" section

**Task Status:**
- 🔴 Not Started / Planning
- 🟡 In Progress
- 🟢 Completed
- ⚪ Blocked

**Complexity Ratings:**
- **Low:** 1-3 hours, straightforward implementation
- **Medium:** 3-8 hours, some complexity, may require research
- **High:** 8+ hours, complex implementation, multiple components

---

## 📝 Notes & Decisions

### Contact Tracking Decision (Pending)
- Need user input on: Log every contact vs. most recent only
- Need to test Google Sheets API column insertion
- **Decision Date:** [To be updated]

### Map Library Decision (Pending)
- Recommendation: Stick with Leaflet
- Monitor Mapbox satellite imagery updates
- **Decision Date:** [To be updated]

### Mobile Strategy (Pending)
- Need to test current design on mobile devices
- May need significant layout restructuring
- **Decision Date:** [To be updated]

---

## 🎨 Design System Reference

**Colors:**
- Primary Dark: `#283618`
- Primary: `#606C38`
- Background: `#FEFAE0`
- Accent: `#DDA15E`
- Accent Dark: `#BC6C25`
- Highlight: `#afcc8e`
- Highlight Light: `#cdf4a0`

**Typography:**
- Headings: Alegreya Extra Bold (800)
- Body: System UI fonts

---

## 📚 Resources

- [Google Sheets API v4 Documentation](https://developers.google.com/sheets/api)
- [Leaflet.js Documentation](https://leafletjs.com/)
- [Mapbox Documentation](https://docs.mapbox.com/)
- [jsPDF Documentation](https://github.com/parallax/jsPDF)
- [html2pdf.js Documentation](https://ekoopmans.github.io/html2pdf.js/)
- [QRCode.js Documentation](https://github.com/davidshimjs/qrcodejs)

---

## 📊 Total Estimated Time

**High Priority Tasks:**
- Contact Tracking: 4-6 hours
- Table Enhancement: 6-8 hours
- **Subtotal:** 10-14 hours

**Medium Priority Tasks:**
- Map Decision/Enhancement: 2-4 hours
- Help Section: 3-4 hours
- Mobile Functionality: 8-12 hours
- **Subtotal:** 13-20 hours

**Low Priority Tasks:**
- Logo Integration: 1-2 hours
- Flyer Generator: 10-15 hours
- **Subtotal:** 11-17 hours

**Grand Total:** 34-51 hours

---

**Last Review Date:** November 25, 2024  
**Next Review Date:** [To be updated weekly]
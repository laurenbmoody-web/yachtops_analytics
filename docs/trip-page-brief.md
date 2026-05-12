# Cargo · Trip Page Redesign · Implementation Brief

This document is the single source of truth for the new trip detail page. Read this first before any implementation work. Pair it with the reference HTML files in `/mnt/user-data/outputs/`:

- `ibiza-port-detail-v3.html` — Documents → port detail page (Phase 5 reference)
- `photos-gallery-v3-locked.html` — Photos → gallery with crew + guest views (Phase 6 reference)

Other section references will be produced per phase before that phase begins.

---

## 1. PURPOSE & SCOPE

The trip page is the logbook of a guest period — owner trip, charter trip, or "other" (broker visit, sales viewing, owner's friend for lunch). Each trip is a chapter of the boat's working year. It serves crew working *this* trip ("what now?") and crew working *future* trips ("what worked last time?").

**Replaces:** the existing trip detail page at `src/pages/trip-detail-view-with-guest-allocation/index.jsx` (3162 lines), which uses left-pane tab navigation.

**Run in parallel.** Build at a new route `/trips/:id/v2` first. Don't delete the existing page. Migrate when stable.

**Three trip types, two real templates:**
- **Owner trip** — recurring principal, looser docs, deeper memory. No broker.
- **Charter trip** — paying party, broker, contract, charter fee, APA. Memory thinner.
- **Other** — catch-all, lightest template. Most modules suppressed.

Charter and owner share the shell. Charter adds Broker & Contract module + APA module. Other shows the bare minimum.

---

## 2. PAGE STRUCTURE (10 SECTIONS, IN ORDER)

The page is a single editorial document with anchored sections. No left-pane tabs. The page header is phase-aware (Planning / Aboard / Settling / Archived) — the topmost section changes per phase, the body is consistent.

Section order top-to-bottom:

```
1. Header
2. The route
3. What's coming up
4. Aboard for this trip
5. Crew on this trip / Rota
6. Provisioning
7. Memory
8. Documents
9. Photos
10. Activity log
```

---

## 3. VOICE & REGISTER

**Editorial-warm, addressed to crew.** Not SaaS. Not analytical. Reads like a senior crew member leaning over your shoulder.

**Vocabulary swaps (already locked):**

| Old (SaaS) | New (editorial) |
|---|---|
| Trip Activity Log | The activity log / The trip so far |
| Reminders + Special Occasions | What's coming up |
| Active Guests on Trip | Aboard for this trip |
| Itinerary | The route |
| No reminders yet | Nothing to remember yet |
| Status: Active | On now / Aboard / Settling / Archived |

**Copy patterns:**
- Empty states never apologise. They invite. *"Nothing to remember yet"* not *"You have no reminders."*
- Trip referred to in third person, not second. *"The trip so far"* not *"Your trip."* The page is the boat's logbook, not the user's tool.
- Dates are written: *"Friday 2 May"* not *"05/02/2026"* in display copy.
- Status words are quiet: *Upcoming, aboard, settling, archived* — not *Active, Pending, Completed, Closed.*

**Headline pattern.** Every section header is `Word, qualifier.` or just `Word.` in DM Serif Display, with the qualifier in italic terracotta. Examples:
- *The route.*
- *The activity log.*
- *Aboard for this trip.*
- *What's coming up.*
- *The photos.*

The period at the end (with italic terracotta colouring of just the period) is the Cargo signature.

---

## 4. DESIGN TOKENS

Already in `src/pages/pantry/pantry.css` under `.editorial-page` class. No new tokens needed. Key tokens:

```css
--bg-canvas:      #F5F1EA;  /* page background, warm cream */
--bg-card:        #FFFFFF;
--bg-surface:     #F5F1EA;
--bg-secondary:   #DFD8CC;

--ink:            #1C1B3A;  /* deep navy, primary text */
--ink-muted:      #695880;  /* muted purple, secondary text */
--ink-tertiary:   #8B8478;  /* tertiary, meta text */

--terracotta:        #C65A1A;
--terracotta-soft:   #FAECE7;
--terracotta-deep:   #7A2E1E;

--sage-text:    #2D5A3A;
--sage-bg:      #F0F4EE;
--sage-border:  #C7DCC9;

--border:       #DFD8CC;
```

**Typography:**
- Headings: `'DM Serif Display', Georgia, serif`
- Body: `'Plus Jakarta Sans', system-ui, sans-serif`

**Section accent colours (top borders) carry meaning:**
- `#1C1B3A` ink — structural/operational (Today, Aboard, Route, Provisioning, Documents, Photos, Activity)
- `#C65A1A` terracotta — human-warm (What's coming up, Memory)
- `#B8935E` brass — Crew widget (interior/working surface)

---

## 5. SECTION-BY-SECTION SPECS

### Section 1 — Header (phase-aware)

The topmost section adapts to trip phase: Planning / Aboard / Settling / Archived.

**Aboard phase (live trip, the richest state):**
- Meta strip above title: `MARCHETTI CHARTER · DAY 3 OF 5 · CHARTER`
- Title in DM Serif Display ~56px: *"The Marchetti charter."* (terracotta italic on "Marchetti")
- Editorial subtitle auto-generated from trip state (e.g. *"Marchetti party of four, two ashore until afternoon. Cocktail hour comes up next."*)
- Right side: two key widgets — current location + current time / day-of-trip

**Planning phase:** subtitle becomes a setup checklist or pre-arrival prep prompt.

**Settling phase:** subtitle becomes close-out copy (*"Settling accounts, uploading photos, the trip's last paperwork."*)

**Archived phase:** muted treatment, memory-forward.

---

### Section 2 — The route

Horizontal cell grid of trip days (5-day default; 14+ days scrolls horizontally with today auto-scrolled into view).

**Chip vocabulary — two shapes, one language:**

**Static chip** (single-location day):
- Day label (Wed, today, Sun) + small date below
- Location name in DM Serif (large)
- Italic stop-type descriptor below name (e.g. *"at anchor"*, *"alongside in Palma"*, *"underway"*)
- Editorial subtitle (e.g. *"Embarkation 16:00, welcome dinner aboard"*)

**Transit chip** (multi-position day):
- Position stack: each position on its own line with `↓ underway HH:MM — HH:MM` lines between
- Marker shapes: `▪` filled square = dock/marina, `○` open ring = anchor, `→`/`↓` = underway
- Example Saturday: `↓ 09:00 → ○ Cala Salada 13:30 → ↓ 15:00 → ▪ Ibiza marina 17:00`

**States:**
- Past days dimmed to 65% opacity
- Today gets terracotta tint + terracotta-coloured marker
- Future days at 100% opacity in default neutral
- Today is bolded with full chroma

**Forecast flags:**
- Small `Forecast` corner badge appears top-right on chips where weather rule fires (e.g. NW wind >15kn + swell >1m at a NW-exposed anchorage)
- Hairline-divided weather strip at bottom of chip shows plain-language read (*"18 kn NW · 1.2 m swell. Cala Salada exposed by lunchtime."*)
- Forecast card sits *below* the route widget when flags are active (terracotta top border, editorial copy, named confidence, concrete actions including "Suggest alternative anchorage" from historical data — Phase 2)

**Marker legend** appears as a small strip below the row (8px vertical): teaches the marker vocabulary in one glance.

**Day-detail panel (clicking any cell expands it inline):**
- Weather strip (4 cards: Wind, Swell, Tender, Sunset) populated by Stormglass + internal tender booking data
- Day timeline (hourly schedule)
- Location detail (coordinates if captain-relevant: `39°33'N 2°37'E`)

**Map view button in header** — Phase 2, Mapbox + Windy + MarineTraffic + anchorage memory layer.

---

### Section 3 — What's coming up

Forward-looking surface merging Reminders + Special Occasions. Shows occasions, reminders, and (for today only) the day's remaining service moments.

**Structure:**
- Date column on the left uses serif words: *Today / Tomorrow / Sunday / Monday / Later*
- Each row has three lines in the date column: relative label (Today), absolute date (Fri 1 May), phase qualifier (Day 3 of 5 / Final day · disembark / etc.)
- "Later" row catches dateless items (em-dash `—` placeholder for the third line)

**Today row (visually anchored):**
- Cream tint background, larger date label
- Strikes through (or 40% opacity — pick opacity, less graveyard-y) completed service moments at top
- Hairline divider above next-up moment ("you are here" line)
- Next-up moment in terracotta with service time
- Rest of day's moments in normal weight below

**Future days compressed view:**
- Occasions shown at full weight in serif italic (e.g. *"Susan's birthday"*)
- Reminders shown at full weight in sans-serif medium (e.g. *"Confirm florist for arrival flowers"*)
- Service moments collapse to italic quiet line: *"5 service moments — first at 09:00. Open day"* (terracotta-underlined "Open day" is tappable to expand)

**Item types differentiated by typography, not badges:**
- **Occasions** (birthdays, anniversaries) — serif italic, no time treatment (date IS the deadline)
- **Reminders** (action-required to-dos) — sans-serif medium, with deadline pip (*"By lunch"*, *"Sunday eve"*)
- **Service moments** (today only, on Today row) — clock times (19:00, 19:30)

**Memory leaks in inline:** the florist reminder includes *"Margarita Flors · used 7 times before · always on time"* — pulled from location memory pool automatically.

**Settled items hidden by default,** with "show settled" footer toggle to fold them back in.

---

### Section 4 — Aboard for this trip

Guest layout, organised by cabin (deck-stacked).

5-cabin layout typical. Each cabin block shows:
- Cabin name (Master, VIP, Twin, Bunk, etc.)
- Guest avatars/photos with names
- Quick status: ashore/aboard, current state
- Allergy chips, dietary signals (linked from preferences feature)
- Tap into guest detail

Shows for guest-bearing trips only. Suppressed on Other trips without guests.

---

### Section 5 — Crew on this trip + Rota drawer

Header pill shows who's on duty now. Tapping opens the rota drawer with three surfaces:

**1. Today view** — half-hour grid, sticky crew column, three-line crew names with `Rest Xh | Past week Yh`, MLC alert triangle on at-risk crew, hover row tinting, `Calendar | Operational` toggle (06:00 default).

**2. Trip span view** — trip-scoped columns, each cell carries hours + shift type/sub-type + rolling 7d state with directional arrow. Today-edge as 2px terracotta vertical seam. Future cells at 72% opacity. Four cell states. `!` pending and `✓` confirmed glyphs. Trajectory column with five day-pills + worst-day text readout. `Trip only / ± 7d context` toggle.

**3. Per-crew rest panel** — large card on blurred backdrop. Identity strip with today/past-week status line. Compliance banner with full-prose narrative. Two-state 24h timeline (rest sage / on-duty ink, NO third "off-duty not rest" category — honest to data model). 7-day rolling rest bar chart with constant heights and 77h MLC line. Trip insights with shift-type breakdown. *"Worth considering"* swap suggestions in two confidence levels (Confident swap / Needs your judgment). Four action buttons.

**Data architecture:**
- Single canonical crew shift record table — both trip and off-trip shifts write here
- Rolling 7d math always pulls from full record, ignoring trip boundaries
- All views use end-of-day rolling 7d for consistency
- Hours-of-rest log = unfiltered chronological per-crew, the canonical audit document
- Same rota component reused off-trip with calendar-week defaults

**Shift type taxonomy:**
- Duty (default)
- Watch (Anchor / Navigation / Engine / Lookout — required)
- Standby (Maintenance / Tender / Support — optional)
- Training
- Off
- Sick

**Permissions:**
- Command + Chief edit
- HOD edits within department
- Crew read-only with submit-time-correction path → `!` glyph in chief's queue → `✓` once confirmed

**Backlog (Phase 2+):**
- Coverage role metadata on shifts (precursor for swap suggestions to know what work needs covering)
- "Apply this swap" mechanism with rota preview affordance
- "Why these two?" suggestion explainer
- Crew-side rota visibility surface (separate page when rota is locked)
- Time-correction submission flow on crew side

---

### Section 6 — Provisioning

Dossier-style summary with linked boards. Click-through to existing workspace at `/provisioning?trip=marchetti` (no duplicated kanban here — trip page is the glance, workspace is the work).

**v1 elements:**
- **Aggregate strip** — four cells: Trip spend (with budget bar + hover-to-expand department breakdown) / Items aboard / Outstanding deliveries (warn-tinted) / Returns to confirm (warn-tinted)
- **Folder tabs** — All / Needs attention / Live / Closed with count chips
- **Board rows** with: 6px coloured left tab, title, status pill, meta row (owner + last activity + collaborators), contextual story (one-line editorial), three-figure panel
- **Cross-board dependency** — small chain icon when one board waits on another (*"Waiting on galley · Iberica delivery"*)
- **Last activity timestamp** on each card (*"Updated 2h ago by Anders"*)
- **Linked dietary signals indicator** on relevant boards (*"3 dietary signals applied"*)

**Permissions:** department-default + collaborator override + read-only fallback.

**v2 layers (parked):**
- AI insights strip below summary
- Supplier risk indicators (*"3rd late this season"*)
- Carry-over items count on closed boards
- Approval flow for over-budget boards (deep-ink stripe + Approval needed pill)
- Department spend breakdown in expanded spend block (currently hover-reveal)

**Workspace at `/provisioning?trip=marchetti` (existing kanban with trip filter chip)** is where the rich kanban interaction lives.

**Calendar overlay** — deliveries surface in "What's coming up" section.

**Trip-end retrospective** — when trip seals, card shifts to historical summary (*"5,420 spent · 142 items provisioned · 3 logged supplier issues · 12 items carried forward"*).

---

### Section 7 — Memory

Three cards: *Last time / In [location] / From the archive*. Each card uses **Option M structure**: cream title bar at top (pool name on left + source line on right), editorial body in white below.

**Pool definitions:**
- **Last time** — guest-keyed (when this principal was last aboard)
- **In [location]** — location-keyed (e.g. "In Palma" — what's happened across visits here)
- **From the archive** — pattern-keyed (across similar trips, generic learnings)

**Card source line content:**
- Last time → date + location (*"Aug 2024 · Côte d'Azur · pinned by Claire"*)
- In Palma → frequency (*"✦ AI-noticed across 6 visits"* — terracotta caps with ✦ glyph)
- From the archive → similar charters (*"2 similar charters · last spring"*)

**Source line styling distinguishes provenance:**
- Human-pinned — italic muted byline
- AI-noticed — terracotta caps with ✦ glyph + Confirm/Dismiss row in body
- No badges, no "AI" labels — system invisible

**AI categorisation is invisible.** Crew pin free-text notes. System silently:
- Categorises which pool (Last time / In location / From archive)
- Determines department relevance (interior=1.0, galley=0.7, deck=0.0, eng=0.0)
- Extracts entities (supplier, location, pattern)
- Uses trip context (current location, guests, time) to inform categorisation
- Returns to screen — no toast, no popup, note appears in right place

**View filtering by viewer role:**
- Same data pool, different *prioritisation* per viewer
- Chief stew sees interior-leaning + cross-department
- Bosun sees deck-leaning + cross-department
- Captain sees command-leaning (cross-cutting)
- Chief eng sees engineering-leaning
- All HODs benefit from cross-department awareness

**Archive at `/memory` or `/trip/:id/memory`** — unfiltered, user-applies-filters, where curation happens. Trip page is consumption.

**Footer:** *"The system surfaces what's most relevant for today."* on left, *"See all memory →"* on right.

**Confirm/Dismiss row** only appears on AI-noticed pattern cards (not on all AI-touched notes — pattern detection is a real claim worth surfacing).

**Data model:**
```
memory_entry {
  id
  raw_text         // what the crew member wrote
  derived_text     // optional AI-rewritten editorial version
  pool             // last_time | in_location | from_archive
  location         // Palma, Antibes, etc.
  dept_relevance   // {interior: 1.0, galley: 0.7, deck: 0.0, eng: 0.0}
  entities         // [supplier:Casa Bianca, item:linens, pattern:lateness]
  confidence       // AI's confidence in categorization
  trip_context     // trip pinned during
  pinned_by        // user_id
  pinned_at        // timestamp
  last_edited_by
  is_followup_to   // optional link to prior entry
}
```

---

### Section 8 — Documents

**Trip page section** (horizontal route strip — see `ibiza-port-detail-v3.html` for the deeper port detail page).

**Structure:**
- Header: title + count + *"View all documents →"* button
- Smart strip (Cargo voice): *"Two stops need your hands. Ibiza inbound is ready to send to María, and Cannes customs needs review by Thursday noon."*
- **Route strip** — horizontal scroll of cards mirroring the trip's itinerary:
  - **Pre-trip bookend** (dashed border, charter-wide packs: Trip pack + Charter pack)
  - **Each port stop card** — flag + country + port name (DM Serif) + dates + *"X/Y ready"* + progress bar
  - **End of trip bookend** (APA pack + closeout)
  - **Arrows between cards** imply flow
- CTAs: *+ Generate pack* / *Upload file*

**Card states:**
- **Done** — faded sage
- **Now** — warm white + terracotta border + outer glow
- **Coming up** — neutral
- **Warn** — soft terracotta

**No stamps on cards** — progress count + colour state do the work.

**Port detail page** (full-screen overlay opened when tapping a port stop card) — see `ibiza-port-detail-v3.html` for full mockup.

**Key port detail elements:**
- Overlay bar: `← Marchetti charter / The trip's paper trail / ×`
- Meta bar: `◉ PORT D'EIVISSA | WED · 8 MAY · ARRIVING 09:30 | ☀ 26°C · CLEAR | 12 KN E · SEAS 0.5 M` (close 12px gap to title)
- Title: `IBIZA, Port d'Eivissa.` (56px DM Serif, one line, white-space:nowrap)
- Subtitle: *"Paperwork for arriving Wednesday and leaving Thursday."* (single serif line)
- Two right-side widgets in 1fr/1fr grid (matches standby NOW/ON DUTY pattern)

**Widget lifecycle states:**
- **Days out** (3+ days) — neutral, *"3 days"* + *"2/8"*
- **Tomorrow** (24-48 hrs) — current default, *"18 hrs"* + *"5/8"* with terracotta accent
- **Imminent** (<12 hrs) — soft terracotta tint on Arriving widget, *"4 hrs"* + soft sage *"8/8 ✓"* on Documents Ready, deep ink Send pack CTA
- **Sent** — Arriving still warning, Documents Ready muted with double tick *"Sent to María · Just now ✓✓"*, secondary CTA
- **In port** — Arriving widget pivots to *"In port"* sage italic, second widget pivots to next pack (Outbound to Beaulieu)
- **Departed** — both muted with double ticks

**Content split layout: 320px rail / 1fr pane**

**Left rail (corner-tag style, no counts):**
- Section flags: deep ink corner-tags flush to rail left edge (*Arriving / During the stay / Leaving*)
  - Padding 7px 14px 7px 20px, border-radius 0 999px 999px 0
- Rail items: type tag (muted caps) + name (DM Serif) + italic meta
- **Active = terracotta left border ONLY** (no fill change, no text colour change)
- **Done = opacity 0.75**
- Corner glyph bottom-right: ✓ for ready, ✓✓ for sent/filed, nothing for empty/drafting (all muted #8B8478)
- State tags (ready/filed/empty/drafting) REMOVED from rail
- Rail starts at top:24px to align with pane content

**Right pane:**
- Eyebrow (terracotta caps + dot): *"● Inbound port pack · ready"*
- Pane name (30px DM Serif): *"For Puerto de Ibiza."* with italic terracotta period
- Recipient line (consolidated): *"→ María Sanz · [puertodeibiza.es](http://puertodeibiza.es) · send by Wed 14:00"*
- Buttons: Download (ghost) + Send pack → (terracotta filled)
- Body paragraph REMOVED entirely
- Doc grid (2-col on desktop): neutral cream rows, ONLY pill carries colour (sage Ready / terracotta Expiring)
- Active doc = subtle deep ink border, no fill change
- Insurance certificate row no longer has soft terracotta bg — only Expiring pill flags it
- "What's inside" header REMOVED
- Bordered container around doc list REMOVED
- Preview pre-header REMOVED — preview pane's internal header is enough
- Live preview pane below with own header

**Pack model:**
- Documents = actual files in vessel source store
- Packs = bundles that reference documents (manifests)
- Update once, propagate everywhere
- Pack contents inspectable, addable, removable
- Cross-pack composition via "Attach from store" (e.g. charter cert into port pack)

**Pack types:**
- **Trip pack** (charter-wide foundation)
- **Charter pack** (commercial/legal — agreement, waivers, NDAs, APA)
- **Customs pack** (per country, regenerated per border crossing)
- **Port pack** (per port, in/out bookends)
- **APA reconciliation** (end of trip)

**Multi-port same-country logic:** Spain customs filed at Palma covers Ibiza if continuous. If broken (Palma → France → Spain again), new customs needed. Note appears on rail as *"Already filed · Tue · Palma · re-filing not needed."*

**Permissions:** Same model as Memory and Provisioning — same component, scoped feed by role (Command sees all, others scoped).

---

### Section 9 — Photos

**Trip page section** — see locked design:

**Structure:**
- Just *"The photos."* title (DM Serif with terracotta italic period) + *"View all 47 →"* button top-right
- 3:2 slideshow panel with crossfade transition, ~5s auto-cycle
- Inside slideshow: dot indicators top-left, caption reveals on hover (bottom gradient overlay), View all link bottom-right
- NO meta strip, NO subtitle, NO upload/pin buttons (removed — those are gallery actions)
- Cover photo auto-selected (or manually pinned from gallery)

**Gallery (View all) — full crew view, see `photos-gallery-v3-locked.html`:**

Two-tab layout: **Crew view** (all photos) / **Guest view** (curated subset).

**Crew view:**
- Overlay bar + view tabs (active tab = deep ink underline; guest tab = terracotta when active)
- Meta bar: `◉ MARCHETTI CHARTER | 47 PHOTOS · 6 CONTRIBUTORS | FRI 3 MAY → SUN 12 MAY`
- Editorial title *"The photos."* + subtitle + Filter by photographer / + Upload photos buttons
- Filter chips (with counts): All / *♡ Hearted* / *Guest book* (terracotta-tinted) / Memorable / Service / Anchorage / Engineering / *Provisioning 🔒* / *Receipts 🔒* (locked = command-only)
- Full-width 21:9 cover photo with Change cover button top-right, TRIP COVER badge top-left, caption hover-reveals
- Category sections: each with cat tag + serif name + count + optional CTA
- 4-col grid of photo tiles

**Each photo tile:**
- Hover reveals caption + actions
- **Two badge systems separated:**
  - **Heart (♡)** — anyone can heart, count visible on hover, filled terracotta when you've hearted it. Personal favourite.
  - **Book icon** — only command/chief/HOD can flag. Shows on tile top-left (always visible) as a small book glyph in terracotta when added to guest book.
- Hover top-right shows:
  - Heart with count
  - *Add to guest book* button (or *In guest book* with minus icon if added) — command/chief/HOD only
- Inline upload tile per category (dashed border, plus icon only, no text — "F" variant locked)

**Permissions:** Only command, chief, HOD can flag photos for guest book. Other crew can view + heart, but not flag.

**Guest view (in same gallery, second tab):**
- Same tabs at top
- Curation toolbar: terracotta-soft banner *"You're previewing what guests will see. 12 photos curated · add or remove from Crew view to adjust."* + *Copy share link* / *Send to guests →* buttons
- Guest preview panel (cream #FFFCF7 background, deep ink top bar with *"M/Y MARCHETTI"* + italic *"A keepsake from your charter"*)
- Inside preview body (60px padding): *"Captured aboard M/Y Marchetti"* mark
- Hero: caps tag `FRI 3 MAY → SUN 12 MAY`, *"The Marchetti charter."* (60px serif), italic meta *"Twelve days at sea · captured for the Lebrun family."*
- Actions: Download all (12) / Print as photo book
- Cover photo (3:2) with caption overlay
- *"Eleven more moments"* italic header
- 3-col grid of remaining photos
- Footer: *"A keepsake from your time aboard M/Y Marchetti. With thanks from the crew · May 2026."*
- NO Cargo branding on guest side — it's their memento

**Categories (locked):**
- **Memorable** — guest-facing candidates
- **Service** — interior preference shots (table settings, napkin folds, cocktail garnishes) — crew-only
- **Anchorage** — deck-side captures, ports, anchorages, sunsets
- **Engineering** — engine room, fuel, water-maker
- **Provisioning 🔒** — command/chief only
- **Receipts 🔒** — command/chief only

**AI auto-categorises uploaded photos** by image content (e.g. sunset over water → Memorable, fuel pump → Engineering). Crew can re-categorise after upload if wrong. Cargo voice toast confirms: *"6 photos uploaded · sorted by category."*

**Upload:**
- Top-right *+ Upload photos* button on gallery page
- Inline upload tile per category (dashed border, plus icon only)
- Crew uploads from device in bulk (no page-wide drag-drop)

---

### Section 10 — Activity log

**Trip page section — flat chronological list.**

**Structure:**
- Title only: *"The activity log."* with terracotta italic period
- *View full log →* button top-right
- Cargo notes digest at top — soft terracotta-bordered card with AI summary of the period:
  *"Cargo notes · last 48 hours"*
  *"Maria Sanz acknowledged the Ibiza port pack, the Lebrun family confirmed Saturday's birthday dinner, and Claire's flagged 6 photos for the guest book."*
- Day group headers — *TODAY · Thursday 8 May* / *YESTERDAY · Wednesday 7 May* / *TUESDAY · 6 May*
- Flat entries, all same size: time + line + category pill

**Entry treatment (no tier sizes):**
- Time in monospace-style numerals on the left (consistent width, `font-variant-numeric: tabular-nums`)
- Actor name in **bold roman** (e.g. *Maria Sanz*, *Claire*, *Lauren*, *Mark*, *Yorke*, *Mrs Lebrun*)
- Rest of line in plain roman Plus Jakarta Sans 13.5px
- Category pill on right — same sage/terracotta/muted-purple system as document status pills (consistent colour language)

**Category pills:**
- *Documents* — sage (`#2D5A3A` text, `#F0F4EE` bg, `#C7DCC9` border)
- *Photos* — terracotta (`#C65A1A` text, `#FAECE7` bg, `#F5C9B8` border)
- *Memory* — muted purple (`#695880` text, `#F0EBDF` bg, `#DFD8CC` border)
- *Guest* — deep terracotta (`#7A2E1E` text, `#FAECE7` bg, `#F5C9B8` border)
- *Provisioning* — muted purple (`#5A4F6F` text, `#F0EBDF` bg, `#DFD8CC` border)

**Italic usage minimal:** only in title's terracotta period, day-header dates (italic muted serif), and digest tag.

**Each entry is tappable** and deep-links to source (the photo tile, document pack, memory note, etc.).

**AI-filtered** to meaningful events. Auto-generated photo uploads (47 of them) shouldn't all appear. The log surfaces decisions, milestones, and external acknowledgments.

**Time window:** Last 48 hours default, with filter to widen (or *View full log* button).

**Permissions:** Same scoping as everything else — command sees all, others scoped by department + own actions + shared events.

---

## 6. PERMISSIONS ARCHITECTURE (consistent across sections)

Use `tenantRole` from `useAuth()` — exposes role as string (e.g. `"COMMAND"`, `"CHIEF"`, `"HOD"`, `"CREW"`).

**NOT** `user?.permission_tier` or `user?.effectiveTier`.

**Section-by-section scoping:**

| Section | Command | Chief | HOD | Crew |
|---|---|---|---|---|
| Header | full | full | view | view |
| Route | full | full | view | view |
| What's coming up | full | full | dept-scoped | view |
| Aboard | full | full | view | view |
| Crew/Rota | full edit | full edit | dept edit | read-only + corrections |
| Provisioning | full | full | dept | view |
| Memory | full | full | dept-prioritised | dept-prioritised |
| Documents | full | full | dept-scoped | view dept |
| Photos | all + locked cats | all + locked cats | flag guest book | view + heart only |
| Activity log | all | all | dept + shared | own + shared |

---

## 7. KEY TECHNICAL CONSTANTS

- `tenant_id`: `de051fc7-ec3b-4c22-96e8-b9834acda6aa`
- `user_id`: `b1ef6b14-d603-49c1-93d3-5f4089242812`
- `tenantRole`: `"COMMAND"`
- Supabase project ref: `gwexbrbasfysbheeklyq`
- Repo: `github.com/laurenbmoody-web/yachtops_analytics`
- Local clone: `/home/claude/yachtops_analytics`
- Editorial primitives: `src/components/editorial/{EditorialPageShell,EditorialHeadline,EditorialMetaStrip,EditorialTabNav}.jsx`
- CSS tokens: `src/styles/tailwind.css`, `src/pages/pantry/pantry.css` (lines 15-160 editorial vars under `.editorial-page` class)
- Existing trip detail (to replace): `src/pages/trip-detail-view-with-guest-allocation/index.jsx` (3162 lines) + 7 modal components
- Trips dashboard: `src/pages/trips-management-dashboard/index.jsx` (1178 lines)
- Standby reference (for pattern): `src/pages/pantry/StandbyPage.jsx`

---

## 8. PHASE PLAN

**Phase 1 — Page shell + editorial primitives**
- New route at `/trips/:id/v2`
- New layout shell component (`TripDetailV2.jsx`)
- 10 section placeholder components (`Section{Header,Route,Coming,Aboard,Crew,Provisioning,Memory,Documents,Photos,Activity}.jsx`)
- Wrap in `<div className="editorial-page">` for token scope
- Apply existing editorial primitives
- Verify page renders with all 10 section frames visible, design tokens applied
- NO section content yet — just scaffolding

**Phase 2 — Header + Route + What's coming up**
- Phase-aware page header with subtitle auto-generation
- Route widget with chip vocabulary (static + transit), legend strip, day-detail panel
- What's coming up with date column, today anchor, future compression, type-differentiated typography

**Phase 3 — Aboard + Crew/Rota**
- Aboard cabin layout, guest avatars, allergy chips
- Crew on duty pill + rota drawer (Today / Trip span / Per-crew rest panel)
- MLC math (rolling 7d, end-of-day, hours-of-rest log)

**Phase 4 — Provisioning + Memory**
- Provisioning aggregate strip + folder tabs + board rows
- Workspace filter chip at `/provisioning?trip=:id`
- Memory three-card pattern (Last time / In location / From archive)
- AI categorisation backend + viewer-role prioritisation

**Phase 5 — Documents + Port detail page**
- Trip page Documents section: route strip with port cards
- Port detail overlay (use `ibiza-port-detail-v3.html` as visual reference)
- Pack model + cross-pack composition
- Widget lifecycle states (Days out → Tomorrow → Imminent → Sent → In port → Departed)

**Phase 6 — Photos + Gallery + Guest view**
- Trip page Photos slideshow (3:2, auto-cycle, hover caption, View all link)
- Gallery with categories (use `photos-gallery-v3-locked.html` as visual reference)
- Heart + Guest book separation (heart for anyone, book for command/chief/HOD)
- Guest view tab with editorial preview page
- Share link / Send to guests flow

**Phase 7 — Activity log + final polish**
- Activity log flat chronological list with Cargo notes digest
- Day group headers, category pills, tappable entries
- Page-level performance optimisation
- Edge cases: empty states, archive phase, "Other" trip type
- Migration cutover from `/trips/:id` to `/trips/:id/v2`

---

## 9. WORKING RULES FOR CLAUDE CODE

- **Work in phases.** Each phase has its own prompt with discovery + implementation + acceptance.
- **Report per phase then pause for approval.** Architecture decisions come through planning chat, implementation via Claude Code prompts.
- **Auto-compact at 700K tokens** (not 1M).
- **Discovery includes live SQL queries** against the actual database, not code comments or migration file reads.
- **Supplier↔crew symmetry:** when updating supplier-side, evaluate crew/vessel side impact or flag risks.
- **Permissions check:** use `tenantRole` from `useAuth()`, not `user?.permission_tier`.
- **No deletion of existing trip page yet** — build at `/trips/:id/v2`, migrate when stable.
- **Use existing editorial primitives** from `src/components/editorial/` rather than recreating.
- **Wrap new page in `<div className="editorial-page">`** for token scope.
- **Reference HTML files in `/mnt/user-data/outputs/`** are visual truth for Documents port detail (Phase 5) and Photos gallery (Phase 6). Per-section reference HTMLs will be generated before each phase.

---

## 10. PARKED / OUT OF SCOPE

- Long-trip mode (4-month case) — week strips, sticky labels, jump-to-date
- Map view with Mapbox + Windy + MarineTraffic + Stormglass + anchorage memory layer
- [Stormglass.io](http://Stormglass.io) / Open-Meteo / Windy / MarineTraffic / Navionics APIs
- Dashboard trip card redesign
- Add Trip / Edit Trip modal (type-aware)
- Coverage role metadata on shifts
- Swap suggestion application mechanism
- Crew-side rota visibility surface
- Time-correction submission flow on crew side
- AI insights button on Provisioning
- Supplier risk indicators
- Carry-over items between trips
- Approval flow for over-budget boards
- Department spend breakdown (currently hover-reveal)
- Storage location signal (workspace, not summary)
- Cross-trip analytics dashboards
- Charter ROI summaries
- Multi-trip planning views
- AI forecasting models that *write* (vs read) into trip data
- Auto-import smart parsing of uploaded docs
- E-signature flows
- Templates for customs forms by country (Phase 2+)
- Port papers automation (Phase 2+)

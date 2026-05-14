# Cargo Trip Page — Locked Design Decisions

Extracted from design sessions 1–3 (May 2026).
These are the locked design rules that govern each section.

---

## Decision 1 (Session 1)

Good. Before I draw the four phases, let me think through what each phase actually changes about What's coming up — because the same widget shape needs to do four genuinely different jobs.

**Planning** — the trip hasn't started. There's no "today" inside the trip. The widget reframes from *"what's coming up during the trip"* to *"what's coming up before they arrive."* The hero row is no longer a day in the trip — it's a *prep deadline*. Reminders dominate (confirm broker, order provisions, brief crew). Occasions still appear at their dated rows even though the trip hasn't started. Service moments don't exist yet because there's no schedule running. The widget's title might shift from "What's coming up" to "Before they arrive."

**Aboard** — the version we just locked. Today expanded, future days compressed.

**Settling** — the trip just ended. Today and the future are gone; the focus shifts to *"what's left to close."* The widget reframes again — the hero row is now *closeout tasks* (APA reconcile, photos, supplier accounts, thank-you cards). No service moments because they're over. Occasions stay only if they're forward-looking ("Susan's thank-you note"). The title shifts to "What's left to close."

**Archived** — the trip is sealed. The widget collapses to a quiet read-only summary or hides entirely. Nothing to do. The information that lived in this widget while the trip was active now lives in the activity log / Memory module on past-trip pages.

Each of these uses the same row pattern — relative day in serif, absolute date in caps, qualifier line — but the *content* and the *title* shift. The voice pulls through.

A few things to settle in the mock:

- **Planning's relative day labels.** Not "Tomorrow / Sunday / Monday" because those are too short-term. Better: "12 days out / Next week / This week" as relative buckets, with the embarkation day called out as "Embark."
- **Settling's relative day labels.** "Today / Yesterday / This week" — the trip's just-ended-tense, not a future tense.
- **Archived's treatment.** Probably just a single line: "Archived. The trip log is the record now." with a link to the activity log. No row structure needed.

Let me mock all four now.

---

## Decision 2 (Session 1)

All four phases. The widget shape is consistent — three-line date column + content lane — but the *vocabulary, hero row, title, and content* all shift with the phase.

A few details worth pointing out:

**Planning** — the title becomes *"Before they arrive."* The hero row is "Embark" in terracotta serif, sitting at the bottom of the widget chronologically (because it's the *destination* of all this prep work). Date column reads *This week / Next week / Embark* with day-counts shifting from "12 — 6 days out" to "5 days — embark" to "Day 1 of 5." The relative-day labels become *prep buckets* rather than weekdays because the user is thinking in larger windows when the trip is two weeks out.

**Aboard** — the locked version, with one quiet edit: I dropped Sunday's row to leave Monday as the next visible day to make the comparison cleaner. Same shape as before.

**Settling** — the title becomes *"What's left to close."* Today is still the hero row (cream tint), but the day-count line reads "1 day after" — the trip-clock is now counting *forward* from disembarkation. Reminders dominate, all closeout-shaped (APA reconcile, photo send, thank-you note, laundry return). One occasion lingers in the "Later" row — *"Susan's anniversary, noted from this trip · 14 August · for next year's planning"* — capturing the principle that Settling is also when the trip writes information forward into next time.

**Archived** — the widget collapses. No row structure, no date column, just a single calm panel reading *"Nothing left to do. All occasions noted. All reminders settled. The trip log is the record now."* Two small actions — read the trip log, or reopen the trip. The top border drops to the muted `#DFD8CC` instead of terracotta because nothing in this widget needs attention anymore. The phase signals itself by going quiet.

Things I'd flag:

- **Settling carries forward a future-dated occasion.** That's an important architectural decision — Settling phase has visibility into Memory items that will fire on *future* trips. "Susan's anniversary noted for next year's planning" is the system showing its work: this trip just generated knowledge for a later trip. Worth confirming that's the right behavior, because it does mean the widget is doing a small amount of cross-trip work in the Settling phase.
- **Archived's "Reopen the trip" button.** Useful escape hatch — sometimes a trip gets archived and then a supplier sends a late invoice. Reopening flips the trip back to Settling phase. The button is muted because it's not the primary path, but it's there.
- **Planning's "Embark" hero treatment.** I made it terracotta serif at the bottom of the column to give it weight. An alternative: keep it neutral and let the qualifier text ("Day 1 · embark") carry the meaning. Worth seeing in real implementation. I'd argue the current treatment is right — the embark day is the *event* the prep is leading toward, and it deserves visual weight.

Land?

---

## Decision 3 (Session 1)

What changed:

**Planning** is now the same calendar widget — five days, same row structure, same content shape. The only difference: the date column drops to two lines (absolute date in serif as the hero, day-count below). No "Today / Tomorrow" because there is no today inside the trip yet. The embarkation day picks up the terracotta qualifier ("Day 1 · embark") and the final day picks up its terracotta qualifier ("Final · disembark"). Everything else stays the same — Saturday's birthday occasion is visible, service-moment counts are visible, days are tappable to expand. Title remains *"What's coming up."*

**Aboard** is unchanged from what we locked. Today/Tomorrow words present, anchored row expanded.

**Settling** uses the same widget too — but now the date column counts forward from disembarkation ("1 day after / 2 days after / 4 days after") and the hero is whichever post-trip date has tasks open. Reminders dominate because that's what closeout is. Susan's anniversary lingers in "Later" as the cross-trip note. Title stays *"What's coming up"* — because from here, those tasks *are* what's coming up.

**Archived** stays as the calm read-only panel with two actions.

Three things to flag:

- **Planning could open with the embarkation day expanded** the same way Aboard opens with Today expanded, since that's the single most relevant day during prep. Or it could open with all days collapsed. I went collapsed because Planning is reference-shaped — the chief stew is browsing what's planned, not acting on it. Aboard is action-shaped — the chief stew opens the page to see *now*.
- **Settling's "1 day after" / "2 days after" terracotta qualifier on Tuesday** marks "today" without using the word. The day-of-relevance still gets emphasis, just through phase-aware language. If that reads weird, the alternative is a small "Now" pip in muted caps without bringing back "Today."
- **The widget title doesn't change across phases.** I had it shift to "Before they arrive" / "What's left to close" but I think that was wrong — the widget *is* "what's coming up" regardless of phase, and changing the title is more disruption than insight. Keeping it consistent makes the widget feel like the same surface throughout the trip's life. Confirm that's the right call?

Land?

---

## Decision 4 (Session 1)

Locked.

The What's coming up widget is final across all four phases. The widget rules:

- Same shape always — date column on the left, content lane on the right
- Date column has three slots: relative day (only when meaningful) / absolute date / day-of-trip qualifier
- Aboard: serif relative word as hero (Today, Tomorrow), absolute date and day-count below. Today expanded with cream background, future days compressed to occasion + reminder + service-count line
- Planning: relative word drops, absolute date becomes the hero. Same content, all days collapsed by default. Embark and Disembark days carry terracotta qualifiers
- Settling: absolute date as hero, day-count counts forward from disembarkation. Reminders dominate. Memory items live in "Later"
- Archived: widget collapses to a quiet read-only panel — "Nothing left to do" — with two actions
- Title stays "What's coming up" across all four phases
- Tap any day to expand inline

Where next?

- **Long-trip mode** — your four-month case, what the route widget and the calendar widget look like at scale
- **Map view** — Mapbox + Windy + the anchorage memory layer
- **Today widget** — the live-state row at the top of the page (now / on duty / aboard)
- **Aboard for this trip** — guest cards
- **Crew on this trip** — rota
- **Memory module** — Last time / In Palma
- **Provisioning** — linked-board summary
- **Documents** — calendar export + manifest stub
- **Photos** — cover + gallery
- **Activity log / The trip so far**
- **Dashboard trip card** — replaces the one-line dashboard entry
- **Add Trip / Edit Trip modal** — type-aware form
- **Roll the locked widgets back into the full Overview** — see the page in context

---

## Decision 5 (Session 1)

Soft-square cards back. Same shape as the original "Now / On duty" pair you liked at the top of the page, applied to the count pills. Each card:

- Small caps label at the top
- Large serif number with "of N" muted to the right
- 12px rounded corners, 0.5px border, white background, 170px min width

A few details:

- Settling's *Trip — closed Mon* card uses italic serif instead of a number, since there's no count to show. The card shape stays consistent so the right-rail still reads as a stack of two; only the value-treatment shifts.
- Planning's meta strip gained the `→ embarks Palma 1 May` pill in terracotta, closing the gap between "boat is in Antibes" and "trip name is Marchetti Charter." Tells you immediately *where the trip starts even though the boat isn't there yet.*
- Archived cards stay full-color (only the headline desaturates) — the pills are now showing trip *totals* rather than live state, so they're factual records and don't need to look closed.

Header locked across all four phases?

---

## Decision 6 (Session 1)

Three phases now, with a sub-state of Aboard for the post-disembarkation closeout window. Quick read on each:

**Planning** — readiness pills, terracotta `→ embarks Palma 1 May` in the meta strip, future-tense subtitle.

**Aboard with guests onboard** — live counts (Crew on duty, Guests onboard), present-tense subtitle, full live meta strip.

**Aboard with guests gone (closing out)** — same headline color and qualifier weight as Aboard-with-guests (terracotta `just ended`), same prose-shaped subtitle, but the right-rail has flipped to totals (Guests hosted, Photos). The page is still active — chief stew hasn't sealed it yet — but the people-counts have stopped updating because there's nothing live to count.

**Archived** — identical right-rail to the closing-out state. The differences are: muted ink in the headline, qualifier becomes the dates, meta strip drops live data for static span, subtitle becomes editorial summary. The act of archiving is the chief stew's deliberate decision; the page reflects it visually.

The transition is now: "guests aboard" → "guests gone, still working" → "archived." Two of those happen automatically (disembarkation flips the pills), one requires a click (archive button somewhere on the page, probably in a settings menu rather than prominent — archiving is a deliberate act, not a frequent one).

Header locked across the three phases?

---

## Decision 7 (Session 1)

Locked. No Today widget, the header carries the live state via meta strip + subtitle + right-rail, the route widget sits directly under the header.

Page order so far:

1. **Header** ✅
2. **The route** ✅
3. **What's coming up** ✅
4. *Next: Aboard for this trip* — guest cards
5. Crew on this trip — rota
6. Provisioning — linked-board summary
7. Memory — Last time / In Palma
8. Documents
9. Photos
10. The trip so far — activity log

Moving to **Aboard for this trip** — the guest cards widget. Before I draw, a few things worth thinking through:

**What the widget is for.** It's the trip's people. A chief stew opens this widget to scan: who's onboard right now, who's where, and what each guest needs that's worth knowing on a fast scan. Not the deep preference panel (that's elsewhere on the page or per-guest drill-in), just the *operationally critical* slice — allergies, current state, cabin, role.

**The original mock had three-column cards.** Each card showed avatar + name + cabin + a couple of pills (allergies, awake/asleep/ashore). That's right in shape, but a few things felt SaaS-style rather than editorial:

- The cards were uniform, regardless of whether the guest was the principal or a plus-one
- All pills looked equally weighted — "Birthday Sat" pill sat next to "Awake" pill in the same color
- The relationship between guests (Susan + Paolo as a couple, both in cabin 101) wasn't visible

**Three things to settle before drawing:**

**1. Should the principal be visually emphasized?** On any owner trip the principal is *the* person; on a charter the lead booker is the equivalent. Earlier mocks treated all guests as equal cards. My instinct: yes, the principal gets slight visual weight — larger card, or first position with more prominence — because the chief stew's mental model centers on them.

**2. How to handle cabin pairings?** Susan and Paolo Marchetti both in 101. Anna and Robert Rossi both in 102. The current cards show this with two separate cards each labeled "Cabin 101" — fine but doesn't tell you they're a couple. Alternatives: two-up cabin cards (Susan+Paolo together), or keep separate cards but link them visually (subtle paired border, shared cabin label). I lean toward the second — separate cards because each guest has their own preferences, but a quiet visual link.

**3. State pills — what's worth showing?** Currently I had: allergies, current state (awake/asleep/ashore), special note (birthday). My instinct: *allergies always visible, current state visible only when meaningful (ashore is meaningful, awake at 18:45 is noise), occasion only when imminent (Susan's birthday tomorrow yes, Susan's birthday in October no).*

The widget should feel like a chief stew's mental model of the people aboard, not a database table.

A small question on phase behavior:

- **Planning** — the cards exist but show *expected* state (arriving 1 May 16:00) rather than live state. Allergies still visible because that drives prep.
- **Aboard with guests** — full live cards as drawn.
- **Aboard guests gone** — cards collapse to a quieter "Was aboard" treatment? Or hide entirely?
- **Archived** — read-only, totals-style summary?

Want to settle the three structural questions plus the phase behavior, or trust me and let me draw?

---

## Decision 8 (Session 1)

Got it — the balloon is locked, that minor copy aside. And the right-rail card on the header (`Crew on duty 5/12`) becomes clickable, opening into a crew rota/schedule surface.

Before I draw, a few things to settle about *what opens*:

**1. Where does the rota live?**

Three options:

- **A drawer** sliding in from the right, sitting on top of the trip page. Doesn't navigate away. The rota is contextual to this trip. Closes back to where you were.
- **A drilldown to its own surface** — `/trips/{id}/crew` — full page, full context. Better for a complex rota that needs scroll and edit.
- **A modal** popping over the page. Less editorial than the drawer.

I'd lean **drawer**. The chief stew opens the trip page to see her trip; she clicks the crew pill to peek at the rota; she closes the drawer and stays on the trip. Drawers preserve context. Modals interrupt. Full pages are heavy for a glance.

**2. Should the rota be trip-scoped or vessel-scoped?**

Trip-scoped means: this rota is for *this trip's* shifts only. Vessel-scoped means: this is the boat's standing rota, with this trip's shifts highlighted.

I'd argue **trip-scoped by default, with a toggle to "see the full rota"**. The chief stew clicked the trip's crew pill, so she wants the trip's rota. But sometimes she needs the wider view — who's on next week, who's still in port, who's overdue for time off. Drawer header has a small toggle: *This trip / Vessel-wide*.

**3. What does the rota actually show?**

Multiple shapes are possible:

- **Schedule grid** — days across the top, crew down the side, shifts as colored bars. Operational, calendar-app-like.
- **Crew list with shift summary** — each crew member as a row, showing their shifts as a small summary line. More editorial, list-shaped.
- **Today's shifts as a vertical timeline** — like the standby page. Today-focused, then "tomorrow" / "Sunday" sections below.

A chief stew planning a charter wants the *grid* most of the time — she's thinking "who's covering Saturday afternoon, do I need to swap someone." The list-shape works for "who's on the boat" but not for "is the rota covered." I'd lean grid, with the option to drill into a single crew member's shifts.

**4. What can the chief stew do from the rota?**

- View only (read-only) — drawer is purely informational
- Edit shifts inline (assign, swap, cover) — drawer is operational
- Both, with edit-mode toggle

I'd argue **edit inline, but quietly** — clicking a shift opens a small "swap / cover / clear" menu, no dedicated edit mode. Operational tools should let you do the work without ceremony.

**5. What does the right-rail card look like when clicked?**

The card itself can give a small visual affordance — a subtle hover lift, an icon that suggests "open" (a small `→` or expand glyph in the corner), maybe a hairline accent on hover. Worth getting right because it's the only interactive element in the header right now.

Two questions for you before I draw the rota drawer:

- Trip-scoped grid as the default, with a toggle to vessel-wide?
- And — should the drawer also surface things like crew on leave during this trip, agency cover, or anyone still to arrive (joining mid-trip)? Those edge-cases matter for charter planning but might overload the drawer.

---

## Decision 9 (Session 2)

Five planning enhancements stacked into the Week view:

**1. Department coverage rows.** Above each department's crew rows now sits a `Department · N crew` row showing the *total department hours* covered each day (36h, 42h, 38h...). Below the number, a 3-pip mini-meter shows how many crew were on at peak that day. The Saturday cell for Interior reads *22h* in terracotta with one red pip — that's a flag: only one crew on Saturday morning, coverage is thin. The captain sees this at a glance without reading three crew rows. The right-most "covered" total shows the week's department coverage (244h Interior, 184h Deck).

**2. Weekly summary column on the right.** Each crew row now ends with a `Week ahead` cell showing total hours on, rest hours / 77h MLC, and a one-line status. Claire reads *59h on · Rest 73h / 77h · 4h short by Sun* in soft terracotta — she'll fail the weekly MLC at the current trajectory unless something changes. Marco reads *48h on · Rest 96h / 77h · 19h spare ✓* in compliant ink. This collapses the weekly cumulative math into one cell per crew.

**3. Pending correction chip.** Claire's Tuesday cell has a small terracotta dot in the top-right corner — a crew correction was submitted for that day and is waiting for chief approval. The dot is small, terracotta, and ringed in white so it sits cleanly on any cell color. Click the cell to review.

**4. Scheduled-forecast cells.** Days that haven't happened yet (Saturday, Sunday) show in white-with-border rather than green — same data shape (hours + rest + state) but visually distinguished from the days that have actually been worked. The label reads "scheduled" not "on duty," and the rest figure is qualified as "projected ✓" or "projected · short." This honest visual distinction prevents anyone from confusing "the rota plans this" with "this happened."

**5. This week / Next week / 14 days toggle** — sits next to the date stepper using the same segmented-control style we just locked. *This week* is active. *Next week* lets the captain plan ahead. *14 days* expands the grid to show today's week and next week side by side for cross-week pattern planning. (For mock simplicity, only the toggle is shown — the 14-day grid would just be 14 columns wide.)

The view now does what command and chief actually need:

- **Spot MLC failures** — color coding handles this
- **See cumulative weekly load** — `Week ahead` column does this
- **See coverage by department** — coverage rows do this
- **Plan the week ahead** — scheduled cells + Next week toggle handle this
- **See pending corrections** — chip + footer link
- **Forecast multiple weeks** — 14 days toggle

Three things worth flagging:

- **Edit affordances need to be discoverable but quiet.** I added the helper text "*Click a cell to drop into the half-hour day · drag to swap shifts*" to the toolbar so the affordances are stated. In the actual implementation, drag would have visual feedback (a ghost shift floating with the cursor) and click would smoothly transition to Today view at the right date.
- **Emma's row is the visual story.** Wednesday violation logged (ink-terracotta), Thursday warning (cream-terracotta), Friday warning (cream-terracotta), and the week summary in terracotta with *16h short by Sun*. The eye lands on her immediately — she's the captain's biggest planning problem this week.
- **The summary column is wide (130px).** It needs the room because of the three-line content (label + total + rest fraction + status line). At narrower widths, the cell would have to truncate. Worth keeping at 130px on desktop; on mobile the column would either stack below or the whole grid would scroll horizontally.

Land?

---

## Decision 10 (Session 2)

Locked.

**Shift type taxonomy — final**

- **Duty** (default — any working time, all departments)
- **Watch** — sub-types: Anchor / Navigation / Engine / Lookout (required)
- **Standby** — sub-types: Maintenance / Tender / Support (optional, can be blank)
- **Training**
- **Off**
- **Sick**

Cell labels in the rota read:
- `12h | duty | 8h 30m rest`
- `4h | watch · anchor | 10h rest`
- `4h | watch · navigation | 8h rest`
- `4h | watch · engine | 9h rest`
- `4h | watch · lookout | 10h rest`
- `4h | standby · maintenance | 12h rest`
- `4h | standby · tender | 12h rest`
- `4h | standby · support | 12h rest`
- `4h | standby | 12h rest` *(no sub-type)*
- `8h | training | 12h rest`
- `— | off | 24h rest`
- `— | sick | —`

The data model: every shift has a `type`, an optional `sub_type` (required for Watch, optional for Standby), and the standard `start_at` / `end_at` timestamps. Captain and chief pick type/sub-type from the edit popover when creating or editing a shift. The MLC math treats Duty, Watch, and Standby as on-duty time for the 24h rest calculation; Training also counts as on-duty; Off and Sick don't.

Want me to redraw the Week view with:

- Simplified MLC color logic (Compliant / Violation unlogged / Violation logged / Off / Forecast)
- Shift type and sub-type labels in the cells

Or move on to the next widget?

---

## Decision 11 (Session 2)

Three real moves. Let me work through each before drawing.

**1. Tick icon for confirmed corrections.** Cleaner. The alert `!` was carrying double meaning (pending vs problematic). Replacing it with a tick `✓` for confirmed is honest:

- **No glyph** = no correction submitted, default state
- **`!` glyph** = correction submitted, awaiting captain/chief review
- **`✓` glyph** = correction reviewed and confirmed (either approved or rejected, but the action's complete)

The `✓` could appear on green cells (confirmed compliant correction) or terracotta cells (confirmed violation with logged reason). It's about *correction lifecycle*, not compliance.

This actually collapses the `Logged` pill into the `✓` system. A logged violation *is* a confirmed correction with a documented reason. So the visual story becomes:

- Compliant cell, no glyph → nothing pending
- Compliant cell, `!` glyph → crew correction awaiting review
- Compliant cell, `✓` glyph → correction confirmed (no change to compliance)
- Violation cell, no glyph → unresolved violation, no correction submitted yet
- Violation cell, `!` glyph → correction submitted, awaiting review (might change MLC state)
- Violation cell, `✓` glyph → violation acknowledged with logged reason, defensible

One glyph system for everything. Cleaner.

**2. Math stays MLC-honest.** Locked. Whatever the visual frame, the data layer always calculates against rolling 24h and rolling 7d windows. Never invent a "calendar-week MLC" that doesn't exist.

**3. The big one — trip-scoped time, not calendar-week time.**

This is a smart catch. You're absolutely right: when guests are aboard, the working unit is the *trip*. Mon–Sun is irrelevant. *Day 3 of 5* is what matters. So the Week view inside a trip page should respect the trip's own clock.

That gives us this logic:

**On the trip page rota (where this Week view lives):**

- Default time window = **the trip's actual span** (embark date → disembark date)
- If the trip is 5 days, the Week view shows 5 day-columns
- If the trip is 14 days, the Week view shows 14 day-columns (with horizontal scroll)
- The headline of the view changes from "27 Apr — 3 May" to "Day 1 — 5" or "Wed 1 May — Sun 5 May" with a small subtitle "the trip's full span"
- Today's column is highlighted (Day 3 = Friday)

**Outside trip context (vessel-level rota planning, off-trip planning):**

The same Week view component is reused but defaults to calendar week (Mon–Sun) because there's no trip clock to anchor on. Same data model, same MLC math, different default time window.

This actually solves a related question I'd been holding: the Week view we drew was generic — but the *trip rota* should naturally span the trip, not split into calendar weeks. A 5-day trip that starts Wednesday shouldn't render as "this week (Mon–Sun)" — it should render as Wed→Sun. A 12-day trip that starts on a Saturday shouldn't show "two weeks" — it should show 12 columns.

**The toggle becomes:** *Trip span | Past 7 days | Custom*

- **Trip span** (default on trip pages) = embark date through disembark date
- **Past 7 days** = rolling 7d ending today, MLC-compliance-focused
- **Custom** = user picks any range

The "this week / next week / 14 days" toggle from before assumed a calendar-week mental model. It needs to die in the trip-page context.

**Off-trip duplicate of the same feature.** That's a Phase 2 conversation but worth flagging the architecture: the rota component itself is generic (just takes a date range and renders crew × days). The trip page wraps it with trip-span defaults. A vessel-level "crew planning" page (off-trip period rota, repositioning legs, owner trips with no guests) wraps it with calendar-week or operational-period defaults. Same component, different default contexts.

**A few subtle implications:**

- **The summary column** ("Total ahead · 59h on · Rest 73h / 77h") is *always* the rolling 7-day MLC window, regardless of what the grid shows. The MLC rule doesn't care whether the user is looking at trip span, calendar week, or something custom — the math always rolls back 7 days from today. Worth labelling the column header explicitly: *"MLC · rolling 7d"*.
- **A 12-day trip's grid** doesn't show MLC in a single column because the rolling 7d only covers part of the trip — but each *cell* still shows that day's compliance state, and the summary column shows today's rolling 7d position. Different data scopes.
- **An overrunning trip** (say a 14-day trip starting Friday last week) would show all 14 days in the Week view by default — the trip is the unit, not a 7-day window.

**Quick decisions before drawing:**

1. **Tick `✓` icon** as the "confirmed" state, replacing the `Logged` pill — yes?
2. **Default time window on trip pages = trip span** (embark → disembark), with `Trip | Past 7d | Custom` toggle?
3. **Summary column always labelled "MLC · rolling 7d"** to make the math window explicit, regardless of grid scope?

Once you confirm I'll redraw the Week view with:
- Trip-span columns (5 days for the Marchetti trip)
- The new toggle (Trip | Past 7d | Custom)
- The simplified glyph system (no glyph / `!` / `✓`)
- Off cells stripped of fake "24h rest"
- Summary column labelled rolling 7d

---

## Decision 12 (Session 2)

Three changes:

**1. The today line is now in the gap.** Friday's column has a 2px terracotta right-border. The line *is* the right edge of today's column, sitting in the seam between Day 3 and Day 4. The header cell for Day 3 also carries the right-border so the line runs the full grid height continuously. Cell content stays clean — no line cutting through the data.

**2. The 5-column grid is correctly trip-scoped.** The note in the toolbar reads *"5 cells = trip span · math reaches 7d back per cell · forecast cells dim past today"* — explicit about why the grid shows 5 days while the math uses 7. The `± 7d context` toggle expands to show the days before/after the trip, dimmed, when the captain wants to see the wider window.

**3. Wording locked.** Every "spare" or "short" line now reads `Xh rest · Yh spare/short`. Marco: *"88h rest · 11h spare"*. James: *"85h rest · 8h spare"*. Emma: *"63h rest · 14h short"*. Claire: *"71h rest · 6h short"*. Same vocabulary across the column.

A few quiet details:

- **The today edge runs through the header too**, so the line is unbroken from the day-label at the top down through the trajectory column. Reads as a single vertical seam, not a series of borders.
- **Forecast cells are still 72% opacity**, no extra decoration. Past cells solid, future cells dimmed, today's edge as the divider. Three states cleanly separated.
- **Day pills still use future-dim** for Saturday and Sunday, matching the cells. The whole future is dimmer.
- **"Worst on" labels stay** — they tell the captain which day in the visible window most needs attention, even if it's a future day. Useful for forward planning.

Land?

---

## Decision 13 (Session 2)

Locked.

The Trip Span rota view is final. Quick recap of what we now have:

**Today view** (single-day half-hour grid) — half-hour cells, hour labels, sticky crew column, sticky departments, three-line crew name labels with `Rest Xh | Past week Yh`, MLC alert triangle, hover row tinting, `Calendar | Operational` toggle (06:00–06:00 default), Today/Trip span/Hours of rest log buttons in the toolbar.

**Trip span view** (multi-day planning grid) — trip-scoped columns from embark to disembark, each cell showing hours + shift type + sub-type + rolling 7d at end of day, today edge marked by 2px terracotta vertical seam, forecast cells dimmed at 72% opacity past today, four cell states (compliant / violation / off-or-sick / + future variants), `!` pending review and `✓` confirmed/logged glyphs, trajectory column with five day-pills + worst-day readout, `Trip only / ± 7d context` toggle, `Hours of rest log` link.

**Per-crew rest panel** (clicked from a name) — auto-prose narrative banner, two summary cards (24h / 7d), 24h timeline with rest blocks shown, 7-day bar chart against MLC line, action buttons (Adjust shift / Log violation reason / Hours of rest log).

**Architecture** — single source of truth for shift records (trip and off-trip both write to it). Rolling 7d math always pulls from full record. Trip rota grid filters; math doesn't. Hours of rest log is the canonical audit document.

**Shift type taxonomy** — Duty / Watch (Anchor / Navigation / Engine / Lookout) / Standby (Maintenance / Tender / Support, all optional) / Training / Off / Sick.

**Permissions** — Command and Chief edit; HOD edits within their department; Crew read-only with submit-time-correction path.

**MLC math** — heavy projection. Every cell knows its own rolling 7d position; future cells project forward; edits ripple downstream; trajectory column shows the week's regulatory shape at a glance.

That's the rota system. Where next?

Page order so far:

1. ✅ Header
2. ✅ The route
3. ✅ What's coming up
4. ✅ Aboard for this trip (5-cabin layout)
5. ✅ Crew on this trip (header pill → rota drawer with Today / Trip span / rest panel / hours of rest log)
6. **Next: Provisioning** — linked-board summary
7. Memory — Last time / In Palma
8. Documents
9. Photos
10. The trip so far — activity log

Ready for **Provisioning**?

---

## Decision 14 (Session 2)

Locked. The math becomes the change, not the label.

So **`Past week 64h`** in the Today view becomes **`Past week 73h`** — same label, but the figure is now the rolling 7d *at end of today*, not the right-now snapshot. It matches Friday's cell figure in the Planning view.

Both views now show the same number for the same person on the same day:
- Today view name card: `Rest 8h 30m | Past week 73h`
- Planning view Friday cell for Claire: `7d rest 73h \u2193 short 4h`

Same math. Same number.

A few quiet things this locks in:

- **The `Rest Xh` figure stays real-time.** That's the 24-hour rolling rest right now — useful for "is she below 10h in this exact moment?" Today view's primary safety read.
- **The `Past week Xh` figure is now end-of-day projected.** It's what the rolling 7d will be by 23:59 today, given her actual past shifts and her remaining planned shifts for today. Captains plan against this projection, not the snapshot.
- **The MLC alert triangle next to the name** still triggers on the same daily rule (10h rest in 24h) — that doesn't change, because the daily MLC is a different rule from the weekly. Triangle = daily failure. The `Past week Xh` color treatment shows weekly failure separately.
- **When a shift is added or changed** mid-day in Today view, the `Past week` figure recalculates immediately — same way the Planning cells recalculate when forecast cells are edited. The math is the same engine, just rendered at different resolutions.
- **Edit ripple consistency.** If the captain edits Claire's evening shift in Today view, both her Today-view name card AND her Planning-view trajectory pills + cells should update. Same data layer, same math, two surfaces.

That's the rota fully locked. Ready for Provisioning?

---

## Decision 15 (Session 2)

Right — the per-crew rest panel is the third surface and it's been touched but not properly locked. Let me put it through the same alignment we just did with Today and Planning.

**The panel's job.** Slides in from the right when the captain clicks a crew name in either Today or Planning view. Single crew, deeper detail. Answers the "why is this person flagged, what's the full picture, what should I do?" question.

**What it has to show, given everything we've decided:**

- Identity strip (name, role, department, current MLC status pill)
- Compliance banner (full prose, the failing rule + by how much + remediation)
- 24-hour timeline (rest blocks vs duty blocks vs projections)
- 7-day bar chart (rolling 7d shape against MLC line)
- Action buttons (Adjust shift / Log violation reason / Hours of rest log)

**What needs alignment with everything we've locked:**

- Math has to use end-of-day rolling 7d, same as Today and Planning
- Shift type and sub-type need to surface (24h timeline should show duty/watch·anchor/standby·support not just generic "on duty")
- The `!` and `✓` glyphs from the rota carry through — pending corrections show as `!` chips in the timeline; logged violations as `✓` chips
- Compliance banner uses Cargo's editorial-warm voice, not legalese
- Trip-aware: if she's on a trip, the panel knows that — language reflects "this trip" vs "off trip"
- Past 7 days vs current trip: the 7-day chart pulls from full record (trip + off-trip), matching the rota math
- Hours of rest log link is the always-present audit-doc path

**A few questions before I draw:**

1. **Drawer width.** I'd argue 480-560px sliding from the right, leaving the rota visible behind it. Crew gets full attention without losing the trip context. Or do you want it as a full-page takeover?

2. **The 24-hour timeline strip.** Currently shows colored segments by activity type (rest/duty/projected). Should it also break out by shift type? E.g. a 12h duty block could visually subdivide into "8h duty + 4h watch·anchor" if that's how the day is structured. Or stay simple at the activity-level (rest vs on-duty vs scheduled) and surface shift types only on hover/click?

3. **Action buttons.** Currently three: Adjust shift / Log violation reason / Hours of rest log. Want to add anything? The captain might also want: *Submit me as cover* (swap with herself), *Send this rest summary to crew* (so the crew member knows their MLC status), or *Add note* (free-text annotation on the day).

4. **What replaces "Past week 64h" in this view?** The panel has more room than a small caps line. Probably a clear `Rolling 7-day rest: 73h / 77h required · 4h short by tonight` headline somewhere, plus the chart visualizing the day-by-day evolution we established.

5. **The rest panel should support the captain logging a violation reason directly from here.** That means the violation cell on the rota has two paths — click cell to drop into Today view at that time, OR click the crew name to open this panel and log a reason. Both routes converge on the canonical hours-of-rest log.

Want me to draw it with my best read of these, or want to weigh in first?

---

## Decision 16 (Session 2)

The full rest panel locked. A few specifics to flag:

**The card sits on a blurred + darkened backdrop.** The rota grid is still visible behind it but defocused — captain knows the trip context is still there, she's just zoomed in on Emma. Backdrop click would dismiss the card. The card itself has a 2px terracotta top-border + soft drop shadow, sized at ~880px max-width so it has breathing room without taking the full screen.

**Identity strip carries the new today-status line.** Below role and "on duty now until 22:00," there's a small caps line: *"Today · 7h rest so far · Past week ends at 63h"*. That's the explicit alignment with the rota math we locked in. *7h rest so far* = current 24h figure (real-time). *Past week ends at 63h* = end-of-day rolling 7d projection (matches the rota cell). Both numbers, both labelled, no ambiguity.

**Compliance banner unchanged from the locked version.** Lead serif sentence + plain-language rule + remediation deadline.

**24-hour timeline now carries shift-type sub-labels.** Each segment shows the activity-level label *and* a tiny italic sub-line: *"5h rest"* with *"22:30 yest — 03:30"* below; *"7h on duty"* with *"duty · service"* below; *"4h scheduled"* with *"duty · turn-down"*. The captain reads the activity at primary level, the type breakdown at secondary level. No segment subdivision, just descriptive overlay text.

**7-day chart is now MLC-honest.**
- 7 bars, one per day across the rolling 7d window ending today (or the day in question)
- Y-axis: 0h → 100h, with the 77h MLC line marked clearly with a dotted terracotta horizontal rule + a tiny caps label *"MLC 77h ÷ 7"* hanging off the right edge
- Each bar shows that day's *rolling 7d rest figure* — same number that appears in the planning view's cells. Wed bar reads 75h, Thu reads 68h, Fri (today) reads 63h, projected Sat reads 66h, projected Sun reads 79h
- Bars below 77h colored soft terracotta `#F5C9B8`, bars at-or-above colored sage `#C7DCC9`
- Bars where a violation has been logged carry the small `✓` glyph next to the number (Wed, Thu)
- Future projected bars are 72% opacity (matches forecast cells in the planning view)
- Today's bar has a 1px terracotta border so it's clearly "where we are"

**Action buttons now four:**
- *Adjust her shift* — primary ink button, takes captain into the editing mode (drops back into Today view focused on Emma's row at the relevant shift)
- *Log violation reason* — secondary outline, opens a small reason dialog (charter emergency / crew injury / unavoidable overrun / other)
- *Add note* — free-text annotation on this crew-day, surfaces in hours-of-rest log
- *Hours of rest log →* — pushed to the right, takes the captain to the canonical audit document filtered to Emma

**Footer note about crew visibility.** *"Once the rota is locked for tomorrow, Emma sees her next 24 hours and any pending corrections she's submitted. Crew receive their planned schedule automatically."* This handles your point about the crew side — once the captain finalizes the next day's plan (a "lock" action somewhere in the rota toolbar), the crew see it on their own surface, and crew time corrections funnel back through the `!` glyph system in the rota.

A few quiet design decisions worth flagging:

- **The chart's y-axis goes to 100h, not 110h or 120h.** That's the rolling 7d max (77h MLC + ~33h spare). Above 100h is rare; you'd be at 100% rest for a week. Capping the scale tightly makes the bar heights more meaningful.
- **The chart looks back 7 days, not 5 trip days.** Because rolling 7d math always rolls 7 days back from today. So Sat 26 Apr through Fri 1 May. The first two days are pre-trip. Honest about MLC timing rather than trip-bound.
- **The today bar (Fri) has its own visual flag** — 1px terracotta border around the track. The eye lands there first.
- **The two `✓` chips on Wed and Thu** carry through the rota glyph language. A captain looking at this chart sees which past violations have been logged and which (if any) haven't. Quiet but definitive audit signal.

Two things to consider for a next pass if you want them:

- **Should the panel show shift-type breakdown for the trip?** A small caps "This trip so far: 26h duty · 8h watch · 6h standby" line. Useful for trip-end reporting; might be too much for this surface.
- **Should there be a "Ping crew" button** to send Emma a manual nudge (e.g., "captain wants you to take the next 4h off")? Or does that live in the broader crew-communication system rather than this specific MLC-driven panel?

Land?

---

## Decision 17 (Session 2)

Good catches. Let me work through each before redrawing.

**1. Blurred background — locked.** ✓

**2. Inline labels.** *"Today · 7h rest so far · Past week 63h"* — drop the "ends at," keep "so far" on rest, simplify "past week" to no qualifier. Cleaner.

**3. The 24-hour timeline is genuinely broken.** Looking at it again — I had segments adding up to a *48-hour* span (yesterday 18:30 → tomorrow 18:30) but called it "Last 24 hours." That's just wrong.

If it's "Last 24 hours" the strip is **18:30 yesterday → 18:30 today (now)**. The "now" line should sit at the *right edge*, not the middle. No "tomorrow." And the segments need to fit inside that 24h window honestly.

If we want to *include* the next few scheduled hours (so the captain sees what's about to happen), the strip becomes **"Last 24 hours + next 12 hours" = 36-hour window**. Different scope, different label.

I'd argue the more useful one is the 36-hour version — the captain wants to see "where she's been + what's coming." But it has to be labeled honestly. Let me redraw with that scope and clearer labels.

**4. The y-axis on the 7-day chart was confusing.** "0h to 100h" labeled as the bar's value isn't clear. Each bar is *that day's rolling 7d rest figure* (a number between, say, 50h and 100h). The y-axis should be *the rolling 7d rest scale* with 77h as the MLC line. Probably cleaner to label it "Rolling 7d rest hours" or strip the y-axis entirely and let each bar's number speak for itself. I'll go with a clear axis label.

**5. Pull from on-trip + off-trip — locked.** Math reaches across boundaries. ✓

**6. Today bar flag invisible.** A 1px terracotta border on a soft-pink bar is too subtle. Bigger move needed: add a "today" label on top of the bar, or use a deeper terracotta border, or place the bar against a tinted column background.

**7. Scroll broken.** I'll fix.

**8. Trip insights — yes.** A small section showing this trip's shift-type breakdown for this crew member: *"This trip so far · 26h duty · 8h watch · 6h standby"*. Useful at trip-end for reviewing patterns and gives the captain context.

**9. No ping crew button.** ✓

Let me redraw.

---

## Decision 18 (Session 2)

Eight things addressed.

**1. Backdrop blur, locked.** Same as before.

**2. Identity line.** Now reads `Today · 7h rest so far · Past week 63h`. No "ends at," no qualifier on past week. Both terracotta-tinted to match the warning state.

**3. The 24-hour timeline now adds up to 24 hours.** Strip header explicitly says *"Last 24 hours · 18:30 yesterday → now"*. The "now" line sits at the right edge of the strip. Five honest segments adding to 24h:
- 4h off-duty (18:30 → 22:30 yesterday)
- 5h continuous rest (22:30 yesterday → 03:30)
- 4h on duty (early service)
- 2h continuous rest
- 9h on duty (current shift, still on)

Two timestamps below the strip: *"18:30 yesterday"* on the left and *"↑ now (18:30 today)"* on the right. No "tomorrow" anywhere. The strip is honest about its window.

**4. Y-axis label.** The y-axis column on the chart now reads *"100h rest"* at top, *"77h MLC"* in terracotta middle (the line itself), and *"0h"* at bottom. A small italic explainer line below the title says *"y-axis is the rolling 7-day rest figure on each day · MLC requires 77h or more"*. Clear what the bars are measuring.

**5. 7-day window pulling from on-trip + off-trip — locked.** Bars Sat 26 Apr through Fri today are 7 consecutive days. The first two bars (Sat–Sun) are pre-trip days, pulled from off-trip vessel records. The next four (Wed–Sat) are trip days. The seventh is today. Math reaches across the boundary cleanly.

**6. Today bar is now visibly flagged.**
- 1.5px terracotta border around the track
- 3px terracotta-soft halo around the border (`box-shadow: 0 0 0 3px #FAECE7`)
- Slightly tinted background `#FFFCFA`
- A small caps "Today" label sitting at the top of the track in terracotta
- Day label below the bar in terracotta with weight 600

The eye lands there immediately.

**7. Scroll** — the issue was probably the panel was `position: absolute` inside an `overflow: hidden` parent. I removed the overflow constraint and the backdrop is now tall enough (`min-height: 920px`) to contain the entire panel without clipping. Should scroll within the chat now.

**8. Trip insights section added.** Sits between the 7-day chart and the action buttons:

- Header: *"This trip so far · day 3 of 5"* in caps + serif lead line *"Emma has worked 41 hours across the first three days of the Marchetti charter."*
- Four stats cards in a row:
  - **29h Duty** — 71% of her trip work
  - **8h Standby · support** — 19%, scheduled forward
  - **4h Watch · anchor** — 10%, overnight cover
  - **2 Logged violations** — terracotta tinted card, Wed + Thu, acknowledged

Reads as the trip-end snapshot. Captain knows what kind of work Emma's been doing and how the violations sit.

A few quiet details:

- **The "8h Standby · support" + "4h Watch · anchor"** demonstrate the shift-type taxonomy in real numbers. If she'd never done a watch, that card wouldn't appear (or would show 0h). The trip insights surfaces show *all* shift types this person has worked across the trip.
- **The "logged violations" card** uses the terracotta soft fill to flag itself visually. The number `2` is in deep terracotta. The sub-text confirms which days they were and that they're acknowledged.
- **No "Logged ✓" on today's bar** because today's day isn't done yet — the violation isn't loggable until the day closes. The bar is still terracotta because the rolling 7d will fail at end of day.
- **Footer note unchanged** — describes the crew-side visibility and correction flow.

Land?

---

## Decision 19 (Session 2)

Two changes locked.

**1. Bar heights now constant.** I rebuilt the chart so each `bar-track-wrap` is a vertical flex column with the bar track as a fixed 120px element on top and the day label below in its own row that can grow as needed. The Wed bar's label *"Wed · 30 Apr · violation logged with reason"* now wraps onto two lines without compressing the bar above it. The whole row of bars sits at the same height; only the labels below vary in row height. The chart's visual integrity holds.

(I also extended the Wed and Thu labels to demonstrate the wrap behavior — *"Wed · 30 Apr · violation logged with reason"* and *"Thu · 1 May"* both go terracotta to match their `✓` violation-logged state.)

**2. Worth considering — the planning assistant section.** A new module sits between Trip insights and the action buttons, with two suggestions:

**Suggestion 1 (Confident swap):**
- Header: *"Move Emma's Saturday 8h standby · support to Marco."*
- Reasoning: *"Marco has 19h spare across the rolling week and is qualified to cover bridge support for the same overnight window. Emma takes the day clear, recovers fully by Sunday."*
- Two effect cards side by side showing Emma's projected change (63h → 79h ✓) and Marco's projected change (96h → 88h ✓), both compliant
- Two buttons: *"Apply this swap"* (primary ink) and *"Preview on rota"* (secondary outline)
- Sage-deep left border indicates confident
- Sage *"Confident swap"* pill at top

**Suggestion 2 (Needs your judgment):**
- Header: *"Extend Emma's Sunday off back into Saturday afternoon — 4h reduction."*
- Reasoning explains the trade-off: *"Saturday afternoon turn-down service currently runs Emma — needs reassigning to Claire (8h short herself) or Sophie (laundry, full week). Lighter cover but not zero."*
- Two effect cards: Emma's projected change (63h → 73h ✓ just compliant) and a coverage-gap card flagging *"Saturday turn-down · Needs reassignment"* in terracotta
- Two buttons: *"Reassign & apply"* and *"Preview on rota"*
- Soft taupe left border indicates judgment-required
- *"Needs your judgment"* pill at top

Both suggestion cards use editorial-warm voice — the lead line in DM Serif Display, the reasoning in Plus Jakarta Sans body. *"Worth considering"* as the section title rather than something clinical like "Recommendations" or "Optimization."

A small footnote line at the bottom of the section: *"Suggestions weigh MLC compliance against guest service coverage and crew qualifications. Why these two?"* — the *"Why these two?"* link opens an explanation of how the system arrived at these specific suggestions.

A few details worth noting:

- **Effect cards always show both crew members affected** (Emma + Marco for swap 1, Emma + the coverage gap for swap 2). The captain sees both sides of every trade-off.
- **Color-coded changes** — old number in current state color, arrow in muted, new number in projected state color. Reading "63h → 79h ✓" tells the story instantly.
- **Preview on rota** is a soft button — the captain can see the swap applied visually in the rota without committing. The visual preview ripples through all cells affected. If she likes it, she clicks Apply. If not, she dismisses and returns to the panel.
- **The suggestions are conservative.** Only swaps that mechanically work without breaking coverage. The captain isn't shown 12 marginal options; she's shown 2 that solve the problem.
- **The "judgment" suggestion is honest about its trade-off** — it solves Emma's compliance but creates a coverage gap that needs reassignment. The system doesn't pretend the swap is free.

Three small things to flag for next pass:

- **The coverage-role metadata problem** I mentioned earlier is genuinely a sprint dependency. To make these suggestions, every shift needs to know what role it's covering — *"Saturday afternoon turn-down service"* not just *"duty 4h."* That's a richer shift model. Worth adding to your backlog as a precursor sprint.
- **The "Why these two?" explainer link** is doing real work — gives the captain a path to trust the system. *"Why not Sophie? Why not James?"* In v1, the explainer could surface the constraint check: *"Sophie is laundry-only, can't cover bridge support. James is deck-qualified but already at 47h on with watches scheduled, swap would take him over the line."*
- **Preview affordance.** The "Preview on rota" button is the trust bridge. Even confident swaps should be preview-able. The captain doesn't apply blindly — she sees the swap rendered in the rota first.

Land?

---

## Decision 20 (Session 2)

Fair point — I was using Emma to demonstrate all the visual states (daily MLC failure + weekly failure + logged violations + pending corrections + standby and watch shifts) so you could see the full visual vocabulary in one panel. I conflated the demo's job with operational realism.

For the locked design, two principles:

**1. The timeline strip is two-state.** Just on-duty (ink) and rest (sage). No phantom "off-duty not rest" category. Honest to the data model.

**2. Demo crew vs real crew.** Emma's story was a teaching example. In production, the panel narrative is generated from actual data — if a crew member only fails weekly, the banner reflects that; if they fail daily, it reflects that; if both, both. The system writes the prose against whichever rules are actually breaking.

For your design lock, I'd suggest keeping Emma as the demo example but reshaping her data so the violation she shows is *internally consistent*:

**Option A.** Emma fails *daily* MLC. Her 24h shows: 5h rest + on-duty + 2h rest + on-duty + projected. Total rest 7h (below 10h), longest block 5h (below 6h). Banner reads as I wrote it. *Two short blocks* is the actual story.

**Option B.** Emma fails *weekly only*. Her 24h shows: 9h rest + on-duty + 2h rest + on-duty. Total rest 11h ✓ daily, but rolling 7d at 63h fails weekly. Banner reframes: *"Last 24 hours met daily MLC. Cumulative rest across the rolling 7 days is 14h short of 77h required."*

**Option C.** Emma fails *both*. 6h rest + on-duty + 1h rest + on-duty. Total 7h, longest 6h (just at the line). And rolling 7d at 63h. Banner names both rules failing.

I'd argue **Option C** is best for the demo because it shows the most surface area — both rules failing, both being explained, both visible in the timeline. That's the worst-case panel state, which is what the captain really needs the panel to handle.

Want me to lock with Option C and redraw with the corrected two-state timeline?

---

## Decision 21 (Session 3)

Fair point — I was using Emma to demonstrate all the visual states (daily MLC failure + weekly failure + logged violations + pending corrections + standby and watch shifts) so you could see the full visual vocabulary in one panel. I conflated the demo's job with operational realism.

For the locked design, two principles:

**1. The timeline strip is two-state.** Just on-duty (ink) and rest (sage). No phantom "off-duty not rest" category. Honest to the data model.

**2. Demo crew vs real crew.** Emma's story was a teaching example. In production, the panel narrative is generated from actual data — if a crew member only fails weekly, the banner reflects that; if they fail daily, it reflects that; if both, both. The system writes the prose against whichever rules are actually breaking.

For your design lock, I'd suggest keeping Emma as the demo example but reshaping her data so the violation she shows is *internally consistent*:

**Option A.** Emma fails *daily* MLC. Her 24h shows: 5h rest + on-duty + 2h rest + on-duty + projected. Total rest 7h (below 10h), longest block 5h (below 6h). Banner reads as I wrote it. *Two short blocks* is the actual story.

**Option B.** Emma fails *weekly only*. Her 24h shows: 9h rest + on-duty + 2h rest + on-duty. Total rest 11h ✓ daily, but rolling 7d at 63h fails weekly. Banner reframes: *"Last 24 hours met daily MLC. Cumulative rest across the rolling 7 days is 14h short of 77h required."*

**Option C.** Emma fails *both*. 6h rest + on-duty + 1h rest + on-duty. Total 7h, longest 6h (just at the line). And rolling 7d at 63h. Banner names both rules failing.

I'd argue **Option C** is best for the demo because it shows the most surface area — both rules failing, both being explained, both visible in the timeline. That's the worst-case panel state, which is what the captain really needs the panel to handle.

Want me to lock with Option C and redraw with the corrected two-state timeline?

---

## Decision 22 (Session 3)

Locked. The full rota system is done.

**The three surfaces:**

1. **Today view** — half-hour grid, sticky crew column, three-line crew names with `Rest Xh | Past week Yh`, MLC alert triangle, hover row tinting, `Calendar | Operational` toggle (06:00 default).

2. **Trip span view** — trip-scoped columns, each cell carries hours + shift type/sub-type + rolling 7d state with directional arrow, today-edge as 2px terracotta vertical seam, future cells at 72% opacity, four cell states, `!` pending and `✓` confirmed glyphs, trajectory column with five day-pills + worst-day text readout, `Trip only / ± 7d context` toggle.

3. **Per-crew rest panel** — large card on blurred backdrop, identity strip with today/past-week status line, compliance banner with full-prose narrative, two-state 24h timeline, 7-day rolling rest bar chart with constant heights and 77h MLC line, trip insights with shift-type breakdown, *"Worth considering"* swap suggestions in two confidence levels, four action buttons.

**Data architecture:**

- Single canonical crew shift record table — both trip and off-trip shifts write here
- Rolling 7d math always pulls from full record, ignoring boundaries
- All views use end-of-day rolling 7d for consistency
- Hours of rest log = unfiltered chronological per-crew, the canonical audit doc
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

**The MLC math is HEAVY:**

- Every cell calculated against rolling 7d at end-of-that-day
- Forecast cells project forward using actual past + planned future
- Edits ripple downstream
- Trajectory shows the regulatory shape of the visible window

**Backlog parked for next sprint:**

- Coverage role metadata on shifts (precursor for swap suggestions to know what work needs covering)
- "Apply this swap" mechanism with rota preview affordance
- "Why these two?" suggestion explainer
- Crew-side rota visibility surface (separate page when rota is locked)
- Time-correction submission flow on crew side

That's the rota system fully designed.

Page order so far:

1. ✅ Header
2. ✅ The route
3. ✅ What's coming up
4. ✅ Aboard for this trip (5-cabin layout, deck-stacked)
5. ✅ Crew on this trip (header pill → rota drawer with three surfaces)
6. **Next: Provisioning** — linked-board summary
7. Memory — Last time / In Palma
8. Documents
9. Photos
10. The trip so far — activity log

Ready to move on to **Provisioning**, or want to take a break and come back to it?

---

## Decision 23 (Session 3)

Got it — keep the rich detail, just don't put it all on the trip page. The trip page gets a *glance*; the workspace shows the *full scope*. The earlier-version detail (aggregate strip + per-board cards with progress meters and stat rows) can live as the expanded state when someone wants to see more.

Two ways to handle the expansion:

**A. Inline expand.** A "Show details" toggle on the section reveals the aggregate strip + the richer board cards inline, pushing the rest of the page down. Same surface, more content.

**B. Click-through to a trip-specific provisioning view.** The trip page shows the glance. Clicking *"Open workspace →"* or any board takes you to `/provisioning?trip=marchetti` — the full kanban workspace pre-filtered to this trip's boards. That's where the rich detail lives.

I'd argue **B is cleaner** because the workspace already has the rich kanban detail (it's a deep feature). Duplicating it inline on the trip page would create two surfaces showing the same thing, which is the busyness problem in another form.

So the trip page provisioning section stays as the simplified list version we just locked. Clicking the workspace link or any board row takes the chief stew to the existing `/provisioning` view filtered to this trip — where they get all the detail (kanban columns, progress, full item lists, supplier portal status, smart delivery tier 1/2/3, etc).

What we *might* want to add to the simplified list version, since you liked the items/spent/delivered idea but lighter:

The right-aligned column already shows `\u00a32,180` + `36 / 42 in` (delivered out of total). That's two of the three stats. We could leave it there — the third stat (item count, e.g. "42 items") is already implied by the "36 / 42 in" denominator.

Or, on hover, each row could reveal a small expanded preview without full click-through — like an inline tooltip showing the three-stat row and a thin progress meter. That gives the chief stew a quick peek without leaving the trip page, but full detail still requires opening the workspace.

Three quick things to settle:

**1. Lock the simplified list as the trip-page version?** The version I just drew, with the alert banner and spend/delivery column on the right.

**2. The full workspace at `/provisioning?trip=marchetti`** is where the rich detail lives — assume the existing workspace handles this with a trip filter applied?

**3. Hover preview on rows?** Quick three-stat reveal on hover, or just rely on click-through to the workspace? I'd lean *no* — keeps the simplified list simple. If they want detail, they click.

Want me to draw anything else for provisioning, or is this section locked as the simplified list?

---

## Decision 24 (Session 3)

Right, let me show you the simplified version locked as the trip-page section, and demonstrate what clicking through reveals — but the click-through is just the existing workspace at `/provisioning` filtered to this trip. Since that workspace exists already in the codebase, what I'll show is: (1) the trip-page section as it stands, and (2) a sketch of what the filtered workspace view *looks like* at the top to confirm the navigation handoff is right.

---

## Decision 25 (Session 3)

Two surfaces side by side, showing the navigation handoff:

**Top — the trip-page glance** (locked from before).
- Meta line carries the trip totals: *"4 boards · \u00a35,420 spent of \u00a38,000"*
- Alert banner if anything needs attention
- Four list rows with stripe + title + contextual story + spend column
- Three CTAs at the bottom: Add a board / Open workspace / History

This sits inside the trip page as a clean, low-density section. The chief stew can scan it in one second and know whether everything's on track.

**Bottom — the existing workspace, filtered** (sketched to confirm the handoff).
- URL: `/provisioning?trip=marchetti`
- Filter chip at the top: *"Filtered to: Marchetti charter ×"* — clicking the × removes the filter and shows all vessel boards across all trips
- The existing 4-column kanban (To order / Ordered / Awaiting / Aboard) shows actual items grouped by their state
- All the workspace's existing controls — add items, drag between columns, supplier portal, return slips, smart delivery tier 1/2/3 — live here
- The trip-page summary numbers (`53 / 68 in` for galley) come *from* this workspace's data, just aggregated

A few things worth flagging:

- **The trip page never duplicates workspace functionality.** It summarises and points outward. All the rich kanban interaction lives in `/provisioning`, just filtered.
- **The filter chip pattern** is borrowed from common SaaS, but tinted in the Cargo terracotta-soft so it feels native. Click the × to widen scope back to the whole vessel.
- **The "Aboard" column shows muted cards** because they're done — same fade pattern as completed boards on the trip page. Visual continuity between summary and detail.
- **The Casa Bianca linens card carries the warning state** all the way through — terracotta tinted, deep terracotta context. Same color vocabulary as the trip page board row, so the chief stew sees the same problem in two places without re-learning what it means.

A small note on the workspace mock: I drew it as a sketch to confirm the navigation handoff makes sense. The actual workspace at `/provisioning` already exists in your codebase with all its real features (kanban, smart delivery, supplier portal, etc.). What this view shows is just what *adding the trip filter* would look like at the top — the filter chip is the only new piece.

Land?

---

## Decision 26 (Session 3)

Hybrid locked.

What stayed:
- **Aggregate strip at the top** — four cells in a row: Trip spend (with budget bar) / Items provisioned / Outstanding deliveries (warn) / Returns to confirm (warn). The terracotta tint on the warning cells still works as the at-a-glance "trouble lives here" signal.
- **2x2 board card grid** — colored left stripe, title, department, stat row, contextual footer.
- **The contextual footer per card** — that one-line story about what's happening.

What got dropped from each card:
- **Status pill** — the colored stripe + the contextual footer carry the state more honestly. The pill was redundant.
- **Progress meter** — "36 / 42 delivered" already tells you completion as a fraction. The bar was decorative.

What's left per card: stripe + title + dept + stat row + footer. Five elements, breathable. The cards now have *room* — the stat row is bordered top and bottom giving it weight as the central data, the footer floats below it with the contextual story, and the title sits at the top with the department.

A few quiet things:

- **The stat row's borders top + bottom** make it feel anchored in the card, like a small data panel within. Reads more clearly than the unbordered version.
- **The contextual footer is the editorial layer.** Each card has its own one-liner — *"Linen delivery from Casa Bianca overdue · expected yesterday"* (terracotta), *"2 deliveries due today · Iberica Foods + Bodegas Sevilla"* (default), *"Florist booked for Friday morning · 3 bouquets · \u20ac180"*, *"All items aboard · closed Tuesday by James"* (italic, muted).
- **The closed deck card** uses a footer in italic muted grey — visually de-emphasised because it's done.
- **The View workspace button moved to the section header** (top right). Feels native to the section rather than an action at the bottom.
- **Three CTAs at the bottom** — the primary "+ Add a board for this trip", "View all trip provisioning →" (filtered workspace), "Provisioning history →" (closed boards).

This balances the rich aggregate detail (which serves command/chief at a glance) with calmer per-card detail (which lets the eye breathe). The cards aren't competing with the strip anymore.

Land?

---

## Decision 27 (Session 3)

Worth thinking about before we close this section. Let me walk through what's potentially missing — some of these will land, some won't.

**Things worth considering:**

**1. Cross-board item dependencies.** Sometimes one board's items depend on another's. The Marchetti welcome basket needs the galley's wine arriving Friday morning *before* Claire can finish setting up the cabin. Currently each board lives in isolation. A small "depends on" link between boards (or between specific items) could surface the right ordering.

For the summary card: a small chain icon next to the welcome basket card if it's blocked waiting on another board's delivery. *"Waiting on galley · Iberica delivery."*

**2. Last activity timestamp.** Each board card could show when the most recent change happened — *"Updated 2h ago by Anders"*. Useful for command/chief to see what's moving and what's stale. A board that hasn't moved in 3 days might need a nudge.

**3. Linked guest preferences / dietary signals.** If the trip has guests with allergies or strong preferences, the relevant boards could surface those connections. A small *"3 dietary signals applied"* indicator on the galley board, clickable to see what's been adapted. Connects to your existing dietary system.

**4. Storage location signal.** Where things go on the boat once aboard. The interior board might say "84% allocated to storage locations · 6 items unallocated." Useful when a chief stew is handing off to another crew member who needs to know where to find the lemon zester. Probably out of scope for this summary card, but worth flagging that the workspace might want it.

**5. Supplier risk indicators.** Casa Bianca being late once is a one-off. Casa Bianca being late on every charter for the last six months is a pattern. A small recurring-issue flag on a board could surface: *"Casa Bianca · 3rd late delivery this season."* Actionable — the captain might switch suppliers. Probably v2.

**6. Carry-over items.** When a charter ends, some items get used up; some are restocked from inventory; some get carried forward to the next trip. A board that's "Closed" might still have items that fed into future trips — a small *"12 items carried to next charter"* signal. Useful for stock continuity.

**7. Trip-end provisioning summary.** When the trip ends, this card could shift to a retrospective mode: *"5,420 spent · 142 items provisioned · 3 logged supplier issues · 12 items carried forward."* A small handoff from operational to historical. Could happen automatically when the trip is sealed.

**8. AI insights button.** Cargo already has AI-generated insights elsewhere. A small "Insights" link on this section could surface things like *"Galley spend is 18% above similar charter average — Bodegas wine selection running heavy."* Pattern-recognition stuff. Definitely v2.

**9. Provisioning calendar overlay.** Not a card feature, but: this section could integrate with the trip's "What's coming up" widget. Casa Bianca delivery shows up there too. Currently those widgets live separately. A subtle linkage — clicking an upcoming delivery in the calendar opens the relevant board card here. The data already supports it; just needs UI plumbing.

**10. Quick-add items inline.** A small "+" button on each card that lets the chief stew add a new item without opening the workspace. Useful for last-minute additions: *"+ Add item to galley"*. Costs a popover but keeps the trip page useful for quick edits.

**11. Department spend breakdown.** The trip spend total (\u00a35,420) doesn't tell you which department is heavy. A small bar showing how that \u00a35,420 splits across departments (Interior \u00a32,180 / Galley \u00a32,640 / Charter-specific \u00a3420 / Deck \u00a3180). Helps command see at a glance whether one department is overspending. Could live in an expanded state of the spend block.

**12. Approval flow for over-budget boards.** If a board's spend would push the trip over its \u00a38,000 budget, command needs to approve. Currently there's no flag for this. A small "Approval needed" indicator on a board that's pushed past a threshold. Operationally important — accidentally going \u00a32k over budget on a charter creates real friction with owner's reps.

**My honest read on what should be in v1:**

Worth adding now:
- **Last activity timestamp** on each card — quick win, low cost
- **Cross-board dependencies** with a small chain icon — operational value, not too noisy
- **Department spend breakdown** in the spend block (could be a hover/click reveal so it doesn't clutter the default view)

Defer to v2:
- AI insights
- Supplier risk indicators
- Carry-over items
- Approval flow

Probably belongs in workspace, not summary:
- Storage locations
- Quick-add inline (the workspace handles this; trip page should point there)

Already exists or is being built:
- Linked dietary signals (your existing system)
- Calendar overlay (data integration, not new UI)

**Two things I'd actually recommend adding to the summary card:**

1. **A `Last activity` line in each card's meta row** — *"Interior · Claire · Updated 2h ago"*. Tiny addition, big informational value. Tells you which boards are alive vs stale at a glance.

2. **Department spend split** revealed via clicking the spend block. The default view stays clean, but expanding it shows the breakdown. Useful for command without polluting chief's view of the spend headline.

Want me to draw these two additions into the locked card?

---

## Decision 28 (Session 3)

Locked. So provisioning v1 includes:

**Active:**
- Aggregate strip (Trip spend with budget bar / Items aboard / Outstanding / Returns)
- Folder tabs (All / Needs attention / Live / Closed) with counts
- Board cards with stripe + title + status pill + meta + figures + contextual story
- Permissions: department-default + collaborator override + read-only fallback
- Cross-board dependencies (chain icon, *"Waiting on galley · Iberica"*)
- Last activity timestamp on each card (*"Updated 2h ago by Anders"*)
- Linked dietary signals visible on relevant boards (*"3 dietary signals applied"*)
- Trip-end retrospective mode (when trip seals, card shifts to historical summary)
- Provisioning calendar overlay (deliveries surface in "What's coming up")

**Deferred to v2:**
- Supplier risk indicators (Casa Bianca pattern flagging)
- Carry-over items between trips
- AI insights button
- Approval flow for over-budget boards
- Department spend breakdown
- Storage location signal (workspace, not summary)
- Quick-add inline (workspace handles this)

**Three new things to draw into the card:**
- Cross-board dependency chain icon (welcome basket → galley)
- Last activity timestamp on each card
- Linked dietary signals indicator on galley + welcome basket boards

Do you want me to redraw the dossier with these three additions woven in, or move on to the next section?

---

## Decision 29 (Session 3)

Locked.

**Provisioning section — final state:**

**v1 ships:**
- Aggregate strip: spend block (with hover-to-expand department breakdown) + three stat cells (items / outstanding / returns)
- Folder tabs: All / Needs attention / Live / Closed with count chips
- Board rows with 6px tab marker, status pill, meta row (owner + last activity + collaborators), contextual story, three-figure panel
- Permissions: department-default + collaborator override + read-only fallback
- Cross-board dependencies (chain icon, *"Waiting on galley · Iberica"*)
- Last activity timestamp on each card
- Linked dietary signals indicator on relevant boards

**v2 layers in:**
- AI insights strip below summary
- Supplier risk indicators (*"3rd late this season"*)
- Carry-over items count on closed boards
- Approval flow for over-budget boards (deep-ink stripe + Approval needed pill)
- Department spend breakdown in the expanded spend block

**Architecture parked:**
- Workspace at `/provisioning?trip=marchetti` (existing kanban + filter chip)
- Provisioning calendar overlay (deliveries surface in "What's coming up")
- Trip-end retrospective mode (when trip seals, card shifts to historical summary)

Page order:

1. ✅ Header
2. ✅ The route
3. ✅ What's coming up
4. ✅ Aboard for this trip
5. ✅ Crew on this trip (rota: Today / Trip span / rest panel)
6. ✅ Provisioning
7. **Next: Memory** — three pools (Last time / In Palma / From the archive)
8. Documents
9. Photos
10. The trip so far — activity log

Ready for **Memory**, or want to take a break?

---

## Decision 30 (Session 3)

Locked direction.

So the memory section uses **Option M** as the structural pattern: each note is a card with a cream title bar at the top showing the pool name on the left and the source line on the right, with the editorial body sitting in white below.

A few things to think through before drawing the final version:

**1. The source line content per pool.** The bylines should consistently answer "where does this come from":
- **Last time** → date + location (*"Aug 2024 · C\u00f4te d'Azur"*)
- **In Palma** → frequency (*"across 6 visits"*) or specific date
- **From the archive** → number of similar trips (*"2 similar charters"*) or pattern strength

**2. Pool name styling in the title bar.** Right now Option M shows the pool name in tracked caps. Worth keeping that — it's the consistent treatment across the page (rota header, provisioning aggregate cells all use tracked caps for labels).

**3. Hover/click affordance.** Each card opens to either the full memory entry (with editing affordances) or pivots to the pool view in the archive. Probably opening to a small expansion in place, with archive being a separate destination.

**4. Number of cards.** We had three for the demo. For real use, the system surfaces 2-3 by default — could be 1 (very calm day, only one relevant memory), could be 4 (many relevant patterns). Worth being flexible with the count.

**5. Dismissable/pin-confirm actions.** AI-noticed entries should still have *"Confirm pattern ✓ / Not relevant"* affordances, but maybe smaller and less prominent than they were in the busy version. Could be a small icon row in the bottom-right of the body when relevant.

**6. The "add a memory" pattern.** From the busy version we had an inline pin input. Worth having that elsewhere — a small "+ Pin a memory" button at the bottom of the section, or maybe just in the archive page. Trip page might just be reading; pinning lives elsewhere.

Want me to draw the final version with these specifics, or settle anything first?

---

## Decision 31 (Session 3)

Good catch. You're right that preferences themselves are a separate feature with its own scope (interior-focused: dietary, drinks, allergies, room temp, music, etc.). Memory in the context of the trip page has to be broader — it serves *all departments*, and preferences are one input among several.

Let me think this through honestly.

**What preferences actually are.**

A *preference* is a fact about a guest's tastes or needs. Lives on the guest's profile. Travels with the guest from trip to trip. Auto-applies to relevant boards (dietary signals on galley, allergy chips on cabin cards, etc.). Mostly interior-facing because the interior team handles guest-direct service. Already wired into multiple existing features (allergy chips on cabin cards, dietary signals on provisioning boards, etc).

**What memory actually is.**

Memory is *institutional knowledge across all departments*. Some of it is preference-derived ("Mr Marchetti drinks Fernet Branca after dinner") but much of it isn't:

- **Deck memory** — anchorage holding, weather quirks, bridge approach notes, tender drop locations, port pilot tips
- **Galley memory** — supplier patterns, market timing, local source quality, regional ingredient availability
- **Engineering memory** — generator quirks at this anchorage, fuel quality at this port, water-maker performance in these conditions
- **Interior memory** — guest preferences, but also crew shift patterns that worked, service rhythms that suited specific principals, things that didn't work and why
- **Cross-department memory** — how previous charters with this booking agent went, broker communication patterns, what to expect from owner reps

So memory has a broader job than preferences. **Preferences feed into memory** but memory contains other things too.

**Where they overlap and where they don't.**

- A guest's allergies (preferences feature) → memory pulls them into "Last time" notes when relevant ("Mrs Marchetti's rosemary migraine — used in master cabin scenting last summer, caused issues")
- An anchorage holding tip (deck-only memory) → not a preference at all, never enters the preferences feature
- A supplier reliability pattern (galley/interior shared) → not a preference, lives only in memory
- A guest's morning routine (preference) → can be expressed as a preference and *also* as a memory note about how the routine went last trip

**The clean separation:**

- **Preferences** = structured data on the guest profile. Editable in the guest's record. Auto-applies to relevant boards. Interior-led. Becomes memory entries naturally for "Last time" pool when guest returns.
- **Memory** = unstructured editorial knowledge. Pinned by any department. Multi-department. Lives independently of guest profiles. Includes preferences-derived notes plus everything else.

**On the trip page:**

The memory section *should* show notes from all departments, not just interior. The Casa Bianca example is interior + galley territory (linens). But equally valuable would be:

- *"In Palma — the harbour pilot at Club de Mar speaks no English; Anders or James needed for radio. Captain has a list."* (deck/captain)
- *"From the archive — generators run hot at low load when ambient is above 28\u00b0C; Pavel adjusts the load schedule."* (engineering)
- *"Last time — Mr Marchetti's son James (15) was given supervised tender driving lessons by James the bosun, hugely successful, repeat if appropriate this trip."* (deck + interior)

So the chief stew opening this trip page should *not* be the only person served by memory. The captain, head chef, chief engineer, and bosun should all see relevant notes from their domains.

**Permissions question:**

Should memory be filtered by department for non-command users? Or shown all together?

I'd argue **shown all together for HODs**, because cross-department awareness is part of how a yacht runs well. The chief stew benefits from knowing the deck's anchorage notes; the captain benefits from knowing the chief stew's guest service patterns. But the system might *prioritize* the most relevant 2-3 notes for the viewer's role:
- Chief stew opens trip page → memory shows interior-leaning + cross-department notes
- Captain opens trip page → memory shows command-leaning + cross-department notes
- Chief engineer opens trip page → memory shows engineering-leaning + cross-department notes

Same data pool. Different *prioritization*. The "see all memory →" link goes to the unfiltered archive.

**Implication for what we just locked:**

The three-card memory pattern stays as drawn, but the *content* should be more honest about being multi-department. Casa Bianca (linens, interior+galley) is fine; the Fernet Branca example is fine but interior-flavored. The Cap de Formentor example is service-flavored.

For a balanced demo, the three cards could be:

- **Last time** — *Mr Marchetti drinks Fernet Branca after dinner. Always neat, no ice.* (interior)
- **In Palma** — *Casa Bianca's linens late on 3 of last 6. Worth a call.* (interior + galley)
- **From the archive** — *Generators run hot at low load above 28\u00b0C ambient. Pavel adjusts the load schedule.* (engineering)

Or if you want to make it even more multi-department:

- **Last time** (deck) — *The Marchettis prefer overnight passages over long anchorages — three of four prior trips ran this way.*
- **In Palma** (interior+galley) — *Casa Bianca's linens late on 3 of last 6.*
- **From the archive** (cross-department) — *Two prior charters with this itinerary asked for a sunset dinner at Cap de Formentor — worth offering.*

**Two questions before we move on:**

1. **Are you comfortable with memory being a separate feature from preferences**, with its own data model (unstructured notes pinned by any department), even though some entries will overlap?
2. **Should the surfaced memories prioritize by viewer's role** (chief stew sees interior-leaning, bosun sees deck-leaning) but with cross-department visibility through the archive?

Want me to redraw the cards with multi-department content so the demo is honest about memory's scope?

---

## Decision 32 (Session 3)

Yes — that's much more honest about how this would actually be used in practice. People don't tag things consistently. The system has to do the work.

**The flow:**

1. Crew member pins a memory: types/dictates a free-text note. *"Casa Bianca's linens late again — third time this season."*
2. AI (Claude / similar) reads it and:
   - **Categorizes** which pool it belongs to (Last time / In Palma / From the archive)
   - **Determines department relevance** — does this affect interior, galley, deck, engineering, or some combination?
   - **Extracts entities** — supplier name (Casa Bianca), location (Palma), pattern (lateness), affected area (linens → interior)
   - **Optionally rewrites** in the editorial-warm voice (or leaves the chief stew's wording if it's already good)
3. Stored with derived metadata (pool, dept_relevance[], entities, raw_text, derived_text)
4. View filtering happens dynamically based on viewer role + dept + the AI-derived relevance scores

**What this means in practice:**

- **The chief stew never picks a pool or department.** She just types the note. The system figures out where it belongs.
- **The system can be wrong sometimes.** A small "edit" affordance on each memory entry lets her correct if AI mis-categorized. *"Actually this should be in From the archive, not Last time"* — one click adjusts and the system learns.
- **Department relevance is fuzzy, not binary.** Casa Bianca's linens might score interior=1.0, galley=0.7, deck=0.0, eng=0.0. Both interior and galley HODs see it (above some threshold), deck and eng don't.
- **Re-categorization happens over time.** A note that started as a "Last time" entry about a specific trip might graduate to "From the archive" once the same pattern repeats. The AI can promote it.

**A few honest considerations:**

- **The AI needs trip context.** When a chief stew pins a note while in Palma on the Marchetti charter, the AI knows: location=Palma, guests=Marchettis, current trip=charter. That context shapes categorization. Same note pinned six months later in Antibes might land differently.
- **Re-pinning vs editing.** If a chief stew adds new info to an existing memory ("update — Casa Bianca was on time this time, switching back may have been premature"), does it update the original or become a new entry? Probably new entry, with a "follow-up to" link, so the audit trail is preserved.
- **Confirmation moments.** When AI auto-categorizes, a small inline confirmation could surface briefly: *"Pinned to In Palma + Last time · interior + galley relevance · edit?"*. Not a permanent UI, just a 3-second toast that lets the chief stew course-correct without effort.
- **Crew member confidence.** If a 2nd stew pins a note about "Mrs Marchetti's dietary thing," the AI might auto-link it to the existing dietary preferences feature, surface a "this is also recorded as a preference — is this a *new* observation?" prompt. Prevents duplication without forcing the crew to navigate.

**For the data model, what's stored per memory entry:**

```
memory_entry {
  id
  raw_text         // what the crew member wrote
  derived_text     // optional AI-rewritten editorial version
  pool             // last_time | in_location | from_archive
  location         // Palma, Antibes, etc. (if location-keyed)
  dept_relevance   // {interior: 1.0, galley: 0.7, deck: 0.0, eng: 0.0}
  entities         // [supplier:Casa Bianca, item:linens, pattern:lateness]
  confidence       // AI's confidence in categorization
  trip_context     // the trip this was pinned during
  pinned_by        // user_id
  pinned_at        // timestamp
  last_edited_by   // optional, if anyone corrected
  is_followup_to   // optional, links to prior entry
}
```

**View filtering:**

When a chief stew opens her trip page, the system queries memory where `dept_relevance.interior > 0.4` (some threshold), sorted by relevance to current trip context (guests, location, charter type). Returns top 3.

Same query for a bosun on his trip page filters `dept_relevance.deck > 0.4`. Different memories surface.

**Quiet design implications for the surface we drew:**

- **Bottom-of-card "edit" affordance.** When AI auto-categorized, a small "edit pool / department" link could surface on hover or click. Quiet but discoverable.
- **The Confirm/Dismiss row on AI-noticed cards** — that pattern still applies, but now it's confirming the AI's *categorization*, not just whether the pattern is real. *"Confirm pattern ✓"* says "yes, this is genuinely a memory worth keeping in this pool." *"Not relevant"* says "actually this doesn't belong here."
- **The Memory archive surface** — when the chief stew goes to the full archive, she can see *all* her memories (across pools, with the AI-derived categorization visible). She can re-categorize, merge duplicates, archive old ones. The archive is where curation happens; the trip page is where consumption happens.

**Locking in:**

- AI does all categorization automatically — pool, department relevance, entity extraction
- Crew never tag manually; they just pin free-text notes
- AI uses trip context (location, guests, time) to inform categorization
- Confidence scores drive view filtering
- Confirmation/correction lives in a small inline affordance, not a heavy form
- The archive is where curation happens; the trip page is where consumption happens

Want me to make a small adjustment to the locked memory cards to reflect the AI-driven attribution (e.g. show "AI-categorized" subtly somewhere, or just leave it invisible because the categorization is just *correct* and doesn't need to advertise itself)? My instinct: leave it invisible. The system shouldn't have to brag about doing its job.

---

## Decision 33 (Session 3)

All locked. Cleaner model:

**1. AI categorization is invisible.** No confirmation toasts, no "we tagged this for you" moments. Crew pins a note, the system handles categorization silently. The system being right is the default expectation, not an event.

**2. New notes update memory automatically.** No "is this a new observation or a duplicate?" prompts. If a chief stew pins something about Mrs Marchetti's dietary thing, the system finds related entries (existing preferences, prior memories), and updates them in the background — refining patterns, marking older ones as superseded, surfacing the latest. The crew doesn't manage the merge; the AI does.

**3. Full archive shows everything, filterable by department.** Memory is institutional knowledge — by definition shared. Anyone can browse the full archive. Department filters help them narrow it. No artificial scoping at the archive level.

**Where scoping still applies:** the trip-page memory section. That's a *prioritized* view — the system surfaces the top 3 most relevant *to the viewer's role and current context*. Chief stew opens the trip page, sees three notes that matter to interior. Bosun opens the same trip page, sees three notes that matter to deck. Same data pool, different feed.

**The clean architecture:**

| Surface | Content | Filtered by |
|---|---|---|
| Trip page memory section | Top 3 most relevant | Viewer's role + current trip context (silent AI scoring) |
| Memory archive | Everything | User-applied filters (department, pool, location, date, guest, supplier) |

**Quiet implications:**

- **No tags shown on the trip page cards.** The pool name (Last time / In Palma / From the archive) lives in the title bar, but department tags don't appear on the surface. A chief stew doesn't need to see *"interior + galley"* on a card — the system already used that info to decide whether to surface the card to her.
- **No "AI-categorized" badge.** The system's invisible.
- **The \u2726 AI-noticed glyph** still applies *only* to entries where the AI *spotted a pattern* (e.g. "Casa Bianca late on 3 of last 6"). That's distinct from "AI categorized this note" — pattern detection is a real claim with a confidence level worth surfacing; categorization is just plumbing. So the glyph stays for AI-spotted insights, not for any-AI-touched note.
- **Updating happens in the background.** When new info arrives, the original entry might get refined ("Mrs Marchetti's allergy: rosemary → confirmed across 3 trips" rather than three separate entries). The crew never manages this; they just keep adding observations.

**What the chief stew experiences:**

She types "Mrs Marchetti's migraines come on with rosemary again." Hits Pin to trip. The system silently:
- Categorizes as Last time (specific to current guest)
- Identifies entities (Mrs Marchetti, rosemary, migraines)
- Cross-checks against existing preferences and memories
- Either updates the existing rosemary entry with stronger evidence, or creates a new linked entry
- Marks dept relevance (interior=1.0, possibly galley=0.5)
- Returns to the chief stew's screen — no toast, no popup, the note just appears in the right place

That's the experience. Memory works the way real memory works: you have a thought, it goes in, the system makes sense of it.

Lock and move on?

**Page order:**

1. ✅ Header
2. ✅ The route
3. ✅ What's coming up
4. ✅ Aboard for this trip
5. ✅ Crew on this trip (rota)
6. ✅ Provisioning
7. ✅ Memory
8. **Next: Documents**
9. Photos
10. The trip so far — activity log

Ready for **Documents**?

---

## Decision 34 (Session 3)

Memory locked. Three cards, cream title bars with byline-on-the-right, editorial body in white, terracotta italic emphasis on the actionable details. Confirm/Dismiss only on AI-spotted patterns.

Now — **Documents.**

Let me set the brief before drawing.

**The job of Documents on the trip page.**

Documents holds the paper trail of a trip — what's been generated, what's been signed, what's been sent, what's been received. Different from provisioning (which is operational state) and memory (which is institutional knowledge). Documents is the *file cabinet*.

**What lives here:**

For any trip, the document set typically includes:
- **Charter/owner contracts** — base agreements (charter agreement for charter trips, owner-trip authorization for owner trips)
- **Manifests** — crew manifest, guest manifest, customs manifest
- **Pre-arrival documentation** — guest forms, dietary/preference questionnaires, watersport waiver forms, NDAs
- **Customs and port papers** — clearance docs, port call notices, immigration forms (often country-specific)
- **Insurance certificates** — vessel insurance, charter insurance for the trip dates
- **Emergency contacts** — for guests and crew
- **Expense receipts and invoices** — provisioning receipts, fuel receipts, marina invoices, ship's bills
- **Generated trip documents** — itinerary PDF for guests, daily activity reports, end-of-trip account summaries
- **Calendar exports** — `.ics` of the trip schedule for guest/captain phones

**Two kinds of documents:**

**1. Generated** — Cargo creates these from trip data. Itinerary PDF, manifest, calendar export, end-of-trip summary. The system makes them; the chief stew can download/send.

**2. Uploaded** — humans add these to the trip. Charter contract, signed waivers, customs receipts, photos of paper documents. The system stores them; the chief stew can preview/download.

Phase 2/3 expansion (parked from earlier): templates for customs forms by country, port papers automation, account templates for charter expense reports.

**For the trip page section, the question is:**

What does a chief stew actually need to *see* about documents on the trip page? Probably not the full file cabinet — that's the document workspace. Probably:

- A small count summary: *"12 documents · 3 awaiting signature · last activity 2h ago"*
- Documents that need attention (unsigned, incomplete, missing signature)
- Recently added documents (last few)
- Quick-action affordances (generate the trip itinerary, download manifest, export to calendar)

The section is a *window* into the document store. The full archive lives in a workspace at `/documents` or `/trip/marchetti/documents`.

**A few quick decisions before drawing:**

**1. v1 scope.** What documents are realistically generated/handled in v1?

I'd argue v1 minimum:
- Itinerary PDF (generated from trip data)
- Crew manifest (generated)
- Guest manifest (generated, but contains data crew enter)
- Calendar export (.ics)

Plus uploaded documents — any file the crew uploads gets stored. No fancy categorization in v1.

Phase 2:
- Customs forms by country
- Port papers
- Pre-arrival guest questionnaires
- Account/expense templates

Phase 3:
- Smart parsing of uploaded docs (extract data from a customs form, etc.)
- Auto-fill of forms from trip data
- E-signature flows

**2. Section structure.**

Three areas?
- **Action card** — what needs attention or quick generation
- **Recent activity** — last 3-5 document touches
- **Categories** — small summary of what's in the file cabinet (counts)

Or simpler — just an action card + recent list, with a "Open documents →" to the workspace.

**3. Generated vs uploaded.**

Should they be visually distinct on the surface, or read together as a chronological feed?

I'd argue together as a feed — a chief stew doesn't care whether the system or a human added something. She cares whether it needs her attention.

**4. Connection to other sections.**

The provisioning section already has return slips and supplier confirmations (those are documents). The crew rota has the hours-of-rest log (also a document, technically). Should those surface here too?

I'd argue: those documents *belong to* their respective sections. They live in the document store but the *primary surface* for a return slip is the provisioning workspace, not the documents tab. The documents section on the trip page surfaces *trip-level* documents — not nested workspace documents.

**5. Voice.**

Editorial-warm but operational. Not as warm as memory; more administrative. *"Itinerary ready to send" / "Manifest needs the Cape pilot's signature" / "Customs form for Ibiza expires in 3 days."*

**Quick decisions to settle:**

1. **v1 scope** — Itinerary PDF + crew manifest + guest manifest + calendar export + uploaded documents?
2. **Section structure** — single action area + recent feed, or split into multiple sub-sections?
3. **Generated vs uploaded** — read together as a feed, distinguished only by source label?
4. **Connection to other sections** — return slips/hours of rest log live in their *parent* sections, not duplicated here?

Want me to settle these and draw, or push the brief further?

---

## Decision 35 (Session 3)

Four department views, same trip, different file cabinets. Honest scoping:

**Command (captain).** Sees everything. Five categories: Trip-level, Customs & port, Interior, Galley, Engineering. 23 documents, 4 needing attention. The captain's job includes oversight — she cares about the unsigned charter agreement, the expiring port clearance, the unsigned watersport waivers, and the awaiting Iberica delivery note. The action banner at the top calls out all four. The bottom CTA includes "Hours of rest log →" because that's a captain-level audit document.

**Interior (chief stew).** 9 documents, 2 needing attention. Trip-level docs (itinerary, guest manifest, calendar export) plus interior-only docs (watersport waivers, pre-arrival questionnaires, Iberica delivery note, interior-scoped provisioning receipts). She does *not* see customs papers, engine room logs, or fuel receipts — they don't apply to her work. The alert banner is shorter, calling out the two interior-relevant attention items.

**Deck (bosun).** 7 documents, 1 expiring. Trip-level docs (itinerary, crew manifest) plus customs/port papers (which are deck/captain territory) plus deck-specific docs (anchorage notes pinned from memory, tender deployment log). The banner flags the Ibiza port clearance expiring before the Cala Pi stop. He doesn't see watersport waivers or interior-specific things.

**Engineering (chief eng).** 5 documents, all current. The lightest list — engineering paperwork is mostly daily logs that auto-reconcile. Trip-level docs + fuel receipts + engine room log + water-maker performance. No alert banner because nothing needs his action right now.

A few patterns worth pointing out:

- **Same component, different feeds.** The component takes a department filter and the document repo returns the relevant subset.
- **Trip-level documents appear in everyone's view.** Itinerary, manifest, calendar export — these are universal. Crew manifest specifically might be redacted slightly for non-command (e.g. doesn't show salary or specific HR details, just names + roles + dates).
- **Customs & port papers are deck/captain territory.** Interior and engineering don't see them by default. They're not blocked from accessing them in the archive — they just don't surface on the trip page summary.
- **Engineering's view is thin.** That's honest — engineering paperwork is dense in *content* but light in *count*. A daily log is one document with many entries, not many documents.
- **Memory-pinned anchorage notes graduate to documents.** "Anchorage notes · Cala Pi" is pinned from memory — when a memory entry contains operational paperwork (a hand-drawn anchorage diagram, a copy of the harbour pilot's contact card), it can be saved as a document. Cross-feature plumbing.
- **Each view has its own attention banner.** Tailored to what *that user* needs to act on.
- **CTAs are consistent across departments.** "+ Generate document" / "Upload" / "Open archive →" — same affordances, different document scope.

A few specific things to consider going forward:

- **The `Re-file →` and `Send chase →` action verbs** are department-specific and editorial. Customs gets "Re-file." Waivers get "Send chase." Receipts get "Upload." Each verb does the right operational thing for that doc type.
- **The category headers** (Trip-level, Customs & port, Interior, etc.) order isn't fixed — they follow a relevance hierarchy: trip-level first, then attention-required, then routine.
- **AI-generated icon labels** — `PDF`, `ICS`, `LOG`. These could vary based on file type and would auto-populate from the file's metadata.

Land on this scoping and we move on, or want to tweak first?

---

## Decision 36 (Session 3)

Right, sorry — I conflated two threads. Let me reset.

**You wanted to see the memory section for different departments before moving on.** Memory is locked in concept (AI-driven scoping, same 3-card pattern, top 3 by relevance to viewer). What's not locked yet is *what those three cards look like for each department viewer*.

Let me draw memory through four department lenses on the same trip — same component, same patterns, but the system's pulling the most relevant 3 entries for each viewer's role.

---

## Decision 37 (Session 3)

Same component. Same trip. Different feeds. Four perspectives:

**Command (captain).** The system picks notes that span departments — overall trip pattern (Marchettis prefer overnight passages), local operational intelligence (Club de Mar pilot doesn't speak English), broker pattern (this booking agent's history of withholding dietary info). Captain gets the cross-cutting view.

**Interior (chief stew).** What we already locked. Service-leaning: Fernet Branca, Casa Bianca's linens, Cap de Formentor sunset dinner. The chief stew's daily concerns.

**Deck (bosun).** Anchorage holding intel for Cala Pi, the Marchetti son's tender lessons last summer, the Magaluf-vs-Portitxol guidance. All deck-relevant. None of the interior service notes appear here — they're filtered out as not-relevant-to-deck.

**Engineering (chief eng).** Generators running hot at low load above 28\u00b0C (with the AI noting today's forecast hits 31\u00b0C — that's a real trip-context-aware alert), the Repsol fuel quality preference, the water-maker performance pattern. Three engineering-specific notes, all materially useful.

A few things worth noting:

- **The system is doing real context-aware work.** Pavel's generator note isn't just static knowledge — it's surfacing today because the weather forecast says 31\u00b0C. Same data, surfaced when it's relevant.
- **Each card stays in the locked Option M pattern.** Cream title bar, source line, editorial body. The voice and structure are consistent across departments — what changes is what content the system feeds in.
- **Pool distribution varies by department.** The captain's view leans heavier on "From the archive" patterns (cross-trip insights). The chief eng's view too — engineering is more pattern-based than guest-specific. Interior leans toward "Last time" because guest preferences are personal. Deck balances "In Palma" (location-keyed intel) heavily.
- **The footer caption tailors per department** — *"Service · supplier · charter rhythm" / "Anchorage · tender ops · port intel" / "Generators · fuel quality · water systems"* etc. Tells the viewer what kinds of notes the system has been pulling from.

Land?

---


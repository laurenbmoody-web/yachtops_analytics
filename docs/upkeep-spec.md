# Upkeep — recurring work across every department

**Status:** partly built. Schema and the checklist merge are live; the generator
is not. **Branch:** `claude/deep-blue-cargo-comparison-gxjgvb`

Upkeep is Cargo's asset-side answer to what the industry calls a PMS. Named
**Upkeep** in the nav; it answers to "PMS" and "planned maintenance" in search,
because engineers, surveyors and class inspectors search for those words.

> **This spec was rewritten after the duty-set work landed on `main`.** An earlier
> draft proposed Upkeep as a single recurring-work engine that would absorb the
> Interior duty sets. That was wrong, and the record of why is worth keeping:
> duty sets and Upkeep organise work around genuinely different subjects, and
> collapsing them bends one out of shape. What *did* need collapsing was the
> checklist, which had grown three separate implementations.

---

## 1. The shape

### Two template kinds, because they are different subjects

| | Duty set | Upkeep schedule |
| --- | --- | --- |
| **Subject** | a **place** — crew mess, laundry | an **asset** — Compressor 2 |
| **Assigned by** | rotation — whose turn today | responsibility — the 1st Engineer owns it |
| **Recurs by** | calendar | calendar **or running hours** |
| **The list is** | a round you walk | a procedure with readings |
| **History matters as** | was the round done | the asset's service record and trend |

A duty set answers *"who has the crew mess today, and what is on that round."*
An Upkeep schedule answers *"when is Compressor 2 next due, what did we read
last time, and is it drifting."* Neither collapses into the other.

### One occurrence stream, one checklist

```
duty_set_templates            upkeep_schedules
  (a place, rotated)            (an asset, calendar or hours)
         │                              │
         └──────────────┬───────────────┘
                        ▼
                    team_jobs                    ← the card
        source='rotation' │ 'upkeep' │ 'defect' │ null
                        │
            ┌───────────┴────────────┐
            ▼                        ▼
   job_checklist_items          job_links
   (tick · note · reading)      (stock it uses · gear it services)
```

**The job is the primitive.** A checklist is something a card *has*, not a
property of where the card came from — so a duty round, an upkeep procedure, a
promoted defect and a job someone typed all render through one component.
Origin decides who *fills* the list, not whether one exists.

### The duty-set grouping rule, kept

A duty template holds one **area** with every frequency in it, and a job shows
only the slice for its own day: today's dailies, **this weekday's** weeklies,
and monthlies that have gone more than `MONTHLY_DUE_AFTER_DAYS` (21) since they
were last done anywhere on the vessel. That mirrors how the work is actually
done — if you are on crew mess today you do the daily, that day's weekly, and
whatever monthly is coming due. Upkeep uses real due dates instead, but the
per-step cadence idea is the same and is preserved.

---

## 2. Schema

### 2.1 `equipment` — the register Cargo lacked

Adjacency tree, matching the `vessel_locations` idiom.

| Column | Type | Notes |
| --- | --- | --- |
| `id` / `tenant_id` | uuid | |
| `department_id` | uuid | bare uuid, as `team_jobs` |
| `parent_id` | uuid | self-FK — system › sub-system › unit |
| `name`, `code`, `description` | text | |
| `vessel_location_id` | uuid | **where it physically is** — reuses the deck plan |
| `manufacturer`, `model`, `serial_number` | text | |
| `commissioned_on` | date | |
| `criticality` | text | `critical` / `important` / `routine` |
| `is_class_item` | boolean | class/flag surveyed |
| `external_source` + `external_ref` | text | the seam for an automation-system integration |

`job_links.equipment_id` already references this table, so the register is
load-bearing for shipped code.

### 2.2 `equipment_counters` and `equipment_counter_readings`

Running hours, starts, cycles. The readings log carries a `source` origin tag —
`manual` / `job_step` / a system name — which is what lets an integration later
write to the same table and change nothing downstream. A trigger keeps the
denormalised `current_value` in step and only ever moves it forward, so a
backfilled historical reading cannot rewind "now".

### 2.3 `upkeep_schedules` — the asset template

`trigger_type` is `calendar`, `counter`, or `either` — the standard marine rule,
*250 hours or 6 months, whichever comes first*. `category` is **free text per
department**: Interior and Engineering are too different to share an enum.

`calendar_rule` shapes:

```json
{ "kind": "daily" }
{ "kind": "weekly",  "days": ["monday","thursday"] }
{ "kind": "monthly", "day": 1 }
{ "kind": "interval","months": 6 }
```

### 2.4 `upkeep_steps` — typed, as rows

`step_type` is `check` / `reading` / `photo` / `note`, and **it is what varies by
department, not the module**. Interior ticks; Deck photographs; Galley and
Engineering take readings with a unit and a normal range. A step may also name
an `inventory_item_id` and `quantity_used`, which becomes a `job_link` when an
occurrence is raised — it never moves stock itself.

Per-step `frequency` is preserved from the duty-set pattern, so a weekly set can
still spread its work across the week.

### 2.5 `job_checklist_items` — the one checklist

Replaces three separate implementations of the same idea:

| Was | Shape | Live rows |
| --- | --- | --- |
| `team_jobs.metadata.checklist` | jsonb, written by three modals | **0 — never used** |
| `duty_task_progress` | rows, tick + note | 48, all migrated |
| `upkeep_step_results` | rows, typed | 0 — dropped |

| Column | Notes |
| --- | --- |
| `job_id` | the card |
| `section` | `Today` / `Tuesday` / `Monthly — falling due` / user-typed |
| `text` | **frozen at materialisation** |
| `item_type` | `check` / `reading` / `photo` / `note` |
| `unit`, `min_normal`, `max_normal` | readings |
| `status` | `pending` / `done` / `skipped` / `failed` |
| `value_numeric`, `note`, `photo_url`, `out_of_range` | what was recorded |
| `auto_completed` | completing a job auto-ticks its dailies; reopening clears only these |
| `origin_kind` + `origin_ref` | `duty` / `upkeep` / `defect` / `manual` |
| `template_id` | drives the last-done lookup behind monthly-falling-due |

**Why frozen text.** `duty_task_progress` stored only a `task_id` and read the
wording live from the template, so editing a task silently rewrote what every
past tick claimed to have covered. Class and flag ask what the procedure *was*.

**Why `section` and not a separate grouping.** The unused manual path called it
`checklistName`; the duty path recomputed it in the UI. Same idea, one column.

**Materialisation is lazy and idempotent.** A unique `(job_id, origin_kind,
origin_ref)` means a second open — or two devices at once — inserts nothing, and
a job raised before the table existed builds its list the first time someone
opens it. No mass backfill, and a missed job self-heals.

### 2.6 What the checklist deliberately does not carry

**Stock.** `job_links` already points a job at what it uses and what it services,
consumes on completion and restores exactly on reopen — multi-location aware
(takes from the fullest shelf, records `consumed_from`), against the
`inventory_movements` ledger, exactly-once via `consumed_at`, and it refuses
size-tracked items rather than mangling them. Linking belongs on the card, at
that altitude. Two things allowed to move the same stock is a bug waiting.

### 2.7 `team_jobs` — the third origin tag

The table already carries `source`, `rotation_assignment_id` and
`source_defect_id`. Add the third:

```
source = 'upkeep'
upkeep_schedule_id   uuid
due_basis            jsonb   -- {"calendar":"2026-09-01","counter":250,"triggered_by":"counter"}
```

```
source = 'rotation'  →  rotation_assignment_id
source = 'defect'    →  source_defect_id      (+ defects.promoted_job_id)
source = 'upkeep'    →  upkeep_schedule_id    ← new, same shape
```

Everything still lands in the **one crew list**. This is the core advantage over
DeepBlue, where the PMS is a walled garden the crew must check separately.

---

## 3. The occurrence generator — NOT BUILT

Nothing on either path raises a job automatically yet. `duty_set_templates.recurrence`
is captured by a rich Repeats control (daily / weekly / fortnightly A-B / monthly
by day or nth-weekday / every-N-days) and round-tripped, but nothing reads it.
Upkeep raises occurrences only from a **Raise now** button.

This is the shared gap and the next piece of work:

1. For each active schedule, compute next due — calendar from the rule, counter
   from `last_completed_counter + counter_interval`, `either` taking whichever
   lands first.
2. If due within `lead_time_days` and no open occurrence exists, insert a
   `team_jobs` row with the right origin tag and materialise its checklist.
3. On completion: stamp the schedule, and let `consumeJobLinks` move the stock.

**Idempotency:** unique on `(schedule, due_date)` for open occurrences, so a
re-run never double-generates.

`nextCalendarDate` in `src/pages/upkeep/utils/recurrence.js` already does the
date arithmetic with month-end clamping and weekday wrapping, and is tested.
The fortnight A/B and nth-weekday shapes still need adding for the duty side.

## 4. What has already been migrated

**The 17 Interior duty sets → `upkeep_schedules` (superseded).** An early
backfill copied 17 sets / 162 steps across, handling both step shapes in the
data (`{id,text,frequency}` and `{title}`). It has since been overtaken: the
duty sets were consolidated on `main` into 5 per-area templates, so **11 of
those 17 rows are now orphaned** — their `source_duty_set_id` points at deleted
templates. They are harmless but stale, and should be cleared once the Upkeep
page is pointed at real asset schedules rather than migrated cleaning rounds.

**`duty_task_progress` → `job_checklist_items` (done).** 48 live ticks carried
across with their wording resolved out of the template jsonb and frozen, notes
and `auto_completed` intact, zero orphaned. `duty_task_progress` is deliberately
**left in place** as a readable fallback until the new path has been exercised
in anger; nothing writes to it any more.

**`upkeep_step_results` → dropped.** Zero rows; superseded by
`job_checklist_items`.

**Before pushing any migration**, per `CLAUDE.md`:

```
ls supabase/migrations | grep -E '^[0-9]{14}_' | sed -E 's/_.*//' | sort | uniq -d
```

Note that concurrent branches take timestamps constantly — this collided twice
during the Upkeep build, and ledger rows applied via the Supabase MCP were
removed by another session and had to be reinserted. Re-run the check after
every merge, and reconcile filenames against
`supabase_migrations.schema_migrations`.

---

## 5. UI

Editorial system throughout — no boxed cards, dates `dd/mm/yyyy`.

```
● UPKEEP | ENGINEERING | 4 OVERDUE
UPKEEP, on schedule.
```

- **Upkeep index** — schedules by department, next due, overdue count. Filters:
  department, category (free text, so a chip list built from distinct values),
  equipment, trigger type, status.
- **Schedule editor** — steps as a reorderable list; each row picks its
  `step_type`, and the row expands to the fields that type needs (unit + normal
  range for a reading, item picker for a part). This is the screen that answers
  "each task should have its own field".
- **Doing a job** — `JobChecklist` in the Team Jobs card, which serves every job
  and not just Upkeep ones: tick, comment, enter a reading, per item, grouped by
  section. Out-of-range readings flag as they are typed. A duty round renders
  through the same component with the same `dc-*` styling it always had; a
  manual card gets an "add a checklist item" row that a generated one does not.
- **Equipment record** — details, location on the GA, counters, schedules,
  service history, linked spares, defect history.
- **Reading trends** — a chart per counter/reading step. This is the payoff for
  typing steps, and it is a category above what a PMS does.

---

## 6. The automation-system seam

The vessel tracks equipment in a separate automation/monitoring system, and
running hours should eventually flow from it rather than being keyed in.

**Build the seam now, the integration later.** Three columns make it an adapter
rather than a refactor:

- `equipment.external_source` + `external_ref` — maps a Cargo asset to its tag
- `equipment_counters.external_ref` — maps a counter to its point
- `equipment_counter_readings.source` — machine-ingested vs hand-keyed

Then v1 ships with manual counter entry (a `reading` step captures running hours
during the job), and the integration later writes to the *same* table with a
different `source`. Nothing downstream changes.

**Practical constraints to plan for.** Yacht automation and alarm systems
generally sit on a segregated ship network, are rarely reachable from the
internet, and typically expose data over Modbus / NMEA / OPC-UA or a vendor
gateway rather than a public REST API. Expect the shape to be an **onboard
collector that pushes to Cargo**, not Cargo pulling from the vessel. Design the
ingest as an authenticated write endpoint accepting batched readings, tolerant of
gaps and out-of-order timestamps (vessels lose connectivity).

Ask the vendor for: available integration methods, whether a read-only account or
gateway can be provisioned, the tag list/point map, and update frequency.

**Later, on the same seam:** an alarm from the automation system can raise a Cargo
defect automatically — `defects.source = '<system>'`, mirroring the origin-tag
pattern again.

---

## 7. Build order

**Done**

1. `equipment`, `equipment_counters`, `equipment_counter_readings` — the register
   Cargo lacked. `job_links.equipment_id` already depends on it.
2. `upkeep_schedules` + `upkeep_steps`, typed and with per-step cadence.
3. `job_checklist_items` — one checklist for every job, replacing three
   implementations. One `JobChecklist` component in the card; `dutyProgress.js`
   keeps its public API and writes to the new table underneath.

**Next**

4. **The occurrence generator** — the shared gap. Nothing raises a job
   automatically on either path (§3). Needs the fortnight A/B and nth-weekday
   shapes adding to `nextCalendarDate`.
5. Counter triggers and `either`, so running hours actually drive a due date.
6. Equipment detail page — location on the GA, counters, schedules, service
   history via `job_links`, linked spares.
7. Reading trends per counter and per reading step. This is the payoff for
   typing steps, and it is a category above what a PMS does.
8. The automation-system integration, once the vendor's method is known (§6).

**Loose ends worth clearing**

- 35 tasks across the 6 legacy "Daily Duties" templates have **no `id`**.
  `JobChecklist` falls back to a positional `origin_ref` so they no longer
  collide, but that key breaks if the template is reordered. Those templates are
  superseded by the consolidated Interior ones — deleting them is the real fix.
- 11 orphaned `upkeep_schedules` rows from the superseded backfill (§4).

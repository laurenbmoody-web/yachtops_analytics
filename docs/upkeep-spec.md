# Upkeep — recurring work across every department

**Status:** draft spec, not yet implemented
**Branch:** `claude/deep-blue-cargo-comparison-gxjgvb`

Upkeep is Cargo's answer to what the industry calls a PMS (Planned Maintenance
System). It generalises the Interior duty-set pattern already in production so
the same engine serves Interior, Deck, Galley and Engineering.

Named **Upkeep** in the nav; answers to "PMS" and "planned maintenance" in search,
because engineers, surveyors and class inspectors search for those words.

---

## 1. Why this shape

### What already exists and works

```
duty_set_templates   →   rotation_assignments   →   team_jobs
   (the template)          (the recurrence)          (the occurrence)
```

This is already the correct template/instance split. It is in production with
**17 duty sets / 162 steps**, all Interior:

| Category | Sets | Steps |
| --- | --- | --- |
| Daily Duties | 6 | 35 |
| Daily Service | 3 | 55 |
| Weekly Maintenance | 4 | 44 |
| Monthly Deep Clean | 4 | 28 |

`duty_set_templates.department_id` already exists, so other departments need
their own sets — not a new module.

### Why the template and the occurrence must stay separate

A schedule is a *definition*; a job is *a thing that happened*. If they share a
row, editing a procedure silently rewrites what was already signed off. Class and
flag ask what the procedure **was** at sign-off, so the step text is frozen onto
the occurrence when it is generated (`upkeep_step_results.step_text`).

### What blocks generalisation today

1. **`duty_set_templates.tasks` is jsonb.** A step is `{id, text, frequency}`. It
   cannot hold a tick, a comment, a photo, a reading, a part, or who did it.
   Interior survives this because "Polish stainless" is pass/fail. Engineering
   cannot: *"Check manometer readouts upstream and downstream of filter"* has to
   store a number.
2. **Frequency lives in three places** — the set name (`Laundry — weekly`), the
   category (`Weekly Maintenance`) and every step (`weekly-tuesday`).
3. **No equipment register.** Cargo has no equipment table, no counters, no
   running hours. `vessel_locations` is the deck plan; `inventory_items` is stock.
   Neither is an asset register.
4. **Calendar-only recurrence.** Engineering services on running hours
   ("250 h or 6 months, whichever comes first"), which the current model cannot
   express.

### What to keep — the good idea already in the data

`Laundry — weekly` spreads eight steps across Monday to Saturday
(`weekly-monday`, `weekly-tuesday`, …). **The set is a container and each step
carries its own cadence.** DeepBlue puts one interval on the whole task and cannot
express this at all. Keep it: `upkeep_steps.frequency`.

### Decisions taken

- **`category` is free text**, per department. Interior and Engineering are
  vastly different; a shared enum would force Engineering into "Monthly Deep
  Clean". Existing four categories migrate unchanged.
- **Running hours are in v1**, because an integration with the vessel's
  equipment-tracking/automation system is a near-term goal (see §6).

---

## 2. Schema

### 2.1 `equipment` — the register Cargo lacks

Adjacency tree, matching the `vessel_locations` idiom already in the codebase.

| Column | Type | Notes |
| --- | --- | --- |
| `id` | uuid pk | |
| `tenant_id` | uuid not null | |
| `department_id` | uuid | who owns it |
| `parent_id` | uuid | self-FK — system › sub-system › unit |
| `name` | text not null | `Chilled Water Compressor 2` |
| `code` | text | the vessel's own numbering (SFI or otherwise) |
| `vessel_location_id` | uuid | **where it physically is** — reuses the deck plan |
| `manufacturer`, `model`, `serial_number` | text | |
| `commissioned_on` | date | |
| `criticality` | text | `critical` / `important` / `routine` |
| `is_class_item` | boolean | class/flag surveyed |
| `external_source` | text | e.g. the automation system's name |
| `external_ref` | text | its id/tag in that system — the join key |
| `metadata` | jsonb | |

Two links that DeepBlue structurally cannot make: **where it is** (the GA already
built) and **what it consumes** (real stock, via `upkeep_steps.inventory_item_id`).

### 2.2 `equipment_counters`

One piece of equipment can carry several counters (running hours, starts, cycles).

| Column | Type | Notes |
| --- | --- | --- |
| `id` | uuid pk | |
| `tenant_id` | uuid not null | |
| `equipment_id` | uuid not null | |
| `name` | text not null | `Running hours` |
| `unit` | text not null | `h`, `count` |
| `current_value` | numeric | denormalised latest, for fast due-calc |
| `current_as_of` | timestamptz | |
| `external_ref` | text | the tag in the automation system |

### 2.3 `equipment_counter_readings` — the log, and the integration seam

| Column | Type | Notes |
| --- | --- | --- |
| `id` | uuid pk | |
| `tenant_id` | uuid not null | |
| `counter_id` | uuid not null | |
| `value` | numeric not null | |
| `read_at` | timestamptz not null | |
| `source` | text not null | `manual` / `job_step` / `<automation system>` |
| `recorded_by` | uuid | null for machine-ingested |
| `job_id` | uuid | set when captured during a job step |

`source` follows the same origin-tag pattern as `team_jobs.source`.

### 2.4 `upkeep_schedules` — the template

Evolves `duty_set_templates`.

| Column | Type | Notes |
| --- | --- | --- |
| `id` | uuid pk | |
| `tenant_id` | uuid not null | |
| `department_id` | uuid not null | |
| `name` | text not null | drop the `— weekly` suffix |
| `category` | text | **free text** |
| `equipment_id` | uuid | null for Interior sets |
| `description` | text | |
| `estimated_minutes` | int | carries `estimated_duration` over |
| `trigger_type` | text not null | `calendar` / `counter` / `either` |
| `calendar_rule` | jsonb | see below |
| `counter_id` | uuid | which counter drives it |
| `counter_interval` | numeric | e.g. `250` |
| `lead_time_days` | int | how early the occurrence appears |
| `criticality` | text | |
| `is_class_item` | boolean | |
| `active` | boolean not null default true | |

`calendar_rule` shapes:

```json
{ "kind": "daily" }
{ "kind": "weekly",  "days": ["monday","thursday"] }
{ "kind": "monthly", "day": 1 }
{ "kind": "interval","months": 6 }
```

`trigger_type = 'either'` is the standard marine rule — *whichever comes first*.

### 2.5 `upkeep_steps` — steps as rows, not jsonb

| Column | Type | Notes |
| --- | --- | --- |
| `id` | uuid pk | |
| `tenant_id` | uuid not null | |
| `schedule_id` | uuid not null | |
| `position` | int not null | |
| `text` | text not null | |
| `step_type` | text not null | `check` / `reading` / `photo` / `note` |
| `frequency` | text | null = every occurrence; else `weekly-tuesday` etc |
| `unit` | text | reading steps — `bar`, `°C`, `h` |
| `min_normal`, `max_normal` | numeric | out-of-range flags on entry |
| `equipment_id` | uuid | step-level override of the schedule's equipment |
| `inventory_item_id` | uuid | **the part this step consumes** |
| `quantity_used` | numeric | decrement on sign-off |
| `is_mandatory` | boolean | blocks completion if skipped |

**`step_type` is what varies by department — not the module.**

- Interior — *Polish stainless* → `check`
- Deck — *Tender hull condition* → `photo`
- Galley — *Fridge temperature* → `reading`, `°C`, −2 to 5
- Engineering — *Manometer upstream/downstream* → `reading`, `bar`

Interior leaves every engineering column null. Galley fridge temps become a trend
line by the same mechanism as a compressor manometer.

### 2.6 `upkeep_step_results` — per occurrence, per step

Where the ticks, comments, readings and photos actually live.

| Column | Type | Notes |
| --- | --- | --- |
| `id` | uuid pk | |
| `tenant_id` | uuid not null | |
| `job_id` | uuid not null | the `team_jobs` occurrence |
| `step_id` | uuid | the template step it came from |
| `step_text` | text not null | **frozen copy at generation — the audit answer** |
| `status` | text not null | `pending` / `done` / `skipped` / `failed` |
| `value_numeric` | numeric | the reading |
| `value_text` | text | |
| `comment` | text | per-step, not per-job |
| `photo_url` | text | |
| `completed_by` | uuid | |
| `completed_at` | timestamptz | |

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

## 3. The occurrence generator

A scheduled job (cron/edge function, mirroring `sync_rotation_job` RPC):

1. For each active schedule, compute next due:
   - `calendar` — next date from `calendar_rule`
   - `counter` — `last_completed_counter + counter_interval` vs `current_value`
   - `either` — whichever lands first
2. If due within `lead_time_days` and no open occurrence exists, insert a
   `team_jobs` row with `source='upkeep'`, and copy every applicable step
   (respecting per-step `frequency`) into `upkeep_step_results` with
   `status='pending'` and `step_text` frozen.
3. On completion: decrement any `inventory_item_id` by `quantity_used`, write a
   counter reading if any step captured one, stamp the completion counter value
   onto the schedule for the next counter-based calculation.

**Idempotency:** unique index on `(upkeep_schedule_id, due_date)` for open
occurrences, so a re-run never double-generates.

---

## 4. Migration path for the 162 existing steps

1. Create the new tables; leave `duty_set_templates` in place.
2. Backfill `upkeep_schedules` from `duty_set_templates` — `name`, `category`
   (unchanged, free text), `department_id`, `estimated_duration` →
   `estimated_minutes`, `trigger_type='calendar'`.
3. Expand `tasks` jsonb → `upkeep_steps` rows: `text` → `text`, `frequency` →
   `frequency`, `position` from array order, `step_type='check'`.
4. Derive `calendar_rule` from the existing category/frequency strings; spot-check
   all 17 by hand — there are few enough.
5. Optionally tidy names (`Laundry — weekly` → `Laundry`) once frequency has one
   home.
6. Run in a transaction with a row-count assertion; keep `duty_set_templates`
   until the new path is proven, then drop.

**Before pushing any migration**, per `CLAUDE.md`:

```
ls supabase/migrations | grep -E '^[0-9]{14}_' | sed -E 's/_.*//' | sort | uniq -d
```

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
- **Doing a job** — the occurrence in Team Jobs opens the step list: tick,
  comment, enter a reading, attach a photo, per step. Out-of-range readings flag
  immediately.
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

1. `equipment` + `equipment_counters` + readings — the missing foundation
2. `upkeep_schedules` + `upkeep_steps`, migrate the 17 Interior sets
3. `upkeep_step_results` + the Team Jobs occurrence view (ticks, comments, readings)
4. The occurrence generator, calendar triggers only
5. Counter triggers and `either`
6. Inventory link — parts decrement on sign-off, low stock raises a provisioning line
7. Reading trends
8. The external integration, once the vendor's method is known

Steps 1–3 deliver the thing that fixes the complaint: **every task its own field,
checkbox and comment, linked to real equipment and real stock.**

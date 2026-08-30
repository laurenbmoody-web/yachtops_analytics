-- ─────────────────────────────────────────────────────────────────────────────
-- 20260830101926_upkeep_schema.sql
--
-- WHAT: Upkeep — recurring work across every department. Generalises the
--       Interior duty-set pattern (duty_set_templates → rotation_assignments →
--       team_jobs) so the same engine serves Interior, Deck, Galley and
--       Engineering. Spec: docs/upkeep-spec.md.
--
--       Creates:
--         * equipment                  — the asset register Cargo lacks. Adjacency
--                                        tree (parent_id), located on the deck plan
--                                        (vessel_location_id → vessel_locations).
--         * equipment_counters         — running hours / starts / cycles per asset.
--         * equipment_counter_readings — the reading log, and the seam for a later
--                                        automation-system integration (`source`).
--         * upkeep_schedules           — the template. Recurrence is calendar,
--                                        counter, or 'either' (whichever first).
--         * upkeep_steps               — steps as ROWS, not jsonb. Typed:
--                                        check / reading / photo / note. A reading
--                                        step carries unit + normal range; any step
--                                        may consume an inventory_item.
--         * upkeep_step_results        — per occurrence, per step: the tick, the
--                                        comment, the reading, the photo.
--
--       Extends public.team_jobs with the third origin tag, matching the existing
--       rotation (rotation_assignment_id) and defect (source_defect_id) pattern:
--         source = 'upkeep' → upkeep_schedule_id
--       so generated occurrences land in the ONE crew list rather than a separate
--       maintenance module.
--
-- AUDIT: upkeep_step_results.step_text is a FROZEN copy of the step at generation
--       time. Editing a schedule later must never rewrite what was signed off —
--       class and flag ask what the procedure WAS at sign-off.
--
-- IDENTITY: user references are Supabase auth uids (auth.users.id), as defects
--       and team_jobs do.
--
-- DEPARTMENTS: department_id is a bare uuid (no FK), exactly like team_jobs and
--       defects — the departments table is managed out-of-band.
--
-- TEAM_JOBS: job_id is a bare uuid (no FK) because the team_jobs base table lives
--       outside migration history, matching source_defect_id / rotation_assignment_id.
--
-- RLS: tenant-scoped via public.tenant_members (active), mirroring defects and
--       team_jobs. Finer control (who may edit a schedule vs. tick a step) is
--       enforced in the app, as team_jobs does.
--
-- IDEMPOTENCY: CREATE TABLE/INDEX IF NOT EXISTS, ADD COLUMN IF NOT EXISTS,
--       DROP POLICY IF EXISTS before each CREATE. Safe to re-apply.
-- ─────────────────────────────────────────────────────────────────────────────

-- ── equipment ────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.equipment (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id           uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  department_id       uuid,                                    -- bare uuid, as team_jobs
  parent_id           uuid REFERENCES public.equipment(id) ON DELETE SET NULL,

  name                text NOT NULL,
  code                text,                                    -- the vessel's own numbering
  description         text,

  -- where it physically is — reuses the deck-plan tree the GA already draws
  vessel_location_id  uuid REFERENCES public.vessel_locations(id) ON DELETE SET NULL,
  location_label      text,                                    -- denormalised for display

  manufacturer        text,
  model               text,
  serial_number       text,
  commissioned_on     date,

  criticality         text NOT NULL DEFAULT 'routine',         -- critical|important|routine
  is_class_item       boolean NOT NULL DEFAULT false,

  -- integration seam: maps this asset to its tag in an automation/monitoring system
  external_source     text,
  external_ref        text,

  active              boolean NOT NULL DEFAULT true,
  metadata            jsonb NOT NULL DEFAULT '{}',

  created_by          uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS equipment_tenant_idx     ON public.equipment (tenant_id, name);
CREATE INDEX IF NOT EXISTS equipment_parent_idx     ON public.equipment (parent_id) WHERE parent_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS equipment_dept_idx       ON public.equipment (tenant_id, department_id);
CREATE INDEX IF NOT EXISTS equipment_location_idx   ON public.equipment (vessel_location_id) WHERE vessel_location_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS equipment_external_ref_uq
  ON public.equipment (tenant_id, external_source, external_ref)
  WHERE external_source IS NOT NULL AND external_ref IS NOT NULL;

-- ── equipment_counters ───────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.equipment_counters (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  equipment_id    uuid NOT NULL REFERENCES public.equipment(id) ON DELETE CASCADE,

  name            text NOT NULL,                               -- 'Running hours'
  unit            text NOT NULL DEFAULT 'h',                   -- h | count | nm
  -- denormalised latest reading, so due-calculation is a single-table read
  current_value   numeric,
  current_as_of   timestamptz,

  external_ref    text,                                        -- the point/tag in the source system

  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS equipment_counters_equipment_idx ON public.equipment_counters (equipment_id);
CREATE INDEX IF NOT EXISTS equipment_counters_tenant_idx    ON public.equipment_counters (tenant_id);

-- ── equipment_counter_readings ───────────────────────────────────────────────
-- The log. `source` is the origin tag — 'manual' today, an automation system's
-- name once the integration lands, writing to this same table.
CREATE TABLE IF NOT EXISTS public.equipment_counter_readings (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id    uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  counter_id   uuid NOT NULL REFERENCES public.equipment_counters(id) ON DELETE CASCADE,

  value        numeric NOT NULL,
  read_at      timestamptz NOT NULL DEFAULT now(),
  source       text NOT NULL DEFAULT 'manual',                 -- manual|job_step|<system>
  recorded_by  uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  job_id       uuid,                                           -- set when captured during a job step
  note         text,

  created_at   timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS counter_readings_counter_idx ON public.equipment_counter_readings (counter_id, read_at DESC);
CREATE INDEX IF NOT EXISTS counter_readings_tenant_idx  ON public.equipment_counter_readings (tenant_id, read_at DESC);

-- ── upkeep_schedules ─────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.upkeep_schedules (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id           uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  department_id       uuid,                                    -- bare uuid, as team_jobs

  name                text NOT NULL,
  category            text,                                    -- FREE TEXT, per department
  description         text,
  equipment_id        uuid REFERENCES public.equipment(id) ON DELETE SET NULL,
  estimated_minutes   integer,

  -- recurrence: calendar, counter, or whichever comes first
  trigger_type        text NOT NULL DEFAULT 'calendar',        -- calendar|counter|either
  calendar_rule       jsonb,                                   -- {kind:daily} | {kind:weekly,days:[]}
                                                               -- {kind:monthly,day:1} | {kind:interval,months:6}
  counter_id          uuid REFERENCES public.equipment_counters(id) ON DELETE SET NULL,
  counter_interval    numeric,                                 -- e.g. 250 (hours)

  lead_time_days      integer NOT NULL DEFAULT 0,              -- how early an occurrence appears
  criticality         text,
  is_class_item       boolean NOT NULL DEFAULT false,
  active              boolean NOT NULL DEFAULT true,

  -- state carried between occurrences, for next-due calculation
  last_completed_at       timestamptz,
  last_completed_counter  numeric,
  next_due_date           date,

  -- provenance, so the duty-set backfill is traceable and re-runnable
  source_duty_set_id  uuid,

  created_by          uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT upkeep_schedules_trigger_type_chk
    CHECK (trigger_type IN ('calendar','counter','either')),
  -- a counter-driven schedule must say which counter and how often
  CONSTRAINT upkeep_schedules_counter_cfg_chk
    CHECK (trigger_type = 'calendar' OR (counter_id IS NOT NULL AND counter_interval IS NOT NULL)),
  -- a calendar-driven schedule must carry a rule
  CONSTRAINT upkeep_schedules_calendar_cfg_chk
    CHECK (trigger_type = 'counter' OR calendar_rule IS NOT NULL)
);

CREATE INDEX IF NOT EXISTS upkeep_schedules_tenant_idx    ON public.upkeep_schedules (tenant_id, active);
CREATE INDEX IF NOT EXISTS upkeep_schedules_dept_idx      ON public.upkeep_schedules (tenant_id, department_id);
CREATE INDEX IF NOT EXISTS upkeep_schedules_equipment_idx ON public.upkeep_schedules (equipment_id) WHERE equipment_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS upkeep_schedules_due_idx       ON public.upkeep_schedules (tenant_id, next_due_date) WHERE active = true;
CREATE UNIQUE INDEX IF NOT EXISTS upkeep_schedules_duty_set_uq
  ON public.upkeep_schedules (source_duty_set_id) WHERE source_duty_set_id IS NOT NULL;

-- ── upkeep_steps ─────────────────────────────────────────────────────────────
-- Steps as rows. `step_type` is what varies by department — not the module.
-- Interior ticks (check); Deck photographs (photo); Galley and Engineering take
-- readings (reading) with a unit and a normal range. Interior leaves the
-- engineering columns null.
CREATE TABLE IF NOT EXISTS public.upkeep_steps (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id          uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  schedule_id        uuid NOT NULL REFERENCES public.upkeep_schedules(id) ON DELETE CASCADE,

  position           integer NOT NULL DEFAULT 0,
  text               text NOT NULL,
  step_type          text NOT NULL DEFAULT 'check',            -- check|reading|photo|note

  -- per-step cadence. null = every occurrence. Carries the Interior pattern over:
  -- 'Laundry — weekly' spreads its steps across weekly-monday … weekly-saturday.
  frequency          text,

  -- reading steps
  unit               text,
  min_normal         numeric,
  max_normal         numeric,
  counter_id         uuid REFERENCES public.equipment_counters(id) ON DELETE SET NULL,

  -- links
  equipment_id       uuid REFERENCES public.equipment(id) ON DELETE SET NULL,
  inventory_item_id  uuid REFERENCES public.inventory_items(id) ON DELETE SET NULL,
  quantity_used      numeric,

  is_mandatory       boolean NOT NULL DEFAULT false,
  guidance           text,

  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT upkeep_steps_step_type_chk
    CHECK (step_type IN ('check','reading','photo','note')),
  -- a reading needs a unit to be meaningful
  CONSTRAINT upkeep_steps_reading_unit_chk
    CHECK (step_type <> 'reading' OR unit IS NOT NULL),
  -- if a normal range is given, it must be the right way round
  CONSTRAINT upkeep_steps_range_chk
    CHECK (min_normal IS NULL OR max_normal IS NULL OR min_normal <= max_normal)
);

CREATE INDEX IF NOT EXISTS upkeep_steps_schedule_idx ON public.upkeep_steps (schedule_id, position);
CREATE INDEX IF NOT EXISTS upkeep_steps_tenant_idx   ON public.upkeep_steps (tenant_id);
CREATE INDEX IF NOT EXISTS upkeep_steps_item_idx     ON public.upkeep_steps (inventory_item_id) WHERE inventory_item_id IS NOT NULL;

-- ── upkeep_step_results ──────────────────────────────────────────────────────
-- Per occurrence, per step. step_text is frozen at generation so a later edit to
-- the schedule can never rewrite what was signed off.
CREATE TABLE IF NOT EXISTS public.upkeep_step_results (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id      uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  job_id         uuid NOT NULL,                                -- team_jobs.id (bare uuid, as source_defect_id)
  step_id        uuid REFERENCES public.upkeep_steps(id) ON DELETE SET NULL,

  position       integer NOT NULL DEFAULT 0,
  step_text      text NOT NULL,                                -- FROZEN copy — the audit answer
  step_type      text NOT NULL DEFAULT 'check',
  unit           text,
  min_normal     numeric,
  max_normal     numeric,

  status         text NOT NULL DEFAULT 'pending',              -- pending|done|skipped|failed
  value_numeric  numeric,
  value_text     text,
  comment        text,
  photo_url      text,
  out_of_range   boolean NOT NULL DEFAULT false,

  inventory_item_id uuid REFERENCES public.inventory_items(id) ON DELETE SET NULL,
  quantity_used     numeric,
  is_mandatory      boolean NOT NULL DEFAULT false,   -- frozen with step_text
  counter_id        uuid REFERENCES public.equipment_counters(id) ON DELETE SET NULL,

  completed_by   uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  completed_by_name text,
  completed_at   timestamptz,

  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT upkeep_step_results_status_chk
    CHECK (status IN ('pending','done','skipped','failed'))
);

CREATE INDEX IF NOT EXISTS upkeep_step_results_job_idx    ON public.upkeep_step_results (job_id, position);
CREATE INDEX IF NOT EXISTS upkeep_step_results_tenant_idx ON public.upkeep_step_results (tenant_id);
CREATE INDEX IF NOT EXISTS upkeep_step_results_step_idx   ON public.upkeep_step_results (step_id) WHERE step_id IS NOT NULL;
-- one result row per step per occurrence, so the generator is idempotent
CREATE UNIQUE INDEX IF NOT EXISTS upkeep_step_results_job_step_uq
  ON public.upkeep_step_results (job_id, step_id) WHERE step_id IS NOT NULL;

-- ── team_jobs: the third origin tag ──────────────────────────────────────────
-- source = 'rotation' → rotation_assignment_id
-- source = 'defect'   → source_defect_id
-- source = 'upkeep'   → upkeep_schedule_id     ← this migration
ALTER TABLE public.team_jobs
  ADD COLUMN IF NOT EXISTS upkeep_schedule_id uuid,
  ADD COLUMN IF NOT EXISTS due_basis          jsonb;

CREATE INDEX IF NOT EXISTS team_jobs_upkeep_schedule_idx
  ON public.team_jobs (upkeep_schedule_id) WHERE upkeep_schedule_id IS NOT NULL;

-- ── RLS ──────────────────────────────────────────────────────────────────────
-- Tenant-scoped via tenant_members(active), mirroring defects and team_jobs.
ALTER TABLE public.equipment                  ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.equipment_counters         ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.equipment_counter_readings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.upkeep_schedules           ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.upkeep_steps               ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.upkeep_step_results        ENABLE ROW LEVEL SECURITY;

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'equipment','equipment_counters','equipment_counter_readings',
    'upkeep_schedules','upkeep_steps','upkeep_step_results'
  ] LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', t || '_tenant_select', t);
    EXECUTE format($f$
      CREATE POLICY %I ON public.%I FOR SELECT TO authenticated
        USING (tenant_id IN (SELECT tenant_id FROM public.tenant_members
                             WHERE user_id = auth.uid() AND active = true))
    $f$, t || '_tenant_select', t);

    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', t || '_tenant_insert', t);
    EXECUTE format($f$
      CREATE POLICY %I ON public.%I FOR INSERT TO authenticated
        WITH CHECK (tenant_id IN (SELECT tenant_id FROM public.tenant_members
                                  WHERE user_id = auth.uid() AND active = true))
    $f$, t || '_tenant_insert', t);

    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', t || '_tenant_update', t);
    EXECUTE format($f$
      CREATE POLICY %I ON public.%I FOR UPDATE TO authenticated
        USING (tenant_id IN (SELECT tenant_id FROM public.tenant_members
                             WHERE user_id = auth.uid() AND active = true))
        WITH CHECK (tenant_id IN (SELECT tenant_id FROM public.tenant_members
                                  WHERE user_id = auth.uid() AND active = true))
    $f$, t || '_tenant_update', t);

    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', t || '_tenant_delete', t);
    EXECUTE format($f$
      CREATE POLICY %I ON public.%I FOR DELETE TO authenticated
        USING (tenant_id IN (SELECT tenant_id FROM public.tenant_members
                             WHERE user_id = auth.uid() AND active = true))
    $f$, t || '_tenant_delete', t);
  END LOOP;
END $$;

-- Counter readings are an audit log: no UPDATE, and DELETE only for a mis-keyed
-- manual entry (machine-ingested rows stay).
DROP POLICY IF EXISTS equipment_counter_readings_tenant_update ON public.equipment_counter_readings;
DROP POLICY IF EXISTS equipment_counter_readings_tenant_delete ON public.equipment_counter_readings;
CREATE POLICY equipment_counter_readings_tenant_delete
  ON public.equipment_counter_readings FOR DELETE TO authenticated
  USING (source = 'manual'
     AND tenant_id IN (SELECT tenant_id FROM public.tenant_members
                       WHERE user_id = auth.uid() AND active = true));

-- ── keep equipment_counters.current_value in step with the log ───────────────
CREATE OR REPLACE FUNCTION public.upkeep_sync_counter_current()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  UPDATE public.equipment_counters c
     SET current_value = NEW.value,
         current_as_of = NEW.read_at,
         updated_at    = now()
   WHERE c.id = NEW.counter_id
     -- only move forward: a backfilled historical reading must not rewind "now"
     AND (c.current_as_of IS NULL OR NEW.read_at >= c.current_as_of);
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS upkeep_counter_reading_sync ON public.equipment_counter_readings;
CREATE TRIGGER upkeep_counter_reading_sync
  AFTER INSERT ON public.equipment_counter_readings
  FOR EACH ROW EXECUTE FUNCTION public.upkeep_sync_counter_current();

-- ── updated_at maintenance ───────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.upkeep_touch_updated_at()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END $$;

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'equipment','equipment_counters','upkeep_schedules','upkeep_steps','upkeep_step_results'
  ] LOOP
    EXECUTE format('DROP TRIGGER IF EXISTS %I ON public.%I', t || '_touch', t);
    EXECUTE format($f$
      CREATE TRIGGER %I BEFORE UPDATE ON public.%I
        FOR EACH ROW EXECUTE FUNCTION public.upkeep_touch_updated_at()
    $f$, t || '_touch', t);
  END LOOP;
END $$;

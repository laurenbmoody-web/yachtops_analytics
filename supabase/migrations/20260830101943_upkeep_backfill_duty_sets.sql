-- ─────────────────────────────────────────────────────────────────────────────
-- 20260830101943_upkeep_backfill_duty_sets.sql
--
-- WHAT: Backfill the existing Interior duty sets into Upkeep — 17 sets / 162
--       steps become upkeep_schedules rows plus upkeep_steps rows, expanding the
--       duty_set_templates.tasks jsonb blob.
--
-- TWO STEP SHAPES exist in the data and both must survive:
--   A. {id, text, frequency}  — 11 sets, 127 steps (Daily Service / Weekly
--      Maintenance / Monthly Deep Clean). frequency is per-step, e.g. a weekly
--      set spreading its work across 'weekly-monday' … 'weekly-saturday'.
--   B. {title}                — 6 sets, 35 steps (Daily Duties). No id, no
--      frequency. Text lives under 'title', not 'text'.
-- Hence coalesce(text, title); a set that matched neither would be caught by the
-- assertion at the foot of this migration.
--
-- CATEGORY is carried over verbatim and stays FREE TEXT — Interior and
--       Engineering are too different to share an enum.
--
-- NAMES are left exactly as they are ('Laundry — weekly' keeps its suffix).
--       Renaming would collide with the 'Laundry' Daily Duties set; tidy them in
--       the UI, by hand, where the collision is visible.
--
-- calendar_rule is derived from the category, and for weekly sets the days come
--       from the distinct per-step frequencies actually present in that set.
--
-- IDEMPOTENT: keyed on upkeep_schedules.source_duty_set_id (unique index from
--       20260830120000). Re-running inserts nothing and re-syncs nothing.
--       duty_set_templates is left in place until the new path is proven.
-- ─────────────────────────────────────────────────────────────────────────────

DO $$
DECLARE
  v_sets_before    integer;
  v_sets_after     integer;
  v_steps_expected integer;
  v_steps_after    integer;
  v_untexted       integer;
BEGIN
  SELECT count(*) INTO v_sets_before FROM public.duty_set_templates;

  -- Any step we could not read text from would silently vanish; refuse instead.
  SELECT count(*) INTO v_untexted
    FROM public.duty_set_templates t, LATERAL jsonb_array_elements(t.tasks) s
   WHERE coalesce(s->>'text', s->>'title') IS NULL;
  IF v_untexted > 0 THEN
    RAISE EXCEPTION 'Upkeep backfill: % duty-set step(s) have neither text nor title', v_untexted;
  END IF;

  SELECT count(*) INTO v_steps_expected
    FROM public.duty_set_templates t, LATERAL jsonb_array_elements(t.tasks) s;

  -- ── schedules ──────────────────────────────────────────────────────────────
  INSERT INTO public.upkeep_schedules (
    tenant_id, department_id, name, category, equipment_id, estimated_minutes,
    trigger_type, calendar_rule, lead_time_days, active, source_duty_set_id,
    created_by, created_at
  )
  SELECT
    t.tenant_id,
    t.department_id,
    t.name,
    t.category,                                    -- free text, verbatim
    NULL,                                          -- Interior sets have no equipment
    t.estimated_duration,
    'calendar',
    CASE
      WHEN t.category ILIKE 'daily%'   THEN jsonb_build_object('kind','daily')
      WHEN t.category ILIKE 'monthly%' THEN jsonb_build_object('kind','monthly','day',1)
      WHEN t.category ILIKE 'weekly%'  THEN jsonb_build_object(
        'kind','weekly',
        'days', COALESCE((
          SELECT jsonb_agg(DISTINCT replace(s->>'frequency','weekly-',''))
            FROM jsonb_array_elements(t.tasks) s
           WHERE s->>'frequency' LIKE 'weekly-%'
        ), jsonb_build_array('monday')))
      ELSE jsonb_build_object('kind','daily')      -- shouldn't arise; safe default
    END,
    0,
    true,
    t.id,
    t.created_by,
    t.created_at
  FROM public.duty_set_templates t
  WHERE NOT EXISTS (
    SELECT 1 FROM public.upkeep_schedules u WHERE u.source_duty_set_id = t.id
  );

  -- ── steps ──────────────────────────────────────────────────────────────────
  -- Only for schedules that have no steps yet, so a re-run is a no-op.
  INSERT INTO public.upkeep_steps (
    tenant_id, schedule_id, position, text, step_type, frequency, is_mandatory
  )
  SELECT
    u.tenant_id,
    u.id,
    (s.ord - 1)::integer,
    coalesce(s.elem->>'text', s.elem->>'title'),
    'check',                                       -- every Interior step is pass/fail
    s.elem->>'frequency',                          -- null for the {title} shape
    false
  FROM public.upkeep_schedules u
  JOIN public.duty_set_templates t ON t.id = u.source_duty_set_id
  CROSS JOIN LATERAL jsonb_array_elements(t.tasks) WITH ORDINALITY AS s(elem, ord)
  WHERE u.source_duty_set_id IS NOT NULL
    AND NOT EXISTS (SELECT 1 FROM public.upkeep_steps st WHERE st.schedule_id = u.id);

  -- ── assertions ─────────────────────────────────────────────────────────────
  SELECT count(*) INTO v_sets_after
    FROM public.upkeep_schedules WHERE source_duty_set_id IS NOT NULL;
  SELECT count(*) INTO v_steps_after
    FROM public.upkeep_steps st
    JOIN public.upkeep_schedules u ON u.id = st.schedule_id
   WHERE u.source_duty_set_id IS NOT NULL;

  IF v_sets_after <> v_sets_before THEN
    RAISE EXCEPTION 'Upkeep backfill: expected % schedules, got %', v_sets_before, v_sets_after;
  END IF;
  IF v_steps_after <> v_steps_expected THEN
    RAISE EXCEPTION 'Upkeep backfill: expected % steps, got %', v_steps_expected, v_steps_after;
  END IF;

  RAISE NOTICE 'Upkeep backfill: % schedules, % steps', v_sets_after, v_steps_after;
END $$;

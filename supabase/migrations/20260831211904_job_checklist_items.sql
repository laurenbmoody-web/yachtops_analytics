-- One checklist for a job, whatever raised it.
--
-- A job is the primitive — a card. A checklist is something a card HAS, not a
-- property of where the card came from. Until now that one idea had three
-- separate implementations:
--
--   team_jobs.metadata.checklist  jsonb {id,text,completed,checklistName} — the
--                                 manual path. Fully coded in three modals and
--                                 never once used: zero jobs carry one.
--   duty_task_progress            real rows, tick + note, keyed (job_id,task_id).
--                                 The only one with live data.
--   upkeep_step_results           typed steps with readings and frozen text.
--                                 Zero rows.
--
-- This is the one table. Origin decides who FILLS the list, not whether a list
-- exists, so a duty round, an upkeep procedure, a promoted defect and a job
-- someone typed all render through the same component.
--
-- WHAT IT ADDS OVER duty_task_progress
--   text          frozen at materialisation. duty_task_progress stores only a
--                 task_id and reads the wording live from the template, so
--                 editing a task silently rewrites what every past tick claims
--                 to have covered. Class and flag ask what the procedure WAS.
--   item_type     check | reading | photo | note. A reading carries a unit and
--                 a normal range, which is what lets a galley fridge temp and a
--                 manometer reading be captured at all.
--   section       the named grouping. duty_task_progress had none and the UI
--                 recomputed it; the unused manual path called it
--                 `checklistName`. Same idea, so it becomes one column: a duty
--                 job gets 'Today' / 'Tuesday' / 'Monthly — falling due'
--                 generated, a manual card gets whatever someone types.
--   status        pending | done | skipped | failed, where there was only a
--                 boolean. "Problem found" is not "not done yet".
--
-- WHAT IT DELIBERATELY DOES NOT CARRY
--   Stock. job_links already points a job at the stock it uses and the gear it
--   services, consumes on completion and restores on reopen, multi-location
--   aware and against the movements ledger. Linking belongs on the card, at
--   that altitude, and duplicating it per-item would give two things permission
--   to move the same stock.
--
-- PRESERVED SEMANTICS
--   auto_completed — completing a job auto-ticks its dailies; reopening clears
--                    only those and never a tick someone made themselves.
--   last-done      — the monthly-falling-due rule reads "when was this task
--                    last done anywhere on this vessel", so the index on
--                    (tenant_id, template_id, origin_ref, done_at) is carried
--                    over exactly.
--
-- IDEMPOTENT: CREATE ... IF NOT EXISTS throughout; the backfill is keyed on the
-- unique (job_id, origin_kind, origin_ref) and re-runs to nothing.

CREATE TABLE IF NOT EXISTS public.job_checklist_items (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id      uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  job_id         uuid NOT NULL REFERENCES public.team_jobs(id) ON DELETE CASCADE,

  section        text,
  position       integer NOT NULL DEFAULT 0,

  text           text NOT NULL,
  item_type      text NOT NULL DEFAULT 'check',
  unit           text,
  min_normal     numeric,
  max_normal     numeric,
  is_mandatory   boolean NOT NULL DEFAULT false,
  guidance       text,

  status         text NOT NULL DEFAULT 'pending',
  value_numeric  numeric,
  value_text     text,
  note           text,
  photo_url      text,
  out_of_range   boolean NOT NULL DEFAULT false,
  auto_completed boolean NOT NULL DEFAULT false,
  done_at        timestamptz,
  done_by        uuid,
  done_by_name   text,

  origin_kind    text NOT NULL DEFAULT 'manual',
  origin_ref     text,
  template_id    uuid,
  counter_id     uuid REFERENCES public.equipment_counters(id) ON DELETE SET NULL,

  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT job_checklist_items_type_chk
    CHECK (item_type IN ('check','reading','photo','note')),
  CONSTRAINT job_checklist_items_status_chk
    CHECK (status IN ('pending','done','skipped','failed')),
  CONSTRAINT job_checklist_items_origin_chk
    CHECK (origin_kind IN ('duty','upkeep','defect','manual')),
  CONSTRAINT job_checklist_items_reading_unit_chk
    CHECK (item_type <> 'reading' OR unit IS NOT NULL),
  CONSTRAINT job_checklist_items_range_chk
    CHECK (min_normal IS NULL OR max_normal IS NULL OR min_normal <= max_normal)
);

CREATE INDEX IF NOT EXISTS job_checklist_items_job_idx
  ON public.job_checklist_items (job_id, position);
CREATE INDEX IF NOT EXISTS job_checklist_items_tenant_idx
  ON public.job_checklist_items (tenant_id);

-- "when was this task last done anywhere on this vessel" — the monthly
-- falling-due rule. Mirrors duty_task_progress_last_done_idx.
CREATE INDEX IF NOT EXISTS job_checklist_items_last_done_idx
  ON public.job_checklist_items (tenant_id, template_id, origin_ref, done_at DESC)
  WHERE status = 'done';

-- One row per generated item per job, so materialising is idempotent and a
-- double-open cannot duplicate a round. Manual items have no origin_ref and are
-- deliberately free to repeat.
CREATE UNIQUE INDEX IF NOT EXISTS job_checklist_items_origin_uq
  ON public.job_checklist_items (job_id, origin_kind, origin_ref)
  WHERE origin_ref IS NOT NULL;

ALTER TABLE public.job_checklist_items ENABLE ROW LEVEL SECURITY;

-- Any active member of the tenant, matching duty_task_progress and job_links:
-- the crew member doing the round is the one ticking the boxes. Case-insensitive
-- on status — the column holds lowercase 'active', and an exact-match 'ACTIVE'
-- comparison is what silently broke duty_set_templates.
DO $do$
DECLARE op text;
BEGIN
  FOREACH op IN ARRAY ARRAY['select','insert','update','delete'] LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.job_checklist_items',
                   'job_checklist_items_' || op);
  END LOOP;
END $do$;

CREATE POLICY job_checklist_items_select ON public.job_checklist_items
  FOR SELECT TO authenticated USING (
    tenant_id IN (SELECT tm.tenant_id FROM public.tenant_members tm
                  WHERE tm.user_id = auth.uid() AND tm.active = true
                    AND upper(tm.status) = 'ACTIVE'));

CREATE POLICY job_checklist_items_insert ON public.job_checklist_items
  FOR INSERT TO authenticated WITH CHECK (
    tenant_id IN (SELECT tm.tenant_id FROM public.tenant_members tm
                  WHERE tm.user_id = auth.uid() AND tm.active = true
                    AND upper(tm.status) = 'ACTIVE'));

CREATE POLICY job_checklist_items_update ON public.job_checklist_items
  FOR UPDATE TO authenticated USING (
    tenant_id IN (SELECT tm.tenant_id FROM public.tenant_members tm
                  WHERE tm.user_id = auth.uid() AND tm.active = true
                    AND upper(tm.status) = 'ACTIVE'));

CREATE POLICY job_checklist_items_delete ON public.job_checklist_items
  FOR DELETE TO authenticated USING (
    tenant_id IN (SELECT tm.tenant_id FROM public.tenant_members tm
                  WHERE tm.user_id = auth.uid() AND tm.active = true
                    AND upper(tm.status) = 'ACTIVE'));

CREATE OR REPLACE FUNCTION public.job_checklist_items_touch()
RETURNS trigger LANGUAGE plpgsql AS $fn$
BEGIN NEW.updated_at = now(); RETURN NEW; END $fn$;

DROP TRIGGER IF EXISTS job_checklist_items_touch ON public.job_checklist_items;
CREATE TRIGGER job_checklist_items_touch BEFORE UPDATE ON public.job_checklist_items
  FOR EACH ROW EXECUTE FUNCTION public.job_checklist_items_touch();

-- ── carry the live duty ticks across ─────────────────────────────────────────
-- The wording is resolved out of the template's jsonb by task id, because that
-- is the whole point: from here on the text is stored, not looked up. A row
-- whose task has since been deleted from its template keeps a readable
-- placeholder rather than being dropped — somebody did that work.
INSERT INTO public.job_checklist_items (
  tenant_id, job_id, section, position, text, item_type,
  status, note, auto_completed, done_at, done_by,
  origin_kind, origin_ref, template_id, created_at
)
SELECT
  p.tenant_id,
  p.job_id,
  CASE
    WHEN lower(coalesce(e.freq,'daily')) LIKE 'monthly%' THEN 'Monthly'
    WHEN lower(coalesce(e.freq,'daily')) LIKE 'weekly-%'
      THEN initcap(split_part(lower(e.freq), '-', 2))
    ELSE 'Today'
  END,
  coalesce(e.ord, 0)::integer,
  coalesce(e.txt, '(task since removed from the duty set)'),
  'check',
  CASE WHEN p.done THEN 'done' ELSE 'pending' END,
  p.note,
  coalesce(p.auto_completed, false),
  p.done_at,
  p.done_by,
  'duty',
  p.task_id,
  p.template_id,
  p.created_at
FROM public.duty_task_progress p
LEFT JOIN LATERAL (
  SELECT el->>'text' AS txt, el->>'frequency' AS freq, ord - 1 AS ord
  FROM public.duty_set_templates t,
       LATERAL jsonb_array_elements(t.tasks) WITH ORDINALITY AS a(el, ord)
  WHERE t.id = p.template_id AND el->>'id' = p.task_id
  LIMIT 1
) e ON true
ON CONFLICT DO NOTHING;

-- ── retire the empty parallel table ──────────────────────────────────────────
-- upkeep_step_results was the third implementation of this idea and never
-- carried a row. duty_task_progress is deliberately LEFT IN PLACE: it holds the
-- only live data this migration copies, and it stays readable until the new
-- path has been exercised.
DROP TABLE IF EXISTS public.upkeep_step_results;

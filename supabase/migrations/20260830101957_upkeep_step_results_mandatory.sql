-- ─────────────────────────────────────────────────────────────────────────────
-- 20260830101957_upkeep_step_results_mandatory.sql
--
-- WHAT: Carry is_mandatory onto the occurrence's frozen step copy.
--
-- WHY: whether a step blocked sign-off is part of the contract the job was
--      generated under, exactly like step_text. Reading it live from
--      upkeep_steps would mean un-ticking a "required" box on the schedule
--      retroactively changed what a past job was allowed to be signed off with.
--      Freeze it with everything else.
--
-- IDEMPOTENT: ADD COLUMN IF NOT EXISTS.
-- ─────────────────────────────────────────────────────────────────────────────
ALTER TABLE public.upkeep_step_results
  ADD COLUMN IF NOT EXISTS is_mandatory boolean NOT NULL DEFAULT false;

-- ─────────────────────────────────────────────────────────────────────────────
-- 20260830103218_upkeep_step_results_counter.sql
--
-- WHAT: Carry counter_id onto the occurrence's frozen step copy.
--
-- WHY: a reading step can be wired to an equipment counter ("record running
--      hours"), and the whole point of that wiring is that the number typed
--      during the job feeds equipment_counter_readings — which is what drives
--      the next counter-based due date. Without the id on the result row the
--      runner has nothing to post against and the reading dead-ends in the job.
--
--      Frozen like step_text: re-pointing the schedule at a different counter
--      must not retarget readings already taken.
--
-- IDEMPOTENT: ADD COLUMN IF NOT EXISTS.
-- ─────────────────────────────────────────────────────────────────────────────
ALTER TABLE public.upkeep_step_results
  ADD COLUMN IF NOT EXISTS counter_id uuid REFERENCES public.equipment_counters(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS upkeep_step_results_counter_idx
  ON public.upkeep_step_results (counter_id) WHERE counter_id IS NOT NULL;

-- ─────────────────────────────────────────────────────────────────────────────
-- 20260716240000_defects_repair_stage.sql
--
-- WHAT: A repair works stage on a defect — the external-contractor progression
--       (contacted → awaiting quote → quote in → scheduled → in progress →
--       complete), distinct from the internal defect status. Each change is
--       stamped into defect_events by the app, giving a traceable works history.
--
--       Free text (app-validated) rather than an enum, so the stage set can
--       evolve without a migration.
--
-- IDEMPOTENT: ADD COLUMN IF NOT EXISTS.
-- ─────────────────────────────────────────────────────────────────────────────
ALTER TABLE public.defects
  ADD COLUMN IF NOT EXISTS repair_stage text;

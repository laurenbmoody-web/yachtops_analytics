-- ─────────────────────────────────────────────────────────────────────────────
-- 20260614200000_hor_approver_tier_default_chief.sql
--
-- WHAT: Default the HOR approver tier to CHIEF ('Chief & above') rather than
--       COMMAND. New vessels default to CHIEF; existing vessels still sitting on
--       the auto-applied COMMAND default are moved to CHIEF too — the feature is
--       new, so no deliberate Command-only choices exist yet. A vessel can still
--       choose Command-only in settings afterwards.
-- IDEMPOTENT: SET DEFAULT is declarative; the UPDATE runs once (migration is
--             recorded in history and won't re-run).
-- ─────────────────────────────────────────────────────────────────────────────

ALTER TABLE public.vessels ALTER COLUMN hor_approver_tier SET DEFAULT 'CHIEF';

UPDATE public.vessels
  SET hor_approver_tier = 'CHIEF'
  WHERE hor_approver_tier = 'COMMAND';

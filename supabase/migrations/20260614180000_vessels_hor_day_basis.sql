-- ─────────────────────────────────────────────────────────────────────────────
-- 20260614180000_vessels_hor_day_basis.sql
--
-- WHAT: Per-vessel choice of how the Hours-of-Rest record slices the "24-hour
--       period" for the daily 10h rest rule:
--         'calendar'    – fixed 00:00–24:00 day (the classic IMO/ILO sheet) [default]
--         'operational' – a 24h day anchored at vessels.operational_day_start_hour
--                          (kills the midnight-split false breaches for vessels
--                          whose real day doesn't start at midnight)
--
--       Default 'calendar' = no behaviour change for existing vessels; the
--       operational basis is strictly opt-in. Only the HOR record/grid/PDF read
--       this for now — live rota-painting warnings are unaffected.
-- IDEMPOTENT: ADD COLUMN IF NOT EXISTS + guarded CHECK constraint.
-- ─────────────────────────────────────────────────────────────────────────────

ALTER TABLE public.vessels
  ADD COLUMN IF NOT EXISTS hor_day_basis text NOT NULL DEFAULT 'calendar';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'vessels_hor_day_basis_check'
  ) THEN
    ALTER TABLE public.vessels
      ADD CONSTRAINT vessels_hor_day_basis_check
      CHECK (hor_day_basis IN ('calendar', 'operational'));
  END IF;
END $$;

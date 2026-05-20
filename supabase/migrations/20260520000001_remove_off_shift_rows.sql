-- ─────────────────────────────────────────────────────────────────────────────
-- 20260520000001_remove_off_shift_rows.sql
--
-- WHAT: Deletes every rota_shifts row with shift_type='off'.
--
-- WHY: As of 2026-05-20 "Off" is no longer a valid shift type in the rota
--      builder model — an empty cell IS the off state. The 2 live rows
--      with shift_type='off' are now orphaned and should be removed so the
--      grid renders them as empty (the new off-state representation).
--
-- IDEMPOTENT: the DELETE naturally re-runs to no-op if already clean
--      (no rows match the predicate the second time).
--
-- DELIBERATELY NOT CHANGING: the rota_shifts_shift_type_check CHECK
--      constraint still lists 'off' as an allowed value. Tightening it
--      would mean another schema migration for a value nothing emits;
--      the unused allowed value is harmless. Leave as-is.
--
-- ROLLBACK: there is none — these rows are deleted intentionally and the
--      app no longer creates them. If a row needs to come back it can be
--      re-inserted by hand.
-- ─────────────────────────────────────────────────────────────────────────────

DELETE FROM public.rota_shifts
WHERE shift_type = 'off';

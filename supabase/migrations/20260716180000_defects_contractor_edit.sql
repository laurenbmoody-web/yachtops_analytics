-- ─────────────────────────────────────────────────────────────────────────────
-- 20260716180000_defects_contractor_edit.sql
--
-- WHAT: Fields for scheduling a fix and recording an external contractor on a
--       defect — who's doing the work, their details, and when it's booked in.
--
-- IDEMPOTENT: ADD COLUMN IF NOT EXISTS.
-- ─────────────────────────────────────────────────────────────────────────────
ALTER TABLE public.defects
  ADD COLUMN IF NOT EXISTS contractor_name    text,
  ADD COLUMN IF NOT EXISTS contractor_details text,
  ADD COLUMN IF NOT EXISTS scheduled_fix_at   date;

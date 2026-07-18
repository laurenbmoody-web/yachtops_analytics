-- ─────────────────────────────────────────────────────────────────────────────
-- 20260718200000_laundry_stays_onboard.sql
--
-- Soft "usually stays on board" flag on a garment — a helper for new crew ("this
-- normally stays unless told otherwise"), NOT a constraint. The item can still be
-- packed and sent with the owner at any time. Nullable = unspecified.
-- ─────────────────────────────────────────────────────────────────────────────

ALTER TABLE public.laundry_items ADD COLUMN IF NOT EXISTS stays_onboard boolean;

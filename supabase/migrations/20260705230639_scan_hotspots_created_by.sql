-- ─────────────────────────────────────────────────────────────────────────────
-- 20260705230639_scan_hotspots_created_by.sql
--
-- WHAT: Adds nullable created_by to scan_hotspots, set on insert from the
--       session user. The vessel-map inspector's Details tab shows who
--       pinned what; NULL reads as "before we tracked this" — no backfill,
--       by design.
--
-- IDEMPOTENCY: ADD COLUMN IF NOT EXISTS. Safe to re-apply.
-- ─────────────────────────────────────────────────────────────────────────────

ALTER TABLE public.scan_hotspots
  ADD COLUMN IF NOT EXISTS created_by uuid REFERENCES auth.users(id);

COMMENT ON COLUMN public.scan_hotspots.created_by IS
  'Who pinned it — set by the app on insert; NULL predates tracking.';

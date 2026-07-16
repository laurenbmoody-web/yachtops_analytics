-- ─────────────────────────────────────────────────────────────────────────────
-- 20260716120000_defects_notify_users.sql
--
-- WHAT: Add public.defects.notify_user_ids — extra people to notify on a defect
--       beyond its assignee/team (e.g. a stew logs damage, assigns it to the
--       Engineering team, but also CCs the Chief Stew). Stored as a jsonb array
--       of { id, name } so the card can show who's watching.
--
-- IDEMPOTENT: ADD COLUMN IF NOT EXISTS.
-- ─────────────────────────────────────────────────────────────────────────────
ALTER TABLE public.defects
  ADD COLUMN IF NOT EXISTS notify_user_ids jsonb NOT NULL DEFAULT '[]';

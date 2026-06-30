-- ─────────────────────────────────────────────────────────────────────────────
-- 20260627180000_collaborators_added_at_backfill.sql
--
-- Heal schema drift on provisioning_list_collaborators.
--
-- The original sharing migration (20260330100000) created the table with
-- `added_at` + `added_by` via CREATE TABLE IF NOT EXISTS. On the live
-- project the table already existed (an earlier Studio/one-off create)
-- WITHOUT those columns, so IF NOT EXISTS skipped the create and the
-- columns never landed. fetchCollaborators ORDER BYs added_at, so the
-- query 400s:
--   column provisioning_list_collaborators.added_at does not exist
-- and the Share modal silently shows no collaborators.
--
-- Add the columns idempotently so the table matches the schema the code
-- expects, regardless of how it was first created.
-- ─────────────────────────────────────────────────────────────────────────────

ALTER TABLE public.provisioning_list_collaborators
  ADD COLUMN IF NOT EXISTS added_at timestamptz NOT NULL DEFAULT now();

ALTER TABLE public.provisioning_list_collaborators
  ADD COLUMN IF NOT EXISTS added_by uuid;

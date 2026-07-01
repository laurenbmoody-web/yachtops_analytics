-- ─────────────────────────────────────────────────────────────────────────────
-- 20260701140000_retrigger_migrations_ci.sql
--
-- No-op migration. Sole purpose: land a change under supabase/migrations/**
-- so the "Supabase — apply migrations" workflow fires on push to main.
--
-- Context: the pipeline was jammed 2026-06-30 → 07-01 by orphan versions in
-- the remote history that the drift-heal step failed to detect (it didn't
-- strip the backticks the CLI wraps table cells in — fixed in the workflow
-- alongside this). The fix only touches .github/workflows/, which the
-- migrations workflow's `paths:` filter ignores, and the CI integration
-- can't trigger workflow_dispatch. This empty migration is the trigger:
-- the fixed run reconciles the orphan history and applies the two pending
-- migrations (20260701120000 unavailable status, 20260701130000 delivery
-- rollup) that were stuck behind the jam.
--
-- Intentionally does nothing to the schema.
-- ─────────────────────────────────────────────────────────────────────────────

SELECT 1;

-- ─────────────────────────────────────────────────────────────────────────────
-- 20260617140000_provisioning_items_backfill_creator_dept.sql
--
-- NO-OP.
--
-- This was originally a follow-up backfill that retagged each item to its
-- list creator's department. After multiple parser-level failures in CI
-- (UPDATE … FROM with chained JOINs, CTE form both rejected) and the
-- user confirming the historical retag doesn't matter — forward writes
-- already honour the adder's dept thanks to the PR that introduced
-- currentDepartment in AddItemsModal — the migration was reduced to a
-- no-op so the queue could drain and let the supplier-portal trigger
-- fix (20260617150000) land.
--
-- Existing items keep whatever department they were tagged with.
-- Newly added items honour the adder's department.
-- ─────────────────────────────────────────────────────────────────────────────

SELECT 1;

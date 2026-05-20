-- ─────────────────────────────────────────────────────────────────────────────
-- 20260520000002_remove_off_seed_template.sql
--
-- WHAT: Deletes the per-tenant "Off" vessel-scope template from
--       rota_shift_templates (one row per tenant — 5 rows in live).
--
-- WHY: Companion to 20260520000001_remove_off_shift_rows.sql — "Off" was
--      retired as a shift type on 2026-05-20. The original seed
--      (20260518000007_seed_default_templates.sql) created an "Off"
--      vessel-scope template per tenant; that template no longer
--      reflects the model and should be cleared from live.
--
-- IDEMPOTENT: the DELETE naturally no-ops on re-run (the predicate
--      stops matching anything once the rows are gone).
--
-- TIGHT PREDICATE: matched by all of name='Off', scope='vessel', and
--      body->>'shift_type'='off' so the migration cannot collateral-
--      damage any unrelated future template that happens to be named
--      'Off'. is_default is not required in the predicate (every seed
--      row has is_default=true; relying on the three above is enough
--      and stays correct if the column is ever toggled).
--
-- ROLLBACK: re-insert by hand if ever needed (the seed migration's
--      "Off" row was removed in the same change so it will not be
--      recreated on a fresh apply).
-- ─────────────────────────────────────────────────────────────────────────────

DELETE FROM public.rota_shift_templates
WHERE name = 'Off'
  AND scope = 'vessel'
  AND body->>'shift_type' = 'off';

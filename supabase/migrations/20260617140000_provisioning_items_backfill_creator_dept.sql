-- ─────────────────────────────────────────────────────────────────────────────
-- 20260617140000_provisioning_items_backfill_creator_dept.sql
--
-- Follow-up to 20260617132100. That migration only retagged items where
-- `department = 'Bar'`, but most legacy items were tagged 'Galley' via the
-- catalogue group default — so a Bridge user who created a board and added
-- food + drink lines ended up with everything under "Galley" instead of
-- their own "Bridge" department.
--
-- provisioning_items has no per-row added_by column, so the best proxy
-- for "the user who set it" is the list's creator. This migration sets
-- every existing item's department to the name of the list creator's
-- tenant_members.department, scoped to the list's vessel/tenant.
--
-- Items whose list creator has no resolvable dept (e.g. created_by is
-- null, or the member has no department_id) are left untouched so we
-- don't accidentally overwrite explicit choices with NULLs.
--
-- Idempotent: re-running is a no-op once item.department == creator
-- dept name.
-- ─────────────────────────────────────────────────────────────────────────────

WITH creator_dept AS (
  SELECT
    pl.id     AS list_id,
    d.name    AS dept_name
  FROM public.provisioning_lists pl
  JOIN public.vessels         v  ON v.id  = pl.vessel_id
  JOIN public.tenant_members  tm ON tm.user_id   = pl.created_by
                                 AND tm.tenant_id = v.tenant_id
                                 AND tm.active IS NOT FALSE
  JOIN public.departments     d  ON d.id  = tm.department_id
)
UPDATE public.provisioning_items pi
   SET department = cd.dept_name
  FROM creator_dept cd
 WHERE pi.list_id = cd.list_id
   AND (pi.department IS DISTINCT FROM cd.dept_name);

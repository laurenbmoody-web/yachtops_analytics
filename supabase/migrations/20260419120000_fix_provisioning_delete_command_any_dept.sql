-- Re-apply correct provisioning_lists DELETE policy.
-- Previous policies (20260411130000 and 20260419110000) may not have been
-- applied to the live DB.  This superseding migration ensures COMMAND users
-- can delete any board in their tenant regardless of visibility or department,
-- and that the active check uses IS NOT FALSE (handles NULL values).

DROP POLICY IF EXISTS "provisioning_lists_delete" ON public.provisioning_lists;

CREATE POLICY "provisioning_lists_delete"
  ON public.provisioning_lists FOR DELETE TO authenticated
  USING (
    -- Board owner or creator
    owner_id   = auth.uid()
    OR created_by = auth.uid()
    -- COMMAND: full delete rights across the entire tenant (any visibility, any dept)
    OR EXISTS (
      SELECT 1 FROM public.tenant_members
      WHERE user_id        = auth.uid()
        AND tenant_id      = provisioning_lists.tenant_id
        AND active IS NOT FALSE
        AND permission_tier = 'COMMAND'
    )
    -- CHIEF: can delete boards in their own department
    OR (
      department_id IS NOT NULL
      AND EXISTS (
        SELECT 1 FROM public.tenant_members
        WHERE user_id        = auth.uid()
          AND tenant_id      = provisioning_lists.tenant_id
          AND active IS NOT FALSE
          AND permission_tier = 'CHIEF'
          AND department_id  = provisioning_lists.department_id
      )
    )
  );

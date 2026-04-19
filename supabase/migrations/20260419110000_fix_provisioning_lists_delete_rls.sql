-- The previous delete policy incorrectly restricted COMMAND to boards with
-- visibility = 'department', so vessel-level boards were undeletable.
-- COMMAND users should be able to delete any board in their tenant.

DROP POLICY IF EXISTS "provisioning_lists_delete" ON public.provisioning_lists;

CREATE POLICY "provisioning_lists_delete"
  ON public.provisioning_lists FOR DELETE TO authenticated
  USING (
    -- Board owner / creator
    owner_id   = auth.uid()
    OR created_by = auth.uid()
    -- COMMAND tier: full delete rights across the tenant, any visibility
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

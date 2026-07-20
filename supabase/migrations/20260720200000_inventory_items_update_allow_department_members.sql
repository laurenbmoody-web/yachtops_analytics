-- Let any department member (incl. crew) edit/move items they can see, matching
-- the SELECT policy. DELETE stays restricted to Command / Chief / HOD (unchanged).
DROP POLICY IF EXISTS "inventory_items_update" ON public.inventory_items;

CREATE POLICY "inventory_items_update"
  ON public.inventory_items
  FOR UPDATE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.tenant_members tm
      WHERE tm.user_id = auth.uid()
        AND tm.tenant_id = inventory_items.tenant_id
        AND tm.active IS NOT FALSE
        AND (
          tm.permission_tier = ANY (ARRAY['COMMAND'::text, 'CHIEF'::text])
          OR EXISTS (
            SELECT 1 FROM public.departments d
            WHERE d.id = tm.department_id
              AND upper(d.name) = inventory_items.usage_department
          )
        )
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.tenant_members tm
      WHERE tm.user_id = auth.uid()
        AND tm.tenant_id = inventory_items.tenant_id
        AND tm.active IS NOT FALSE
        AND (
          tm.permission_tier = ANY (ARRAY['COMMAND'::text, 'CHIEF'::text])
          OR EXISTS (
            SELECT 1 FROM public.departments d
            WHERE d.id = tm.department_id
              AND upper(d.name) = inventory_items.usage_department
          )
        )
    )
  );

-- Fix provisioning_lists DELETE and UPDATE RLS.
--
-- Correct rules:
--   Any tier  - can delete/update their own board (owner_id = auth.uid())
--   COMMAND   - can delete/update any board in the tenant
--   CHIEF     - can delete/update boards belonging to their department

DROP POLICY IF EXISTS "Owners can delete provisioning lists" ON provisioning_lists;
DROP POLICY IF EXISTS "Owners can update provisioning lists" ON provisioning_lists;

CREATE POLICY "Owners can delete provisioning lists" ON provisioning_lists
FOR DELETE USING (
  owner_id = auth.uid()
  OR EXISTS (
    SELECT 1 FROM tenant_members
    WHERE user_id = auth.uid()
      AND active = true
      AND permission_tier = 'COMMAND'
      AND tenant_id = provisioning_lists.tenant_id
  )
  OR EXISTS (
    SELECT 1 FROM tenant_members
    WHERE user_id = auth.uid()
      AND active = true
      AND permission_tier = 'CHIEF'
      AND tenant_id = provisioning_lists.tenant_id
      AND department_id = provisioning_lists.department_id
      AND provisioning_lists.department_id IS NOT NULL
  )
);

CREATE POLICY "Owners can update provisioning lists" ON provisioning_lists
FOR UPDATE USING (
  owner_id = auth.uid()
  OR EXISTS (
    SELECT 1 FROM tenant_members
    WHERE user_id = auth.uid()
      AND active = true
      AND permission_tier = 'COMMAND'
      AND tenant_id = provisioning_lists.tenant_id
  )
  OR EXISTS (
    SELECT 1 FROM tenant_members
    WHERE user_id = auth.uid()
      AND active = true
      AND permission_tier = 'CHIEF'
      AND tenant_id = provisioning_lists.tenant_id
      AND department_id = provisioning_lists.department_id
      AND provisioning_lists.department_id IS NOT NULL
  )
);

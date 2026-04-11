-- Fix provisioning_lists DELETE and UPDATE RLS.
--
-- Rules:
--   Any tier  - can delete/update their own board (any visibility, including private)
--   COMMAND   - can delete/update non-private boards in the tenant
--   CHIEF     - can delete/update non-private boards belonging to their department
--
-- Private boards are invisible and untouchable by anyone except the owner.

DROP POLICY IF EXISTS "Owners can delete provisioning lists" ON provisioning_lists;
DROP POLICY IF EXISTS "Owners can update provisioning lists" ON provisioning_lists;

CREATE POLICY "Owners can delete provisioning lists" ON provisioning_lists
FOR DELETE USING (
  owner_id = auth.uid()
  OR (
    provisioning_lists.visibility != 'private'
    AND EXISTS (
      SELECT 1 FROM tenant_members
      WHERE user_id = auth.uid()
        AND active = true
        AND permission_tier = 'COMMAND'
        AND tenant_id = provisioning_lists.tenant_id
    )
  )
  OR (
    provisioning_lists.visibility != 'private'
    AND EXISTS (
      SELECT 1 FROM tenant_members
      WHERE user_id = auth.uid()
        AND active = true
        AND permission_tier = 'CHIEF'
        AND tenant_id = provisioning_lists.tenant_id
        AND department_id = provisioning_lists.department_id
        AND provisioning_lists.department_id IS NOT NULL
    )
  )
);

CREATE POLICY "Owners can update provisioning lists" ON provisioning_lists
FOR UPDATE USING (
  owner_id = auth.uid()
  OR (
    provisioning_lists.visibility != 'private'
    AND EXISTS (
      SELECT 1 FROM tenant_members
      WHERE user_id = auth.uid()
        AND active = true
        AND permission_tier = 'COMMAND'
        AND tenant_id = provisioning_lists.tenant_id
    )
  )
  OR (
    provisioning_lists.visibility != 'private'
    AND EXISTS (
      SELECT 1 FROM tenant_members
      WHERE user_id = auth.uid()
        AND active = true
        AND permission_tier = 'CHIEF'
        AND tenant_id = provisioning_lists.tenant_id
        AND department_id = provisioning_lists.department_id
        AND provisioning_lists.department_id IS NOT NULL
    )
  )
);

-- Fix provisioning_lists DELETE and UPDATE RLS so that COMMAND and CHIEF
-- can delete/edit any board, not just their own.
--
-- Previous policies only allowed owner_id = auth.uid(), which blocked CHIEF
-- users from deleting boards they did not personally create.
--
-- New rule:
--   COMMAND or CHIEF  - any board in their tenant
--   Owner (any tier)  - their own board
--   HOD               - boards they own only (dept-scoped edits stay in the app layer)

DROP POLICY IF EXISTS "Owners can delete provisioning lists" ON provisioning_lists;
DROP POLICY IF EXISTS "Owners can update provisioning lists" ON provisioning_lists;

CREATE POLICY "Owners can delete provisioning lists" ON provisioning_lists
FOR DELETE USING (
  owner_id = auth.uid()
  OR EXISTS (
    SELECT 1 FROM tenant_members
    WHERE user_id = auth.uid()
      AND active = true
      AND permission_tier IN ('COMMAND', 'CHIEF')
      AND tenant_id = provisioning_lists.tenant_id
  )
);

CREATE POLICY "Owners can update provisioning lists" ON provisioning_lists
FOR UPDATE USING (
  owner_id = auth.uid()
  OR EXISTS (
    SELECT 1 FROM tenant_members
    WHERE user_id = auth.uid()
      AND active = true
      AND permission_tier IN ('COMMAND', 'CHIEF')
      AND tenant_id = provisioning_lists.tenant_id
  )
);

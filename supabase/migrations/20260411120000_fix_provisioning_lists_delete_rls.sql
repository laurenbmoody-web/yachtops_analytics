-- Fix provisioning_lists DELETE (and UPDATE) RLS so that COMMAND and CHIEF
-- can delete/edit any board, not just their own.
--
-- Previous policies only allowed owner_id = auth.uid(), which blocked CHIEF
-- users from deleting boards they did not personally create.
--
-- New rule (mirrors the app's canEdit / canDelete logic):
--   COMMAND or CHIEF  → any board in their tenant
--   Owner (any tier)  → their own board
--   HOD               → boards they own (dept-scoped edits stay in the app layer)

-- ── DELETE ────────────────────────────────────────────────────────────────────
DROP POLICY IF EXISTS "Owners can delete provisioning lists" ON provisioning_lists;

CREATE POLICY "Owners can delete provisioning lists" ON provisioning_lists
FOR DELETE USING (
  -- Owner can always delete their own board
  owner_id = auth.uid()
  -- COMMAND and CHIEF can delete any board in the same tenant
  OR EXISTS (
    SELECT 1
    FROM tenant_members tm
    WHERE tm.user_id        = auth.uid()
      AND tm.active         = true
      AND tm.permission_tier IN ('COMMAND', 'CHIEF')
      AND tm.tenant_id      = provisioning_lists.tenant_id
  )
);

-- ── UPDATE ────────────────────────────────────────────────────────────────────
-- Apply the same broadened rule to UPDATE so that CHIEF can edit board metadata.
DROP POLICY IF EXISTS "Owners can update provisioning lists" ON provisioning_lists;

CREATE POLICY "Owners can update provisioning lists" ON provisioning_lists
FOR UPDATE USING (
  owner_id = auth.uid()
  OR EXISTS (
    SELECT 1
    FROM tenant_members tm
    WHERE tm.user_id        = auth.uid()
      AND tm.active         = true
      AND tm.permission_tier IN ('COMMAND', 'CHIEF')
      AND tm.tenant_id      = provisioning_lists.tenant_id
  )
);

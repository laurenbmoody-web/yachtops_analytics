-- Replace RLS-based board deletion with a SECURITY DEFINER RPC.
-- Multiple RLS policy iterations have not reliably granted COMMAND users the
-- ability to delete boards they don't own.  A SECURITY DEFINER function runs
-- as the function owner (postgres/service role) and enforces permission logic
-- in PL/pgSQL — the same pattern used by is_active_tenant_member and
-- get_tenant_departments throughout this codebase.
--
-- Permission rules (mirrors the UI canDelete check):
--   owner_id   = caller           → always allowed
--   created_by = caller           → always allowed
--   COMMAND    in same tenant     → always allowed (any visibility / dept)
--   CHIEF      in same dept       → allowed if board has a matching department_id

CREATE OR REPLACE FUNCTION public.delete_provisioning_board(p_list_id UUID)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_tenant_id    UUID;
  v_owner_id     UUID;
  v_created_by   UUID;
  v_dept_id      UUID;
  v_caller       UUID := auth.uid();
BEGIN
  SELECT tenant_id, owner_id, created_by, department_id
  INTO   v_tenant_id, v_owner_id, v_created_by, v_dept_id
  FROM   provisioning_lists
  WHERE  id = p_list_id;

  IF NOT FOUND THEN
    RETURN FALSE;
  END IF;

  -- Owner or creator
  IF v_owner_id = v_caller OR v_created_by = v_caller THEN
    DELETE FROM provisioning_lists WHERE id = p_list_id;
    RETURN TRUE;
  END IF;

  -- COMMAND: full delete rights across entire tenant
  IF EXISTS (
    SELECT 1 FROM tenant_members
    WHERE user_id        = v_caller
      AND tenant_id      = v_tenant_id
      AND active IS NOT FALSE
      AND permission_tier = 'COMMAND'
  ) THEN
    DELETE FROM provisioning_lists WHERE id = p_list_id;
    RETURN TRUE;
  END IF;

  -- CHIEF: can delete boards in their own department
  IF v_dept_id IS NOT NULL AND EXISTS (
    SELECT 1 FROM tenant_members
    WHERE user_id        = v_caller
      AND tenant_id      = v_tenant_id
      AND active IS NOT FALSE
      AND permission_tier = 'CHIEF'
      AND department_id   = v_dept_id
  ) THEN
    DELETE FROM provisioning_lists WHERE id = p_list_id;
    RETURN TRUE;
  END IF;

  RAISE EXCEPTION 'Not authorized to delete this provisioning board';
END;
$$;

GRANT EXECUTE ON FUNCTION public.delete_provisioning_board(UUID) TO authenticated;

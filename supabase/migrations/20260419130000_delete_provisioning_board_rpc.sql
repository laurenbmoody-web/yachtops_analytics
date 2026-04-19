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
--
-- Children are deleted explicitly in dependency order rather than relying on
-- CASCADE, because provisioning_deliveries has ON DELETE SET NULL in the live
-- DB (instead of CASCADE), which would cause a NOT NULL violation on list_id.
-- The broken activity_events audit trigger is fixed separately in migration
-- 20260419140000_fix_provisioning_list_delete_trigger.sql.

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

  -- Permission check
  IF NOT (
    v_owner_id = v_caller
    OR v_created_by = v_caller
    OR EXISTS (
      SELECT 1 FROM tenant_members
      WHERE user_id        = v_caller
        AND tenant_id      = v_tenant_id
        AND active IS NOT FALSE
        AND permission_tier = 'COMMAND'
    )
    OR (
      v_dept_id IS NOT NULL
      AND EXISTS (
        SELECT 1 FROM tenant_members
        WHERE user_id        = v_caller
          AND tenant_id      = v_tenant_id
          AND active IS NOT FALSE
          AND permission_tier = 'CHIEF'
          AND department_id   = v_dept_id
      )
    )
  ) THEN
    RAISE EXCEPTION 'Not authorized to delete this provisioning board';
  END IF;

  -- Explicitly delete children in dependency order.
  -- Do NOT rely on ON DELETE CASCADE — provisioning_deliveries has SET NULL
  -- in the live DB which would fail the NOT NULL constraint on list_id.
  DELETE FROM supplier_order_items
    WHERE order_id IN (SELECT id FROM supplier_orders WHERE list_id = p_list_id);
  DELETE FROM supplier_orders               WHERE list_id = p_list_id;
  DELETE FROM provisioning_deliveries       WHERE list_id = p_list_id;
  DELETE FROM provisioning_list_collaborators WHERE list_id = p_list_id;
  DELETE FROM provisioning_list_shares      WHERE list_id = p_list_id;
  DELETE FROM provisioning_items            WHERE list_id = p_list_id;
  DELETE FROM provisioning_lists            WHERE id      = p_list_id;

  RETURN TRUE;
END;
$$;

GRANT EXECUTE ON FUNCTION public.delete_provisioning_board(UUID) TO authenticated;

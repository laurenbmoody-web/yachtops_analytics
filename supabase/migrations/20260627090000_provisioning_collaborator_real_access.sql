-- ─────────────────────────────────────────────────────────────────────────────
-- 20260627090000_provisioning_collaborator_real_access.sql
--
-- Make board collaboration REAL.
--
-- The Share-board modal lets a chief invite a crew member as a
-- collaborator (provisioning_list_collaborators, permission
-- view / edit / approve), and the board SELECT policy already
-- surfaces the shared board row to that user. But the rest of the
-- access never honoured the collaborator table:
--
--   * provisioning_items SELECT/INSERT/UPDATE/DELETE only checked
--     owner + department tier. A collaborator invited to a PRIVATE
--     board could see the board card but NOT its items — so the
--     board opened empty for them, and they could not edit anything.
--   * provisioning_lists UPDATE didn't include collaborators either,
--     so an 'edit' collaborator couldn't rename / restatus the board.
--
-- This migration wires the collaborator table into all of those
-- policies via a SECURITY DEFINER helper (same recursion-avoidance
-- pattern as provisioning_list_tenant in
-- 20260615170000_fix_provisioning_lists_rls_recursion.sql): the
-- helper reads provisioning_list_collaborators directly, so calling
-- it from the lists / items policies doesn't re-trigger RLS and
-- recurse.
--
-- Permission mapping:
--   view            → can SELECT board + items (read-only)
--   edit / approve  → can also INSERT / UPDATE / DELETE items and
--                     UPDATE the board row
-- (approve additionally unlocks the approval flow elsewhere; for raw
--  table access it behaves like edit.)
-- ─────────────────────────────────────────────────────────────────────────────

-- Helper: the caller's collaborator permission on a board, or NULL.
-- SECURITY DEFINER so it bypasses RLS on provisioning_list_collaborators
-- and can't recurse back through the lists / items policies that call it.
CREATE OR REPLACE FUNCTION public.provisioning_list_collab_perm(p_list_id uuid, p_user_id uuid)
RETURNS text
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = public
AS $$
  SELECT permission
  FROM public.provisioning_list_collaborators
  WHERE list_id = p_list_id
    AND user_id = p_user_id
  LIMIT 1
$$;

GRANT EXECUTE ON FUNCTION public.provisioning_list_collab_perm(uuid, uuid) TO authenticated;

-- ═══════════════════════════════════════════════════════════════════════════
-- provisioning_lists — add collaborators to UPDATE
-- ═══════════════════════════════════════════════════════════════════════════
DROP POLICY IF EXISTS "provisioning_lists_update" ON provisioning_lists;
CREATE POLICY "provisioning_lists_update" ON provisioning_lists
FOR UPDATE USING (
  owner_id = auth.uid()
  -- edit / approve collaborators can update the board row
  OR public.provisioning_list_collab_perm(provisioning_lists.id, auth.uid()) IN ('edit', 'approve')
  OR (
    visibility = 'department'
    AND EXISTS (
      SELECT 1 FROM tenant_members
      WHERE user_id = auth.uid()
        AND active = true
        AND permission_tier = 'COMMAND'
        AND tenant_id = provisioning_lists.tenant_id
    )
  )
  OR (
    visibility = 'department'
    AND department_id IS NOT NULL
    AND EXISTS (
      SELECT 1 FROM tenant_members
      WHERE user_id = auth.uid()
        AND active = true
        AND permission_tier IN ('CHIEF', 'HOD')
        AND tenant_id = provisioning_lists.tenant_id
        AND department_id = provisioning_lists.department_id
    )
  )
);

-- ═══════════════════════════════════════════════════════════════════════════
-- provisioning_items — add collaborators to SELECT / INSERT / UPDATE / DELETE
-- ═══════════════════════════════════════════════════════════════════════════

-- SELECT: any collaborator (view / edit / approve) can read the items
DROP POLICY IF EXISTS "provisioning_items_select" ON provisioning_items;
CREATE POLICY "provisioning_items_select" ON provisioning_items
FOR SELECT USING (
  public.provisioning_list_collab_perm(provisioning_items.list_id, auth.uid()) IS NOT NULL
  OR EXISTS (
    SELECT 1 FROM provisioning_lists pl
    WHERE pl.id = provisioning_items.list_id
      AND (
        pl.owner_id = auth.uid()
        OR (
          pl.visibility = 'department'
          AND EXISTS (
            SELECT 1 FROM tenant_members
            WHERE user_id = auth.uid()
              AND active = true
              AND permission_tier = 'COMMAND'
              AND tenant_id = pl.tenant_id
          )
        )
        OR (
          pl.visibility = 'department'
          AND pl.department_id IS NOT NULL
          AND EXISTS (
            SELECT 1 FROM tenant_members
            WHERE user_id = auth.uid()
              AND active = true
              AND permission_tier IN ('CHIEF', 'HOD', 'CREW')
              AND tenant_id = pl.tenant_id
              AND department_id = pl.department_id
          )
        )
      )
  )
);

-- INSERT: edit / approve collaborators can add items
DROP POLICY IF EXISTS "provisioning_items_insert" ON provisioning_items;
CREATE POLICY "provisioning_items_insert" ON provisioning_items
FOR INSERT WITH CHECK (
  public.provisioning_list_collab_perm(provisioning_items.list_id, auth.uid()) IN ('edit', 'approve')
  OR EXISTS (
    SELECT 1 FROM provisioning_lists pl
    WHERE pl.id = provisioning_items.list_id
      AND (
        pl.owner_id = auth.uid()
        OR (
          pl.visibility = 'department'
          AND EXISTS (
            SELECT 1 FROM tenant_members
            WHERE user_id = auth.uid()
              AND active = true
              AND permission_tier = 'COMMAND'
              AND tenant_id = pl.tenant_id
          )
        )
        OR (
          pl.visibility = 'department'
          AND pl.department_id IS NOT NULL
          AND EXISTS (
            SELECT 1 FROM tenant_members
            WHERE user_id = auth.uid()
              AND active = true
              AND permission_tier IN ('CHIEF', 'HOD')
              AND tenant_id = pl.tenant_id
              AND department_id = pl.department_id
          )
        )
      )
  )
);

-- UPDATE: edit / approve collaborators can edit items
DROP POLICY IF EXISTS "provisioning_items_update" ON provisioning_items;
CREATE POLICY "provisioning_items_update" ON provisioning_items
FOR UPDATE USING (
  public.provisioning_list_collab_perm(provisioning_items.list_id, auth.uid()) IN ('edit', 'approve')
  OR EXISTS (
    SELECT 1 FROM provisioning_lists pl
    WHERE pl.id = provisioning_items.list_id
      AND (
        pl.owner_id = auth.uid()
        OR (
          pl.visibility = 'department'
          AND EXISTS (
            SELECT 1 FROM tenant_members
            WHERE user_id = auth.uid()
              AND active = true
              AND permission_tier = 'COMMAND'
              AND tenant_id = pl.tenant_id
          )
        )
        OR (
          pl.visibility = 'department'
          AND pl.department_id IS NOT NULL
          AND EXISTS (
            SELECT 1 FROM tenant_members
            WHERE user_id = auth.uid()
              AND active = true
              AND permission_tier IN ('CHIEF', 'HOD', 'CREW')
              AND tenant_id = pl.tenant_id
              AND department_id = pl.department_id
          )
        )
      )
  )
);

-- DELETE: edit / approve collaborators can remove items
DROP POLICY IF EXISTS "provisioning_items_delete" ON provisioning_items;
CREATE POLICY "provisioning_items_delete" ON provisioning_items
FOR DELETE USING (
  public.provisioning_list_collab_perm(provisioning_items.list_id, auth.uid()) IN ('edit', 'approve')
  OR EXISTS (
    SELECT 1 FROM provisioning_lists pl
    WHERE pl.id = provisioning_items.list_id
      AND (
        pl.owner_id = auth.uid()
        OR (
          pl.visibility = 'department'
          AND EXISTS (
            SELECT 1 FROM tenant_members
            WHERE user_id = auth.uid()
              AND active = true
              AND permission_tier = 'COMMAND'
              AND tenant_id = pl.tenant_id
          )
        )
        OR (
          pl.visibility = 'department'
          AND pl.department_id IS NOT NULL
          AND EXISTS (
            SELECT 1 FROM tenant_members
            WHERE user_id = auth.uid()
              AND active = true
              AND permission_tier IN ('CHIEF', 'HOD')
              AND tenant_id = pl.tenant_id
              AND department_id = pl.department_id
          )
        )
      )
  )
);

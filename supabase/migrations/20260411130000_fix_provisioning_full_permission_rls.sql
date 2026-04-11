-- Full provisioning permission matrix
--
-- Private boards: owner only (view/edit/add/delete). Invisible to everyone else.
--
-- Department boards:
--   COMMAND  view / edit board / add items / delete board / delete items  (any dept)
--   CHIEF    view / edit board / add items / delete board / delete items  (their dept)
--   HOD      view / edit board / add items                               (their dept, no board delete)
--   CREW     view / edit items only                                       (their dept, no add / delete)
--
-- Replaces the previous per-migration policies with a single consistent set.

-- =========================================================================
-- provisioning_lists
-- =========================================================================

DROP POLICY IF EXISTS "Users can view provisioning lists"    ON provisioning_lists;
DROP POLICY IF EXISTS "Users can insert provisioning lists"  ON provisioning_lists;
DROP POLICY IF EXISTS "Owners can update provisioning lists" ON provisioning_lists;
DROP POLICY IF EXISTS "Owners can delete provisioning lists" ON provisioning_lists;
DROP POLICY IF EXISTS "provisioning_lists_select"            ON provisioning_lists;
DROP POLICY IF EXISTS "provisioning_lists_insert"            ON provisioning_lists;
DROP POLICY IF EXISTS "provisioning_lists_update"            ON provisioning_lists;
DROP POLICY IF EXISTS "provisioning_lists_delete"            ON provisioning_lists;

-- SELECT
CREATE POLICY "provisioning_lists_select" ON provisioning_lists
FOR SELECT USING (
  owner_id = auth.uid()
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
        AND permission_tier IN ('CHIEF', 'HOD', 'CREW')
        AND tenant_id = provisioning_lists.tenant_id
        AND department_id = provisioning_lists.department_id
    )
  )
  OR id IN (
    SELECT list_id FROM provisioning_list_collaborators WHERE user_id = auth.uid()
  )
);

-- INSERT (any tenant member can create their own board)
CREATE POLICY "provisioning_lists_insert" ON provisioning_lists
FOR INSERT WITH CHECK (
  owner_id = auth.uid()
);

-- UPDATE: owner / COMMAND / CHIEF / HOD  (not CREW — CREW edits items, not board metadata)
CREATE POLICY "provisioning_lists_update" ON provisioning_lists
FOR UPDATE USING (
  owner_id = auth.uid()
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

-- DELETE: owner / COMMAND / CHIEF  (not HOD or CREW)
CREATE POLICY "provisioning_lists_delete" ON provisioning_lists
FOR DELETE USING (
  owner_id = auth.uid()
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
        AND permission_tier = 'CHIEF'
        AND tenant_id = provisioning_lists.tenant_id
        AND department_id = provisioning_lists.department_id
    )
  )
);

-- =========================================================================
-- provisioning_items
-- =========================================================================

DROP POLICY IF EXISTS "provisioning_items_select" ON provisioning_items;
DROP POLICY IF EXISTS "provisioning_items_insert" ON provisioning_items;
DROP POLICY IF EXISTS "provisioning_items_update" ON provisioning_items;
DROP POLICY IF EXISTS "provisioning_items_delete" ON provisioning_items;

-- Also drop the old verbose policy names from the original migration
DROP POLICY IF EXISTS "Provisioning items are viewable by vessel members"    ON provisioning_items;
DROP POLICY IF EXISTS "Provisioning items can be created by vessel members"  ON provisioning_items;
DROP POLICY IF EXISTS "Provisioning items can be updated by vessel members"  ON provisioning_items;

-- SELECT: all tiers who can see the parent board can see its items
CREATE POLICY "provisioning_items_select" ON provisioning_items
FOR SELECT USING (
  EXISTS (
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

-- INSERT: owner / COMMAND / CHIEF / HOD  (not CREW)
CREATE POLICY "provisioning_items_insert" ON provisioning_items
FOR INSERT WITH CHECK (
  EXISTS (
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

-- UPDATE: owner / COMMAND / CHIEF / HOD / CREW (all visible tiers can edit items)
CREATE POLICY "provisioning_items_update" ON provisioning_items
FOR UPDATE USING (
  EXISTS (
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

-- DELETE items: owner / COMMAND / CHIEF / HOD  (not CREW)
CREATE POLICY "provisioning_items_delete" ON provisioning_items
FOR DELETE USING (
  EXISTS (
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

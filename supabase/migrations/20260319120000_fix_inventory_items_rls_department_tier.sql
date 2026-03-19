-- Migration: Fix inventory_items RLS to enforce department + permission tier
--
-- Problem: The original policies (20260309150000) allow ANY tenant member to
--          INSERT/UPDATE/DELETE any item — no department or tier check at all.
--          A CHIEF in Engineering can currently modify Deck or Interior items.
--
-- Rules:
--   SELECT  → COMMAND/CHIEF: all departments
--             HOD/CREW/VIEW_ONLY: own department only
--   INSERT  → COMMAND: any department
--             CHIEF/HOD: own department only
--             CREW/VIEW_ONLY: blocked
--   UPDATE  → same as INSERT
--   DELETE  → same as INSERT

-- ── SELECT ───────────────────────────────────────────────────────────────────
DROP POLICY IF EXISTS "inventory_items_select" ON public.inventory_items;
CREATE POLICY "inventory_items_select"
  ON public.inventory_items FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM public.tenant_members tm
      WHERE tm.user_id    = auth.uid()
        AND tm.tenant_id  = inventory_items.tenant_id
        AND tm.active IS NOT FALSE
        AND (
          -- COMMAND and CHIEF see every department
          tm.permission_tier IN ('COMMAND', 'CHIEF')
          OR
          -- Everyone else sees only their own department
          EXISTS (
            SELECT 1 FROM public.departments d
            WHERE d.id          = tm.department_id
              AND UPPER(d.name) = inventory_items.usage_department
          )
        )
    )
  );

-- ── INSERT ───────────────────────────────────────────────────────────────────
DROP POLICY IF EXISTS "inventory_items_insert" ON public.inventory_items;
CREATE POLICY "inventory_items_insert"
  ON public.inventory_items FOR INSERT TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1
      FROM public.tenant_members tm
      WHERE tm.user_id   = auth.uid()
        AND tm.tenant_id = inventory_items.tenant_id
        AND tm.active IS NOT FALSE
        AND (
          -- COMMAND can insert into any department
          tm.permission_tier = 'COMMAND'
          OR
          -- CHIEF/HOD can only insert into their own department
          (
            tm.permission_tier IN ('CHIEF', 'HOD')
            AND EXISTS (
              SELECT 1 FROM public.departments d
              WHERE d.id          = tm.department_id
                AND UPPER(d.name) = inventory_items.usage_department
            )
          )
        )
    )
  );

-- ── UPDATE ───────────────────────────────────────────────────────────────────
DROP POLICY IF EXISTS "inventory_items_update" ON public.inventory_items;
CREATE POLICY "inventory_items_update"
  ON public.inventory_items FOR UPDATE TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM public.tenant_members tm
      WHERE tm.user_id   = auth.uid()
        AND tm.tenant_id = inventory_items.tenant_id
        AND tm.active IS NOT FALSE
        AND (
          tm.permission_tier = 'COMMAND'
          OR
          (
            tm.permission_tier IN ('CHIEF', 'HOD')
            AND EXISTS (
              SELECT 1 FROM public.departments d
              WHERE d.id          = tm.department_id
                AND UPPER(d.name) = inventory_items.usage_department
            )
          )
        )
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1
      FROM public.tenant_members tm
      WHERE tm.user_id   = auth.uid()
        AND tm.tenant_id = inventory_items.tenant_id
        AND tm.active IS NOT FALSE
        AND (
          tm.permission_tier = 'COMMAND'
          OR
          (
            tm.permission_tier IN ('CHIEF', 'HOD')
            AND EXISTS (
              SELECT 1 FROM public.departments d
              WHERE d.id          = tm.department_id
                AND UPPER(d.name) = inventory_items.usage_department
            )
          )
        )
    )
  );

-- ── DELETE ───────────────────────────────────────────────────────────────────
DROP POLICY IF EXISTS "inventory_items_delete" ON public.inventory_items;
CREATE POLICY "inventory_items_delete"
  ON public.inventory_items FOR DELETE TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM public.tenant_members tm
      WHERE tm.user_id   = auth.uid()
        AND tm.tenant_id = inventory_items.tenant_id
        AND tm.active IS NOT FALSE
        AND (
          tm.permission_tier = 'COMMAND'
          OR
          (
            tm.permission_tier IN ('CHIEF', 'HOD')
            AND EXISTS (
              SELECT 1 FROM public.departments d
              WHERE d.id          = tm.department_id
                AND UPPER(d.name) = inventory_items.usage_department
            )
          )
        )
    )
  );

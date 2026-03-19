-- Migration: Fix inventory_locations RLS policies
-- Fixes status case mismatch: 'active' -> 'ACTIVE' to match tenant_members check constraint
-- Also ensures department columns exist (idempotent)

-- 1. Add new columns (IF NOT EXISTS guards against re-run)
ALTER TABLE public.inventory_locations
  ADD COLUMN IF NOT EXISTS department TEXT,
  ADD COLUMN IF NOT EXISTS is_department_root BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS visibility TEXT NOT NULL DEFAULT 'everyone';

-- 2. Drop ALL existing RLS policies (both quoted and unquoted names)
DROP POLICY IF EXISTS inventory_locations_select ON public.inventory_locations;
DROP POLICY IF EXISTS inventory_locations_insert ON public.inventory_locations;
DROP POLICY IF EXISTS inventory_locations_update ON public.inventory_locations;
DROP POLICY IF EXISTS inventory_locations_delete ON public.inventory_locations;
DROP POLICY IF EXISTS "inventory_locations_select" ON public.inventory_locations;
DROP POLICY IF EXISTS "inventory_locations_insert" ON public.inventory_locations;
DROP POLICY IF EXISTS "inventory_locations_update" ON public.inventory_locations;
DROP POLICY IF EXISTS "inventory_locations_delete" ON public.inventory_locations;

-- 3. SELECT policy — use tm.active=true (boolean) consistent with existing policies
--    Also support visibility gating for non-everyone visibility settings
CREATE POLICY "inventory_locations_select"
  ON public.inventory_locations
  FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.tenant_members tm
      WHERE tm.tenant_id = inventory_locations.tenant_id
        AND tm.user_id = auth.uid()
        AND tm.active = true
    )
    AND (
      inventory_locations.visibility = 'everyone'
      OR (
        inventory_locations.visibility = 'chief_hod_command'
        AND EXISTS (
          SELECT 1 FROM public.tenant_members tm2
          WHERE tm2.tenant_id = inventory_locations.tenant_id
            AND tm2.user_id = auth.uid()
            AND tm2.permission_tier IN ('COMMAND','CHIEF','HOD')
        )
      )
      OR (
        inventory_locations.visibility = 'chief_command'
        AND EXISTS (
          SELECT 1 FROM public.tenant_members tm3
          WHERE tm3.tenant_id = inventory_locations.tenant_id
            AND tm3.user_id = auth.uid()
            AND tm3.permission_tier IN ('COMMAND','CHIEF')
        )
      )
      OR (
        inventory_locations.visibility = 'command_only'
        AND EXISTS (
          SELECT 1 FROM public.tenant_members tm4
          WHERE tm4.tenant_id = inventory_locations.tenant_id
            AND tm4.user_id = auth.uid()
            AND tm4.permission_tier = 'COMMAND'
        )
      )
    )
  );

-- 4. INSERT policy — block root-folder inserts for non-Command users
CREATE POLICY "inventory_locations_insert"
  ON public.inventory_locations
  FOR INSERT
  TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.tenant_members tm
      WHERE tm.tenant_id = inventory_locations.tenant_id
        AND tm.user_id = auth.uid()
        AND tm.active = true
    )
    AND (
      inventory_locations.is_department_root = false
      OR EXISTS (
        SELECT 1 FROM public.tenant_members tm2
        WHERE tm2.tenant_id = inventory_locations.tenant_id
          AND tm2.user_id = auth.uid()
          AND tm2.permission_tier = 'COMMAND'
      )
    )
  );

-- 5. UPDATE policy — block updates on root folders for non-Command users
CREATE POLICY "inventory_locations_update"
  ON public.inventory_locations
  FOR UPDATE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.tenant_members tm
      WHERE tm.tenant_id = inventory_locations.tenant_id
        AND tm.user_id = auth.uid()
        AND tm.active = true
    )
    AND (
      inventory_locations.is_department_root = false
      OR EXISTS (
        SELECT 1 FROM public.tenant_members tm2
        WHERE tm2.tenant_id = inventory_locations.tenant_id
          AND tm2.user_id = auth.uid()
          AND tm2.permission_tier = 'COMMAND'
      )
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.tenant_members tm
      WHERE tm.tenant_id = inventory_locations.tenant_id
        AND tm.user_id = auth.uid()
        AND tm.active = true
    )
    AND (
      inventory_locations.is_department_root = false
      OR EXISTS (
        SELECT 1 FROM public.tenant_members tm2
        WHERE tm2.tenant_id = inventory_locations.tenant_id
          AND tm2.user_id = auth.uid()
          AND tm2.permission_tier = 'COMMAND'
      )
    )
  );

-- 6. DELETE policy — block deletes on root folders for non-Command users
CREATE POLICY "inventory_locations_delete"
  ON public.inventory_locations
  FOR DELETE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.tenant_members tm
      WHERE tm.tenant_id = inventory_locations.tenant_id
        AND tm.user_id = auth.uid()
        AND tm.active = true
    )
    AND (
      inventory_locations.is_department_root = false
      OR EXISTS (
        SELECT 1 FROM public.tenant_members tm2
        WHERE tm2.tenant_id = inventory_locations.tenant_id
          AND tm2.user_id = auth.uid()
          AND tm2.permission_tier = 'COMMAND'
      )
    )
  );

-- Migration: Backfill Interior department for duty_set_templates and rotation_assignments
-- Purpose: One-time backfill so existing templates and rotation items that have no
--          department_id assigned are set to the Interior department for this tenant.
--          No rows are deleted. Only NULL department_id rows are updated.
-- Safe to re-run: uses ON CONFLICT and conditional UPDATE.

DO $$
DECLARE
  v_interior_dept_id UUID;
  v_tenant_id        UUID;
BEGIN

  -- ----------------------------------------------------------------
  -- Step 1: Ensure the Interior department row exists in departments.
  -- departments has no tenant_id column; it is a shared lookup table.
  -- We upsert by name so this is idempotent.
  -- ----------------------------------------------------------------
  SELECT id INTO v_interior_dept_id
  FROM public.departments
  WHERE name = 'Interior'
  LIMIT 1;

  IF v_interior_dept_id IS NULL THEN
    INSERT INTO public.departments (id, name)
    VALUES (gen_random_uuid(), 'Interior')
    RETURNING id INTO v_interior_dept_id;

    RAISE NOTICE 'Created Interior department with id: %', v_interior_dept_id;
  ELSE
    RAISE NOTICE 'Interior department already exists with id: %', v_interior_dept_id;
  END IF;

  -- ----------------------------------------------------------------
  -- Step 2: Resolve the tenant_id.
  -- There is exactly one tenant in this project (rows = 1 in tenants).
  -- ----------------------------------------------------------------
  SELECT id INTO v_tenant_id
  FROM public.tenants
  LIMIT 1;

  IF v_tenant_id IS NULL THEN
    RAISE NOTICE 'No tenant found – skipping backfill.';
    RETURN;
  END IF;

  RAISE NOTICE 'Backfilling for tenant_id: %', v_tenant_id;

  -- ----------------------------------------------------------------
  -- Step 3: Backfill duty_set_templates.
  -- Only update rows where department_id IS NULL for this tenant.
  -- Rows that already have a department_id are left untouched.
  -- ----------------------------------------------------------------
  UPDATE public.duty_set_templates
  SET    department_id = v_interior_dept_id
  WHERE  tenant_id     = v_tenant_id
    AND  department_id IS NULL;

  RAISE NOTICE 'duty_set_templates backfill complete (rows updated: %).',
    (SELECT COUNT(*) FROM public.duty_set_templates
     WHERE tenant_id = v_tenant_id AND department_id = v_interior_dept_id);

  -- ----------------------------------------------------------------
  -- Step 4: Backfill rotation_assignments.
  -- Only update rows where department_id IS NULL for this tenant.
  -- ----------------------------------------------------------------
  UPDATE public.rotation_assignments
  SET    department_id = v_interior_dept_id
  WHERE  tenant_id     = v_tenant_id
    AND  department_id IS NULL;

  RAISE NOTICE 'rotation_assignments backfill complete (rows updated: %).',
    (SELECT COUNT(*) FROM public.rotation_assignments
     WHERE tenant_id = v_tenant_id AND department_id = v_interior_dept_id);

EXCEPTION
  WHEN OTHERS THEN
    RAISE NOTICE 'Backfill migration failed: %', SQLERRM;
END $$;

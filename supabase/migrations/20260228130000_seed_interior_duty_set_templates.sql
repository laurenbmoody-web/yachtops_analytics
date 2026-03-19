-- Migration: Seed Interior duty set templates
-- Purpose: Insert the 7 standard Interior duty set templates as real rows
--          so they appear in the UI without relying on mock/hardcoded data.
-- Safe to re-run: uses ON CONFLICT DO NOTHING and existence checks.

DO $$
DECLARE
  v_tenant_id        UUID;
  v_interior_dept_id UUID;
BEGIN

  -- ----------------------------------------------------------------
  -- Step 1: Resolve tenant_id (single tenant project)
  -- ----------------------------------------------------------------
  SELECT id INTO v_tenant_id
  FROM public.tenants
  LIMIT 1;

  IF v_tenant_id IS NULL THEN
    RAISE NOTICE 'No tenant found – skipping template seed.';
    RETURN;
  END IF;

  RAISE NOTICE 'Seeding templates for tenant_id: %', v_tenant_id;

  -- ----------------------------------------------------------------
  -- Step 2: Ensure Interior department exists
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
    RAISE NOTICE 'Interior department found with id: %', v_interior_dept_id;
  END IF;

  -- ----------------------------------------------------------------
  -- Step 3: Insert the 7 standard Interior duty set templates
  --         ON CONFLICT (id) DO NOTHING ensures idempotency.
  --         We use a name-based check so re-runs do not duplicate.
  -- ----------------------------------------------------------------

  -- 1. Crew Mess
  INSERT INTO public.duty_set_templates
    (id, tenant_id, department_id, name, category, estimated_duration, task_count, tasks)
  SELECT
    gen_random_uuid(),
    v_tenant_id,
    v_interior_dept_id,
    'Crew Mess',
    'Daily Service',
    45,
    6,
    '[{"title":"Clear and wipe tables"},{"title":"Wash up dishes and utensils"},{"title":"Clean countertops and surfaces"},{"title":"Sweep and mop floor"},{"title":"Empty bins and replace liners"},{"title":"Restock condiments and supplies"}]'::jsonb
  WHERE NOT EXISTS (
    SELECT 1 FROM public.duty_set_templates
    WHERE tenant_id = v_tenant_id AND name = 'Crew Mess'
  );

  -- 2. Captain''s Cabin
  INSERT INTO public.duty_set_templates
    (id, tenant_id, department_id, name, category, estimated_duration, task_count, tasks)
  SELECT
    gen_random_uuid(),
    v_tenant_id,
    v_interior_dept_id,
    'Captain''s Cabin',
    'Cabin Service',
    60,
    8,
    '[{"title":"Make bed with fresh linen"},{"title":"Dust all surfaces"},{"title":"Vacuum carpet or mop floor"},{"title":"Clean and sanitise bathroom"},{"title":"Replace towels and toiletries"},{"title":"Empty bins"},{"title":"Wipe mirrors and glass"},{"title":"Tidy and organise personal items"}]'::jsonb
  WHERE NOT EXISTS (
    SELECT 1 FROM public.duty_set_templates
    WHERE tenant_id = v_tenant_id AND name = 'Captain''s Cabin'
  );

  -- 3. Pantries
  INSERT INTO public.duty_set_templates
    (id, tenant_id, department_id, name, category, estimated_duration, task_count, tasks)
  SELECT
    gen_random_uuid(),
    v_tenant_id,
    v_interior_dept_id,
    'Pantries',
    'Daily Service',
    30,
    5,
    '[{"title":"Wipe down all surfaces and shelves"},{"title":"Clean sink and taps"},{"title":"Organise and restock supplies"},{"title":"Empty and clean bins"},{"title":"Sweep and mop floor"}]'::jsonb
  WHERE NOT EXISTS (
    SELECT 1 FROM public.duty_set_templates
    WHERE tenant_id = v_tenant_id AND name = 'Pantries'
  );

  -- 4. Bridge
  INSERT INTO public.duty_set_templates
    (id, tenant_id, department_id, name, category, estimated_duration, task_count, tasks)
  SELECT
    gen_random_uuid(),
    v_tenant_id,
    v_interior_dept_id,
    'Bridge',
    'Daily Service',
    40,
    5,
    '[{"title":"Dust all equipment and consoles"},{"title":"Wipe windows and glass panels"},{"title":"Vacuum or sweep floor"},{"title":"Clean chart table and surfaces"},{"title":"Empty bins and tidy stowage"}]'::jsonb
  WHERE NOT EXISTS (
    SELECT 1 FROM public.duty_set_templates
    WHERE tenant_id = v_tenant_id AND name = 'Bridge'
  );

  -- 5. Stairs
  INSERT INTO public.duty_set_templates
    (id, tenant_id, department_id, name, category, estimated_duration, task_count, tasks)
  SELECT
    gen_random_uuid(),
    v_tenant_id,
    v_interior_dept_id,
    'Stairs',
    'Daily Service',
    20,
    4,
    '[{"title":"Vacuum or sweep all stair treads"},{"title":"Wipe handrails and banisters"},{"title":"Spot clean walls and skirting"},{"title":"Polish any brass or chrome fittings"}]'::jsonb
  WHERE NOT EXISTS (
    SELECT 1 FROM public.duty_set_templates
    WHERE tenant_id = v_tenant_id AND name = 'Stairs'
  );

  -- 6. Laundry
  INSERT INTO public.duty_set_templates
    (id, tenant_id, department_id, name, category, estimated_duration, task_count, tasks)
  SELECT
    gen_random_uuid(),
    v_tenant_id,
    v_interior_dept_id,
    'Laundry',
    'Laundry',
    90,
    7,
    '[{"title":"Sort and load washing machines"},{"title":"Transfer to dryers when complete"},{"title":"Iron and press linens and uniforms"},{"title":"Fold and stack towels"},{"title":"Return items to correct cabins or stowage"},{"title":"Clean lint filters and machines"},{"title":"Restock laundry supplies"}]'::jsonb
  WHERE NOT EXISTS (
    SELECT 1 FROM public.duty_set_templates
    WHERE tenant_id = v_tenant_id AND name = 'Laundry'
  );

  -- 7. Guest Cabin Turnover
  INSERT INTO public.duty_set_templates
    (id, tenant_id, department_id, name, category, estimated_duration, task_count, tasks)
  SELECT
    gen_random_uuid(),
    v_tenant_id,
    v_interior_dept_id,
    'Guest Cabin Turnover',
    'Cabin Service',
    75,
    10,
    '[{"title":"Strip and remake bed with fresh linen"},{"title":"Dust all surfaces and furniture"},{"title":"Vacuum carpet or mop floor"},{"title":"Clean and sanitise en-suite bathroom"},{"title":"Replace all towels and bathrobes"},{"title":"Restock toiletries and amenities"},{"title":"Empty all bins and replace liners"},{"title":"Wipe mirrors and glass surfaces"},{"title":"Check and replenish minibar or refreshments"},{"title":"Final inspection and presentation check"}]'::jsonb
  WHERE NOT EXISTS (
    SELECT 1 FROM public.duty_set_templates
    WHERE tenant_id = v_tenant_id AND name = 'Guest Cabin Turnover'
  );

  RAISE NOTICE 'Interior duty set template seed complete.';

EXCEPTION
  WHEN OTHERS THEN
    RAISE NOTICE 'Template seed migration failed: %', SQLERRM;
END $$;

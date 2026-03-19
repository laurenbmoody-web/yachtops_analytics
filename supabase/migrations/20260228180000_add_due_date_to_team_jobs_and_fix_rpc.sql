-- Migration: Add due_date column to team_jobs and fix sync_rotation_job RPC
-- Root cause: team_jobs had no due_date column; previous migrations assumed it existed

-- ── Step 1: Add due_date column to team_jobs ──
ALTER TABLE public.team_jobs
  ADD COLUMN IF NOT EXISTS due_date DATE;

-- ── Step 2: Drop and recreate sync_rotation_job with correct column references ──
CREATE OR REPLACE FUNCTION public.sync_rotation_job(
  p_assignment_id UUID,
  p_tenant_id UUID,
  p_department_id UUID,
  p_member_id UUID,
  p_date DATE,
  p_title TEXT,
  p_created_by UUID
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
AS $func$
DECLARE
  v_job_id UUID;
BEGIN
  -- Validate required fields
  IF p_tenant_id IS NULL OR p_member_id IS NULL OR p_date IS NULL OR p_title IS NULL THEN
    RAISE NOTICE 'sync_rotation_job: missing required fields (tenant_id=%, member_id=%, date=%, title=%)',
      p_tenant_id, p_member_id, p_date, p_title;
    RETURN NULL;
  END IF;

  -- Use created_by fallback: if NULL, use member_id (self-created)
  IF p_created_by IS NULL THEN
    -- Try to find any admin/command user in the tenant as fallback
    SELECT user_id INTO p_created_by
    FROM public.tenant_members
    WHERE tenant_id = p_tenant_id
      AND active = true
      AND permission_tier IN ('COMMAND', 'CHIEF')
    LIMIT 1;
    -- Final fallback: use the member themselves
    IF p_created_by IS NULL THEN
      p_created_by := p_member_id;
    END IF;
  END IF;

  -- Check if a job already exists for this assignment
  IF p_assignment_id IS NOT NULL THEN
    SELECT id INTO v_job_id
    FROM public.team_jobs
    WHERE rotation_assignment_id = p_assignment_id
      AND source = 'rotation'
    LIMIT 1;
  END IF;

  -- Also check by member + date + source + title if no assignment match
  IF v_job_id IS NULL THEN
    SELECT id INTO v_job_id
    FROM public.team_jobs
    WHERE tenant_id = p_tenant_id
      AND assigned_to = p_member_id
      AND due_date = p_date
      AND source = 'rotation'
      AND title = p_title
    LIMIT 1;
  END IF;

  IF v_job_id IS NOT NULL THEN
    -- Update existing job
    UPDATE public.team_jobs
    SET
      title = p_title,
      assigned_to = p_member_id,
      due_date = p_date,
      department_id = p_department_id,
      updated_at = now()
    WHERE id = v_job_id;

    -- Update assignment link if provided
    IF p_assignment_id IS NOT NULL THEN
      UPDATE public.rotation_assignments
      SET linked_job_id = v_job_id
      WHERE id = p_assignment_id AND linked_job_id IS NULL;
    END IF;

    RETURN v_job_id;
  ELSE
    -- Insert new job
    INSERT INTO public.team_jobs (
      tenant_id,
      department_id,
      title,
      assigned_to,
      due_date,
      status,
      source,
      rotation_assignment_id,
      created_by,
      is_private,
      cross_dept_status,
      created_at,
      updated_at
    ) VALUES (
      p_tenant_id,
      p_department_id,
      p_title,
      p_member_id,
      p_date,
      'OPEN',
      'rotation',
      p_assignment_id,
      p_created_by,
      false,
      'NONE',
      now(),
      now()
    )
    RETURNING id INTO v_job_id;

    -- Update the rotation_assignment with the linked_job_id
    IF p_assignment_id IS NOT NULL THEN
      UPDATE public.rotation_assignments
      SET linked_job_id = v_job_id
      WHERE id = p_assignment_id;
    END IF;

    RETURN v_job_id;
  END IF;
EXCEPTION
  WHEN OTHERS THEN
    RAISE NOTICE 'sync_rotation_job error for assignment %: %', p_assignment_id, SQLERRM;
    RETURN NULL;
END;
$func$;

-- Grant execute to authenticated users
GRANT EXECUTE ON FUNCTION public.sync_rotation_job(
  UUID, UUID, UUID, UUID, DATE, TEXT, UUID
) TO authenticated;

-- ── Step 3: Backfill team_jobs for rotation_assignments with no linked_job_id ──
DO $$
DECLARE
  r RECORD;
  v_job_id UUID;
  v_template_name TEXT;
  v_created_by UUID;
BEGIN
  FOR r IN
    SELECT
      ra.id AS assignment_id,
      ra.tenant_id,
      ra.department_id,
      ra.member_id,
      ra.date,
      dst.name AS template_name
    FROM public.rotation_assignments ra
    JOIN public.duty_set_templates dst ON dst.id = ra.duty_set_template_id
    WHERE ra.linked_job_id IS NULL
      AND ra.date >= CURRENT_DATE
  LOOP
    -- Find a COMMAND/CHIEF user in this tenant to use as created_by
    SELECT user_id INTO v_created_by
    FROM public.tenant_members
    WHERE tenant_id = r.tenant_id
      AND active = true
      AND permission_tier IN ('COMMAND', 'CHIEF')
    LIMIT 1;

    -- Fallback: use the member themselves
    IF v_created_by IS NULL THEN
      v_created_by := r.member_id;
    END IF;

    -- Check if a job already exists (avoid duplicates)
    SELECT id INTO v_job_id
    FROM public.team_jobs
    WHERE tenant_id = r.tenant_id
      AND assigned_to = r.member_id
      AND due_date = r.date
      AND source = 'rotation'
      AND title = r.template_name
    LIMIT 1;

    IF v_job_id IS NULL THEN
      -- Insert the missing job
      INSERT INTO public.team_jobs (
        tenant_id,
        department_id,
        title,
        assigned_to,
        due_date,
        status,
        source,
        rotation_assignment_id,
        created_by,
        is_private,
        cross_dept_status,
        created_at,
        updated_at
      ) VALUES (
        r.tenant_id,
        r.department_id,
        r.template_name,
        r.member_id,
        r.date,
        'OPEN',
        'rotation',
        r.assignment_id,
        v_created_by,
        false,
        'NONE',
        now(),
        now()
      )
      RETURNING id INTO v_job_id;
    END IF;

    -- Link the job back to the assignment
    IF v_job_id IS NOT NULL THEN
      UPDATE public.rotation_assignments
      SET linked_job_id = v_job_id
      WHERE id = r.assignment_id;
    END IF;
  END LOOP;
END;
$$;

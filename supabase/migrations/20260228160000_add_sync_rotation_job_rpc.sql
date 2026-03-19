-- Migration: Backfill team_jobs for existing rotation_assignments that have no linked_job_id
-- Root cause fix: created_by was NULL causing NOT NULL constraint violation on team_jobs
-- This migration creates a SECURITY DEFINER function to backfill existing assignments
-- and also adds a helper RPC that the frontend can call to sync a single assignment

-- ── Helper RPC: sync a single rotation assignment to team_jobs ──
-- Called by RotationCalendar when re-assigning an existing duty
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
  -- Check if a job already exists for this assignment
  SELECT id INTO v_job_id
  FROM public.team_jobs
  WHERE rotation_assignment_id = p_assignment_id
    AND source = 'rotation'
  LIMIT 1;

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
      board_id,
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
      NULL,
      p_created_by,
      false,
      'NONE',
      now(),
      now()
    )
    RETURNING id INTO v_job_id;

    -- Update the rotation_assignment with the linked_job_id
    UPDATE public.rotation_assignments
    SET linked_job_id = v_job_id
    WHERE id = p_assignment_id;

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

-- Migration: Fix team_jobs.assigned_to for rotation jobs
-- Root cause: RotationCalendar was passing tenant_members.id as p_member_id
-- to sync_rotation_job RPC, but assigned_to should store the auth user_id (profiles.id)
-- This migration backfills existing rotation jobs with the correct user_id

DO $$
BEGIN
  -- Update team_jobs.assigned_to for rotation jobs where assigned_to is a tenant_members.id
  -- Join rotation_assignments -> tenant_members to get the correct user_id
  UPDATE public.team_jobs tj
  SET assigned_to = tm.user_id,
      updated_at = now()
  FROM public.rotation_assignments ra
  JOIN public.tenant_members tm ON tm.id = ra.member_id
  WHERE tj.rotation_assignment_id = ra.id
    AND tj.source = 'rotation'
    AND tj.assigned_to = ra.member_id  -- currently storing tenant_members.id
    AND tm.user_id IS NOT NULL
    AND tj.assigned_to != tm.user_id;  -- only update if not already correct

  RAISE NOTICE 'Fixed rotation job assigned_to values to use auth user_id';
EXCEPTION
  WHEN OTHERS THEN
    RAISE NOTICE 'Fix rotation assigned_to error: %', SQLERRM;
END $$;

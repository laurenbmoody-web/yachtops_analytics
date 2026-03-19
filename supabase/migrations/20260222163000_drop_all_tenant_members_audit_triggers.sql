-- Migration: Drop all tenant_members audit triggers and fix audit logging
-- Purpose: Remove ALL existing audit triggers that reference vessel_admin_audit incorrectly
-- Date: 2026-02-22
-- Issue: Error "column tenant_member_id of relation vessel_admin_audit does not exist"
-- Root Cause: Old trigger in database trying to insert into vessel_admin_audit with wrong column
-- Solution: Drop ALL triggers on tenant_members, then recreate only the correct ones

-- Step 1: Drop ALL triggers on tenant_members (except the updated_at trigger and system FK triggers)
DO $$
DECLARE
  trigger_record RECORD;
BEGIN
  -- Get all triggers on tenant_members table
  FOR trigger_record IN 
    SELECT tgname 
    FROM pg_trigger 
    WHERE tgrelid = 'public.tenant_members'::regclass 
    AND tgname NOT LIKE 'set_tenant_members_updated_at'
    AND tgname NOT LIKE 'RI_ConstraintTrigger_%'  -- Exclude system FK constraint triggers
    AND tgname NOT LIKE 'pg_%'  -- Exclude other system triggers
  LOOP
    EXECUTE format('DROP TRIGGER IF EXISTS %I ON public.tenant_members', trigger_record.tgname);
    RAISE NOTICE 'Dropped trigger: %', trigger_record.tgname;
  END LOOP;
END $$;

-- Step 2: Drop ALL audit-related functions that might reference vessel_admin_audit
DROP FUNCTION IF EXISTS public.log_tenant_member_changes() CASCADE;
DROP FUNCTION IF EXISTS public.audit_tenant_member_changes() CASCADE;
DROP FUNCTION IF EXISTS public.handle_tenant_member_audit() CASCADE;
DROP FUNCTION IF EXISTS public.log_tenant_member_employment_changes() CASCADE;
DROP FUNCTION IF EXISTS public.audit_tenant_member_employment() CASCADE;
DROP FUNCTION IF EXISTS public.handle_tenant_member_employment_audit() CASCADE;

-- Step 3: Create the correct audit trigger function
-- This logs to tenant_member_assignment_audit (the correct table)
CREATE OR REPLACE FUNCTION public.log_tenant_member_employment_changes()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  old_values_json JSONB;
  new_values_json JSONB;
  has_changes BOOLEAN := false;
BEGIN
  -- Only log on UPDATE operations
  IF TG_OP = 'UPDATE' THEN
    -- Build old_values JSON for tracked fields
    old_values_json := jsonb_build_object(
      'department_id', OLD.department_id,
      'role_id', OLD.role_id,
      'status', OLD.status,
      'permission_tier_override', OLD.permission_tier_override
    );
    
    -- Build new_values JSON for tracked fields
    new_values_json := jsonb_build_object(
      'department_id', NEW.department_id,
      'role_id', NEW.role_id,
      'status', NEW.status,
      'permission_tier_override', NEW.permission_tier_override
    );
    
    -- Check if any tracked fields changed
    IF OLD.department_id IS DISTINCT FROM NEW.department_id OR
       OLD.role_id IS DISTINCT FROM NEW.role_id OR
       OLD.status IS DISTINCT FROM NEW.status OR
       OLD.permission_tier_override IS DISTINCT FROM NEW.permission_tier_override THEN
      has_changes := true;
    END IF;
    
    -- Only insert audit log if there are actual changes to tracked fields
    IF has_changes THEN
      INSERT INTO public.tenant_member_assignment_audit (
        id,
        tenant_id,
        user_id,
        changed_by,
        changed_at,
        old_values,
        new_values
      ) VALUES (
        gen_random_uuid(),
        NEW.tenant_id,
        NEW.user_id,
        auth.uid(), -- Current user making the change
        now(),
        old_values_json,
        new_values_json
      );
    END IF;
  END IF;
  
  RETURN NEW;
EXCEPTION
  WHEN OTHERS THEN
    -- Log error but don't block the update
    RAISE WARNING 'Audit logging failed: %', SQLERRM;
    RETURN NEW;
END;
$$;

-- Step 4: Create the trigger on tenant_members table
DROP TRIGGER IF EXISTS log_tenant_member_employment_changes_trigger ON public.tenant_members;
CREATE TRIGGER log_tenant_member_employment_changes_trigger
  AFTER UPDATE ON public.tenant_members
  FOR EACH ROW
  EXECUTE FUNCTION public.log_tenant_member_employment_changes();

-- Step 5: Add documentation
COMMENT ON FUNCTION public.log_tenant_member_employment_changes IS 'Logs employment field changes (department_id, role_id, status, permission_tier_override) to tenant_member_assignment_audit table. Does NOT use vessel_admin_audit.';
COMMENT ON TRIGGER log_tenant_member_employment_changes_trigger ON public.tenant_members IS 'Automatically logs employment changes to tenant_member_assignment_audit table after updates';
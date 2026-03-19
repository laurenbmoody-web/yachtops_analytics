-- Migration: Fix tenant_members audit logging
-- Purpose: Add proper audit trigger that logs employment changes to tenant_member_assignment_audit
-- Date: 2026-02-22
-- Issue: Error "column tenant_member_id of relation vessel_admin_audit does not exist"
-- Solution: Create trigger that logs to correct audit table with correct columns

-- Drop any existing audit trigger on tenant_members that might be causing issues
DROP TRIGGER IF EXISTS log_tenant_member_changes ON public.tenant_members;
DROP TRIGGER IF EXISTS audit_tenant_member_changes ON public.tenant_members;
DROP TRIGGER IF EXISTS tenant_member_audit_trigger ON public.tenant_members;

-- Drop any existing audit function that might be referencing wrong table
DROP FUNCTION IF EXISTS public.log_tenant_member_changes();
DROP FUNCTION IF EXISTS public.audit_tenant_member_changes();
DROP FUNCTION IF EXISTS public.handle_tenant_member_audit();

-- Create audit trigger function that logs to tenant_member_assignment_audit
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

-- Create trigger on tenant_members table
CREATE TRIGGER log_tenant_member_employment_changes_trigger
  AFTER UPDATE ON public.tenant_members
  FOR EACH ROW
  EXECUTE FUNCTION public.log_tenant_member_employment_changes();

-- Add comment for documentation
COMMENT ON FUNCTION public.log_tenant_member_employment_changes IS 'Logs employment field changes (department_id, role_id, status, permission_tier_override) to tenant_member_assignment_audit table';
COMMENT ON TRIGGER log_tenant_member_employment_changes_trigger ON public.tenant_members IS 'Automatically logs employment changes to audit table after updates';
-- Migration: Fix get_invite_public to return role_id and department_id with labels
-- Purpose: Update function to return role and department information from new schema
-- Date: 2026-02-19

-- Drop existing function
DROP FUNCTION IF EXISTS public.get_invite_public(TEXT);

-- Create updated RPC function to get public invite details with role_id support
CREATE OR REPLACE FUNCTION public.get_invite_public(p_token TEXT)
RETURNS TABLE(
    success BOOLEAN,
    vessel_name TEXT,
    email TEXT,
    job_title_label TEXT,
    department TEXT,
    department_id UUID,
    role_id UUID,
    invitee_name TEXT,
    error_message TEXT
)
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    v_invite_record RECORD;
    v_vessel_name TEXT;
    v_role_name TEXT;
    v_department_name TEXT;
BEGIN
    -- Find the invite (no auth check - public function)
    SELECT * INTO v_invite_record
    FROM public.crew_invites
    WHERE token = p_token
    AND status = 'PENDING'
    AND expires_at > NOW();
    
    -- Validate invite exists
    IF v_invite_record.id IS NULL THEN
        RETURN QUERY SELECT false, NULL::TEXT, NULL::TEXT, NULL::TEXT, NULL::TEXT, NULL::UUID, NULL::UUID, NULL::TEXT, 'Invite expired or invalid'::TEXT;
        RETURN;
    END IF;
    
    -- Get vessel name from tenants table
    SELECT name INTO v_vessel_name
    FROM public.tenants
    WHERE id = v_invite_record.tenant_id;
    
    -- Get role name from roles table if role_id exists
    IF v_invite_record.role_id IS NOT NULL THEN
        SELECT name INTO v_role_name
        FROM public.roles
        WHERE id = v_invite_record.role_id;
    END IF;
    
    -- Get department name from departments table if department_id exists
    IF v_invite_record.department_id IS NOT NULL THEN
        SELECT name INTO v_department_name
        FROM public.departments
        WHERE id = v_invite_record.department_id;
    END IF;
    
    -- Return invite details with role and department information
    RETURN QUERY SELECT 
        true,
        COALESCE(v_vessel_name, 'Unknown Vessel'),
        v_invite_record.email,
        COALESCE(v_role_name, v_invite_record.job_title_label, 'Crew Member'),
        COALESCE(v_department_name, v_invite_record.department, 'General'),
        v_invite_record.department_id,
        v_invite_record.role_id,
        v_invite_record.invitee_name,
        NULL::TEXT;
    
EXCEPTION
    WHEN OTHERS THEN
        RETURN QUERY SELECT false, NULL::TEXT, NULL::TEXT, NULL::TEXT, NULL::TEXT, NULL::UUID, NULL::UUID, NULL::TEXT, SQLERRM::TEXT;
END;
$$;

-- Grant execute permission to anonymous users (public access)
GRANT EXECUTE ON FUNCTION public.get_invite_public(TEXT) TO anon;
GRANT EXECUTE ON FUNCTION public.get_invite_public(TEXT) TO authenticated;
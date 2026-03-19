-- Migration: Fix accept_crew_invite_v3 NULL expires_at bug
-- Root cause: The WHERE clause used `ci.expires_at > NOW()` which evaluates to NULL
-- (not TRUE) when expires_at IS NULL, causing valid never-expiring PENDING invites
-- to be rejected as "Invite invalid, expired, or already used".
-- Fix: Use (ci.expires_at IS NULL OR ci.expires_at > NOW()) to match RLS policy logic.
-- Date: 2026-02-27

-- Drop existing v3 function
DROP FUNCTION IF EXISTS public.accept_crew_invite_v3(TEXT, TEXT);

-- Recreate with corrected expires_at check
CREATE OR REPLACE FUNCTION public.accept_crew_invite_v3(p_token TEXT, p_full_name TEXT DEFAULT NULL)
RETURNS TABLE(
    success BOOLEAN,
    tenant_id UUID,
    role TEXT,
    role_id UUID,
    job_title_id TEXT,
    job_title_label TEXT,
    message TEXT
)
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    v_invite_record RECORD;
    v_user_email TEXT;
    v_user_id UUID;
BEGIN
    -- Get current user info
    v_user_id := auth.uid();
    
    IF v_user_id IS NULL THEN
        RETURN QUERY SELECT false, NULL::UUID, NULL::TEXT, NULL::UUID, NULL::TEXT, NULL::TEXT, 'Not authenticated'::TEXT;
        RETURN;
    END IF;
    
    -- Get user email from profiles
    SELECT p.email INTO v_user_email
    FROM public.profiles p
    WHERE p.id = v_user_id;
    
    IF v_user_email IS NULL THEN
        RETURN QUERY SELECT false, NULL::UUID, NULL::TEXT, NULL::UUID, NULL::TEXT, NULL::TEXT, 'User profile not found'::TEXT;
        RETURN;
    END IF;
    
    -- Find the invite with corrected expires_at check
    -- FIX: Use (ci.expires_at IS NULL OR ci.expires_at > NOW()) to handle never-expiring invites
    -- Previously: ci.expires_at > NOW() would evaluate to NULL when expires_at IS NULL,
    -- causing valid PENDING invites to be incorrectly rejected.
    SELECT ci.* INTO v_invite_record
    FROM public.crew_invites ci
    WHERE ci.token = p_token
      AND ci.status = 'PENDING'
      AND (ci.expires_at IS NULL OR ci.expires_at > NOW())
    FOR UPDATE;
    
    -- Validate invite exists
    IF v_invite_record.id IS NULL THEN
        RETURN QUERY SELECT false, NULL::UUID, NULL::TEXT, NULL::UUID, NULL::TEXT, NULL::TEXT, 'Invite invalid, expired, or already used'::TEXT;
        RETURN;
    END IF;
    
    -- Validate email matches
    IF LOWER(v_user_email) != LOWER(v_invite_record.email) THEN
        RETURN QUERY SELECT false, NULL::UUID, NULL::TEXT, NULL::UUID, NULL::TEXT, NULL::TEXT, 'This invite is not for your email address'::TEXT;
        RETURN;
    END IF;
    
    -- Update profiles with full_name if provided
    IF p_full_name IS NOT NULL AND p_full_name != '' THEN
        UPDATE public.profiles
        SET full_name = p_full_name
        WHERE id = v_user_id;
    END IF;
    
    -- Check if user is already a member of this tenant
    IF EXISTS (
        SELECT 1 FROM public.tenant_members tm
        WHERE tm.tenant_id = v_invite_record.tenant_id
          AND tm.user_id = v_user_id
          AND tm.active = true
    ) THEN
        -- Mark invite as accepted anyway
        UPDATE public.crew_invites
        SET status = 'ACCEPTED',
            accepted_at = NOW(),
            accepted_by = v_user_id
        WHERE id = v_invite_record.id;
        
        RETURN QUERY SELECT true, v_invite_record.tenant_id, v_invite_record.invited_role, v_invite_record.role_id, v_invite_record.job_title_id, v_invite_record.job_title_label, 'Already a member'::TEXT;
        RETURN;
    END IF;
    
    -- Create tenant membership with role_id
    INSERT INTO public.tenant_members (tenant_id, user_id, role, role_id, active, status)
    VALUES (
        v_invite_record.tenant_id,
        v_user_id,
        v_invite_record.invited_role,
        v_invite_record.role_id,
        true,
        'ACTIVE'
    );
    
    -- Update invite status
    UPDATE public.crew_invites
    SET status = 'ACCEPTED',
        accepted_at = NOW(),
        accepted_by = v_user_id
    WHERE id = v_invite_record.id;
    
    -- Update user's last_active_tenant_id
    UPDATE public.profiles p
    SET last_active_tenant_id = v_invite_record.tenant_id
    WHERE p.id = v_user_id;
    
    -- Return success with tenant_id and job title information
    RETURN QUERY SELECT true, v_invite_record.tenant_id, v_invite_record.invited_role, v_invite_record.role_id, v_invite_record.job_title_id, v_invite_record.job_title_label, 'Invite accepted successfully'::TEXT;
    
EXCEPTION
    WHEN OTHERS THEN
        RETURN QUERY SELECT false, NULL::UUID, NULL::TEXT, NULL::UUID, NULL::TEXT, NULL::TEXT, SQLERRM::TEXT;
END;
$$;

-- Grant execute permission on the fixed function
GRANT EXECUTE ON FUNCTION public.accept_crew_invite_v3(TEXT, TEXT) TO authenticated;

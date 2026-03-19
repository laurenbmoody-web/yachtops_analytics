-- Migration: Add job title fields to crew_invites and create accept_crew_invite_v2
-- Created: 2026-01-27

-- 1. Add job_title_id and job_title_label columns to crew_invites table
ALTER TABLE public.crew_invites
ADD COLUMN IF NOT EXISTS job_title_id TEXT,
ADD COLUMN IF NOT EXISTS job_title_label TEXT;

-- 2. Create new versioned RPC function to accept crew invite with job title support
CREATE OR REPLACE FUNCTION public.accept_crew_invite_v2(p_token TEXT)
RETURNS TABLE(
    success BOOLEAN,
    tenant_id UUID,
    role TEXT,
    job_title_id TEXT,
    job_title_label TEXT,
    error_message TEXT
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
        RETURN QUERY SELECT false, NULL::UUID, NULL::TEXT, NULL::TEXT, NULL::TEXT, 'Not authenticated'::TEXT;
        RETURN;
    END IF;
    
    -- Get user email from profiles
    SELECT email INTO v_user_email
    FROM public.profiles
    WHERE id = v_user_id;
    
    IF v_user_email IS NULL THEN
        RETURN QUERY SELECT false, NULL::UUID, NULL::TEXT, NULL::TEXT, NULL::TEXT, 'User profile not found'::TEXT;
        RETURN;
    END IF;
    
    -- Find the invite
    SELECT * INTO v_invite_record
    FROM public.crew_invites
    WHERE token = p_token
    AND status = 'PENDING'
    AND expires_at > NOW()
    FOR UPDATE;
    
    -- Validate invite exists
    IF v_invite_record.id IS NULL THEN
        RETURN QUERY SELECT false, NULL::UUID, NULL::TEXT, NULL::TEXT, NULL::TEXT, 'Invite invalid, expired, or already used'::TEXT;
        RETURN;
    END IF;
    
    -- Validate email matches
    IF LOWER(v_user_email) != LOWER(v_invite_record.email) THEN
        RETURN QUERY SELECT false, NULL::UUID, NULL::TEXT, NULL::TEXT, NULL::TEXT, 'This invite is not for your email address'::TEXT;
        RETURN;
    END IF;
    
    -- Check if user is already a member of this tenant
    IF EXISTS (
        SELECT 1 FROM public.tenant_members
        WHERE tenant_id = v_invite_record.tenant_id
        AND user_id = v_user_id
        AND active = true
    ) THEN
        -- Mark invite as accepted anyway
        UPDATE public.crew_invites
        SET status = 'ACCEPTED',
            accepted_at = NOW(),
            accepted_by = v_user_id
        WHERE id = v_invite_record.id;
        
        RETURN QUERY SELECT true, v_invite_record.tenant_id, v_invite_record.invited_role, v_invite_record.job_title_id, v_invite_record.job_title_label, 'Already a member'::TEXT;
        RETURN;
    END IF;
    
    -- Create tenant membership
    INSERT INTO public.tenant_members (tenant_id, user_id, role, active, status)
    VALUES (
        v_invite_record.tenant_id,
        v_user_id,
        v_invite_record.invited_role,
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
    UPDATE public.profiles
    SET last_active_tenant_id = v_invite_record.tenant_id
    WHERE id = v_user_id;
    
    -- Return success with job title information
    RETURN QUERY SELECT true, v_invite_record.tenant_id, v_invite_record.invited_role, v_invite_record.job_title_id, v_invite_record.job_title_label, NULL::TEXT;
    
EXCEPTION
    WHEN OTHERS THEN
        RETURN QUERY SELECT false, NULL::UUID, NULL::TEXT, NULL::TEXT, NULL::TEXT, SQLERRM::TEXT;
END;
$$;

-- 3. Grant execute permission on the new function
GRANT EXECUTE ON FUNCTION public.accept_crew_invite_v2(TEXT) TO authenticated;
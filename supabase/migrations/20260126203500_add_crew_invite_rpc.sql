-- Migration: Add accept_crew_invite RPC function and crew_invites RLS policies
-- Created: 2026-01-26

-- Drop any existing version of the function (handles signature changes)
DROP FUNCTION IF EXISTS public.accept_crew_invite(TEXT) CASCADE;
DROP FUNCTION IF EXISTS public.accept_crew_invite(p_token TEXT) CASCADE;

-- 1. RLS Policies for crew_invites table
-- COMMAND users can view all invites for their tenant
CREATE POLICY "command_view_crew_invites"
ON public.crew_invites
FOR SELECT
TO authenticated
USING (
    EXISTS (
        SELECT 1 FROM public.tenant_members tm
        WHERE tm.tenant_id = crew_invites.tenant_id
        AND tm.user_id = auth.uid()
        AND tm.role = 'COMMAND'
        AND tm.active = true
    )
);

-- COMMAND users can insert invites for their tenant
CREATE POLICY "command_create_crew_invites"
ON public.crew_invites
FOR INSERT
TO authenticated
WITH CHECK (
    EXISTS (
        SELECT 1 FROM public.tenant_members tm
        WHERE tm.tenant_id = crew_invites.tenant_id
        AND tm.user_id = auth.uid()
        AND tm.role = 'COMMAND'
        AND tm.active = true
    )
);

-- COMMAND users can update invites for their tenant (for revoke)
CREATE POLICY "command_update_crew_invites"
ON public.crew_invites
FOR UPDATE
TO authenticated
USING (
    EXISTS (
        SELECT 1 FROM public.tenant_members tm
        WHERE tm.tenant_id = crew_invites.tenant_id
        AND tm.user_id = auth.uid()
        AND tm.role = 'COMMAND'
        AND tm.active = true
    )
)
WITH CHECK (
    EXISTS (
        SELECT 1 FROM public.tenant_members tm
        WHERE tm.tenant_id = crew_invites.tenant_id
        AND tm.user_id = auth.uid()
        AND tm.role = 'COMMAND'
        AND tm.active = true
    )
);

-- 2. RPC function to accept crew invite
CREATE OR REPLACE FUNCTION public.accept_crew_invite(p_token TEXT)
RETURNS TABLE(
    success BOOLEAN,
    tenant_id UUID,
    role TEXT,
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
        RETURN QUERY SELECT false, NULL::UUID, NULL::TEXT, 'Not authenticated'::TEXT;
        RETURN;
    END IF;
    
    -- Get user email from profiles
    SELECT email INTO v_user_email
    FROM public.profiles
    WHERE id = v_user_id;
    
    IF v_user_email IS NULL THEN
        RETURN QUERY SELECT false, NULL::UUID, NULL::TEXT, 'User profile not found'::TEXT;
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
        RETURN QUERY SELECT false, NULL::UUID, NULL::TEXT, 'Invite invalid, expired, or already used'::TEXT;
        RETURN;
    END IF;
    
    -- Validate email matches
    IF LOWER(v_user_email) != LOWER(v_invite_record.email) THEN
        RETURN QUERY SELECT false, NULL::UUID, NULL::TEXT, 'This invite is not for your email address'::TEXT;
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
        
        RETURN QUERY SELECT true, v_invite_record.tenant_id, v_invite_record.invited_role, 'Already a member'::TEXT;
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
    
    -- Return success
    RETURN QUERY SELECT true, v_invite_record.tenant_id, v_invite_record.invited_role, NULL::TEXT;
    
EXCEPTION
    WHEN OTHERS THEN
        RETURN QUERY SELECT false, NULL::UUID, NULL::TEXT, SQLERRM::TEXT;
END;
$$;

-- 3. Grant execute permission on the function
GRANT EXECUTE ON FUNCTION public.accept_crew_invite(TEXT) TO authenticated;
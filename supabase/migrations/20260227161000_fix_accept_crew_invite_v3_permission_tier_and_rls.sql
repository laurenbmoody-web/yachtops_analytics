-- Migration: Fix accept_crew_invite_v3 to include permission_tier in tenant_members INSERT
-- Root cause: permission_tier column was not being set, so crew members showed no tier
-- Fix: Map invited_role to permission_tier during INSERT
-- Date: 2026-02-27

-- Drop existing v3 function
DROP FUNCTION IF EXISTS public.accept_crew_invite_v3(TEXT, TEXT);

-- Recreate with permission_tier included in INSERT
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
    v_user_email    TEXT;
    v_user_id       UUID;
    v_out_tenant_id       UUID;
    v_out_role            TEXT;
    v_out_role_id         UUID;
    v_out_job_title_id    TEXT;
    v_out_job_title_label TEXT;
    v_out_department_id   UUID;
    v_out_permission_tier TEXT;
BEGIN
    -- Get current user info
    v_user_id := auth.uid();

    IF v_user_id IS NULL THEN
        RETURN QUERY SELECT false::BOOLEAN, NULL::UUID, NULL::TEXT, NULL::UUID, NULL::TEXT, NULL::TEXT, 'Not authenticated'::TEXT;
        RETURN;
    END IF;

    -- Get user email from profiles
    SELECT p.email INTO v_user_email
    FROM public.profiles p
    WHERE p.id = v_user_id;

    IF v_user_email IS NULL THEN
        RETURN QUERY SELECT false::BOOLEAN, NULL::UUID, NULL::TEXT, NULL::UUID, NULL::TEXT, NULL::TEXT, 'User profile not found'::TEXT;
        RETURN;
    END IF;

    -- Find the invite (NULL-safe expires_at check)
    SELECT ci.* INTO v_invite_record
    FROM public.crew_invites ci
    WHERE ci.token = p_token
      AND ci.status = 'PENDING'
      AND (ci.expires_at IS NULL OR ci.expires_at > NOW())
    FOR UPDATE;

    -- Validate invite exists
    IF v_invite_record.id IS NULL THEN
        RETURN QUERY SELECT false::BOOLEAN, NULL::UUID, NULL::TEXT, NULL::UUID, NULL::TEXT, NULL::TEXT, 'Invite invalid, expired, or already used'::TEXT;
        RETURN;
    END IF;

    -- Validate email matches
    IF LOWER(v_user_email) != LOWER(v_invite_record.email) THEN
        RETURN QUERY SELECT false::BOOLEAN, NULL::UUID, NULL::TEXT, NULL::UUID, NULL::TEXT, NULL::TEXT, 'This invite is not for your email address'::TEXT;
        RETURN;
    END IF;

    -- Capture return values into unambiguous local variables
    v_out_tenant_id       := v_invite_record.tenant_id;
    v_out_role            := v_invite_record.invited_role;
    v_out_role_id         := v_invite_record.role_id;
    v_out_job_title_id    := v_invite_record.job_title_id;
    v_out_job_title_label := v_invite_record.job_title_label;
    v_out_department_id   := v_invite_record.department_id;
    -- Use permission_tier from invite if set, otherwise derive from invited_role
    v_out_permission_tier := COALESCE(
        v_invite_record.permission_tier,
        v_invite_record.invited_role
    );

    -- Update profiles with full_name if provided
    IF p_full_name IS NOT NULL AND p_full_name != '' THEN
        UPDATE public.profiles
        SET full_name = p_full_name
        WHERE id = v_user_id;
    END IF;

    -- Check if user is already a member of this tenant
    IF EXISTS (
        SELECT 1 FROM public.tenant_members tm
        WHERE tm.tenant_id = v_out_tenant_id
          AND tm.user_id   = v_user_id
          AND tm.active    = true
    ) THEN
        -- Mark invite as accepted anyway
        UPDATE public.crew_invites
        SET status      = 'ACCEPTED',
            accepted_at = NOW(),
            accepted_by = v_user_id
        WHERE id = v_invite_record.id;

        RETURN QUERY SELECT true::BOOLEAN, v_out_tenant_id, v_out_role, v_out_role_id, v_out_job_title_id, v_out_job_title_label, 'Already a member'::TEXT;
        RETURN;
    END IF;

    -- Create tenant membership with permission_tier included
    INSERT INTO public.tenant_members (tenant_id, user_id, role, role_id, role_legacy, department_id, permission_tier, active, status)
    VALUES (
        v_out_tenant_id,
        v_user_id,
        v_out_role,
        v_out_role_id,
        v_out_role,
        v_out_department_id,
        v_out_permission_tier,  -- FIX: include permission_tier so crew shows correct tier in crew management
        true,
        'ACTIVE'
    );

    -- Update invite status
    UPDATE public.crew_invites
    SET status      = 'ACCEPTED',
        accepted_at = NOW(),
        accepted_by = v_user_id
    WHERE id = v_invite_record.id;

    -- Update user's last_active_tenant_id
    UPDATE public.profiles
    SET last_active_tenant_id = v_out_tenant_id
    WHERE id = v_user_id;

    -- Return success
    RETURN QUERY SELECT true::BOOLEAN, v_out_tenant_id, v_out_role, v_out_role_id, v_out_job_title_id, v_out_job_title_label, 'Invite accepted successfully'::TEXT;

EXCEPTION
    WHEN OTHERS THEN
        RETURN QUERY SELECT false::BOOLEAN, NULL::UUID, NULL::TEXT, NULL::UUID, NULL::TEXT, NULL::TEXT, SQLERRM::TEXT;
END;
$$;

-- Grant execute permission
GRANT EXECUTE ON FUNCTION public.accept_crew_invite_v3(TEXT, TEXT) TO authenticated;

-- Also add a SELECT policy so COMMAND users can see all tenant members
-- (the existing tm_select_own policy only allows users to see their own row)
DROP POLICY IF EXISTS "tm_select_same_tenant" ON public.tenant_members;
CREATE POLICY "tm_select_same_tenant"
ON public.tenant_members
FOR SELECT
TO authenticated
USING (
    -- Users can see all members in tenants they belong to
    -- Uses SECURITY DEFINER function to avoid circular RLS
    public.user_is_tenant_member(auth.uid(), tenant_id)
);

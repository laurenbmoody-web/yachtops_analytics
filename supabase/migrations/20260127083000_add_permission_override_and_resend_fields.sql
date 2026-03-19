-- Migration: Add permission override fields and invite resend tracking
-- Created: 2026-01-27

-- 1. Add permission override fields to tenant_members
ALTER TABLE public.tenant_members
ADD COLUMN IF NOT EXISTS permission_override_enabled BOOLEAN DEFAULT false,
ADD COLUMN IF NOT EXISTS permission_tier_override TEXT;

-- Add check constraint for permission_tier_override
ALTER TABLE public.tenant_members
DROP CONSTRAINT IF EXISTS tenant_members_permission_tier_override_check;

ALTER TABLE public.tenant_members
ADD CONSTRAINT tenant_members_permission_tier_override_check
CHECK (permission_tier_override IS NULL OR permission_tier_override = ANY (ARRAY['COMMAND'::text, 'CHIEF'::text, 'HOD'::text, 'CREW'::text]));

-- 2. Add resend tracking fields to crew_invites
ALTER TABLE public.crew_invites
ADD COLUMN IF NOT EXISTS last_resent_at TIMESTAMP WITH TIME ZONE,
ADD COLUMN IF NOT EXISTS resent_count INTEGER DEFAULT 0;

-- 3. Create RPC function to resend/nudge invite
CREATE OR REPLACE FUNCTION public.resend_crew_invite(p_invite_id UUID)
RETURNS TABLE(
    success BOOLEAN,
    error_message TEXT,
    can_resend BOOLEAN,
    wait_seconds INTEGER
)
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    v_invite_record RECORD;
    v_user_id UUID;
    v_time_since_last_resend INTERVAL;
    v_rate_limit_seconds INTEGER := 300; -- 5 minutes
BEGIN
    -- Get current user
    v_user_id := auth.uid();
    
    IF v_user_id IS NULL THEN
        RETURN QUERY SELECT false, 'Not authenticated'::TEXT, false, 0;
        RETURN;
    END IF;
    
    -- Get invite record
    SELECT * INTO v_invite_record
    FROM public.crew_invites
    WHERE id = p_invite_id
    AND status = 'PENDING'
    FOR UPDATE;
    
    IF v_invite_record.id IS NULL THEN
        RETURN QUERY SELECT false, 'Invite not found or not pending'::TEXT, false, 0;
        RETURN;
    END IF;
    
    -- Check if user has COMMAND access to this tenant
    IF NOT EXISTS (
        SELECT 1 FROM public.tenant_members tm
        WHERE tm.tenant_id = v_invite_record.tenant_id
        AND tm.user_id = v_user_id
        AND tm.role = 'COMMAND'
        AND tm.active = true
    ) THEN
        RETURN QUERY SELECT false, 'Unauthorized'::TEXT, false, 0;
        RETURN;
    END IF;
    
    -- Check rate limit (5 minutes)
    IF v_invite_record.last_resent_at IS NOT NULL THEN
        v_time_since_last_resend := NOW() - v_invite_record.last_resent_at;
        
        IF EXTRACT(EPOCH FROM v_time_since_last_resend) < v_rate_limit_seconds THEN
            -- Rate limited
            RETURN QUERY SELECT 
                false, 
                'Rate limit: Please wait before resending'::TEXT, 
                false,
                (v_rate_limit_seconds - EXTRACT(EPOCH FROM v_time_since_last_resend)::INTEGER);
            RETURN;
        END IF;
    END IF;
    
    -- Update invite record
    UPDATE public.crew_invites
    SET 
        last_resent_at = NOW(),
        resent_count = COALESCE(resent_count, 0) + 1
    WHERE id = p_invite_id;
    
    -- Return success
    RETURN QUERY SELECT true, NULL::TEXT, true, 0;
    
EXCEPTION
    WHEN OTHERS THEN
        RETURN QUERY SELECT false, SQLERRM::TEXT, false, 0;
END;
$$;

-- 4. Grant execute permission
GRANT EXECUTE ON FUNCTION public.resend_crew_invite(UUID) TO authenticated;

-- 5. Create RPC function to get effective permission tier for a member
CREATE OR REPLACE FUNCTION public.get_member_effective_tier(p_user_id UUID, p_tenant_id UUID)
RETURNS TEXT
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    v_member_record RECORD;
    v_role_tier TEXT;
BEGIN
    -- Get member record
    SELECT * INTO v_member_record
    FROM public.tenant_members
    WHERE user_id = p_user_id
    AND tenant_id = p_tenant_id
    AND active = true;
    
    IF v_member_record.id IS NULL THEN
        RETURN NULL;
    END IF;
    
    -- If override is enabled, return override tier
    IF v_member_record.permission_override_enabled = true AND v_member_record.permission_tier_override IS NOT NULL THEN
        RETURN v_member_record.permission_tier_override;
    END IF;
    
    -- Otherwise, return role-based tier (from tenant_members.role)
    RETURN v_member_record.role;
    
END;
$$;

-- 6. Grant execute permission
GRANT EXECUTE ON FUNCTION public.get_member_effective_tier(UUID, UUID) TO authenticated;
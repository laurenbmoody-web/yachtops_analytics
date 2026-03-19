-- Migration: Add get_invite_public RPC for unauthenticated invite page
-- Created: 2026-01-27

-- Drop existing function if it exists (required when changing return type)
DROP FUNCTION IF EXISTS public.get_invite_public(TEXT);

-- Create RPC function to get public invite details (no auth required)
CREATE OR REPLACE FUNCTION public.get_invite_public(p_token TEXT)
RETURNS TABLE(
    success BOOLEAN,
    vessel_name TEXT,
    email TEXT,
    job_title_label TEXT,
    department TEXT,
    invitee_name TEXT,
    error_message TEXT
)
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    v_invite_record RECORD;
    v_vessel_name TEXT;
BEGIN
    -- Find the invite (no auth check - public function)
    SELECT * INTO v_invite_record
    FROM public.crew_invites
    WHERE token = p_token
    AND status = 'PENDING'
    AND expires_at > NOW();
    
    -- Validate invite exists
    IF v_invite_record.id IS NULL THEN
        RETURN QUERY SELECT false, NULL::TEXT, NULL::TEXT, NULL::TEXT, NULL::TEXT, NULL::TEXT, 'Invite expired or invalid'::TEXT;
        RETURN;
    END IF;
    
    -- Get vessel name from tenants table
    SELECT name INTO v_vessel_name
    FROM public.tenants
    WHERE id = v_invite_record.tenant_id;
    
    -- Return invite details
    RETURN QUERY SELECT 
        true,
        COALESCE(v_vessel_name, 'Unknown Vessel'),
        v_invite_record.email,
        v_invite_record.job_title_label,
        v_invite_record.department,
        v_invite_record.invitee_name,
        NULL::TEXT;
    
EXCEPTION
    WHEN OTHERS THEN
        RETURN QUERY SELECT false, NULL::TEXT, NULL::TEXT, NULL::TEXT, NULL::TEXT, NULL::TEXT, SQLERRM::TEXT;
END;
$$;

-- Grant execute permission to anonymous users (public access)
GRANT EXECUTE ON FUNCTION public.get_invite_public(TEXT) TO anon;
GRANT EXECUTE ON FUNCTION public.get_invite_public(TEXT) TO authenticated;
-- Migration: Fix get_my_context() to use permission_tier column
-- Created: 2026-02-24
-- Purpose: Use tenant_members.permission_tier as the authoritative column (role column does not exist)

CREATE OR REPLACE FUNCTION public.get_my_context()
RETURNS TABLE (
    user_id UUID,
    tenant_id UUID,
    role TEXT
)
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    v_user_id UUID;
    v_tenant_id UUID;
    v_role TEXT;
BEGIN
    -- Get authenticated user ID
    v_user_id := auth.uid();
    
    IF v_user_id IS NULL THEN
        RETURN QUERY SELECT NULL::UUID, NULL::UUID, NULL::TEXT;
        RETURN;
    END IF;
    
    -- Get active tenant from profile
    SELECT last_active_tenant_id INTO v_tenant_id
    FROM public.profiles
    WHERE id = v_user_id;
    
    -- If no active tenant, return null for tenant_id and role
    IF v_tenant_id IS NULL THEN
        RETURN QUERY SELECT v_user_id, NULL::UUID, NULL::TEXT;
        RETURN;
    END IF;
    
    -- Get effective permission tier from tenant_members
    -- Use permission_tier as primary source, with fallback chain
    SELECT 
        COALESCE(
            tm.permission_tier,
            tm.permission_tier_override,
            'VIEW_ONLY'
        ) INTO v_role
    FROM public.tenant_members tm
    WHERE tm.user_id = v_user_id
      AND tm.tenant_id = v_tenant_id
      AND tm.active = true
      AND tm.status = 'ACTIVE'
    LIMIT 1;
    
    -- Return context (permission_tier defaults to null if no membership found)
    RETURN QUERY SELECT v_user_id, v_tenant_id, v_role;
END;
$$;
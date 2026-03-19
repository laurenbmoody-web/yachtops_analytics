-- Migration: Fix crew_invites UPDATE RLS policy to use role_id
-- Purpose: Update RLS policy to check permission tier via roles.default_permission_tier instead of deprecated tenant_members.permission_tier column
-- Date: 2026-02-19

-- Drop old policy that checks tm.role = 'COMMAND'
DROP POLICY IF EXISTS "command_update_crew_invites" ON public.crew_invites;

-- Create new policy that checks permission tier via role_id join
CREATE POLICY "command_update_crew_invites"
ON public.crew_invites
FOR UPDATE
TO authenticated
USING (
    EXISTS (
        SELECT 1 
        FROM public.tenant_members tm
        LEFT JOIN public.roles r ON r.id = tm.role_id
        WHERE tm.tenant_id = crew_invites.tenant_id
        AND tm.user_id = auth.uid()
        AND tm.active = true
        AND (
            -- Check new role_id system: permission tier must be COMMAND
            (tm.role_id IS NOT NULL AND r.default_permission_tier = 'COMMAND')
            OR
            -- Fallback to old role column for backwards compatibility
            (tm.role_id IS NULL AND tm.role = 'COMMAND')
        )
    )
)
WITH CHECK (
    EXISTS (
        SELECT 1 
        FROM public.tenant_members tm
        LEFT JOIN public.roles r ON r.id = tm.role_id
        WHERE tm.tenant_id = crew_invites.tenant_id
        AND tm.user_id = auth.uid()
        AND tm.active = true
        AND (
            -- Check new role_id system: permission tier must be COMMAND
            (tm.role_id IS NOT NULL AND r.default_permission_tier = 'COMMAND')
            OR
            -- Fallback to old role column for backwards compatibility
            (tm.role_id IS NULL AND tm.role = 'COMMAND')
        )
    )
);
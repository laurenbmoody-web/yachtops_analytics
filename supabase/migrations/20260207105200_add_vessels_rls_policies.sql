-- Migration: Add RLS policies for vessels table
-- Purpose: Enable authenticated users to read vessel data including hero image fields

-- RLS policies for vessels table
-- Allow authenticated users to read vessels they are members of
DROP POLICY IF EXISTS "authenticated_read_vessels" ON public.vessels;
CREATE POLICY "authenticated_read_vessels" 
ON public.vessels
FOR SELECT 
TO authenticated
USING (
    EXISTS (
        SELECT 1 FROM public.tenant_members tm
        WHERE tm.tenant_id = vessels.tenant_id
        AND tm.user_id = auth.uid()
        AND tm.active = true
    )
);

-- Allow COMMAND role to update vessels
DROP POLICY IF EXISTS "command_update_vessels" ON public.vessels;
CREATE POLICY "command_update_vessels" 
ON public.vessels
FOR UPDATE 
TO authenticated
USING (
    EXISTS (
        SELECT 1 FROM public.tenant_members tm
        WHERE tm.tenant_id = vessels.tenant_id
        AND tm.user_id = auth.uid()
        AND tm.permission_tier = 'COMMAND'
        AND tm.active = true
    )
)
WITH CHECK (
    EXISTS (
        SELECT 1 FROM public.tenant_members tm
        WHERE tm.tenant_id = vessels.tenant_id
        AND tm.user_id = auth.uid()
        AND tm.permission_tier = 'COMMAND'
        AND tm.active = true
    )
);

-- Allow COMMAND role to insert vessels
DROP POLICY IF EXISTS "command_insert_vessels" ON public.vessels;
CREATE POLICY "command_insert_vessels" 
ON public.vessels
FOR INSERT 
TO authenticated
WITH CHECK (
    EXISTS (
        SELECT 1 FROM public.tenant_members tm
        WHERE tm.tenant_id = vessels.tenant_id
        AND tm.user_id = auth.uid()
        AND tm.permission_tier = 'COMMAND'
        AND tm.active = true
    )
);
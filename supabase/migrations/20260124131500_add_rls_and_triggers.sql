-- Migration: Add RLS policies and triggers for tenant management
-- Created: 2026-01-24

-- 1. Create trigger function for auto-creating profiles
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
    INSERT INTO public.profiles (id, full_name, email)
    VALUES (
        NEW.id,
        COALESCE(NEW.raw_user_meta_data->>'full_name', split_part(NEW.email, '@', 1)),
        NEW.email
    );
    RETURN NEW;
END;
$$;

-- 2. Enable RLS on all tables
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.tenants ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.tenant_members ENABLE ROW LEVEL SECURITY;

-- 3. RLS Policies for profiles
DROP POLICY IF EXISTS "users_manage_own_profiles" ON public.profiles;
CREATE POLICY "users_manage_own_profiles"
ON public.profiles
FOR ALL
TO authenticated
USING (id = auth.uid())
WITH CHECK (id = auth.uid());

-- 4. RLS Policies for tenants
-- Users can view tenants they are members of
DROP POLICY IF EXISTS "users_view_member_tenants" ON public.tenants;
CREATE POLICY "users_view_member_tenants"
ON public.tenants
FOR SELECT
TO authenticated
USING (
    EXISTS (
        SELECT 1 FROM public.tenant_members tm
        WHERE tm.tenant_id = id
        AND tm.user_id = auth.uid()
        AND tm.active = true
    )
);

-- Users with COMMAND role can update their tenant
DROP POLICY IF EXISTS "command_update_tenant" ON public.tenants;
CREATE POLICY "command_update_tenant"
ON public.tenants
FOR UPDATE
TO authenticated
USING (
    EXISTS (
        SELECT 1 FROM public.tenant_members tm
        WHERE tm.tenant_id = id
        AND tm.user_id = auth.uid()
        AND tm.permission_tier = 'COMMAND'
        AND tm.active = true
    )
)
WITH CHECK (
    EXISTS (
        SELECT 1 FROM public.tenant_members tm
        WHERE tm.tenant_id = id
        AND tm.user_id = auth.uid()
        AND tm.permission_tier = 'COMMAND'
        AND tm.active = true
    )
);

-- Any authenticated user can create a tenant (for signup)
DROP POLICY IF EXISTS "authenticated_create_tenant" ON public.tenants;
CREATE POLICY "authenticated_create_tenant"
ON public.tenants
FOR INSERT
TO authenticated
WITH CHECK (true);

-- 5. RLS Policies for tenant_members
-- Users can view members of tenants they belong to
DROP POLICY IF EXISTS "users_view_tenant_members" ON public.tenant_members;
CREATE POLICY "users_view_tenant_members"
ON public.tenant_members
FOR SELECT
TO authenticated
USING (
    EXISTS (
        SELECT 1 FROM public.tenant_members tm
        WHERE tm.tenant_id = tenant_id
        AND tm.user_id = auth.uid()
        AND tm.active = true
    )
);

-- Any authenticated user can create tenant membership (for signup)
DROP POLICY IF EXISTS "authenticated_create_membership" ON public.tenant_members;
CREATE POLICY "authenticated_create_membership"
ON public.tenant_members
FOR INSERT
TO authenticated
WITH CHECK (user_id = auth.uid());

-- COMMAND role can update memberships in their tenant
DROP POLICY IF EXISTS "command_update_membership" ON public.tenant_members;
CREATE POLICY "command_update_membership"
ON public.tenant_members
FOR UPDATE
TO authenticated
USING (
    EXISTS (
        SELECT 1 FROM public.tenant_members tm
        WHERE tm.tenant_id = tenant_id
        AND tm.user_id = auth.uid()
        AND tm.permission_tier = 'COMMAND'
        AND tm.active = true
    )
)
WITH CHECK (
    EXISTS (
        SELECT 1 FROM public.tenant_members tm
        WHERE tm.tenant_id = tenant_id
        AND tm.user_id = auth.uid()
        AND tm.permission_tier = 'COMMAND'
        AND tm.active = true
    )
);

-- 6. Create trigger on auth.users
DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
    AFTER INSERT ON auth.users
    FOR EACH ROW
    EXECUTE FUNCTION public.handle_new_user();

-- 7. Create mock data for testing
DO $$
DECLARE
    captain_uuid UUID := gen_random_uuid();
    crew_uuid UUID := gen_random_uuid();
    tenant_uuid UUID := gen_random_uuid();
BEGIN
    -- Create auth users (trigger will create profiles automatically)
    INSERT INTO auth.users (
        id, instance_id, aud, role, email, encrypted_password, email_confirmed_at,
        created_at, updated_at, raw_user_meta_data, raw_app_meta_data,
        is_sso_user, is_anonymous, confirmation_token, confirmation_sent_at,
        recovery_token, recovery_sent_at, email_change_token_new, email_change,
        email_change_sent_at, email_change_token_current, email_change_confirm_status,
        reauthentication_token, reauthentication_sent_at, phone, phone_change,
        phone_change_token, phone_change_sent_at
    ) VALUES
        (captain_uuid, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
         'captain@cargo.local', crypt('cargo123', gen_salt('bf', 10)), now(), now(), now(),
         '{"full_name": "Captain James"}'::jsonb,
         '{"provider": "email", "providers": ["email"]}'::jsonb,
         false, false, '', null, '', null, '', '', null, '', 0, '', null, null, '', '', null),
        (crew_uuid, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
         'crew@cargo.local', crypt('cargo123', gen_salt('bf', 10)), now(), now(), now(),
         '{"full_name": "Sarah Mitchell"}'::jsonb,
         '{"provider": "email", "providers": ["email"]}'::jsonb,
         false, false, '', null, '', null, '', '', null, '', 0, '', null, null, '', '', null);

    -- Create a tenant
    INSERT INTO public.tenants (id, name, type, status)
    VALUES (tenant_uuid, 'M/Y Belongers', 'VESSEL', 'TRIAL');

    -- Create tenant memberships
    INSERT INTO public.tenant_members (tenant_id, user_id, permission_tier, role_legacy, active)
    VALUES
        (tenant_uuid, captain_uuid, 'COMMAND', 'COMMAND', true),
        (tenant_uuid, crew_uuid, 'CREW', 'CREW', true);
END $$;
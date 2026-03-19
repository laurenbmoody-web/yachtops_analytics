-- Fix guests RLS: redefine is_tenant_member with SET search_path and fix INSERT policy
-- This resolves 'TypeError: Load failed' on createGuest caused by RLS policy failure

-- Redefine is_tenant_member with explicit search_path to avoid schema resolution issues
CREATE OR REPLACE FUNCTION public.is_tenant_member(p_tenant_id UUID)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.tenant_members tm
    WHERE tm.tenant_id = p_tenant_id
      AND tm.user_id = auth.uid()
      AND tm.active = true
  )
$$;

-- Drop and recreate all guests policies using the fixed function
DROP POLICY IF EXISTS "guests_select_tenant_members" ON public.guests;
CREATE POLICY "guests_select_tenant_members"
  ON public.guests
  FOR SELECT
  TO authenticated
  USING (public.is_tenant_member(tenant_id));

DROP POLICY IF EXISTS "guests_insert_tenant_members" ON public.guests;
CREATE POLICY "guests_insert_tenant_members"
  ON public.guests
  FOR INSERT
  TO authenticated
  WITH CHECK (public.is_tenant_member(tenant_id));

DROP POLICY IF EXISTS "guests_update_tenant_members" ON public.guests;
CREATE POLICY "guests_update_tenant_members"
  ON public.guests
  FOR UPDATE
  TO authenticated
  USING (public.is_tenant_member(tenant_id))
  WITH CHECK (public.is_tenant_member(tenant_id));

DROP POLICY IF EXISTS "guests_delete_tenant_members" ON public.guests;
CREATE POLICY "guests_delete_tenant_members"
  ON public.guests
  FOR DELETE
  TO authenticated
  USING (public.is_tenant_member(tenant_id));

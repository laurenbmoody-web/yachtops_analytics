-- Allow supplier team members to see each other.
--
-- Background: 20260419180000 fixed an RLS recursion loop by restricting
-- supplier_contacts SELECT to user_id = auth.uid(). That works for the
-- recursion fix but means no teammate is ever visible to another. The
-- Reassign modal and the Team list both need to read peer rows.
--
-- We can safely broaden the policy because public.get_user_supplier_id()
-- is SECURITY DEFINER and bypasses RLS, so it doesn't re-enter this policy.

DROP POLICY IF EXISTS "supplier_read_own_contacts" ON public.supplier_contacts;

CREATE POLICY "supplier_read_team_contacts" ON public.supplier_contacts
  FOR SELECT USING (
    supplier_id = public.get_user_supplier_id()
  );

COMMENT ON POLICY "supplier_read_team_contacts" ON public.supplier_contacts IS
  'Members of a supplier can see all teammates in their org. Uses SECURITY DEFINER helper to avoid recursion.';

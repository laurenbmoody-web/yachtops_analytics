-- ─────────────────────────────────────────────────────────────────────────────
-- 20260713160000_leave_tenant.sql
--
-- WHAT: Let a crew member leave a vessel themselves. tenant_members updates are
--       Command-gated by RLS, so a SECURITY DEFINER RPC deactivates the CALLER's
--       own membership (scoped to auth.uid()). Their personal record (profile,
--       documents, personal details, sea service) is user-owned and untouched —
--       leaving ≠ deleting.
--
-- GUARD: a COMMAND member who is the ONLY active Command on the vessel can't
--        leave (it would strand the vessel with no admin) — they must transfer
--        command first. Raised as 'last_command' for the client to explain.
-- ─────────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.leave_tenant(p_tenant uuid)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  my_tier   text;
  cmd_count int;
BEGIN
  SELECT upper(coalesce(permission_tier, role, ''))
    INTO my_tier
    FROM tenant_members
   WHERE user_id = auth.uid() AND tenant_id = p_tenant AND active = true;

  IF my_tier IS NULL THEN
    RAISE EXCEPTION 'not_member';
  END IF;

  IF my_tier = 'COMMAND' THEN
    SELECT count(*) INTO cmd_count
      FROM tenant_members
     WHERE tenant_id = p_tenant AND active = true
       AND upper(coalesce(permission_tier, role, '')) = 'COMMAND';
    IF cmd_count <= 1 THEN
      RAISE EXCEPTION 'last_command';
    END IF;
  END IF;

  UPDATE tenant_members
     SET active = false
   WHERE user_id = auth.uid() AND tenant_id = p_tenant;
END;
$$;

REVOKE ALL ON FUNCTION public.leave_tenant(uuid) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.leave_tenant(uuid) TO authenticated;

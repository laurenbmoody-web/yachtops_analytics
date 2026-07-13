-- ─────────────────────────────────────────────────────────────────────────────
-- 20260713130000_restrict_profile_email.sql
--
-- WHAT: Stop crew reading each other's email. profiles.email should be visible
--       only to the person themselves and to the Command tier of a shared vessel
--       — matching how contact details / documents are already scoped.
--
-- WHY THIS SHAPE: Postgres RLS is row-level; it can't hide a single column. The
--       correct mechanism is column-level SELECT privileges. authenticated has a
--       table-wide SELECT today, so we revoke that and re-grant every column
--       EXCEPT email. Email is then handed back only where legitimate, via the
--       SECURITY DEFINER crew_emails() function below (self or shared-tenant
--       Command). Verified against the live DB with a rolled-back dry run:
--       email reads block, all other columns and RLS row-scoping are unchanged.
--
-- NOTE: after this, any client query naming email directly (or select('*'))
--       will error — those call sites are updated to use crew_emails() or the
--       auth session email instead.
-- ─────────────────────────────────────────────────────────────────────────────

REVOKE SELECT ON public.profiles FROM authenticated;
GRANT SELECT (
  id, full_name, first_name, last_name, surname, avatar_url,
  department, department_id, role_id, account_type, account_mode,
  current_tenant_id, last_active_tenant_id, created_at, updated_at,
  custom_departments, dashboard_tutorial_dismissed_at, onboarding_tutorial_state
) ON public.profiles TO authenticated;

-- Emails for the given users, but only those the caller may see: themselves, or
-- anyone in a tenant where the caller is active COMMAND. Runs as definer so it
-- can read the (now-restricted) email column; the WHERE clause is the gate.
CREATE OR REPLACE FUNCTION public.crew_emails(p_ids uuid[])
RETURNS TABLE (id uuid, email text)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT p.id, p.email
  FROM public.profiles p
  WHERE p.id = ANY(p_ids)
    AND (
      p.id = auth.uid()
      OR EXISTS (
        SELECT 1
        FROM public.tenant_members v
        JOIN public.tenant_members s ON s.tenant_id = v.tenant_id
        WHERE v.user_id = auth.uid()
          AND v.active = true
          AND v.permission_tier = 'COMMAND'
          AND s.user_id = p.id
      )
    );
$$;

REVOKE ALL ON FUNCTION public.crew_emails(uuid[]) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.crew_emails(uuid[]) TO authenticated;

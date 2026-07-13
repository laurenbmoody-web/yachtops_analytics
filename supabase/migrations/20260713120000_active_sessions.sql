-- ─────────────────────────────────────────────────────────────────────────────
-- 20260713120000_active_sessions.sql
--
-- WHAT: Let a signed-in user see and sign out their own auth sessions (the
--       "Active sessions" surface in Settings › Security). auth.sessions isn't
--       reachable from the client, so this exposes three SECURITY DEFINER RPCs,
--       each hard-scoped to auth.uid(). The current device is identified by the
--       JWT's session_id claim so it can be marked and protected.
--
-- SAFETY: every function filters on user_id = auth.uid(); a caller can only ever
--         list or revoke their OWN sessions. Deleting an auth.sessions row is a
--         full revoke — the FK from auth.refresh_tokens cascades, so the device
--         can't refresh and drops out within the access-token lifetime.
--
-- IDEMPOTENT: CREATE OR REPLACE; GRANT/REVOKE are repeatable.
-- ─────────────────────────────────────────────────────────────────────────────

-- The caller's own sessions, current device first. host(ip) strips the netmask;
-- refreshed_at is stored without a zone (UTC) so we stamp it as UTC.
CREATE OR REPLACE FUNCTION public.list_my_sessions()
RETURNS TABLE (
  id           uuid,
  created_at   timestamptz,
  refreshed_at timestamptz,
  user_agent   text,
  ip           text,
  aal          text,
  is_current   boolean
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = auth, public AS $$
  SELECT s.id,
         s.created_at,
         COALESCE((s.refreshed_at AT TIME ZONE 'UTC'), s.updated_at, s.created_at) AS refreshed_at,
         s.user_agent,
         host(s.ip) AS ip,
         s.aal::text AS aal,
         s.id = (NULLIF(auth.jwt() ->> 'session_id', ''))::uuid AS is_current
  FROM auth.sessions s
  WHERE s.user_id = auth.uid()
  ORDER BY (s.id = (NULLIF(auth.jwt() ->> 'session_id', ''))::uuid) DESC,
           COALESCE((s.refreshed_at AT TIME ZONE 'UTC'), s.updated_at, s.created_at) DESC;
$$;

-- Sign out one of the caller's sessions (any device, including the current one).
CREATE OR REPLACE FUNCTION public.revoke_my_session(p_session_id uuid)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = auth, public AS $$
BEGIN
  DELETE FROM auth.sessions WHERE id = p_session_id AND user_id = auth.uid();
END;
$$;

-- Sign out every OTHER device, keeping the current session. If the current
-- session can't be identified from the JWT, refuse rather than risk self-logout.
CREATE OR REPLACE FUNCTION public.revoke_my_other_sessions()
RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path = auth, public AS $$
DECLARE
  cur uuid := (NULLIF(auth.jwt() ->> 'session_id', ''))::uuid;
  n   integer;
BEGIN
  IF cur IS NULL THEN
    RETURN 0;
  END IF;
  DELETE FROM auth.sessions WHERE user_id = auth.uid() AND id <> cur;
  GET DIAGNOSTICS n = ROW_COUNT;
  RETURN n;
END;
$$;

REVOKE ALL ON FUNCTION public.list_my_sessions() FROM public, anon;
REVOKE ALL ON FUNCTION public.revoke_my_session(uuid) FROM public, anon;
REVOKE ALL ON FUNCTION public.revoke_my_other_sessions() FROM public, anon;
GRANT EXECUTE ON FUNCTION public.list_my_sessions() TO authenticated;
GRANT EXECUTE ON FUNCTION public.revoke_my_session(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.revoke_my_other_sessions() TO authenticated;

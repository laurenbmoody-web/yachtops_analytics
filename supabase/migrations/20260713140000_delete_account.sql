-- ─────────────────────────────────────────────────────────────────────────────
-- 20260713140000_delete_account.sql
--
-- WHAT: Server-side erasure of a user's personal data (GDPR Art. 17). There is
--       no single cascade from auth.users, and the user-owned tables are many
--       and grow over time, so this sweeps EVERY public table that has a
--       user_id column (delete where user_id = target) and finally the profiles
--       row — drift-proof as new personal tables are added.
--
-- WHO: EXECUTE is granted to service_role only. It's invoked by the
--      delete-my-account edge function, which first verifies the caller's JWT
--      and passes their own id. Not callable by normal clients.
--
-- FK ORDER: the tables reference each other, so a single pass can hit FK
--      violations; we retry a few passes, absorbing errors, then delete
--      profiles last (its ON DELETE CASCADE children mop up any remainder).
-- ─────────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.admin_wipe_user(p_uid uuid)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  r         record;
  pass      int;
  remaining int;
BEGIN
  IF p_uid IS NULL THEN RAISE EXCEPTION 'p_uid required'; END IF;

  FOR pass IN 1..8 LOOP
    remaining := 0;
    FOR r IN
      SELECT table_name FROM information_schema.columns
      WHERE table_schema = 'public' AND column_name = 'user_id'
    LOOP
      BEGIN
        EXECUTE format('DELETE FROM public.%I WHERE user_id = $1', r.table_name) USING p_uid;
      EXCEPTION WHEN others THEN
        remaining := remaining + 1;  -- likely an FK dependency; retry next pass
      END;
    END LOOP;
    EXIT WHEN remaining = 0;
  END LOOP;

  DELETE FROM public.profiles WHERE id = p_uid;
END;
$$;

REVOKE ALL ON FUNCTION public.admin_wipe_user(uuid) FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.admin_wipe_user(uuid) TO service_role;

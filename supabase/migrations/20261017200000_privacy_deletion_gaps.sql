-- ─────────────────────────────────────────────────────────────────────────────
-- 20261017200000_privacy_deletion_gaps.sql
--
-- Closes two gaps between what Cargo promises users and what the code does.
--
-- 1. FACE TEMPLATES ON LEAVING A VESSEL
--    The face sign-in consent text (faceSignIn.js, 2026-10-face-v1) says the
--    template "is removed when you leave the vessel". Nothing did that. Leaving
--    or being off-boarded sets tenant_members.active = false (leave_tenant RPC,
--    crew off-boarding); a membership row can also be deleted outright. Both now
--    delete that person's templates for that vessel. Templates are biometric
--    (special-category) data, so they must not outlive the purpose.
--
-- 2. DELETE MY ACCOUNT
--    a) admin_wipe_user's final DELETE FROM profiles failed (FK, NO ACTION) for
--       anyone referenced by tenants.current_admin_user_id or the provisioning
--       list owner/share/collaborator columns, so "Delete my account" returned
--       "data erasure failed". Those references now go to NULL first — the
--       vessel keeps its lists, just without the deleted author.
--    b) Deleting the last Command on an active vessel would orphan the vessel.
--       Blocked with 'last_command', same rule as leave_tenant.
--    c) Files: the edge function only cleared crew-documents. It now asks
--       admin_user_storage_paths() for every personal file (avatars, crew
--       documents, captain credentials, sea-service testimonials, feedback
--       voice notes) and removes them. Vessel compliance records (hours-of-rest
--       and kit signatures, vessel documents, laundry photos) are the vessel's
--       and are deliberately kept, as the Privacy Policy states.
-- ─────────────────────────────────────────────────────────────────────────────

-- 1. Face templates follow vessel membership ─────────────────────────────────
CREATE OR REPLACE FUNCTION public.purge_face_enrolments_on_leave()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    DELETE FROM public.crew_face_enrolments
     WHERE tenant_id = OLD.tenant_id AND user_id = OLD.user_id;
    RETURN OLD;
  END IF;

  IF coalesce(OLD.active, false) AND NOT coalesce(NEW.active, false) THEN
    DELETE FROM public.crew_face_enrolments
     WHERE tenant_id = NEW.tenant_id AND user_id = NEW.user_id;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_purge_face_enrolments_on_leave ON public.tenant_members;
CREATE TRIGGER trg_purge_face_enrolments_on_leave
  AFTER UPDATE OF active OR DELETE ON public.tenant_members
  FOR EACH ROW EXECUTE FUNCTION public.purge_face_enrolments_on_leave();

-- Backfill: anyone already off a vessel loses their templates for it.
DELETE FROM public.crew_face_enrolments e
 WHERE NOT EXISTS (
   SELECT 1 FROM public.tenant_members tm
    WHERE tm.tenant_id = e.tenant_id AND tm.user_id = e.user_id AND tm.active
 );

-- 2a/2b. Account deletion guard ──────────────────────────────────────────────
-- Returns NULL when the account can be deleted, otherwise a reason code.
CREATE OR REPLACE FUNCTION public.admin_account_deletion_blocker(p_uid uuid)
RETURNS text
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF EXISTS (
    SELECT 1
      FROM public.tenant_members me
     WHERE me.user_id = p_uid AND me.active
       AND upper(coalesce(me.permission_tier, me.role, '')) = 'COMMAND'
       AND NOT EXISTS (
         SELECT 1 FROM public.tenant_members other
          WHERE other.tenant_id = me.tenant_id AND other.active
            AND other.user_id <> p_uid
            AND upper(coalesce(other.permission_tier, other.role, '')) = 'COMMAND'
       )
  ) THEN
    RETURN 'last_command';
  END IF;
  RETURN NULL;
END;
$$;

REVOKE ALL ON FUNCTION public.admin_account_deletion_blocker(uuid) FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.admin_account_deletion_blocker(uuid) TO service_role;

-- 2c. Every personal file for a user ────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.admin_user_storage_paths(p_uid uuid)
RETURNS TABLE (bucket text, path text)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, storage AS $$
  -- Personal buckets keyed `${uid}/…`
  SELECT o.bucket_id::text, o.name
    FROM storage.objects o
   WHERE o.bucket_id IN ('avatars', 'crew-documents', 'captain-credentials')
     AND split_part(o.name, '/', 1) = p_uid::text
  UNION
  -- Sea-service testimonials keyed `${tenant}/${uid}/…` (the crew member's own record)
  SELECT o.bucket_id::text, o.name
    FROM storage.objects o
   WHERE o.bucket_id = 'sea-service-testimonials'
     AND split_part(o.name, '/', 2) = p_uid::text
  UNION
  -- Beta feedback voice notes, linked through public.feedback
  SELECT 'feedback-audio', f.audio_path
    FROM public.feedback f
   WHERE f.user_id = p_uid AND f.audio_path IS NOT NULL AND f.audio_path <> '';
$$;

REVOKE ALL ON FUNCTION public.admin_user_storage_paths(uuid) FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.admin_user_storage_paths(uuid) TO service_role;

-- 2a. Wipe, with the blocking references cleared first ───────────────────────
CREATE OR REPLACE FUNCTION public.admin_wipe_user(p_uid uuid)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  r         record;
  pass      int;
  remaining int;
BEGIN
  IF p_uid IS NULL THEN RAISE EXCEPTION 'p_uid required'; END IF;

  IF public.admin_account_deletion_blocker(p_uid) IS NOT NULL THEN
    RAISE EXCEPTION '%', public.admin_account_deletion_blocker(p_uid);
  END IF;

  -- Vessel-owned rows that point at this person without CASCADE / SET NULL.
  UPDATE public.tenants                         SET current_admin_user_id = NULL WHERE current_admin_user_id = p_uid;
  UPDATE public.provisioning_lists              SET owner_id   = NULL WHERE owner_id   = p_uid;
  UPDATE public.provisioning_list_shares        SET created_by = NULL WHERE created_by = p_uid;
  UPDATE public.provisioning_list_collaborators SET added_by   = NULL WHERE added_by   = p_uid;

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

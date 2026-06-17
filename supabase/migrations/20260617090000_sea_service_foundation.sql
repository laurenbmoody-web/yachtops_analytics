-- ─────────────────────────────────────────────────────────────────────────────
-- 20260617090000_sea_service_foundation.sql
--
-- WHAT: Moves the Sea Time Tracker off client-only localStorage onto real
--       Postgres tables, so captain attestation, the audit trail, and
--       tamper-evident verification have an authoritative backing store.
--
--       Tables (all tenant-scoped, RLS on):
--         sea_service_entries — the atomic day record (one row per crew/day),
--             carrying the four MCA service types, vessel snapshot facts, the
--             cached qualification result, and the sign-off / audit columns.
--         sea_time_config     — per-vessel rules config (config-driven
--             thresholds). App falls back to a built-in default when absent.
--         sea_service_audit   — append-only trail of every state transition.
--
--       Captain attestation mirrors the HOR month-signature pattern
--       (_120000): drawn signature PNG in a private bucket (DB stores the
--       object PATH, re-signed on display), signed name/ip/ua audit columns,
--       and a server-computed SHA-256 record_hash for tamper-evidence. Writer
--       RPCs are SECURITY DEFINER and gate on tenant membership / COMMAND tier.
--
--       'tenants' is the vessel entity here (gt, loa_m, flag, imo_number); an
--       entry is anchored to its tenant and snapshots vessel facts so prior
--       service on OTHER vessels (manual entries) is still self-contained.
--
-- IDEMPOTENCY: CREATE TABLE/POLICY IF NOT EXISTS, bucket ON CONFLICT DO
--       NOTHING, DROP/CREATE POLICY, CREATE OR REPLACE FUNCTION. Safe to
--       re-apply. Purely additive — touches no existing table's data.
-- ─────────────────────────────────────────────────────────────────────────────

-- ── updated_at helper (shared convention) ────────────────────────────────────
CREATE OR REPLACE FUNCTION public.sea_time_touch_updated_at()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

-- ── sea_service_entries ──────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.sea_service_entries (
  id                      uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id               uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  user_id                 uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  entry_date              date NOT NULL,

  -- provenance
  source                  text NOT NULL DEFAULT 'manual'
                            CHECK (source IN ('manual','vessel_auto','ais_proposed','rota_derived')),

  -- classification (primary MCA service type — exactly one, computed app-side)
  service_type            text CHECK (service_type IN ('seagoing','watchkeeping','standby','yard')),
  capacity_served         text,
  watch_hours             numeric NOT NULL DEFAULT 0 CHECK (watch_hours >= 0 AND watch_hours <= 24),
  vessel_status           text,                 -- UNDERWAY/ANCHOR/IN_PORT/IN_YARD (auto entries)
  location_trading_area   text,

  -- vessel snapshot (self-contained for manual / external-vessel service)
  vessel_name             text,
  vessel_flag             text,
  vessel_imo              text,
  vessel_official_number  text,
  vessel_gt               numeric,
  vessel_length_m         numeric,             -- registered / load-line length, gates ≥15m
  vessel_type             text,

  -- qualification cache (authoritative compute may move server-side later)
  path_id                 text,
  qualifies               boolean NOT NULL DEFAULT false,
  qualification_reason    text,
  counts_toward           jsonb NOT NULL DEFAULT '{}'::jsonb,

  -- verification / captain attestation
  verification_status     text NOT NULL DEFAULT 'draft'
                            CHECK (verification_status IN ('draft','pending','captain_signed','rejected')),
  submitted_at            timestamptz,
  submitted_by            uuid,
  signed_by               uuid,
  signed_at               timestamptz,
  signature_path          text,                -- object path in 'sea-time-signatures' bucket
  signed_name             text,
  signed_ip               text,
  signed_ua               text,
  rejection_reason        text,
  record_hash             text,                -- SHA-256 over canonical fields at signing
  locked                  boolean NOT NULL DEFAULT false,

  note                    text,
  documents               jsonb NOT NULL DEFAULT '[]'::jsonb,

  created_at              timestamptz NOT NULL DEFAULT now(),
  updated_at              timestamptz NOT NULL DEFAULT now(),
  created_by              uuid DEFAULT auth.uid()
);

CREATE INDEX IF NOT EXISTS sea_service_entries_tenant_user_date_idx
  ON public.sea_service_entries (tenant_id, user_id, entry_date);
CREATE INDEX IF NOT EXISTS sea_service_entries_tenant_status_idx
  ON public.sea_service_entries (tenant_id, verification_status);
CREATE INDEX IF NOT EXISTS sea_service_entries_user_idx
  ON public.sea_service_entries (user_id);

DROP TRIGGER IF EXISTS sea_service_entries_touch ON public.sea_service_entries;
CREATE TRIGGER sea_service_entries_touch
  BEFORE UPDATE ON public.sea_service_entries
  FOR EACH ROW EXECUTE FUNCTION public.sea_time_touch_updated_at();

ALTER TABLE public.sea_service_entries ENABLE ROW LEVEL SECURITY;

-- Read: the seafarer sees their own; COMMAND sees the whole vessel.
DROP POLICY IF EXISTS sea_service_entries_select ON public.sea_service_entries;
CREATE POLICY sea_service_entries_select ON public.sea_service_entries
  FOR SELECT TO authenticated
  USING (user_id = auth.uid() OR public.is_command_user_in_tenant(tenant_id));

-- Insert: any active member for their own record; COMMAND for anyone on the vessel.
DROP POLICY IF EXISTS sea_service_entries_insert ON public.sea_service_entries;
CREATE POLICY sea_service_entries_insert ON public.sea_service_entries
  FOR INSERT TO authenticated
  WITH CHECK (
    public.is_active_tenant_member(tenant_id, auth.uid())
    AND (user_id = auth.uid() OR public.is_command_user_in_tenant(tenant_id))
  );

-- Update: own UNLOCKED records, or COMMAND. Sign-off itself goes through the
-- SECURITY DEFINER RPCs below (which bypass RLS), so locked rows stay immutable
-- to ordinary writes.
DROP POLICY IF EXISTS sea_service_entries_update ON public.sea_service_entries;
CREATE POLICY sea_service_entries_update ON public.sea_service_entries
  FOR UPDATE TO authenticated
  USING ((user_id = auth.uid() AND NOT locked) OR public.is_command_user_in_tenant(tenant_id))
  WITH CHECK ((user_id = auth.uid() AND NOT locked) OR public.is_command_user_in_tenant(tenant_id));

-- Delete: own unlocked manual entries, or COMMAND.
DROP POLICY IF EXISTS sea_service_entries_delete ON public.sea_service_entries;
CREATE POLICY sea_service_entries_delete ON public.sea_service_entries
  FOR DELETE TO authenticated
  USING (
    (user_id = auth.uid() AND source = 'manual' AND NOT locked)
    OR public.is_command_user_in_tenant(tenant_id)
  );

-- ── sea_time_config (per-vessel, config-driven thresholds) ───────────────────
CREATE TABLE IF NOT EXISTS public.sea_time_config (
  tenant_id     uuid PRIMARY KEY REFERENCES public.tenants(id) ON DELETE CASCADE,
  config        jsonb NOT NULL,
  version       text,
  review_status text NOT NULL DEFAULT 'UNVERIFIED'
                  CHECK (review_status IN ('UNVERIFIED','VERIFIED')),
  updated_at    timestamptz NOT NULL DEFAULT now(),
  updated_by    uuid DEFAULT auth.uid()
);

DROP TRIGGER IF EXISTS sea_time_config_touch ON public.sea_time_config;
CREATE TRIGGER sea_time_config_touch
  BEFORE UPDATE ON public.sea_time_config
  FOR EACH ROW EXECUTE FUNCTION public.sea_time_touch_updated_at();

ALTER TABLE public.sea_time_config ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS sea_time_config_select ON public.sea_time_config;
CREATE POLICY sea_time_config_select ON public.sea_time_config
  FOR SELECT TO authenticated
  USING (public.is_active_tenant_member(tenant_id, auth.uid()));

DROP POLICY IF EXISTS sea_time_config_write ON public.sea_time_config;
CREATE POLICY sea_time_config_write ON public.sea_time_config
  FOR ALL TO authenticated
  USING (public.is_command_user_in_tenant(tenant_id))
  WITH CHECK (public.is_command_user_in_tenant(tenant_id));

-- ── sea_service_audit (append-only) ──────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.sea_service_audit (
  id          bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  tenant_id   uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  entry_id    uuid REFERENCES public.sea_service_entries(id) ON DELETE SET NULL,
  subject_user_id uuid,
  actor_id    uuid DEFAULT auth.uid(),
  action      text NOT NULL,           -- CREATED/UPDATED/DELETED/SUBMITTED/SIGNED/REJECTED
  detail      jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS sea_service_audit_tenant_idx ON public.sea_service_audit (tenant_id, created_at DESC);
CREATE INDEX IF NOT EXISTS sea_service_audit_entry_idx ON public.sea_service_audit (entry_id);

ALTER TABLE public.sea_service_audit ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS sea_service_audit_select ON public.sea_service_audit;
CREATE POLICY sea_service_audit_select ON public.sea_service_audit
  FOR SELECT TO authenticated
  USING (
    subject_user_id = auth.uid()
    OR actor_id = auth.uid()
    OR public.is_command_user_in_tenant(tenant_id)
  );

-- Direct inserts limited to the acting member; the RPCs (definer) also write here.
DROP POLICY IF EXISTS sea_service_audit_insert ON public.sea_service_audit;
CREATE POLICY sea_service_audit_insert ON public.sea_service_audit
  FOR INSERT TO authenticated
  WITH CHECK (public.is_active_tenant_member(tenant_id, auth.uid()));

-- ── Private signature bucket (mirrors hor-signatures) ────────────────────────
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES ('sea-time-signatures','sea-time-signatures', false, 524288, ARRAY['image/png'])
ON CONFLICT (id) DO NOTHING;

DROP POLICY IF EXISTS "users_manage_own_seatime_signatures" ON storage.objects;
CREATE POLICY "users_manage_own_seatime_signatures"
ON storage.objects FOR ALL TO authenticated
USING (
  bucket_id = 'sea-time-signatures'
  AND (storage.foldername(name))[1] = auth.uid()::text
)
WITH CHECK (
  bucket_id = 'sea-time-signatures'
  AND (storage.foldername(name))[1] = auth.uid()::text
);

DROP POLICY IF EXISTS "users_view_tenant_seatime_signatures" ON storage.objects;
CREATE POLICY "users_view_tenant_seatime_signatures"
ON storage.objects FOR SELECT TO authenticated
USING (
  bucket_id = 'sea-time-signatures'
  AND EXISTS (
    SELECT 1 FROM public.tenant_members tm1
    JOIN public.tenant_members tm2 ON tm1.tenant_id = tm2.tenant_id
    WHERE tm1.user_id = auth.uid()
      AND tm2.user_id = (storage.foldername(name))[1]::uuid
      AND tm1.active = true
      AND tm2.active = true
  )
);

-- ─────────────────────────────────────────────────────────────────────────────
-- WRITER RPCs (SECURITY DEFINER) — submit / sign / reject in bulk by entry ids.
-- ─────────────────────────────────────────────────────────────────────────────

-- Crew submits their own draft entries for verification (draft → pending).
CREATE OR REPLACE FUNCTION public.sea_time_submit_entries(
  p_tenant_id   uuid,
  p_entry_ids   uuid[],
  p_note        text DEFAULT NULL,
  p_sig_path    text DEFAULT NULL,
  p_signed_name text DEFAULT NULL,
  p_signed_ip   text DEFAULT NULL,
  p_signed_ua   text DEFAULT NULL
)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
DECLARE
  v_uid   uuid := auth.uid();
  v_count integer := 0;
  r       public.sea_service_entries;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'Not authenticated.'; END IF;
  IF NOT public.is_active_tenant_member(p_tenant_id, v_uid) THEN
    RAISE EXCEPTION 'You are not an active member of this vessel.';
  END IF;

  FOR r IN
    SELECT * FROM public.sea_service_entries
    WHERE id = ANY(p_entry_ids) AND tenant_id = p_tenant_id
      AND user_id = v_uid AND verification_status = 'draft' AND NOT locked
  LOOP
    UPDATE public.sea_service_entries
      SET verification_status = 'pending',
          submitted_at = now(),
          submitted_by = v_uid,
          signature_path = COALESCE(p_sig_path, signature_path),
          signed_name = COALESCE(p_signed_name, signed_name),
          note = COALESCE(p_note, note)
    WHERE id = r.id;

    INSERT INTO public.sea_service_audit (tenant_id, entry_id, subject_user_id, actor_id, action, detail)
    VALUES (p_tenant_id, r.id, r.user_id, v_uid, 'SUBMITTED',
            jsonb_build_object('signed_name', p_signed_name, 'ip', p_signed_ip, 'ua', p_signed_ua));
    v_count := v_count + 1;
  END LOOP;

  RETURN v_count;
END;
$function$;

-- Captain (COMMAND) signs off pending entries (pending → captain_signed, locked).
-- Computes a SHA-256 record_hash over the canonical fields for tamper-evidence.
CREATE OR REPLACE FUNCTION public.sea_time_sign_entries(
  p_tenant_id   uuid,
  p_entry_ids   uuid[],
  p_note        text DEFAULT NULL,
  p_sig_path    text DEFAULT NULL,
  p_signed_name text DEFAULT NULL,
  p_signed_ip   text DEFAULT NULL,
  p_signed_ua   text DEFAULT NULL
)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
DECLARE
  v_uid   uuid := auth.uid();
  v_now   timestamptz := now();
  v_count integer := 0;
  v_hash  text;
  r       public.sea_service_entries;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'Not authenticated.'; END IF;
  IF NOT public.is_command_user_in_tenant(p_tenant_id) THEN
    RAISE EXCEPTION 'Only COMMAND may sign off sea service on this vessel.';
  END IF;

  FOR r IN
    SELECT * FROM public.sea_service_entries
    WHERE id = ANY(p_entry_ids) AND tenant_id = p_tenant_id
      AND verification_status = 'pending'
  LOOP
    v_hash := encode(extensions.digest(
      concat_ws('|', r.id::text, r.user_id::text, r.entry_date::text,
        COALESCE(r.service_type,''), COALESCE(r.vessel_name,''), COALESCE(r.vessel_imo,''),
        COALESCE(r.vessel_gt::text,''), COALESCE(r.vessel_length_m::text,''),
        COALESCE(r.watch_hours::text,''), COALESCE(r.capacity_served,''),
        v_uid::text, v_now::text),
      'sha256'), 'hex');

    UPDATE public.sea_service_entries
      SET verification_status = 'captain_signed',
          signed_by = v_uid,
          signed_at = v_now,
          signature_path = COALESCE(p_sig_path, signature_path),
          signed_name = COALESCE(p_signed_name, signed_name),
          signed_ip = COALESCE(p_signed_ip, signed_ip),
          signed_ua = COALESCE(p_signed_ua, signed_ua),
          record_hash = v_hash,
          locked = true,
          rejection_reason = NULL,
          note = COALESCE(p_note, note)
    WHERE id = r.id;

    INSERT INTO public.sea_service_audit (tenant_id, entry_id, subject_user_id, actor_id, action, detail)
    VALUES (p_tenant_id, r.id, r.user_id, v_uid, 'SIGNED',
            jsonb_build_object('signed_name', p_signed_name, 'ip', p_signed_ip, 'ua', p_signed_ua, 'hash', v_hash));
    v_count := v_count + 1;
  END LOOP;

  RETURN v_count;
END;
$function$;

-- Captain (COMMAND) rejects pending entries with a reason (pending → rejected).
CREATE OR REPLACE FUNCTION public.sea_time_reject_entries(
  p_tenant_id uuid,
  p_entry_ids uuid[],
  p_reason    text
)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
DECLARE
  v_uid   uuid := auth.uid();
  v_count integer := 0;
  r       public.sea_service_entries;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'Not authenticated.'; END IF;
  IF NOT public.is_command_user_in_tenant(p_tenant_id) THEN
    RAISE EXCEPTION 'Only COMMAND may reject sea service on this vessel.';
  END IF;
  IF COALESCE(btrim(p_reason),'') = '' THEN
    RAISE EXCEPTION 'A rejection reason is required.';
  END IF;

  FOR r IN
    SELECT * FROM public.sea_service_entries
    WHERE id = ANY(p_entry_ids) AND tenant_id = p_tenant_id
      AND verification_status = 'pending'
  LOOP
    UPDATE public.sea_service_entries
      SET verification_status = 'rejected',
          rejection_reason = p_reason,
          locked = false
    WHERE id = r.id;

    INSERT INTO public.sea_service_audit (tenant_id, entry_id, subject_user_id, actor_id, action, detail)
    VALUES (p_tenant_id, r.id, r.user_id, v_uid, 'REJECTED', jsonb_build_object('reason', p_reason));
    v_count := v_count + 1;
  END LOOP;

  RETURN v_count;
END;
$function$;

-- Only signed-in users may call these; revoke the implicit PUBLIC/anon grant.
REVOKE EXECUTE ON FUNCTION public.sea_time_submit_entries(uuid, uuid[], text, text, text, text, text) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.sea_time_sign_entries(uuid, uuid[], text, text, text, text, text) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.sea_time_reject_entries(uuid, uuid[], text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.sea_time_submit_entries(uuid, uuid[], text, text, text, text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.sea_time_sign_entries(uuid, uuid[], text, text, text, text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.sea_time_reject_entries(uuid, uuid[], text) TO authenticated;

-- ─────────────────────────────────────────────────────────────────────────────
-- 20260715140000_defects_server.sql
--
-- WHAT: Promote Defects from localStorage (`cargo_defects_v1`, per-browser) to
--       real, tenant-scoped Supabase tables so notifications reach other crew's
--       devices, defects are shared across the vessel, a fleet snag report can
--       be exported, and a survey/class audit trail exists.
--
--       Creates:
--         * public.defects          — the defect record (mirrors the localStorage
--                                     shape, re-anchored to auth.users / tenants,
--                                     plus map-pin link + team-claim assignment).
--         * public.defect_comments  — threaded comments.
--         * public.defect_events    — immutable audit trail (created / status /
--                                     assigned / accepted / declined / closed /
--                                     reopened / claimed / comment / photo).
--
-- IDENTITY: user references are Supabase auth uids (auth.users.id), matching
--       public.notifications.user_id so cross-device notifications work. A
--       denormalised *_name text sits beside every uid so display survives even
--       when the uid can't be resolved (e.g. imported legacy rows).
--
-- RLS: tenant-scoped via public.tenant_members (active), mirroring team_jobs
--       (20260228150000_fix_team_jobs_rls_for_rotation.sql). Any active member of
--       the tenant may read/insert/update/delete; finer control (who may edit /
--       assign / accept) is enforced in the app, as team_jobs does.
--
-- DEPARTMENTS: department_id is a bare uuid (no FK) exactly like team_jobs — the
--       departments table is managed out-of-band. Member resolution for team
--       assignment reuses the existing get_tenant_members_for_jobs RPC.
--
-- IDEMPOTENCY: CREATE TABLE/INDEX IF NOT EXISTS; ENABLE RLS is a no-op if on;
--       DROP POLICY IF EXISTS before each CREATE. Safe to re-apply.
-- ─────────────────────────────────────────────────────────────────────────────

-- ── defects ──────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.defects (
  id                          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id                   uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  seq                         bigint GENERATED ALWAYS AS IDENTITY,  -- human ref: DEF-{seq}

  title                       text NOT NULL,
  description                 text NOT NULL DEFAULT '',
  priority                    text NOT NULL DEFAULT 'Medium',        -- Low|Medium|High|Critical
  status                      text NOT NULL DEFAULT 'New',           -- see DefectStatus

  -- target department (name kept for back-compat with the existing UI; id used
  -- to resolve "the whole Engineering team" via get_tenant_members_for_jobs).
  department_id               uuid,
  department_owner            text,

  -- reporter / creator (auth uids + denormalised names)
  reported_by                 uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  reported_by_name            text,
  created_by                  uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_by_name             text,
  created_by_department       text,
  created_by_tier             text,

  -- assignment — supports a named person OR a whole team (first to claim owns it)
  assignee_kind               text NOT NULL DEFAULT 'unassigned',    -- unassigned|user|team
  assigned_to                 uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  assigned_to_name            text,
  assigned_team_department_id uuid,
  assigned_team_name          text,
  claimed_by                  uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  claimed_by_name             text,
  claimed_at                  timestamptz,

  -- cross-department acceptance flow
  pending_for_department      text,
  sent_for_acceptance         boolean NOT NULL DEFAULT false,
  submitted_by                uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  submitted_by_name           text,
  decided_by                  uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  decided_at                  timestamptz,
  decision_notes              text,

  -- lifecycle
  due_date                    date,
  closed_at                   timestamptz,
  closed_by                   uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  closed_by_name              text,
  closed_notes                text,
  closed_photo                text,
  reopened_at                 timestamptz,
  reopened_by                 uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  reopened_by_name            text,
  reopened_notes              text,

  -- classification
  defect_type                 text,
  defect_sub_type             text,
  affects_guest_areas         boolean NOT NULL DEFAULT false,
  safety_related              boolean NOT NULL DEFAULT false,

  -- location: legacy deck/zone/space hierarchy + free text, PLUS the map pin
  location_deck_id            uuid,
  location_zone_id            uuid,
  location_space_id           uuid,
  location_path_label         text,
  location_free_text          text,
  hotspot_id                  uuid REFERENCES public.scan_hotspots(id) ON DELETE SET NULL,
  location_node_id            uuid REFERENCES public.vessel_locations(id) ON DELETE SET NULL,

  -- media (array of {id, path|dataUrl, caption, created_at, created_by})
  photos                      jsonb NOT NULL DEFAULT '[]',

  -- housekeeping (sender archive + soft delete of pending requests)
  is_archived_by_sender       boolean NOT NULL DEFAULT false,
  archived_at                 timestamptz,
  deleted_at                  timestamptz,
  deleted_by                  uuid REFERENCES auth.users(id) ON DELETE SET NULL,

  created_at                  timestamptz NOT NULL DEFAULT now(),
  updated_at                  timestamptz NOT NULL DEFAULT now()
);

-- List/filter by tenant, newest first; open-count & pending queues; map lookup.
CREATE INDEX IF NOT EXISTS defects_tenant_created_idx  ON public.defects (tenant_id, created_at DESC);
CREATE INDEX IF NOT EXISTS defects_tenant_status_idx   ON public.defects (tenant_id, status);
CREATE INDEX IF NOT EXISTS defects_hotspot_idx         ON public.defects (hotspot_id) WHERE hotspot_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS defects_assigned_to_idx     ON public.defects (assigned_to) WHERE assigned_to IS NOT NULL;

ALTER TABLE public.defects ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "defects_tenant_select" ON public.defects;
CREATE POLICY "defects_tenant_select" ON public.defects FOR SELECT TO authenticated
  USING (tenant_id IN (SELECT tenant_id FROM public.tenant_members
                       WHERE user_id = auth.uid() AND active = true));

DROP POLICY IF EXISTS "defects_tenant_insert" ON public.defects;
CREATE POLICY "defects_tenant_insert" ON public.defects FOR INSERT TO authenticated
  WITH CHECK (tenant_id IN (SELECT tenant_id FROM public.tenant_members
                            WHERE user_id = auth.uid() AND active = true));

DROP POLICY IF EXISTS "defects_tenant_update" ON public.defects;
CREATE POLICY "defects_tenant_update" ON public.defects FOR UPDATE TO authenticated
  USING (tenant_id IN (SELECT tenant_id FROM public.tenant_members
                       WHERE user_id = auth.uid() AND active = true))
  WITH CHECK (tenant_id IN (SELECT tenant_id FROM public.tenant_members
                            WHERE user_id = auth.uid() AND active = true));

DROP POLICY IF EXISTS "defects_tenant_delete" ON public.defects;
CREATE POLICY "defects_tenant_delete" ON public.defects FOR DELETE TO authenticated
  USING (tenant_id IN (SELECT tenant_id FROM public.tenant_members
                       WHERE user_id = auth.uid() AND active = true));

-- ── defect_comments ──────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.defect_comments (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  defect_id   uuid NOT NULL REFERENCES public.defects(id) ON DELETE CASCADE,
  tenant_id   uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  user_id     uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  user_name   text,
  body        text NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS defect_comments_defect_idx ON public.defect_comments (defect_id, created_at);

ALTER TABLE public.defect_comments ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "defect_comments_tenant_select" ON public.defect_comments;
CREATE POLICY "defect_comments_tenant_select" ON public.defect_comments FOR SELECT TO authenticated
  USING (tenant_id IN (SELECT tenant_id FROM public.tenant_members
                       WHERE user_id = auth.uid() AND active = true));

DROP POLICY IF EXISTS "defect_comments_tenant_insert" ON public.defect_comments;
CREATE POLICY "defect_comments_tenant_insert" ON public.defect_comments FOR INSERT TO authenticated
  WITH CHECK (tenant_id IN (SELECT tenant_id FROM public.tenant_members
                            WHERE user_id = auth.uid() AND active = true));

-- Comments are immutable once posted (no update/delete policy → denied).

-- ── defect_events (audit trail) ──────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.defect_events (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  defect_id   uuid NOT NULL REFERENCES public.defects(id) ON DELETE CASCADE,
  tenant_id   uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  type        text NOT NULL,   -- created|status_changed|assigned|claimed|accepted|declined|comment|photo|closed|reopened|deleted
  actor_id    uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  actor_name  text,
  summary     text,
  meta        jsonb NOT NULL DEFAULT '{}',
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS defect_events_defect_idx ON public.defect_events (defect_id, created_at);

ALTER TABLE public.defect_events ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "defect_events_tenant_select" ON public.defect_events;
CREATE POLICY "defect_events_tenant_select" ON public.defect_events FOR SELECT TO authenticated
  USING (tenant_id IN (SELECT tenant_id FROM public.tenant_members
                       WHERE user_id = auth.uid() AND active = true));

DROP POLICY IF EXISTS "defect_events_tenant_insert" ON public.defect_events;
CREATE POLICY "defect_events_tenant_insert" ON public.defect_events FOR INSERT TO authenticated
  WITH CHECK (tenant_id IN (SELECT tenant_id FROM public.tenant_members
                            WHERE user_id = auth.uid() AND active = true));

-- Audit rows are immutable (no update/delete policy → denied).

-- ── updated_at touch trigger for defects ─────────────────────────────────────
CREATE OR REPLACE FUNCTION public.defects_touch_updated_at()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS defects_touch_updated_at ON public.defects;
CREATE TRIGGER defects_touch_updated_at
  BEFORE UPDATE ON public.defects
  FOR EACH ROW EXECUTE FUNCTION public.defects_touch_updated_at();

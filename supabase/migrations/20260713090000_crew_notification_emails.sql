-- ─────────────────────────────────────────────────────────────────────────────
-- 20260713090000_crew_notification_emails.sql
--
-- WHAT: Per-vessel notification email. A crew member can route THIS vessel's
--       alerts to a different address than the one they sign in with (often a
--       personal address the joining link went to). Optional — blank/absent
--       means "use my login email".
--
-- WHY PER-VESSEL (not per-account): the address is scoped to (user, tenant) so
--       a member of two vessels can send each vessel's ops to a vessel-owned
--       inbox, and the routing stays with the vessel through crew changes.
--       Hence the PK is (user_id, tenant_id).
--
-- RLS: owner-scoped — a user reads/writes only their OWN rows (any tenant).
--       Server-side senders use the service role and bypass RLS to read a
--       vessel's members' addresses.
--
-- IDEMPOTENT: CREATE ... IF NOT EXISTS; DROP POLICY IF EXISTS before CREATE.
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.crew_notification_emails (
  user_id     uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  tenant_id   uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  email       text NOT NULL,
  updated_at  timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, tenant_id)
);

-- Send-path lookup: all overrides for a vessel's members.
CREATE INDEX IF NOT EXISTS crew_notification_emails_tenant_idx
  ON public.crew_notification_emails (tenant_id);

ALTER TABLE public.crew_notification_emails ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "cne_owner_select" ON public.crew_notification_emails;
CREATE POLICY "cne_owner_select" ON public.crew_notification_emails FOR SELECT
  USING (user_id = auth.uid());

DROP POLICY IF EXISTS "cne_owner_insert" ON public.crew_notification_emails;
CREATE POLICY "cne_owner_insert" ON public.crew_notification_emails FOR INSERT
  WITH CHECK (user_id = auth.uid());

DROP POLICY IF EXISTS "cne_owner_update" ON public.crew_notification_emails;
CREATE POLICY "cne_owner_update" ON public.crew_notification_emails FOR UPDATE
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

DROP POLICY IF EXISTS "cne_owner_delete" ON public.crew_notification_emails;
CREATE POLICY "cne_owner_delete" ON public.crew_notification_emails FOR DELETE
  USING (user_id = auth.uid());

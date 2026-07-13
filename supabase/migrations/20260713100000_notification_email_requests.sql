-- ─────────────────────────────────────────────────────────────────────────────
-- 20260713100000_notification_email_requests.sql
--
-- WHAT: Governed change of a crew member's per-vessel notification email. The
--       crew member REQUESTS an address; a COMMAND user of that vessel approves
--       or declines. Approval is what actually writes crew_notification_emails —
--       the crew member never writes vessel-governed routing directly.
--
-- PIECES:
--   * notification_email_requests — the request queue (pending|approved|declined)
--   * is_tenant_command(tenant)   — helper: is auth.uid() COMMAND of the tenant
--   * trigger on INSERT           — notify the vessel's COMMAND users (bell)
--   * decide_notification_email_request(id, approve) — COMMAND-only decision;
--       on approve upserts crew_notification_emails + notifies the requester.
--
-- IDEMPOTENT: CREATE ... IF NOT EXISTS / OR REPLACE; DROP POLICY|TRIGGER first.
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.notification_email_requests (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  user_id         uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  requested_email text NOT NULL,
  status          text NOT NULL DEFAULT 'pending',
  requested_at    timestamptz NOT NULL DEFAULT now(),
  decided_by      uuid REFERENCES auth.users(id),
  decided_at      timestamptz
);
CREATE INDEX IF NOT EXISTS ner_tenant_status_idx ON public.notification_email_requests (tenant_id, status);
CREATE INDEX IF NOT EXISTS ner_user_idx ON public.notification_email_requests (user_id);

-- Is the caller a COMMAND member of this tenant? SECURITY DEFINER so RLS on
-- tenant_members doesn't hide the row from the check.
CREATE OR REPLACE FUNCTION public.is_tenant_command(p_tenant uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.tenant_members tm
    WHERE tm.tenant_id = p_tenant
      AND tm.user_id = auth.uid()
      AND tm.active = true
      AND upper(coalesce(tm.permission_tier, tm.role, '')) = 'COMMAND'
  );
$$;

ALTER TABLE public.notification_email_requests ENABLE ROW LEVEL SECURITY;

-- Requester sees their own; COMMAND sees their vessel's.
DROP POLICY IF EXISTS "ner_select" ON public.notification_email_requests;
CREATE POLICY "ner_select" ON public.notification_email_requests FOR SELECT
  USING (user_id = auth.uid() OR public.is_tenant_command(tenant_id));

-- Requester may raise a request for themselves.
DROP POLICY IF EXISTS "ner_insert" ON public.notification_email_requests;
CREATE POLICY "ner_insert" ON public.notification_email_requests FOR INSERT
  WITH CHECK (user_id = auth.uid());

-- Requester may cancel their own still-pending request.
DROP POLICY IF EXISTS "ner_delete" ON public.notification_email_requests;
CREATE POLICY "ner_delete" ON public.notification_email_requests FOR DELETE
  USING (user_id = auth.uid() AND status = 'pending');

-- Decisions never happen via a client UPDATE — only through the RPC below.

-- Notify the vessel's COMMAND users when a request lands.
CREATE OR REPLACE FUNCTION public.notify_command_on_email_request()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  requester_name text;
BEGIN
  SELECT coalesce(p.full_name, 'A crew member') INTO requester_name
    FROM public.profiles p WHERE p.id = NEW.user_id;
  INSERT INTO public.notifications (user_id, type, title, message, severity, action_url, read, created_at)
  SELECT tm.user_id,
         'NOTIFICATION_EMAIL_REQUEST',
         'Notification email request',
         requester_name || ' asked to send alerts to ' || NEW.requested_email,
         'info',
         '/settings/vessel?section=notification-requests',
         false, now()
  FROM public.tenant_members tm
  WHERE tm.tenant_id = NEW.tenant_id
    AND tm.active = true
    AND upper(coalesce(tm.permission_tier, tm.role, '')) = 'COMMAND';
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS trg_notify_command_email_request ON public.notification_email_requests;
CREATE TRIGGER trg_notify_command_email_request
  AFTER INSERT ON public.notification_email_requests
  FOR EACH ROW EXECUTE FUNCTION public.notify_command_on_email_request();

-- COMMAND-only approve/decline. On approve, writes the routing + notifies crew.
CREATE OR REPLACE FUNCTION public.decide_notification_email_request(p_request_id uuid, p_approve boolean)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  r public.notification_email_requests%ROWTYPE;
BEGIN
  SELECT * INTO r FROM public.notification_email_requests WHERE id = p_request_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'request not found'; END IF;
  IF NOT public.is_tenant_command(r.tenant_id) THEN RAISE EXCEPTION 'not authorized'; END IF;
  IF r.status <> 'pending' THEN RAISE EXCEPTION 'already decided'; END IF;

  UPDATE public.notification_email_requests
     SET status = CASE WHEN p_approve THEN 'approved' ELSE 'declined' END,
         decided_by = auth.uid(),
         decided_at = now()
   WHERE id = p_request_id;

  IF p_approve THEN
    INSERT INTO public.crew_notification_emails (user_id, tenant_id, email, updated_at)
    VALUES (r.user_id, r.tenant_id, r.requested_email, now())
    ON CONFLICT (user_id, tenant_id) DO UPDATE SET email = EXCLUDED.email, updated_at = now();
  END IF;

  INSERT INTO public.notifications (user_id, type, title, message, severity, action_url, read, created_at)
  VALUES (r.user_id,
          'NOTIFICATION_EMAIL_DECISION',
          CASE WHEN p_approve THEN 'Notification email approved' ELSE 'Notification email declined' END,
          CASE WHEN p_approve THEN 'Alerts will now go to ' || r.requested_email
               ELSE 'Your notification email request was declined.' END,
          'info', '/settings', false, now());
END;
$$;

GRANT EXECUTE ON FUNCTION public.is_tenant_command(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.decide_notification_email_request(uuid, boolean) TO authenticated;

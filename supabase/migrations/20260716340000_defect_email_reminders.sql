-- ─────────────────────────────────────────────────────────────────────────────
-- 20260716340000_defect_email_reminders.sql
--
-- WHAT: Email layer for High/Critical defect reminders (in-app already ships in
--       defects_run_daily_reminders). Adds:
--   • notification_preferences.email_defect_reminders — per-user opt-out (default on).
--   • defect_reminder_log.channel — so email sends dedupe separately from in-app.
--   • defects_email_plan(run) — the day's High/Critical reminder rows not yet
--     emailed, for the edge function to send + log.
--
-- Mirrors the HOR email pattern. Idempotent.
-- ─────────────────────────────────────────────────────────────────────────────

ALTER TABLE public.notification_preferences
  ADD COLUMN IF NOT EXISTS email_defect_reminders boolean NOT NULL DEFAULT true;

ALTER TABLE public.defect_reminder_log
  ADD COLUMN IF NOT EXISTS channel text NOT NULL DEFAULT 'in_app';

DROP INDEX IF EXISTS defect_reminder_log_uq;
CREATE UNIQUE INDEX IF NOT EXISTS defect_reminder_log_uq
  ON public.defect_reminder_log (defect_id, recipient_user_id, kind, channel, sent_on);

-- High/Critical reminder rows due for email, not yet emailed today.
CREATE OR REPLACE FUNCTION public.defects_email_plan(p_run date DEFAULT current_date)
RETURNS TABLE (
  defect_id         uuid,
  tenant_id         uuid,
  recipient_user_id uuid,
  kind              text,
  title_txt         text,
  msg               text,
  priority          text
)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  WITH base AS (
    SELECT d.id AS defect_id, d.tenant_id, d.department_id, d.assigned_to, d.priority,
           'repair_due'::text AS kind, 'Repair due'::text AS title_txt,
           (coalesce(d.title, 'Defect') || ' — repair is due')::text AS msg
    FROM public.defects d
    WHERE d.repair_stage = 'scheduled'
      AND d.scheduled_fix_at IS NOT NULL
      AND d.scheduled_fix_at <= p_run
      AND coalesce(d.status, '') NOT IN ('Closed', 'declined')
      AND d.priority IN ('High', 'Critical')
    UNION ALL
    SELECT d.id, d.tenant_id, d.department_id, d.assigned_to, d.priority,
           'quote_signoff'::text, 'Quote awaiting sign-off'::text,
           (coalesce(d.title, 'Defect') || ' — quote still needs sign-off')::text
    FROM public.defects d
    WHERE d.quote_approval_status = 'pending'
      AND d.updated_at <= (p_run - interval '2 days')
      AND d.priority IN ('High', 'Critical')
  ),
  recips AS (
    SELECT b.defect_id, b.tenant_id, b.kind, b.title_txt, b.msg, b.priority, b.assigned_to AS recipient
    FROM base b
    WHERE b.kind = 'repair_due' AND b.assigned_to IS NOT NULL
    UNION
    SELECT b.defect_id, b.tenant_id, b.kind, b.title_txt, b.msg, b.priority, tm.user_id
    FROM base b
    JOIN public.tenant_members tm
      ON tm.tenant_id = b.tenant_id AND tm.department_id = b.department_id
     AND tm.active AND tm.permission_tier IN ('COMMAND', 'CHIEF')
    UNION
    SELECT b.defect_id, b.tenant_id, b.kind, b.title_txt, b.msg, b.priority, tm.user_id
    FROM base b
    JOIN public.tenant_members tm
      ON tm.tenant_id = b.tenant_id AND tm.active AND tm.permission_tier = 'COMMAND'
    WHERE b.kind = 'quote_signoff'
  )
  SELECT DISTINCT r.defect_id, r.tenant_id, r.recipient AS recipient_user_id, r.kind, r.title_txt, r.msg, r.priority
  FROM recips r
  WHERE r.recipient IS NOT NULL
    AND NOT EXISTS (
      SELECT 1 FROM public.defect_reminder_log l
      WHERE l.defect_id = r.defect_id AND l.recipient_user_id = r.recipient
        AND l.kind = r.kind AND l.channel = 'email' AND l.sent_on = p_run
    );
$$;

GRANT EXECUTE ON FUNCTION public.defects_email_plan(date) TO authenticated, service_role;

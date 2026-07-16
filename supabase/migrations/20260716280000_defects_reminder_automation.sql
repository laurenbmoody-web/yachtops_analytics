-- ─────────────────────────────────────────────────────────────────────────────
-- 20260716280000_defects_reminder_automation.sql
--
-- WHAT: Daily in-app reminders for repairs. Two nudges:
--   • repair_due    — a repair is stage 'scheduled' and its scheduled date has
--                     arrived/passed → nudge the assignee + department chiefs.
--   • quote_signoff — a quote has been 'pending' sign-off for 2+ days → nudge the
--                     department chiefs + the Captain (COMMAND) to authorise it.
--
-- Mirrors the HOR reminder engine: a SECURITY DEFINER function inserts straight
-- into public.notifications, deduped once per (defect, recipient, kind, day) via
-- defect_reminder_log. Scheduled by pg_cron in the companion migration.
--
-- IDEMPOTENT: CREATE TABLE / OR REPLACE FUNCTION.
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.defect_reminder_log (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id         uuid NOT NULL,
  defect_id         uuid NOT NULL,
  recipient_user_id uuid NOT NULL,
  kind              text NOT NULL,
  sent_on           date NOT NULL,
  created_at        timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS defect_reminder_log_uq
  ON public.defect_reminder_log (defect_id, recipient_user_id, kind, sent_on);

CREATE OR REPLACE FUNCTION public.defects_run_daily_reminders(
  p_run    date    DEFAULT current_date,
  p_commit boolean DEFAULT true
) RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  n_inserted integer := 0;
BEGIN
  CREATE TEMP TABLE _dplan ON COMMIT DROP AS
  WITH base AS (
    -- repair scheduled and now due
    SELECT d.id AS defect_id, d.tenant_id, d.department_id, d.assigned_to,
           'repair_due'::text AS kind,
           'Repair due'::text AS title_txt,
           (coalesce(d.title, 'Defect') || ' — repair is due')::text AS msg
    FROM public.defects d
    WHERE d.repair_stage = 'scheduled'
      AND d.scheduled_fix_at IS NOT NULL
      AND d.scheduled_fix_at <= p_run
      AND coalesce(d.status, '') NOT IN ('Closed', 'declined')
    UNION ALL
    -- quote awaiting sign-off for 2+ days
    SELECT d.id, d.tenant_id, d.department_id, d.assigned_to,
           'quote_signoff'::text,
           'Quote awaiting sign-off'::text,
           (coalesce(d.title, 'Defect') || ' — quote still needs sign-off')::text
    FROM public.defects d
    WHERE d.quote_approval_status = 'pending'
      AND d.updated_at <= (p_run - interval '2 days')
  ),
  recips AS (
    -- the assignee (repair_due only)
    SELECT b.defect_id, b.tenant_id, b.kind, b.title_txt, b.msg, b.assigned_to AS recipient
    FROM base b
    WHERE b.kind = 'repair_due' AND b.assigned_to IS NOT NULL
    UNION
    -- department chiefs (both kinds)
    SELECT b.defect_id, b.tenant_id, b.kind, b.title_txt, b.msg, tm.user_id
    FROM base b
    JOIN public.tenant_members tm
      ON tm.tenant_id = b.tenant_id
     AND tm.department_id = b.department_id
     AND tm.active
     AND tm.permission_tier IN ('COMMAND', 'CHIEF')
    UNION
    -- the Captain (tenant COMMAND) for sign-off nudges
    SELECT b.defect_id, b.tenant_id, b.kind, b.title_txt, b.msg, tm.user_id
    FROM base b
    JOIN public.tenant_members tm
      ON tm.tenant_id = b.tenant_id
     AND tm.active
     AND tm.permission_tier = 'COMMAND'
    WHERE b.kind = 'quote_signoff'
  )
  SELECT DISTINCT r.defect_id, r.tenant_id, r.kind, r.title_txt, r.msg, r.recipient
  FROM recips r
  WHERE r.recipient IS NOT NULL
    AND NOT EXISTS (
      SELECT 1 FROM public.defect_reminder_log l
      WHERE l.defect_id = r.defect_id
        AND l.recipient_user_id = r.recipient
        AND l.kind = r.kind
        AND l.sent_on = p_run
    );

  IF p_commit THEN
    INSERT INTO public.notifications (user_id, type, title, message, severity, action_url, read, created_at)
    SELECT p.recipient, 'defect_reminder', p.title_txt, p.msg, 'warning',
           '/defects/' || p.defect_id, false, now()
    FROM _dplan p;
    GET DIAGNOSTICS n_inserted = ROW_COUNT;

    INSERT INTO public.defect_reminder_log (tenant_id, defect_id, recipient_user_id, kind, sent_on)
    SELECT p.tenant_id, p.defect_id, p.recipient, p.kind, p_run
    FROM _dplan p
    ON CONFLICT DO NOTHING;
  ELSE
    SELECT count(*) INTO n_inserted FROM _dplan;
  END IF;

  RETURN n_inserted;
END;
$$;

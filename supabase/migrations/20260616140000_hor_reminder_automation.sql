-- ─────────────────────────────────────────────────────────────────────────────
-- 20260616140000_hor_reminder_automation.sql
--
-- WHAT: Daily HOR reminder engine (in-app). hor_run_daily_reminders(p_run,
--   p_commit) computes who needs nudging and, when p_commit = true, inserts the
--   in-app notifications and logs them (deduped via hor_reminder_log). p_commit
--   defaults FALSE so the function is inert / dry-runnable until a scheduler
--   calls it with true. The function ALSO returns the planned 'email' rows so a
--   separate email layer (Resend edge function) can send the overdue emails.
--
--   Tiers (per active crew member, per tenant):
--     1. input_behind  — mid-month: ≥3 unlogged PAST days with no edited entry
--        AND no rota shift (rota-aware), at most weekly, month still open.
--     2. signoff_due   — on the month's last day, if still open (once/period).
--     3. overdue       — previous month still open: daily in-app + email to the
--        member, plus an in-app copy to every Chief/Command (overdue_copy).
--
-- IDEMPOTENT: CREATE TABLE IF NOT EXISTS / CREATE OR REPLACE.
-- ─────────────────────────────────────────────────────────────────────────────

create table if not exists public.hor_reminder_log (
  id                uuid primary key default gen_random_uuid(),
  tenant_id         uuid not null,
  subject_user_id   uuid not null,      -- the crew member the reminder is ABOUT
  recipient_user_id uuid not null,      -- who received it (subject, or chief/command copy)
  period_year       int  not null,
  period_month      int  not null,      -- 1-12
  kind              text not null,      -- input_behind | signoff_due | overdue | overdue_copy
  channel           text not null default 'in_app',  -- in_app | email
  sent_on           date not null default current_date,
  created_at        timestamptz not null default now()
);
create unique index if not exists hor_reminder_log_dedupe
  on public.hor_reminder_log (tenant_id, subject_user_id, recipient_user_id, period_year, period_month, kind, channel, sent_on);

alter table public.hor_reminder_log enable row level security;
drop policy if exists hor_reminder_log_read on public.hor_reminder_log;
create policy hor_reminder_log_read on public.hor_reminder_log
  for select to authenticated
  using (
    public._hor_tier_rank((
      select tm.permission_tier from public.tenant_members tm
      where tm.user_id = auth.uid() and tm.tenant_id = hor_reminder_log.tenant_id and tm.active = true
      limit 1
    )) >= 2
  );

create or replace function public.hor_run_daily_reminders(
  p_run    date    default current_date,
  p_commit boolean default false
)
RETURNS TABLE (
  tenant_id         uuid,
  subject_user_id   uuid,
  subject_name      text,
  recipient_user_id uuid,
  recipient_name    text,
  period_year       int,
  period_month      int,
  kind              text,
  channel           text,
  title             text,
  message           text,
  action_url        text
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $fn$
#variable_conflict use_column
DECLARE
  v_cur_y    int  := extract(year  from p_run)::int;
  v_cur_m    int  := extract(month from p_run)::int;
  v_last     date := (date_trunc('month', p_run) + interval '1 month - 1 day')::date;
  v_prev     date := (date_trunc('month', p_run) - interval '1 day')::date;
  v_prev_y   int  := extract(year  from v_prev)::int;
  v_prev_m   int  := extract(month from v_prev)::int;
  v_cur_lbl  text := to_char(date_trunc('month', p_run), 'FMMonth YYYY');
  v_prev_lbl text := to_char(date_trunc('month', v_prev), 'FMMonth YYYY');
BEGIN
  CREATE TEMP TABLE _plan ON COMMIT DROP AS
  WITH mem AS (
    SELECT tm.tenant_id, tm.user_id, tm.id AS tm_id, tm.permission_tier,
           COALESCE(p.full_name, 'Crew') AS name
    FROM public.tenant_members tm
    LEFT JOIN public.profiles p ON p.id = tm.user_id
    WHERE tm.active = true
  ),
  st_cur AS (
    SELECT h.subject_user_id, h.tenant_id, h.status FROM public.hor_month_status h
    WHERE h.period_year = v_cur_y AND h.period_month = v_cur_m
  ),
  st_prev AS (
    SELECT h.subject_user_id, h.tenant_id, h.status FROM public.hor_month_status h
    WHERE h.period_year = v_prev_y AND h.period_month = v_prev_m
  ),
  t1 AS (
    SELECT m.tenant_id, m.user_id AS subject_user_id, m.name AS subject_name,
           m.user_id AS recipient_user_id, m.name AS recipient_name,
           v_cur_y AS period_year, v_cur_m AS period_month,
           'input_behind'::text AS kind, 'in_app'::text AS channel,
           'Hours of Rest'::text AS title,
           ('You have '|| beh.n ||' unlogged day'|| CASE WHEN beh.n=1 THEN '' ELSE 's' END
             ||' this month. Please keep your Hours of Rest up to date.')::text AS message,
           ('/profile/'||m.user_id||'?tab=hor')::text AS action_url
    FROM mem m
    CROSS JOIN LATERAL (
      SELECT count(*)::int AS n
      FROM generate_series(date_trunc('month', p_run)::date, p_run - 1, interval '1 day') g(d)
      WHERE NOT EXISTS (SELECT 1 FROM public.hor_work_entries w
                         WHERE w.tenant_id = m.tenant_id AND w.subject_user_id = m.user_id
                           AND w.entry_date = g.d::date)
        AND NOT EXISTS (SELECT 1 FROM public.rota_shifts rs
                         WHERE rs.tenant_id = m.tenant_id AND rs.member_id = m.tm_id
                           AND rs.shift_date = g.d::date)
    ) beh
    WHERE p_run < v_last
      AND beh.n >= 3
      AND COALESCE((SELECT s.status FROM st_cur s WHERE s.subject_user_id = m.user_id AND s.tenant_id = m.tenant_id), 'open') = 'open'
      AND NOT EXISTS (SELECT 1 FROM public.hor_reminder_log l
                       WHERE l.tenant_id = m.tenant_id AND l.subject_user_id = m.user_id
                         AND l.kind = 'input_behind' AND l.sent_on > p_run - 7)
  ),
  t2 AS (
    SELECT m.tenant_id, m.user_id, m.name, m.user_id, m.name,
           v_cur_y, v_cur_m, 'signoff_due'::text, 'in_app'::text,
           'Hours of Rest — sign-off due'::text,
           ('Today is the last day of '||v_cur_lbl||'. Please sign off your Hours of Rest.')::text,
           ('/profile/'||m.user_id||'?tab=hor')::text
    FROM mem m
    WHERE p_run = v_last
      AND COALESCE((SELECT s.status FROM st_cur s WHERE s.subject_user_id = m.user_id AND s.tenant_id = m.tenant_id), 'open') = 'open'
      AND NOT EXISTS (SELECT 1 FROM public.hor_reminder_log l
                       WHERE l.tenant_id = m.tenant_id AND l.subject_user_id = m.user_id
                         AND l.kind = 'signoff_due' AND l.period_year = v_cur_y AND l.period_month = v_cur_m)
  ),
  t3 AS (
    SELECT m.tenant_id, m.user_id, m.name, m.user_id, m.name,
           v_prev_y, v_prev_m, 'overdue'::text, ch.channel,
           'Hours of Rest overdue'::text,
           (v_prev_lbl||' is not signed off. Please sign off your Hours of Rest now.')::text,
           ('/profile/'||m.user_id||'?tab=hor')::text
    FROM mem m
    CROSS JOIN (VALUES ('in_app'), ('email')) ch(channel)
    WHERE COALESCE((SELECT s.status FROM st_prev s WHERE s.subject_user_id = m.user_id AND s.tenant_id = m.tenant_id), 'open') = 'open'
      AND NOT EXISTS (SELECT 1 FROM public.hor_reminder_log l
                       WHERE l.tenant_id = m.tenant_id AND l.subject_user_id = m.user_id
                         AND l.kind = 'overdue' AND l.channel = ch.channel AND l.sent_on = p_run)
  ),
  t3copy AS (
    SELECT m.tenant_id, m.user_id AS subject_user_id, m.name AS subject_name,
           r.user_id AS recipient_user_id, r.name AS recipient_name,
           v_prev_y, v_prev_m, 'overdue_copy'::text, 'in_app'::text,
           ('HOR overdue — '||m.name)::text,
           (m.name||' has not signed off Hours of Rest for '||v_prev_lbl||'.')::text,
           '/month-end'::text
    FROM mem m
    JOIN mem r ON r.tenant_id = m.tenant_id
              AND public._hor_tier_rank(r.permission_tier) >= 2
              AND r.user_id <> m.user_id
    WHERE COALESCE((SELECT s.status FROM st_prev s WHERE s.subject_user_id = m.user_id AND s.tenant_id = m.tenant_id), 'open') = 'open'
      AND NOT EXISTS (SELECT 1 FROM public.hor_reminder_log l
                       WHERE l.tenant_id = m.tenant_id AND l.subject_user_id = m.user_id
                         AND l.recipient_user_id = r.user_id
                         AND l.kind = 'overdue_copy' AND l.sent_on = p_run)
  )
  SELECT * FROM t1
  UNION ALL SELECT * FROM t2
  UNION ALL SELECT * FROM t3
  UNION ALL SELECT * FROM t3copy;

  IF p_commit THEN
    INSERT INTO public.notifications (user_id, type, title, message, severity, action_url, read, created_at)
    SELECT pl.recipient_user_id, 'hor_reminder', pl.title, pl.message,
           CASE WHEN pl.kind = 'input_behind' THEN 'info' ELSE 'warning' END,
           pl.action_url, false, now()
    FROM _plan pl WHERE pl.channel = 'in_app';

    INSERT INTO public.hor_reminder_log
      (tenant_id, subject_user_id, recipient_user_id, period_year, period_month, kind, channel, sent_on)
    SELECT pl.tenant_id, pl.subject_user_id, pl.recipient_user_id, pl.period_year, pl.period_month, pl.kind, pl.channel, p_run
    FROM _plan pl
    ON CONFLICT DO NOTHING;
  END IF;

  RETURN QUERY
    SELECT pl.tenant_id, pl.subject_user_id, pl.subject_name, pl.recipient_user_id, pl.recipient_name,
           pl.period_year, pl.period_month, pl.kind, pl.channel, pl.title, pl.message, pl.action_url
    FROM _plan pl
    ORDER BY pl.subject_name, pl.kind, pl.channel;
END;
$fn$;

REVOKE ALL ON FUNCTION public.hor_run_daily_reminders(date, boolean) FROM public, authenticated;

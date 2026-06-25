-- Server-side HOR reminder sweep. Replaces the unreliable client-side
-- setInterval (which only ran if a browser was open at Sun 18:00). Scans the
-- CURRENT month for each active tenant member and writes a notification row:
--   * missing logged days  -> "missing entries"
--   * complete but unsubmitted near month-end -> "confirm month"
-- Locked months are skipped; a 6-day per-user de-dupe prevents double-sends.
create or replace function public.hor_send_weekly_reminders()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_today date := (now() at time zone 'UTC')::date;
  v_year int := extract(year from v_today)::int;
  v_month int := extract(month from v_today)::int;
  v_first date := make_date(v_year, v_month, 1);
  v_last date := (date_trunc('month', v_first) + interval '1 month - 1 day')::date;
  v_expected_last date := least(v_today, v_last);
  v_expected_count int := (v_expected_last - v_first) + 1;
  v_days_left int := v_last - v_today;
  v_period text := to_char(v_first, 'YYYY-MM');
  v_monlabel text := to_char(v_first, 'Mon YYYY');
  r record;
  v_logged int;
  v_missing int;
  v_status text;
  v_sent int := 0;
begin
  for r in
    select tm.tenant_id, tm.user_id
    from public.tenant_members tm
    where tm.active is true and tm.user_id is not null
  loop
    -- De-dupe: skip if a HOR reminder already reached this user in the last 6 days.
    if exists (
      select 1 from public.notifications n
      where n.user_id = r.user_id
        and n.type = 'HOR_REMINDER'
        and n.created_at > now() - interval '6 days'
    ) then
      continue;
    end if;

    select status into v_status
    from public.hor_month_status
    where tenant_id = r.tenant_id and subject_user_id = r.user_id
      and period_year = v_year and period_month = v_month;

    if v_status = 'locked' then
      continue;
    end if;

    select count(distinct entry_date) into v_logged
    from public.hor_work_entries
    where tenant_id = r.tenant_id and subject_user_id = r.user_id
      and entry_date between v_first and v_expected_last;

    v_missing := v_expected_count - coalesce(v_logged, 0);

    if v_missing > 0 then
      insert into public.notifications (user_id, type, title, message, severity, action_url, read, created_at)
      values (
        r.user_id, 'HOR_REMINDER', 'Hours of Rest — missing entries',
        'You have ' || v_missing || ' day' || case when v_missing = 1 then '' else 's' end ||
          ' with no Hours of Rest logged for ' || v_monlabel || '.',
        'info', '/profile?tab=hor&period=' || v_period, false, now()
      );
      v_sent := v_sent + 1;
    elsif v_days_left <= 7 and coalesce(v_status, 'open') not in ('submitted','confirmed','locked') then
      insert into public.notifications (user_id, type, title, message, severity, action_url, read, created_at)
      values (
        r.user_id, 'HOR_REMINDER', 'Hours of Rest — confirm month',
        'Your ' || v_monlabel || ' Hours of Rest are complete. Please submit them for sign-off.',
        'info', '/profile?tab=hor&period=' || v_period, false, now()
      );
      v_sent := v_sent + 1;
    end if;
  end loop;
  return v_sent;
end;
$$;

-- SECURITY DEFINER: keep it callable only by the job owner / service role.
revoke all on function public.hor_send_weekly_reminders() from public, anon, authenticated;

-- Weekly schedule, Sundays 18:00 UTC. cron.schedule upserts by job name.
select cron.schedule('hor-weekly-reminders', '0 18 * * 0', $$select public.hor_send_weekly_reminders();$$);

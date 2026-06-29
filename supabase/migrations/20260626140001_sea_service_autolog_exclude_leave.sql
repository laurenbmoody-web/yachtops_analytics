-- Auto-log v2: exclude leave from materialised onboard service.
--
-- A day only counts as onboard service when the crew member's status was 'active'
-- on that day. Rotational leave, normal leave, medical/training leave and
-- travel days all change crew_status_history away from 'active' — and that record
-- is management-owned, so the exclusion stays authority-sourced (the crew can't
-- inflate their service by self-reporting presence).
--
-- Status as-of a day = the latest crew_status_history change on or before that
-- day; absent any history, the member is treated as active.
create or replace function public.sync_sea_service_from_vessel(
  p_tenant_id uuid,
  p_user_id   uuid
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid      uuid := auth.uid();
  v_start    date;
  v_end      date;
  v_rank     text;
  v_vessel   record;
  v_inserted int := 0;
  v_excluded int := 0;
begin
  if not (v_uid = p_user_id or public.is_command_user_in_tenant(p_tenant_id)) then
    raise exception 'Not authorised to sync sea service for this user.';
  end if;
  if not public.is_active_tenant_member(p_tenant_id, p_user_id) then
    raise exception 'User is not an active member of this vessel.';
  end if;

  select ce.start_date, ce.end_date, ce.rank_held
    into v_start, v_end, v_rank
  from crew_employment ce
  where ce.tenant_id = p_tenant_id and ce.user_id = p_user_id
  order by ce.start_date asc nulls last
  limit 1;

  select name, flag, imo_number, official_number, loa_m, gt, vessel_type_label, operating_regions
    into v_vessel
  from vessels
  where tenant_id = p_tenant_id;

  if v_start is null then
    return jsonb_build_object('inserted', 0, 'has_start_date', false, 'reason', 'no_join_date');
  end if;

  v_end := least(coalesce(v_end, current_date), current_date);
  if v_end < v_start then
    return jsonb_build_object('inserted', 0, 'has_start_date', true,
      'period_from', v_start, 'period_to', v_end, 'reason', 'empty_range');
  end if;

  with days as (
    select d::date as entry_date
    from generate_series(v_start, v_end, interval '1 day') d
  ),
  status_as_of as (
    select
      dd.entry_date,
      coalesce((
        select csh.new_status
        from crew_status_history csh
        where csh.tenant_id = p_tenant_id
          and csh.user_id   = p_user_id
          and csh.changed_at::date <= dd.entry_date
        order by csh.changed_at desc
        limit 1
      ), 'active') as status
    from days dd
  ),
  -- Onboard days only: active status, and not already logged.
  candidate as (
    select s.entry_date, (s.status <> 'active') as is_leave
    from status_as_of s
  ),
  missing as (
    select c.entry_date
    from candidate c
    where c.is_leave = false
      and not exists (
        select 1 from sea_service_entries e
        where e.tenant_id = p_tenant_id and e.user_id = p_user_id and e.entry_date = c.entry_date
      )
  ),
  ins as (
    insert into sea_service_entries (
      tenant_id, user_id, entry_date, source, vessel_status, watch_hours,
      capacity_served, location_trading_area, vessel_name, vessel_flag, vessel_imo,
      vessel_official_number, vessel_gt, vessel_length_m, vessel_type, verification_status
    )
    select
      p_tenant_id, p_user_id, m.entry_date, 'vessel_auto', 'UNDERWAY', 0,
      v_rank, v_vessel.operating_regions, v_vessel.name, v_vessel.flag, v_vessel.imo_number,
      v_vessel.official_number, v_vessel.gt, v_vessel.loa_m, v_vessel.vessel_type_label, 'draft'
    from missing m
    returning 1
  )
  select
    (select count(*) from ins),
    (select count(*) from candidate where is_leave)
  into v_inserted, v_excluded;

  return jsonb_build_object(
    'inserted', v_inserted,
    'excluded_leave_days', v_excluded,
    'has_start_date', true,
    'period_from', v_start,
    'period_to', v_end
  );
end
$$;

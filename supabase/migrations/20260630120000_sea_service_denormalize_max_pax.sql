-- The Transport Malta deck testimonial (S.L. 499.23) records each vessel's
-- maximum certificated passenger count. We already denormalize the vessel's LOA
-- (loa_m → vessel_length_m) and GT onto each auto-logged service row, but not the
-- passenger count — so a testimonial spanning a non-current vessel had no pax.
-- Denormalize the vessel's typical_guest_count onto the row, exactly like LOA/GT,
-- so every Cargo-tracked spell carries it regardless of which vessel.
alter table public.sea_service_entries add column if not exists vessel_max_pax integer;

-- Backfill existing auto-logged rows from their tenant's vessel.
update public.sea_service_entries e
set vessel_max_pax = v.typical_guest_count
from public.vessels v
where v.tenant_id = e.tenant_id
  and e.source = 'vessel_auto'
  and e.vessel_max_pax is null
  and v.typical_guest_count is not null;

-- Re-create the autolog sync to ALSO read + stamp the passenger count. Identical
-- to 20260626220000_sea_service_autolog_stamp_captain except: the vessels select
-- now pulls typical_guest_count, and the insert stamps vessel_max_pax.
create or replace function public.sync_sea_service_from_vessel(
  p_tenant_id uuid,
  p_user_id   uuid
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid          uuid := auth.uid();
  v_start        date;
  v_end          date;
  v_rank         text;
  v_vessel       record;
  v_captain_id   uuid;
  v_captain_name text;
  v_inserted     int := 0;
  v_reclassified int := 0;
  v_excluded     int := 0;
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

  select name, flag, imo_number, official_number, loa_m, gt, vessel_type_label, operating_regions, typical_guest_count
    into v_vessel
  from vessels where tenant_id = p_tenant_id;

  select tm.user_id into v_captain_id
  from tenant_members tm
  where tm.tenant_id = p_tenant_id and tm.role = 'COMMAND'
  order by tm.created_at asc nulls last
  limit 1;
  if v_captain_id is not null then
    select coalesce(nullif(btrim(coalesce(pr.first_name,'') || ' ' || coalesce(pr.surname,'')), ''), pr.full_name)
      into v_captain_name from profiles pr where pr.id = v_captain_id;
  end if;

  if v_start is null then
    return jsonb_build_object('inserted', 0, 'has_start_date', false, 'reason', 'no_join_date');
  end if;

  v_end := least(coalesce(v_end, current_date), current_date);
  if v_end < v_start then
    return jsonb_build_object('inserted', 0, 'has_start_date', true,
      'period_from', v_start, 'period_to', v_end, 'reason', 'empty_range');
  end if;

  create temp table _plan on commit drop as
  with days as (
    select d::date as entry_date from generate_series(v_start, v_end, interval '1 day') d
  ),
  mem as (
    select id from tenant_members where tenant_id = p_tenant_id and user_id = p_user_id
  ),
  rota as (
    select
      rs.shift_date,
      sum(case when rs.shift_type = 'watch' then
        case when rs.end_time < rs.start_time
          then extract(epoch from (rs.end_time - rs.start_time + interval '24 hours')) / 3600.0
          else extract(epoch from (rs.end_time - rs.start_time)) / 3600.0 end
        else 0 end) as watch_hours,
      bool_or(rs.shift_type = 'standby') as has_standby,
      bool_or(rs.shift_type = 'watch')   as has_watch
    from rota_shifts rs
    where rs.tenant_id = p_tenant_id and rs.member_id in (select id from mem)
    group by rs.shift_date
  )
  select
    dd.entry_date,
    coalesce((
      select csh.new_status from crew_status_history csh
      where csh.tenant_id = p_tenant_id and csh.user_id = p_user_id
        and csh.changed_at::date <= dd.entry_date
      order by csh.changed_at desc limit 1
    ), 'active') <> 'active' as is_leave,
    round(coalesce(r.watch_hours, 0))::int as wh,
    case
      when coalesce(r.has_watch, false)   then 'UNDERWAY'
      when coalesce(r.has_standby, false) then 'ANCHOR'
      else 'UNDERWAY'
    end as vstatus
  from days dd
  left join rota r on r.shift_date = dd.entry_date;

  insert into sea_service_entries (
    tenant_id, user_id, entry_date, source, vessel_status, watch_hours,
    capacity_served, location_trading_area, vessel_name, vessel_flag, vessel_imo,
    vessel_official_number, vessel_gt, vessel_length_m, vessel_type, vessel_max_pax, verification_status,
    master_user_id, master_name
  )
  select
    p_tenant_id, p_user_id, p.entry_date, 'vessel_auto', p.vstatus, p.wh,
    v_rank, v_vessel.operating_regions, v_vessel.name, v_vessel.flag, v_vessel.imo_number,
    v_vessel.official_number, v_vessel.gt, v_vessel.loa_m, v_vessel.vessel_type_label, v_vessel.typical_guest_count, 'draft',
    v_captain_id, v_captain_name
  from _plan p
  where p.is_leave = false
    and not exists (
      select 1 from sea_service_entries e
      where e.tenant_id = p_tenant_id and e.user_id = p_user_id and e.entry_date = p.entry_date
    );
  get diagnostics v_inserted = row_count;

  update sea_service_entries e
  set vessel_status = p.vstatus,
      watch_hours = p.wh,
      master_user_id = coalesce(e.master_user_id, v_captain_id),
      master_name = coalesce(nullif(e.master_name, ''), v_captain_name)
  from _plan p
  where e.tenant_id = p_tenant_id and e.user_id = p_user_id and e.entry_date = p.entry_date
    and e.source = 'vessel_auto' and e.verification_status = 'draft' and coalesce(e.locked, false) = false
    and (e.vessel_status is distinct from p.vstatus
         or e.watch_hours is distinct from p.wh
         or e.master_user_id is null);
  get diagnostics v_reclassified = row_count;

  select count(*) into v_excluded from _plan where is_leave;

  return jsonb_build_object(
    'inserted', v_inserted,
    'reclassified', v_reclassified,
    'excluded_leave_days', v_excluded,
    'has_start_date', true,
    'period_from', v_start,
    'period_to', v_end
  );
end
$$;

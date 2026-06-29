-- Auto-log sea service from the crew member's current Cargo vessel.
--
-- The crew should never have to reconstruct dates by hand (or self-assert them —
-- they could enter anything). Instead we materialise one onboard-service row per
-- day straight from AUTHORITY-OWNED records: the management-maintained
-- crew_employment period (start/end, set by COMMAND/admin) + the vessel
-- particulars (a tenant IS a vessel). The crew only review the result.
--
-- Idempotent: only days not already logged are inserted, so it's safe to re-run
-- (e.g. each time the dashboard loads, or after COMMAND sets a join date).
--
-- Classification is a deliberate v1 default — every generated day is onboard
-- service ('UNDERWAY') in draft, flagged for review. Refinement from rota /
-- crew-status (and AIS later, once a feed exists) layers on top without changing
-- this contract.
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
begin
  -- The seafarer themselves, or COMMAND on the vessel, may trigger a sync.
  if not (v_uid = p_user_id or public.is_command_user_in_tenant(p_tenant_id)) then
    raise exception 'Not authorised to sync sea service for this user.';
  end if;
  if not public.is_active_tenant_member(p_tenant_id, p_user_id) then
    raise exception 'User is not an active member of this vessel.';
  end if;

  -- Authority-owned service period — the management-maintained employment record.
  select ce.start_date, ce.end_date, ce.rank_held
    into v_start, v_end, v_rank
  from crew_employment ce
  where ce.tenant_id = p_tenant_id and ce.user_id = p_user_id
  order by ce.start_date asc nulls last
  limit 1;

  -- Vessel particulars (a tenant IS a vessel).
  select name, flag, imo_number, official_number, loa_m, gt, vessel_type_label, operating_regions
    into v_vessel
  from vessels
  where tenant_id = p_tenant_id;

  -- Without an authority-set join date there's nothing to bound the service —
  -- COMMAND completes the employment record first.
  if v_start is null then
    return jsonb_build_object('inserted', 0, 'has_start_date', false, 'reason', 'no_join_date');
  end if;

  -- Still aboard → run to today; never generate future days.
  v_end := least(coalesce(v_end, current_date), current_date);
  if v_end < v_start then
    return jsonb_build_object('inserted', 0, 'has_start_date', true,
      'period_from', v_start, 'period_to', v_end, 'reason', 'empty_range');
  end if;

  with days as (
    select d::date as entry_date
    from generate_series(v_start, v_end, interval '1 day') d
  ),
  missing as (
    select dd.entry_date
    from days dd
    where not exists (
      select 1 from sea_service_entries s
      where s.tenant_id = p_tenant_id
        and s.user_id   = p_user_id
        and s.entry_date = dd.entry_date
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
  select count(*) into v_inserted from ins;

  return jsonb_build_object(
    'inserted', v_inserted,
    'has_start_date', true,
    'period_from', v_start,
    'period_to', v_end
  );
end
$$;

grant execute on function public.sync_sea_service_from_vessel(uuid, uuid) to authenticated;

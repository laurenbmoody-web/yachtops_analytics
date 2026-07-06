-- Vessel status log — the master's vessel-wide record of what the vessel was
-- actually doing (Underway / At anchor / In port / In yard), which is the FIRST
-- source of truth for how each sea-service day is classified. Until now the
-- auto-log defaulted every un-rota'd day to UNDERWAY (= seagoing), silently
-- over-counting seagoing service and with no way to represent a yard/refit or
-- an in-port period from the command side. This log fixes that.
--
-- Guarantees the design asks for:
--   • Command-only writes (via the SECURITY DEFINER RPC — no direct table writes).
--   • Append-only: a change never overwrites a period's status/dates; it
--     supersedes the old row (active=false, kept for history) and inserts new
--     rows, so the log is its own audit trail. Every write also lands in
--     vessel_status_audit with the actor + reason.
--   • Lock on sign-off: a period that overlaps already captain-signed service
--     cannot be changed — those records are attested and immutable.

-- ── vessel_status_log (one vessel per tenant) ────────────────────────────────
create table if not exists public.vessel_status_log (
  id             bigint generated always as identity primary key,
  tenant_id      uuid not null references public.tenants(id) on delete cascade,
  status         text not null check (status in ('UNDERWAY','ANCHOR','IN_PORT','IN_YARD')),
  effective_from date not null,
  effective_to   date,                              -- null = open-ended (current, until further notice)
  note           text,
  active         boolean not null default true,     -- false = superseded (retained for history)
  set_by         uuid default auth.uid(),
  set_by_name    text,
  superseded_at  timestamptz,
  created_at     timestamptz not null default now(),
  check (effective_to is null or effective_to >= effective_from)
);
create index if not exists vessel_status_log_tenant_active
  on public.vessel_status_log (tenant_id, active, effective_from);

alter table public.vessel_status_log enable row level security;

-- Read: any active member of the vessel (crew can SEE the status; only command
-- can SET it). No write policies — all writes go through set_vessel_status().
drop policy if exists vessel_status_log_select on public.vessel_status_log;
create policy vessel_status_log_select on public.vessel_status_log
  for select to authenticated
  using (public.is_active_tenant_member(tenant_id, auth.uid()));

-- ── vessel_status_audit (append-only) ────────────────────────────────────────
create table if not exists public.vessel_status_audit (
  id             bigint generated always as identity primary key,
  tenant_id      uuid not null references public.tenants(id) on delete cascade,
  actor_id       uuid default auth.uid(),
  actor_name     text,
  action         text not null,                     -- SET
  status         text,
  effective_from date,
  effective_to   date,
  reason         text,
  detail         jsonb not null default '{}'::jsonb,
  created_at     timestamptz not null default now()
);
create index if not exists vessel_status_audit_tenant
  on public.vessel_status_audit (tenant_id, created_at desc);

alter table public.vessel_status_audit enable row level security;

drop policy if exists vessel_status_audit_select on public.vessel_status_audit;
create policy vessel_status_audit_select on public.vessel_status_audit
  for select to authenticated
  using (public.is_command_user_in_tenant(tenant_id));

-- ── set_vessel_status — the only write path ──────────────────────────────────
-- Command-only. Splices the new [from,to] period into the existing timeline
-- (superseding overlaps, preserving their non-overlapping remainders), records
-- an audit row, and re-stamps existing auto-logged, unlocked, draft days in the
-- range so the classification is immediately consistent. Refuses to touch a
-- range that overlaps already signed-off service.
create or replace function public.set_vessel_status(
  p_tenant_id uuid,
  p_status    text,
  p_from      date,
  p_to        date default null,
  p_note      text default null,
  p_reason    text default null
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid          uuid := auth.uid();
  v_name         text;
  v_signed       int;
  v_reclassified int;
  r              record;
begin
  if not public.is_command_user_in_tenant(p_tenant_id) then
    raise exception 'Only command crew can set the vessel status.' using errcode = 'insufficient_privilege';
  end if;
  if p_status is null or p_status not in ('UNDERWAY','ANCHOR','IN_PORT','IN_YARD') then
    raise exception 'Invalid vessel status: %', p_status;
  end if;
  if p_from is null then
    raise exception 'A start date is required.';
  end if;
  if p_to is not null and p_to < p_from then
    raise exception 'The end date is before the start date.';
  end if;

  -- Lock on sign-off: a change may not cover dates that already carry
  -- captain-signed service — those records are attested and immutable.
  select count(*) into v_signed
  from sea_service_entries e
  where e.tenant_id = p_tenant_id and e.verification_status = 'captain_signed'
    and e.entry_date >= p_from and (p_to is null or e.entry_date <= p_to);
  if v_signed > 0 then
    raise exception 'Cannot change the vessel status over % day(s) of already signed-off sea service — those records are locked.', v_signed
      using errcode = 'check_violation';
  end if;

  select coalesce(nullif(btrim(coalesce(pr.first_name,'') || ' ' || coalesce(pr.surname,'')), ''), pr.full_name)
    into v_name from profiles pr where pr.id = v_uid;

  -- Splice: supersede every active period that overlaps the new range, keeping
  -- the parts of each that fall OUTSIDE the new range as fresh active rows.
  for r in
    select * from vessel_status_log
    where tenant_id = p_tenant_id and active
      and effective_from <= coalesce(p_to, 'infinity'::date)
      and coalesce(effective_to, 'infinity'::date) >= p_from
  loop
    update vessel_status_log set active = false, superseded_at = now() where id = r.id;
    if r.effective_from < p_from then
      insert into vessel_status_log(tenant_id, status, effective_from, effective_to, note, set_by, set_by_name)
      values (p_tenant_id, r.status, r.effective_from, p_from - 1, r.note, r.set_by, r.set_by_name);
    end if;
    if p_to is not null and coalesce(r.effective_to, 'infinity'::date) > p_to then
      insert into vessel_status_log(tenant_id, status, effective_from, effective_to, note, set_by, set_by_name)
      values (p_tenant_id, r.status, p_to + 1, r.effective_to, r.note, r.set_by, r.set_by_name);
    end if;
  end loop;

  insert into vessel_status_log(tenant_id, status, effective_from, effective_to, note, set_by, set_by_name)
  values (p_tenant_id, p_status, p_from, p_to, p_note, v_uid, v_name);

  -- Re-stamp existing auto-logged, unlocked, draft days in the range (vessel-wide;
  -- manual crew entries and signed/locked rows are left untouched).
  update sea_service_entries e
     set vessel_status = p_status
   where e.tenant_id = p_tenant_id and e.source = 'vessel_auto'
     and coalesce(e.locked, false) = false and e.verification_status = 'draft'
     and e.entry_date >= p_from and (p_to is null or e.entry_date <= p_to)
     and e.vessel_status is distinct from p_status;
  get diagnostics v_reclassified = row_count;

  insert into vessel_status_audit(tenant_id, actor_id, actor_name, action, status, effective_from, effective_to, reason, detail)
  values (p_tenant_id, v_uid, v_name, 'SET', p_status, p_from, p_to, p_reason,
          jsonb_build_object('reclassified', v_reclassified));

  return jsonb_build_object('ok', true, 'status', p_status, 'from', p_from, 'to', p_to, 'reclassified', v_reclassified);
end;
$$;

-- ── get_vessel_status_timeline — read the effective timeline + lock flags ─────
create or replace function public.get_vessel_status_timeline(p_tenant_id uuid)
returns table (
  id bigint, status text, effective_from date, effective_to date, note text,
  set_by uuid, set_by_name text, created_at timestamptz, locked boolean
)
language sql
stable
security definer
set search_path = public
as $$
  select l.id, l.status, l.effective_from, l.effective_to, l.note,
         l.set_by, l.set_by_name, l.created_at,
         exists (
           select 1 from sea_service_entries e
           where e.tenant_id = l.tenant_id and e.verification_status = 'captain_signed'
             and e.entry_date >= l.effective_from
             and (l.effective_to is null or e.entry_date <= l.effective_to)
         ) as locked
  from vessel_status_log l
  where l.tenant_id = p_tenant_id and l.active
    and public.is_active_tenant_member(p_tenant_id, auth.uid())
  order by l.effective_from desc;
$$;

grant execute on function public.set_vessel_status(uuid, text, date, date, text, text) to authenticated;
grant execute on function public.get_vessel_status_timeline(uuid) to authenticated;

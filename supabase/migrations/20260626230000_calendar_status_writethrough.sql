-- Close the gap: Activity-calendar leave/travel must drive sea-service exclusion.
--
-- The Activity calendar (crew_calendar_entries) is a date-ranged schedule of
-- leave/travel. The sea-service auto-log only knows about crew_status_history
-- (the point-in-time status timeline). Previously the two never met: you could
-- schedule rotational leave on the calendar and those days would still count as
-- sea time, because nothing wrote them into crew_status_history.
--
-- This migration projects every calendar entry into crew_status_history as
-- `source = 'calendar'` rows, kept in lock-step by a trigger. The sea-service
-- RPC already reads crew_status_history point-in-time, so scheduled leave/travel
-- now correctly drops out of sea time — no change to that RPC required.
--
-- Design notes:
--   * Manual rows (the status chip) keep source = 'manual' (the column default),
--     so chip changes and calendar projections never clobber each other. The
--     chip's *displayed* status reads tenant_members.status, untouched here.
--   * A calendar entry only asserts a status *within* its [start, end] range.
--     Outside a range we fall back to the manual timeline — so the calendar can
--     never silently re-activate someone the office has manually parked on leave.
--   * Projection is recomputed from scratch on any insert/update/delete, so it is
--     always consistent and self-healing (no fragile incremental bookkeeping).

alter table crew_status_history
  add column if not exists source text not null default 'manual',
  add column if not exists calendar_entry_id uuid;

create index if not exists idx_csh_user_source
  on crew_status_history (user_id, source);

-- Rebuild the calendar-sourced status rows for one crew member from their
-- current calendar entries. Emits a status-change row at each day the effective
-- status transitions; days inside an entry take the entry's kind, days outside
-- fall back to the manual timeline.
create or replace function public.sync_calendar_status_history(p_tenant uuid, p_user uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if p_tenant is null or p_user is null then
    return;
  end if;

  delete from crew_status_history
   where source = 'calendar'
     and tenant_id = p_tenant
     and user_id = p_user;

  insert into crew_status_history
    (tenant_id, user_id, old_status, new_status, changed_at, notes, source, calendar_entry_id)
  with entries as (
    select id, kind, start_date::date as sd, end_date::date as ed
    from crew_calendar_entries
    where tenant_id = p_tenant and user_id = p_user
  ),
  -- A status can only change at an entry's start or the day after its end.
  boundaries as (
    select sd as b from entries
    union
    select ed + 1 from entries
  ),
  eff as (
    select
      b.b,
      coalesce(
        -- Calendar entry covering this day (latest start wins on overlap)...
        (select e.kind from entries e
           where e.sd <= b.b and b.b <= e.ed
           order by e.sd desc limit 1),
        -- ...else the manual status as-of this day...
        (select csh.new_status from crew_status_history csh
           where csh.tenant_id = p_tenant and csh.user_id = p_user
             and csh.source = 'manual'
             and csh.changed_at::date <= b.b
           order by csh.changed_at desc limit 1),
        -- ...else active (no history at all).
        'active'
      ) as status,
      (select e.id from entries e
         where e.sd <= b.b and b.b <= e.ed
         order by e.sd desc limit 1) as entry_id
    from boundaries b
  ),
  ordered as (
    select b, status, entry_id,
           lag(status) over (order by b) as prev_status
    from eff
  )
  select
    p_tenant, p_user, prev_status, status,
    (b::timestamp at time zone 'UTC'),
    'Auto: scheduled on the activity calendar',
    'calendar',
    entry_id
  from ordered
  where prev_status is distinct from status;
end
$$;

create or replace function public.trg_calendar_status_sync()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if tg_op = 'DELETE' then
    perform public.sync_calendar_status_history(old.tenant_id, old.user_id);
    return old;
  end if;
  perform public.sync_calendar_status_history(new.tenant_id, new.user_id);
  if tg_op = 'UPDATE'
     and (old.user_id is distinct from new.user_id
          or old.tenant_id is distinct from new.tenant_id) then
    perform public.sync_calendar_status_history(old.tenant_id, old.user_id);
  end if;
  return new;
end
$$;

drop trigger if exists calendar_status_sync on crew_calendar_entries;
create trigger calendar_status_sync
after insert or update or delete on crew_calendar_entries
for each row execute function public.trg_calendar_status_sync();

-- Backfill: project all existing calendar entries.
do $$
declare r record;
begin
  for r in (select distinct tenant_id, user_id
              from crew_calendar_entries
             where tenant_id is not null and user_id is not null)
  loop
    perform public.sync_calendar_status_history(r.tenant_id, r.user_id);
  end loop;
end $$;

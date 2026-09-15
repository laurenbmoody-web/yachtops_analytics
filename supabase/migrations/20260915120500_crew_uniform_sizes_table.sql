-- Uniform sizes previously lived in crew_personal_details.preferences.uniformSizes,
-- but that row also holds highly sensitive data (DOB, home address, blood type,
-- medical conditions, next of kin). We could not widen access to sizes without
-- exposing all of that. Move sizes to their own table with size-specific rules:
--
--   READ  : self; any Interior member (they run uniform/laundry); CHIEF+ (full
--           crew management); HOD only within their own department.
--   WRITE : self; any Interior member; COMMAND.
--
-- Effective tier honours permission_tier_override throughout.

create table if not exists public.crew_uniform_sizes (
  user_id    uuid primary key,
  sizes      jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

alter table public.crew_uniform_sizes enable row level security;

-- SECURITY DEFINER so the membership/department lookups bypass tenant_members'
-- own RLS (avoids recursion) while still keying off the calling auth.uid().
create or replace function public.can_read_uniform_sizes(subject uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select subject = auth.uid() or exists (
    select 1
    from tenant_members v
    join tenant_members s on s.tenant_id = v.tenant_id
    left join departments vd on vd.id = v.department_id
    where v.user_id = auth.uid() and v.active
      and s.user_id = subject and s.active
      and (
        lower(coalesce(vd.name, '')) = 'interior'
        or coalesce(v.permission_tier_override, v.permission_tier) in ('COMMAND', 'CHIEF')
        or (coalesce(v.permission_tier_override, v.permission_tier) = 'HOD'
            and v.department_id is not null and v.department_id = s.department_id)
      )
  );
$$;

create or replace function public.can_write_uniform_sizes(subject uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select subject = auth.uid() or exists (
    select 1
    from tenant_members v
    join tenant_members s on s.tenant_id = v.tenant_id
    left join departments vd on vd.id = v.department_id
    where v.user_id = auth.uid() and v.active
      and s.user_id = subject and s.active
      and (
        lower(coalesce(vd.name, '')) = 'interior'
        or coalesce(v.permission_tier_override, v.permission_tier) = 'COMMAND'
      )
  );
$$;

drop policy if exists crew_uniform_sizes_read on public.crew_uniform_sizes;
create policy crew_uniform_sizes_read on public.crew_uniform_sizes
  for select using (public.can_read_uniform_sizes(user_id));

drop policy if exists crew_uniform_sizes_ins on public.crew_uniform_sizes;
create policy crew_uniform_sizes_ins on public.crew_uniform_sizes
  for insert with check (public.can_write_uniform_sizes(user_id));

drop policy if exists crew_uniform_sizes_upd on public.crew_uniform_sizes;
create policy crew_uniform_sizes_upd on public.crew_uniform_sizes
  for update using (public.can_write_uniform_sizes(user_id))
  with check (public.can_write_uniform_sizes(user_id));

grant select, insert, update on public.crew_uniform_sizes to authenticated;

-- Backfill from the legacy location; leave the old copy in place for rollback.
insert into public.crew_uniform_sizes (user_id, sizes, updated_at)
select user_id, preferences->'uniformSizes', now()
from public.crew_personal_details
where preferences ? 'uniformSizes'
  and jsonb_typeof(preferences->'uniformSizes') = 'object'
on conflict (user_id) do update set sizes = excluded.sizes, updated_at = now();

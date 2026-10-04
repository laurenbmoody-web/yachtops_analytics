-- Gangway "Device" role: a dedicated account (the wall-mounted entry-door iPad)
-- that may sign ANY crew / guest / visitor in or out for its vessel, without
-- being a Command/Chief human login. Marked per tenant_member via is_kiosk_device
-- and granted write access through additional (permissive) RLS policies that OR
-- with the existing self / Command-Chief rules — so nothing already allowed breaks.

alter table public.tenant_members
  add column if not exists is_kiosk_device boolean not null default false;

-- True when the caller is an active kiosk device for the given tenant.
create or replace function public.is_kiosk_device_for(p_tenant uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.tenant_members d
    where d.user_id = auth.uid() and d.tenant_id = p_tenant
      and d.active is not false and d.is_kiosk_device
  );
$$;
grant execute on function public.is_kiosk_device_for(uuid) to authenticated;

-- crew_presence — a device may set anyone's status in its tenant.
drop policy if exists crew_presence_device_insert on public.crew_presence;
create policy crew_presence_device_insert on public.crew_presence
  for insert to authenticated with check (public.is_kiosk_device_for(tenant_id));
drop policy if exists crew_presence_device_update on public.crew_presence;
create policy crew_presence_device_update on public.crew_presence
  for update to authenticated using (public.is_kiosk_device_for(tenant_id))
  with check (public.is_kiosk_device_for(tenant_id));

-- guests — a device may toggle the on-board state.
drop policy if exists guests_device_update on public.guests;
create policy guests_device_update on public.guests
  for update to authenticated using (public.is_kiosk_device_for(tenant_id))
  with check (public.is_kiosk_device_for(tenant_id));

-- contractor_visits — a device may sign visitors in and out.
drop policy if exists contractor_visits_device_insert on public.contractor_visits;
create policy contractor_visits_device_insert on public.contractor_visits
  for insert to authenticated with check (public.is_kiosk_device_for(tenant_id));
drop policy if exists contractor_visits_device_update on public.contractor_visits;
create policy contractor_visits_device_update on public.contractor_visits
  for update to authenticated using (public.is_kiosk_device_for(tenant_id))
  with check (public.is_kiosk_device_for(tenant_id));

-- Only Command may mark/unmark an account as the gangway device (in their tenant).
create or replace function public.set_kiosk_device(p_user_id uuid, p_on boolean)
returns void language plpgsql security definer set search_path = public as $$
declare v_tenant uuid;
begin
  select me.tenant_id into v_tenant from public.tenant_members me
    where me.user_id = auth.uid() and me.active is not false
      and upper(me.permission_tier) = 'COMMAND'
    limit 1;
  if v_tenant is null then
    raise exception 'Only Command can set the gangway device';
  end if;
  update public.tenant_members set is_kiosk_device = p_on
    where user_id = p_user_id and tenant_id = v_tenant;
end $$;
grant execute on function public.set_kiosk_device(uuid, boolean) to authenticated;

-- Allow any active crew member (not only Command/Chief) to add vessel_locations.
-- Adding a storage location (a room's cupboard/bed/void, or a box) is an
-- everyday inventory action, so INSERT is opened to all active tenant members,
-- matching the SELECT policy. UPDATE/DELETE stay Command/Chief only.
drop policy if exists vessel_locations_insert on public.vessel_locations;
create policy vessel_locations_insert on public.vessel_locations
  for insert to authenticated
  with check (
    tenant_id in (
      select tenant_members.tenant_id
      from tenant_members
      where tenant_members.user_id = auth.uid()
        and tenant_members.active = true
    )
  );

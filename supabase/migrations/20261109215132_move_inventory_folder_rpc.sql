-- Atomic server-side folder move for inventory.
--
-- The client used to move a folder with a sequence of 6+ separate
-- select/update round-trips (moveFolderInDB in inventoryStorage.js). In the
-- field that sequence could silently do nothing — a move would "refresh and
-- fall back" with no error and no DB change. Replace it with one atomic,
-- membership-checked SECURITY DEFINER function the client awaits, so a move
-- either fully applies or raises a real error.
--
-- Paths are materialized strings (see docs/inventory-location-model.md):
--   p_old_location / p_new_location  = the department (inventory_items.location)
--   p_old_sub  = the folder's current full sub_location path (e.g. 'Equipment'
--                or 'Equipment > Small')
--   p_new_sub  = its new full sub_location path (e.g. 'Utensils > Equipment')
-- The function moves the folder row itself and every descendant folder/item.

create or replace function public.move_inventory_folder(
  p_tenant uuid,
  p_old_location text,
  p_old_sub text,
  p_new_location text,
  p_new_sub text
) returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  n_loc int := 0;
  n_items int := 0;
begin
  if p_tenant is null or not public.is_tenant_member(p_tenant) then
    raise exception 'not permitted to manage inventory for tenant %', p_tenant
      using errcode = '42501';
  end if;

  if p_old_location is null or p_old_sub is null
     or p_new_location is null or p_new_sub is null then
    raise exception 'move_inventory_folder: all path arguments are required';
  end if;

  -- Guard against moving a folder into itself or one of its own descendants.
  if p_new_location = p_old_location
     and (p_new_sub = p_old_sub or p_new_sub like p_old_sub || ' > %') then
    raise exception 'cannot move a folder into itself';
  end if;

  -- Move the folder rows: the folder itself plus any nested sub-folders.
  update public.inventory_locations
     set location = p_new_location,
         sub_location = case
           when sub_location = p_old_sub then p_new_sub
           else p_new_sub || substr(sub_location, length(p_old_sub) + 1)
         end
   where tenant_id = p_tenant
     and location = p_old_location
     and (sub_location = p_old_sub or sub_location like p_old_sub || ' > %');
  get diagnostics n_loc = row_count;

  -- Move every item filed in the folder or any descendant.
  update public.inventory_items
     set location = p_new_location,
         sub_location = case
           when sub_location = p_old_sub then p_new_sub
           else p_new_sub || substr(sub_location, length(p_old_sub) + 1)
         end
   where tenant_id = p_tenant
     and location = p_old_location
     and (sub_location = p_old_sub or sub_location like p_old_sub || ' > %');
  get diagnostics n_items = row_count;

  return n_loc + n_items;
end;
$$;

grant execute on function public.move_inventory_folder(uuid, text, text, text, text) to authenticated;

-- Extend the crew-safe kit read so a crew member can also see which CHARTER
-- each uniform piece belongs to (on charter / off charter), for grouping the
-- Issued Kit tab, the acknowledgement flow and the exported record — all of
-- which should read charter-first like the rest of the wardrobe. Charter is
-- derived from the item's inventory folder (location + sub_location), which a
-- plain crew member can't read directly, so return it here alongside the photo.
-- Named get_* so the native offline read-cache treats it as a read.
create or replace function public.get_kit_item_meta(subject uuid)
returns table (inventory_item_id uuid, image_url text, location text, sub_location text)
language sql stable security definer set search_path = public as $$
  select distinct k.inventory_item_id, ii.image_url, ii.location, ii.sub_location
  from crew_issued_kit k
  join inventory_items ii on ii.id = k.inventory_item_id
  where k.inventory_item_id is not null
    and k.user_id = subject
    and (subject = auth.uid() or public.can_view_tenant_profile(subject));
$$;

grant execute on function public.get_kit_item_meta(uuid) to authenticated;

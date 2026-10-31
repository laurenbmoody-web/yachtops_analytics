-- Crew need to SEE the uniform item's photo on their Issued Kit — in the
-- acknowledgement flow and on the exported record — so they know what each
-- piece is. But a plain crew member has no inventory read, so they can't pull
-- the image off inventory_items directly.
--
-- This SECURITY DEFINER read returns ONLY the image_url for the inventory items
-- a given crew member actually holds kit for (garment photos are not sensitive).
-- Named get_* so the native offline read-cache treats it as a read.
create or replace function public.get_kit_item_images(subject uuid)
returns table (inventory_item_id uuid, image_url text)
language sql stable security definer set search_path = public as $$
  select distinct k.inventory_item_id, ii.image_url
  from crew_issued_kit k
  join inventory_items ii on ii.id = k.inventory_item_id
  where k.inventory_item_id is not null
    and ii.image_url is not null
    and k.user_id = subject
    and (subject = auth.uid() or public.can_view_tenant_profile(subject));
$$;

grant execute on function public.get_kit_item_images(uuid) to authenticated;

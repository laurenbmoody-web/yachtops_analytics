-- 20260711120000_hotspot_containers.sql
--
-- Vessel-map pins, phase "containers": a pin can hold other pins. When
-- is_container is true it opens into an interior photo (interior_photo_path)
-- that its child pins are placed on; children carry parent_id and a 2-D
-- position ({x,y}) on that photo instead of the 3-D scan position.
--
-- This makes scan_hotspots a tree: top-level pins live on the 3-D scan
-- (parent_id null), nested pins live on their parent's interior photo.

alter table public.scan_hotspots
  add column if not exists is_container boolean not null default false,
  add column if not exists parent_id uuid references public.scan_hotspots(id) on delete cascade,
  add column if not exists interior_photo_path text;

create index if not exists scan_hotspots_parent_idx on public.scan_hotspots (parent_id);

comment on column public.scan_hotspots.is_container is
  'True when other pins live inside this one — it opens into an interior photo.';
comment on column public.scan_hotspots.parent_id is
  'The container pin this pin lives inside (null = top-level, on the 3-D scan).';
comment on column public.scan_hotspots.interior_photo_path is
  'Storage path of the photo of this container''s inside, that child pins sit on.';

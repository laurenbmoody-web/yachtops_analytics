-- A vessel-map pin is a node in the physical-location tree.
--
-- Link each pin to its vessel_locations row (created lazily under the scan's
-- space, nested by the pin's container trail) so items placed at the pin
-- reference a stable, rename-safe location id — not the pin's name. Null until
-- the first item is placed there; ON DELETE SET NULL so removing the location
-- node doesn't cascade-delete the pin.

alter table public.scan_hotspots
  add column if not exists location_node_id uuid
    references public.vessel_locations(id) on delete set null;

create index if not exists scan_hotspots_location_node_idx
  on public.scan_hotspots (location_node_id);

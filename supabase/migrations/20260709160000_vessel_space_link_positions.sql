-- 20260709160000_vessel_space_link_positions.sql
--
-- Full-vessel layout, phase 4b: anchor doorway links to a 3D spot inside each
-- room's scan, so the "walk through" pin sits on the actual door.
--
-- A link joins space A and space B. The doorway looks different from each side,
-- so it gets placed once per room: a_pos is its position in A's scan, b_pos in
-- B's scan (both {x,y,z} in the scan's coordinate space, like scan_hotspots.
-- position). Null = not placed in that room yet.

alter table public.vessel_space_links
  add column if not exists a_pos jsonb,
  add column if not exists b_pos jsonb;

comment on column public.vessel_space_links.a_pos is
  'Doorway position {x,y,z} inside space A''s scan (a_space_id). Null = unplaced.';
comment on column public.vessel_space_links.b_pos is
  'Doorway position {x,y,z} inside space B''s scan (b_space_id). Null = unplaced.';

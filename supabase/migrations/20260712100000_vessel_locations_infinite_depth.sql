-- Physical locations go infinitely deep.
--
-- vessel_locations already nests via parent_id; only the level CHECK
-- (deck/zone/space) capped the tree at three tiers. Lift that cap so a
-- location can sit under any other location to any depth — the vessel map's
-- pins (room > cupboard > shelf > …) and hand-typed locations in Location
-- Management share ONE physical-location tree. `level` stays as a freeform
-- label for display/back-compat; depth is defined by the parent_id chain,
-- not the enum.
--
-- Non-destructive: existing deck/zone/space rows are untouched; this only
-- removes the constraint that rejected deeper/other level values.

alter table public.vessel_locations
  drop constraint if exists vessel_locations_level_check;

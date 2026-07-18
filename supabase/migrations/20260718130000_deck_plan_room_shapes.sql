-- Deck-plan room outlines (tracing). A space can carry a traced shape — a
-- polygon or a Bézier curve — on its deck's plan crop, so rooms are marked by
-- their true footprint, not just a point. plan_x/plan_y stays as the fallback
-- point and label anchor.
--
-- Shape is normalized 0..1 to the deck crop (same coordinate space as
-- plan_x/plan_y):
--   { "closed": true,
--     "nodes": [ { "x":0.12,"y":0.34 },
--                { "x":0.5,"y":0.2, "h1":{"x":..,"y":..}, "h2":{"x":..,"y":..} } ] }
-- h1/h2 are optional cubic-Bézier handles per node (incoming / outgoing);
-- absent = straight segment. One format covers polygons and smooth curves.

ALTER TABLE public.vessel_locations
  ADD COLUMN IF NOT EXISTS plan_shape jsonb;

COMMENT ON COLUMN public.vessel_locations.plan_shape IS
  'Traced room outline on the deck plan (normalized 0..1 to the deck crop): { closed, nodes:[{x,y,h1?,h2?}] }. h1/h2 optional cubic-Bézier handles.';

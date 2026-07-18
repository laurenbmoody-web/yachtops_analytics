-- Deck-plan room category — a zoning tag so rooms can be coloured on the plan by
-- what they are (guest / crew / technical / service / owner / exterior / …). The
-- app auto-assigns one from the room name and lets the crew override it; this
-- column stores the override (null = fall back to the name-based default).

ALTER TABLE public.vessel_locations
  ADD COLUMN IF NOT EXISTS plan_category text;

COMMENT ON COLUMN public.vessel_locations.plan_category IS
  'Deck-plan zoning category for colour-coding (guest, crew, technical, service, owner, exterior, bridge, other). Null = use the name-based default.';

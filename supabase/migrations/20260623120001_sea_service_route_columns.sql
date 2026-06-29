-- Sea service: route / master-of-record enrichment
-- ---------------------------------------------------------------------------
-- The sign-off route (verified-in-Cargo "stamp" / digital "virtual" / external
-- testimonial) and the change-of-command split need three facts the per-day
-- entry didn't carry: whether the vessel keeps its records in Cargo, who the
-- master of record was for that day, and whether that master is still aboard /
-- still has a Cargo account. These are additive, nullable columns — existing
-- rows are unaffected and keep falling through to the external route.
ALTER TABLE public.sea_service_entries
  ADD COLUMN IF NOT EXISTS vessel_cargo_registered boolean,
  ADD COLUMN IF NOT EXISTS master_name             text,
  ADD COLUMN IF NOT EXISTS master_aboard           boolean,  -- master still aboard this vessel
  ADD COLUMN IF NOT EXISTS master_on_cargo         boolean;  -- master still has a Cargo account

COMMENT ON COLUMN public.sea_service_entries.vessel_cargo_registered IS 'Vessel keeps its records in Cargo (drives stamp/virtual vs external testimonial).';
COMMENT ON COLUMN public.sea_service_entries.master_name IS 'Master of record for this service day (command spells split on this).';
COMMENT ON COLUMN public.sea_service_entries.master_aboard IS 'Master of record is still aboard this vessel (→ verified in Cargo).';
COMMENT ON COLUMN public.sea_service_entries.master_on_cargo IS 'Master of record still has an active Cargo account (→ signs digitally vs by email).';

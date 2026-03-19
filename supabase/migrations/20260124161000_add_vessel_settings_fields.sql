-- Migration: Add vessel settings fields to tenants table
-- Purpose: Support expanded vessel configuration including sea time requirements

-- Add vessel identity fields
ALTER TABLE public.tenants
  ADD COLUMN IF NOT EXISTS flag text,
  ADD COLUMN IF NOT EXISTS port_of_registry text,
  ADD COLUMN IF NOT EXISTS imo_number text,
  ADD COLUMN IF NOT EXISTS official_number text,
  ADD COLUMN IF NOT EXISTS loa_m numeric,
  ADD COLUMN IF NOT EXISTS gt numeric,
  ADD COLUMN IF NOT EXISTS year_built int,
  ADD COLUMN IF NOT EXISTS year_refit int;

-- Add operational profile fields
ALTER TABLE public.tenants
  ADD COLUMN IF NOT EXISTS commercial_status text,
  ADD COLUMN IF NOT EXISTS certified_commercial boolean DEFAULT false,
  ADD COLUMN IF NOT EXISTS area_of_operation text,
  ADD COLUMN IF NOT EXISTS operating_regions text,
  ADD COLUMN IF NOT EXISTS seasonal_pattern text,
  ADD COLUMN IF NOT EXISTS typical_guest_count int,
  ADD COLUMN IF NOT EXISTS typical_crew_count int;

-- Add compliance fields
ALTER TABLE public.tenants
  ADD COLUMN IF NOT EXISTS ism_applicable boolean DEFAULT false,
  ADD COLUMN IF NOT EXISTS isps_applicable boolean DEFAULT false;

-- Add cargo configuration fields
ALTER TABLE public.tenants
  ADD COLUMN IF NOT EXISTS departments_in_use text,
  ADD COLUMN IF NOT EXISTS bonded_stores_enabled boolean DEFAULT false,
  ADD COLUMN IF NOT EXISTS multi_location_storage boolean DEFAULT false;

-- Add comments for documentation
COMMENT ON COLUMN public.tenants.flag IS 'Vessel flag state';
COMMENT ON COLUMN public.tenants.port_of_registry IS 'Port of registry';
COMMENT ON COLUMN public.tenants.imo_number IS 'IMO number (can be N/A)';
COMMENT ON COLUMN public.tenants.official_number IS 'Official number / SSR (can be N/A)';
COMMENT ON COLUMN public.tenants.loa_m IS 'Length overall in metres';
COMMENT ON COLUMN public.tenants.gt IS 'Gross tonnage';
COMMENT ON COLUMN public.tenants.year_built IS 'Year vessel was built';
COMMENT ON COLUMN public.tenants.year_refit IS 'Year of last major refit';
COMMENT ON COLUMN public.tenants.commercial_status IS 'Private / Commercial / Charter / Dual';
COMMENT ON COLUMN public.tenants.certified_commercial IS 'Whether vessel is certified for commercial operation';
COMMENT ON COLUMN public.tenants.area_of_operation IS 'Coastal / Near Coastal / Unlimited';
COMMENT ON COLUMN public.tenants.operating_regions IS 'Geographic regions of operation (multi-select)';
COMMENT ON COLUMN public.tenants.seasonal_pattern IS 'Seasonal operating pattern';
COMMENT ON COLUMN public.tenants.typical_guest_count IS 'Typical number of guests';
COMMENT ON COLUMN public.tenants.typical_crew_count IS 'Typical crew complement';
COMMENT ON COLUMN public.tenants.ism_applicable IS 'Whether ISM code applies';
COMMENT ON COLUMN public.tenants.isps_applicable IS 'Whether ISPS code applies';
COMMENT ON COLUMN public.tenants.departments_in_use IS 'Departments in use (array stored as text)';
COMMENT ON COLUMN public.tenants.bonded_stores_enabled IS 'Whether bonded stores are in use';
COMMENT ON COLUMN public.tenants.multi_location_storage IS 'Whether multi-location storage is enabled';
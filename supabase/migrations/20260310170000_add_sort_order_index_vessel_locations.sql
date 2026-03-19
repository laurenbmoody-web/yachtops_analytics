-- Ensure sort_order is indexed for efficient ordering queries on vessel_locations
-- sort_order column already exists from the initial migration; this adds a composite index
-- for faster ordered queries per tenant/level/parent

CREATE INDEX IF NOT EXISTS idx_vessel_locations_sort_order
  ON public.vessel_locations(tenant_id, level, parent_id, sort_order);

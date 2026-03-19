-- Migration: Create inventory_items table for Supabase-backed inventory
-- Replaces localStorage cargo_inventory_items

CREATE TABLE IF NOT EXISTS public.inventory_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  created_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  updated_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,

  -- 4-level taxonomy IDs (ID-based, rename-safe)
  l1_id TEXT,
  l2_id TEXT,
  l3_id TEXT,
  l4_id TEXT,

  -- 4-level taxonomy display names (denormalized for fast display)
  l1_name TEXT,
  l2_name TEXT,
  l3_name TEXT,
  l4_name TEXT,

  -- Core item fields
  name TEXT NOT NULL DEFAULT '',
  unit TEXT DEFAULT 'each',
  usage_department TEXT DEFAULT 'INTERIOR',

  -- Stock locations (JSONB array: [{locationId, locationName, qty}])
  stock_locations JSONB DEFAULT '[]'::jsonb,
  total_qty NUMERIC DEFAULT 0,

  -- Par / restock
  par_level NUMERIC,
  reorder_point NUMERIC,
  restock_enabled BOOLEAN DEFAULT false,
  restock_level NUMERIC,

  -- Cost / value
  unit_cost NUMERIC,
  currency TEXT DEFAULT 'USD',
  value_method TEXT DEFAULT 'unknown',

  -- Metadata
  notes TEXT,
  supplier TEXT,
  purchase_price NUMERIC,
  purchase_date TEXT,
  condition TEXT,
  image_url TEXT,

  -- Variants
  has_variants BOOLEAN DEFAULT false,
  variant_type TEXT,
  variants JSONB DEFAULT '[]'::jsonb,

  -- Additional locations (legacy support)
  additional_locations JSONB DEFAULT '[]'::jsonb,

  -- Timestamps
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_inventory_items_tenant_id ON public.inventory_items(tenant_id);
CREATE INDEX IF NOT EXISTS idx_inventory_items_l1_id ON public.inventory_items(l1_id);
CREATE INDEX IF NOT EXISTS idx_inventory_items_l2_id ON public.inventory_items(l2_id);
CREATE INDEX IF NOT EXISTS idx_inventory_items_l3_id ON public.inventory_items(l3_id);
CREATE INDEX IF NOT EXISTS idx_inventory_items_l4_id ON public.inventory_items(l4_id);
CREATE INDEX IF NOT EXISTS idx_inventory_items_tenant_l1 ON public.inventory_items(tenant_id, l1_id);

-- Enable RLS
ALTER TABLE public.inventory_items ENABLE ROW LEVEL SECURITY;

-- RLS: Tenant members can read all inventory items for their tenant
DROP POLICY IF EXISTS "inventory_items_select" ON public.inventory_items;
CREATE POLICY "inventory_items_select"
  ON public.inventory_items
  FOR SELECT
  TO authenticated
  USING (
    tenant_id IN (
      SELECT tm.tenant_id FROM public.tenant_members tm
      WHERE tm.user_id = auth.uid() AND tm.active = true
    )
  );

-- RLS: Tenant members can insert inventory items for their tenant
DROP POLICY IF EXISTS "inventory_items_insert" ON public.inventory_items;
CREATE POLICY "inventory_items_insert"
  ON public.inventory_items
  FOR INSERT
  TO authenticated
  WITH CHECK (
    tenant_id IN (
      SELECT tm.tenant_id FROM public.tenant_members tm
      WHERE tm.user_id = auth.uid() AND tm.active = true
    )
  );

-- RLS: Tenant members can update inventory items for their tenant
DROP POLICY IF EXISTS "inventory_items_update" ON public.inventory_items;
CREATE POLICY "inventory_items_update"
  ON public.inventory_items
  FOR UPDATE
  TO authenticated
  USING (
    tenant_id IN (
      SELECT tm.tenant_id FROM public.tenant_members tm
      WHERE tm.user_id = auth.uid() AND tm.active = true
    )
  )
  WITH CHECK (
    tenant_id IN (
      SELECT tm.tenant_id FROM public.tenant_members tm
      WHERE tm.user_id = auth.uid() AND tm.active = true
    )
  );

-- RLS: Tenant members can delete inventory items for their tenant
DROP POLICY IF EXISTS "inventory_items_delete" ON public.inventory_items;
CREATE POLICY "inventory_items_delete"
  ON public.inventory_items
  FOR DELETE
  TO authenticated
  USING (
    tenant_id IN (
      SELECT tm.tenant_id FROM public.tenant_members tm
      WHERE tm.user_id = auth.uid() AND tm.active = true
    )
  );

-- Migration: Create provisioning module tables
-- Tables: provisioning_lists, provisioning_items, provisioning_suppliers, provisioning_deliveries
--
-- RLS pattern: vessel-scoped, resolved via vessels.tenant_id → tenant_members.
-- Uses existing is_active_tenant_member() SECURITY DEFINER function to avoid
-- RLS recursion (established in 20260207150715).
-- DELETE requires permission_tier = 'COMMAND' (pattern from 20260319120000).
-- updated_at trigger follows handle_<table>_updated_at naming convention
-- (established in 20260217174900 — no shared trigger function exists).

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. provisioning_lists
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.provisioning_lists (
  id               uuid          DEFAULT uuid_generate_v4() PRIMARY KEY,
  vessel_id        uuid          NOT NULL REFERENCES public.vessels(id) ON DELETE CASCADE,
  trip_id          uuid          REFERENCES public.trips(id) ON DELETE SET NULL,
  title            text          NOT NULL,
  status           text          NOT NULL DEFAULT 'draft'
                                 CHECK (status IN (
                                   'draft',
                                   'pending_approval',
                                   'sent_to_supplier',
                                   'partially_delivered',
                                   'delivered_with_discrepancies',
                                   'delivered'
                                 )),
  department       text[]        NOT NULL DEFAULT '{}',
  created_by       uuid          REFERENCES auth.users(id),
  created_at       timestamptz   DEFAULT now(),
  updated_at       timestamptz   DEFAULT now(),
  notes            text,
  supplier_id      uuid,
  estimated_cost   numeric(10,2),
  actual_cost      numeric(10,2),
  port_location    text
);

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. provisioning_items
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.provisioning_items (
  id                   uuid          DEFAULT uuid_generate_v4() PRIMARY KEY,
  list_id              uuid          NOT NULL REFERENCES public.provisioning_lists(id) ON DELETE CASCADE,
  name                 text          NOT NULL,
  category             text,
  department           text,
  quantity_ordered     numeric(10,2) NOT NULL DEFAULT 0,
  quantity_received    numeric(10,2) DEFAULT 0,
  unit                 text,
  estimated_unit_cost  numeric(10,2),
  allergen_flags       text[]        DEFAULT '{}',
  source               text          CHECK (source IN (
                                       'manual',
                                       'guest_preference',
                                       'low_stock',
                                       'invoice_pattern',
                                       'smart_suggestion',
                                       'location_aware'
                                     )),
  notes                text,
  status               text          NOT NULL DEFAULT 'pending'
                                     CHECK (status IN (
                                       'pending',
                                       'received',
                                       'short_delivered',
                                       'not_delivered'
                                     )),
  created_at           timestamptz   DEFAULT now()
);

-- ─────────────────────────────────────────────────────────────────────────────
-- 3. provisioning_suppliers
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.provisioning_suppliers (
  id            uuid          DEFAULT uuid_generate_v4() PRIMARY KEY,
  vessel_id     uuid          NOT NULL REFERENCES public.vessels(id) ON DELETE CASCADE,
  name          text          NOT NULL,
  email         text,
  phone         text,
  port_location text,
  department    text[]        DEFAULT '{}',
  notes         text,
  created_at    timestamptz   DEFAULT now()
);

-- ─────────────────────────────────────────────────────────────────────────────
-- 4. provisioning_deliveries
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.provisioning_deliveries (
  id                 uuid          DEFAULT uuid_generate_v4() PRIMARY KEY,
  list_id            uuid          NOT NULL REFERENCES public.provisioning_lists(id) ON DELETE CASCADE,
  delivered_at       timestamptz   DEFAULT now(),
  delivery_note_url  text,
  delivery_note_type text          CHECK (delivery_note_type IN ('pdf', 'image', 'csv', 'email')),
  parsed_data        jsonb,
  discrepancies      jsonb,
  received_by        uuid          REFERENCES auth.users(id),
  created_at         timestamptz   DEFAULT now()
);

-- ─────────────────────────────────────────────────────────────────────────────
-- Indexes
-- ─────────────────────────────────────────────────────────────────────────────

CREATE INDEX IF NOT EXISTS idx_provisioning_lists_vessel_id
  ON public.provisioning_lists(vessel_id);

CREATE INDEX IF NOT EXISTS idx_provisioning_lists_trip_id
  ON public.provisioning_lists(trip_id);

CREATE INDEX IF NOT EXISTS idx_provisioning_lists_status
  ON public.provisioning_lists(status);

CREATE INDEX IF NOT EXISTS idx_provisioning_items_list_id
  ON public.provisioning_items(list_id);

CREATE INDEX IF NOT EXISTS idx_provisioning_items_status
  ON public.provisioning_items(status);

CREATE INDEX IF NOT EXISTS idx_provisioning_suppliers_vessel_id
  ON public.provisioning_suppliers(vessel_id);

CREATE INDEX IF NOT EXISTS idx_provisioning_deliveries_list_id
  ON public.provisioning_deliveries(list_id);

-- ─────────────────────────────────────────────────────────────────────────────
-- updated_at trigger on provisioning_lists
-- No shared trigger function exists in this codebase — each table gets its own.
-- ─────────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.handle_provisioning_lists_updated_at()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS set_provisioning_lists_updated_at ON public.provisioning_lists;

CREATE TRIGGER set_provisioning_lists_updated_at
  BEFORE UPDATE ON public.provisioning_lists
  FOR EACH ROW
  EXECUTE FUNCTION public.handle_provisioning_lists_updated_at();

-- ─────────────────────────────────────────────────────────────────────────────
-- Enable RLS
-- ─────────────────────────────────────────────────────────────────────────────

ALTER TABLE public.provisioning_lists      ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.provisioning_items      ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.provisioning_suppliers  ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.provisioning_deliveries ENABLE ROW LEVEL SECURITY;

-- ─────────────────────────────────────────────────────────────────────────────
-- RLS: provisioning_lists
-- Vessel access resolved via vessels.tenant_id → is_active_tenant_member()
-- ─────────────────────────────────────────────────────────────────────────────

DROP POLICY IF EXISTS "provisioning_lists_select" ON public.provisioning_lists;
CREATE POLICY "provisioning_lists_select"
  ON public.provisioning_lists FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.vessels v
      WHERE v.id = provisioning_lists.vessel_id
        AND public.is_active_tenant_member(v.tenant_id, auth.uid())
    )
  );

DROP POLICY IF EXISTS "provisioning_lists_insert" ON public.provisioning_lists;
CREATE POLICY "provisioning_lists_insert"
  ON public.provisioning_lists FOR INSERT TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.vessels v
      WHERE v.id = provisioning_lists.vessel_id
        AND public.is_active_tenant_member(v.tenant_id, auth.uid())
    )
  );

DROP POLICY IF EXISTS "provisioning_lists_update" ON public.provisioning_lists;
CREATE POLICY "provisioning_lists_update"
  ON public.provisioning_lists FOR UPDATE TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.vessels v
      WHERE v.id = provisioning_lists.vessel_id
        AND public.is_active_tenant_member(v.tenant_id, auth.uid())
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.vessels v
      WHERE v.id = provisioning_lists.vessel_id
        AND public.is_active_tenant_member(v.tenant_id, auth.uid())
    )
  );

-- DELETE: COMMAND permission tier only
DROP POLICY IF EXISTS "provisioning_lists_delete" ON public.provisioning_lists;
CREATE POLICY "provisioning_lists_delete"
  ON public.provisioning_lists FOR DELETE TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM public.vessels v
      JOIN public.tenant_members tm ON tm.tenant_id = v.tenant_id
      WHERE v.id               = provisioning_lists.vessel_id
        AND tm.user_id         = auth.uid()
        AND tm.active IS NOT FALSE
        AND tm.permission_tier = 'COMMAND'
    )
  );

-- ─────────────────────────────────────────────────────────────────────────────
-- RLS: provisioning_items
-- No direct vessel_id — resolved via list_id → provisioning_lists → vessels
-- ─────────────────────────────────────────────────────────────────────────────

DROP POLICY IF EXISTS "provisioning_items_select" ON public.provisioning_items;
CREATE POLICY "provisioning_items_select"
  ON public.provisioning_items FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM public.provisioning_lists pl
      JOIN public.vessels v ON v.id = pl.vessel_id
      WHERE pl.id = provisioning_items.list_id
        AND public.is_active_tenant_member(v.tenant_id, auth.uid())
    )
  );

DROP POLICY IF EXISTS "provisioning_items_insert" ON public.provisioning_items;
CREATE POLICY "provisioning_items_insert"
  ON public.provisioning_items FOR INSERT TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1
      FROM public.provisioning_lists pl
      JOIN public.vessels v ON v.id = pl.vessel_id
      WHERE pl.id = provisioning_items.list_id
        AND public.is_active_tenant_member(v.tenant_id, auth.uid())
    )
  );

DROP POLICY IF EXISTS "provisioning_items_update" ON public.provisioning_items;
CREATE POLICY "provisioning_items_update"
  ON public.provisioning_items FOR UPDATE TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM public.provisioning_lists pl
      JOIN public.vessels v ON v.id = pl.vessel_id
      WHERE pl.id = provisioning_items.list_id
        AND public.is_active_tenant_member(v.tenant_id, auth.uid())
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1
      FROM public.provisioning_lists pl
      JOIN public.vessels v ON v.id = pl.vessel_id
      WHERE pl.id = provisioning_items.list_id
        AND public.is_active_tenant_member(v.tenant_id, auth.uid())
    )
  );

-- DELETE: COMMAND only
DROP POLICY IF EXISTS "provisioning_items_delete" ON public.provisioning_items;
CREATE POLICY "provisioning_items_delete"
  ON public.provisioning_items FOR DELETE TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM public.provisioning_lists pl
      JOIN public.vessels v ON v.id = pl.vessel_id
      JOIN public.tenant_members tm ON tm.tenant_id = v.tenant_id
      WHERE pl.id              = provisioning_items.list_id
        AND tm.user_id         = auth.uid()
        AND tm.active IS NOT FALSE
        AND tm.permission_tier = 'COMMAND'
    )
  );

-- ─────────────────────────────────────────────────────────────────────────────
-- RLS: provisioning_suppliers
-- Direct vessel_id column — same pattern as provisioning_lists
-- ─────────────────────────────────────────────────────────────────────────────

DROP POLICY IF EXISTS "provisioning_suppliers_select" ON public.provisioning_suppliers;
CREATE POLICY "provisioning_suppliers_select"
  ON public.provisioning_suppliers FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.vessels v
      WHERE v.id = provisioning_suppliers.vessel_id
        AND public.is_active_tenant_member(v.tenant_id, auth.uid())
    )
  );

DROP POLICY IF EXISTS "provisioning_suppliers_insert" ON public.provisioning_suppliers;
CREATE POLICY "provisioning_suppliers_insert"
  ON public.provisioning_suppliers FOR INSERT TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.vessels v
      WHERE v.id = provisioning_suppliers.vessel_id
        AND public.is_active_tenant_member(v.tenant_id, auth.uid())
    )
  );

DROP POLICY IF EXISTS "provisioning_suppliers_update" ON public.provisioning_suppliers;
CREATE POLICY "provisioning_suppliers_update"
  ON public.provisioning_suppliers FOR UPDATE TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.vessels v
      WHERE v.id = provisioning_suppliers.vessel_id
        AND public.is_active_tenant_member(v.tenant_id, auth.uid())
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.vessels v
      WHERE v.id = provisioning_suppliers.vessel_id
        AND public.is_active_tenant_member(v.tenant_id, auth.uid())
    )
  );

-- DELETE: COMMAND only
DROP POLICY IF EXISTS "provisioning_suppliers_delete" ON public.provisioning_suppliers;
CREATE POLICY "provisioning_suppliers_delete"
  ON public.provisioning_suppliers FOR DELETE TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM public.vessels v
      JOIN public.tenant_members tm ON tm.tenant_id = v.tenant_id
      WHERE v.id               = provisioning_suppliers.vessel_id
        AND tm.user_id         = auth.uid()
        AND tm.active IS NOT FALSE
        AND tm.permission_tier = 'COMMAND'
    )
  );

-- ─────────────────────────────────────────────────────────────────────────────
-- RLS: provisioning_deliveries
-- No direct vessel_id — resolved via list_id → provisioning_lists → vessels
-- ─────────────────────────────────────────────────────────────────────────────

DROP POLICY IF EXISTS "provisioning_deliveries_select" ON public.provisioning_deliveries;
CREATE POLICY "provisioning_deliveries_select"
  ON public.provisioning_deliveries FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM public.provisioning_lists pl
      JOIN public.vessels v ON v.id = pl.vessel_id
      WHERE pl.id = provisioning_deliveries.list_id
        AND public.is_active_tenant_member(v.tenant_id, auth.uid())
    )
  );

DROP POLICY IF EXISTS "provisioning_deliveries_insert" ON public.provisioning_deliveries;
CREATE POLICY "provisioning_deliveries_insert"
  ON public.provisioning_deliveries FOR INSERT TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1
      FROM public.provisioning_lists pl
      JOIN public.vessels v ON v.id = pl.vessel_id
      WHERE pl.id = provisioning_deliveries.list_id
        AND public.is_active_tenant_member(v.tenant_id, auth.uid())
    )
  );

DROP POLICY IF EXISTS "provisioning_deliveries_update" ON public.provisioning_deliveries;
CREATE POLICY "provisioning_deliveries_update"
  ON public.provisioning_deliveries FOR UPDATE TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM public.provisioning_lists pl
      JOIN public.vessels v ON v.id = pl.vessel_id
      WHERE pl.id = provisioning_deliveries.list_id
        AND public.is_active_tenant_member(v.tenant_id, auth.uid())
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1
      FROM public.provisioning_lists pl
      JOIN public.vessels v ON v.id = pl.vessel_id
      WHERE pl.id = provisioning_deliveries.list_id
        AND public.is_active_tenant_member(v.tenant_id, auth.uid())
    )
  );

-- DELETE: COMMAND only
DROP POLICY IF EXISTS "provisioning_deliveries_delete" ON public.provisioning_deliveries;
CREATE POLICY "provisioning_deliveries_delete"
  ON public.provisioning_deliveries FOR DELETE TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM public.provisioning_lists pl
      JOIN public.vessels v ON v.id = pl.vessel_id
      JOIN public.tenant_members tm ON tm.tenant_id = v.tenant_id
      WHERE pl.id              = provisioning_deliveries.list_id
        AND tm.user_id         = auth.uid()
        AND tm.active IS NOT FALSE
        AND tm.permission_tier = 'COMMAND'
    )
  );

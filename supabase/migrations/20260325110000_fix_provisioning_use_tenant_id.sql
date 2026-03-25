-- Migration: Fix provisioning tables to use tenant_id (not vessel_id)
--
-- The original migration (20260325100000) used vessel_id referencing vessels(id),
-- which does not match the codebase convention. Every other table in this codebase
-- (inventory_items, guests, guest_preferences, tenant_members, etc.) uses tenant_id
-- directly. This migration drops and recreates the four provisioning tables with
-- tenant_id as the isolation column so the frontend can query the same way as
-- every other module.
--
-- trip_id is kept as a plain uuid (no FK) — the trips table does not exist in
-- Supabase yet (trips are currently stored in localStorage). The FK can be added
-- once trips are migrated to Supabase.
--
-- RLS pattern: is_active_tenant_member(tenant_id, auth.uid()) SECURITY DEFINER
-- function (established in 20260207150715) to avoid recursion.
-- DELETE restricted to COMMAND permission_tier (pattern from 20260319120000).

-- ─── Drop old tables (original migration may have partially applied) ─────────

DROP TABLE IF EXISTS public.provisioning_deliveries CASCADE;
DROP TABLE IF EXISTS public.provisioning_items CASCADE;
DROP TABLE IF EXISTS public.provisioning_suppliers CASCADE;
DROP TABLE IF EXISTS public.provisioning_lists CASCADE;

DROP TRIGGER IF EXISTS set_provisioning_lists_updated_at ON public.provisioning_lists;
DROP FUNCTION IF EXISTS public.handle_provisioning_lists_updated_at();

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. provisioning_lists
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE public.provisioning_lists (
  id               uuid          DEFAULT uuid_generate_v4() PRIMARY KEY,
  tenant_id        uuid          NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  trip_id          uuid,
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

CREATE TABLE public.provisioning_items (
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

CREATE TABLE public.provisioning_suppliers (
  id            uuid          DEFAULT uuid_generate_v4() PRIMARY KEY,
  tenant_id     uuid          NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
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

CREATE TABLE public.provisioning_deliveries (
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

CREATE INDEX idx_provisioning_lists_tenant_id   ON public.provisioning_lists(tenant_id);
CREATE INDEX idx_provisioning_lists_trip_id     ON public.provisioning_lists(trip_id);
CREATE INDEX idx_provisioning_lists_status      ON public.provisioning_lists(status);
CREATE INDEX idx_provisioning_items_list_id     ON public.provisioning_items(list_id);
CREATE INDEX idx_provisioning_items_status      ON public.provisioning_items(status);
CREATE INDEX idx_provisioning_suppliers_tenant_id ON public.provisioning_suppliers(tenant_id);
CREATE INDEX idx_provisioning_deliveries_list_id ON public.provisioning_deliveries(list_id);

-- ─────────────────────────────────────────────────────────────────────────────
-- updated_at trigger on provisioning_lists
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
-- ─────────────────────────────────────────────────────────────────────────────

CREATE POLICY "provisioning_lists_select"
  ON public.provisioning_lists FOR SELECT TO authenticated
  USING (public.is_active_tenant_member(tenant_id, auth.uid()));

CREATE POLICY "provisioning_lists_insert"
  ON public.provisioning_lists FOR INSERT TO authenticated
  WITH CHECK (public.is_active_tenant_member(tenant_id, auth.uid()));

CREATE POLICY "provisioning_lists_update"
  ON public.provisioning_lists FOR UPDATE TO authenticated
  USING (public.is_active_tenant_member(tenant_id, auth.uid()))
  WITH CHECK (public.is_active_tenant_member(tenant_id, auth.uid()));

CREATE POLICY "provisioning_lists_delete"
  ON public.provisioning_lists FOR DELETE TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.tenant_members tm
      WHERE tm.tenant_id      = provisioning_lists.tenant_id
        AND tm.user_id        = auth.uid()
        AND tm.active IS NOT FALSE
        AND tm.permission_tier = 'COMMAND'
    )
  );

-- ─────────────────────────────────────────────────────────────────────────────
-- RLS: provisioning_items (resolves tenant via list → provisioning_lists)
-- ─────────────────────────────────────────────────────────────────────────────

CREATE POLICY "provisioning_items_select"
  ON public.provisioning_items FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.provisioning_lists pl
      WHERE pl.id = provisioning_items.list_id
        AND public.is_active_tenant_member(pl.tenant_id, auth.uid())
    )
  );

CREATE POLICY "provisioning_items_insert"
  ON public.provisioning_items FOR INSERT TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.provisioning_lists pl
      WHERE pl.id = provisioning_items.list_id
        AND public.is_active_tenant_member(pl.tenant_id, auth.uid())
    )
  );

CREATE POLICY "provisioning_items_update"
  ON public.provisioning_items FOR UPDATE TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.provisioning_lists pl
      WHERE pl.id = provisioning_items.list_id
        AND public.is_active_tenant_member(pl.tenant_id, auth.uid())
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.provisioning_lists pl
      WHERE pl.id = provisioning_items.list_id
        AND public.is_active_tenant_member(pl.tenant_id, auth.uid())
    )
  );

CREATE POLICY "provisioning_items_delete"
  ON public.provisioning_items FOR DELETE TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM public.provisioning_lists pl
      JOIN public.tenant_members tm ON tm.tenant_id = pl.tenant_id
      WHERE pl.id              = provisioning_items.list_id
        AND tm.user_id         = auth.uid()
        AND tm.active IS NOT FALSE
        AND tm.permission_tier = 'COMMAND'
    )
  );

-- ─────────────────────────────────────────────────────────────────────────────
-- RLS: provisioning_suppliers
-- ─────────────────────────────────────────────────────────────────────────────

CREATE POLICY "provisioning_suppliers_select"
  ON public.provisioning_suppliers FOR SELECT TO authenticated
  USING (public.is_active_tenant_member(tenant_id, auth.uid()));

CREATE POLICY "provisioning_suppliers_insert"
  ON public.provisioning_suppliers FOR INSERT TO authenticated
  WITH CHECK (public.is_active_tenant_member(tenant_id, auth.uid()));

CREATE POLICY "provisioning_suppliers_update"
  ON public.provisioning_suppliers FOR UPDATE TO authenticated
  USING (public.is_active_tenant_member(tenant_id, auth.uid()))
  WITH CHECK (public.is_active_tenant_member(tenant_id, auth.uid()));

CREATE POLICY "provisioning_suppliers_delete"
  ON public.provisioning_suppliers FOR DELETE TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.tenant_members tm
      WHERE tm.tenant_id      = provisioning_suppliers.tenant_id
        AND tm.user_id        = auth.uid()
        AND tm.active IS NOT FALSE
        AND tm.permission_tier = 'COMMAND'
    )
  );

-- ─────────────────────────────────────────────────────────────────────────────
-- RLS: provisioning_deliveries (resolves tenant via list → provisioning_lists)
-- ─────────────────────────────────────────────────────────────────────────────

CREATE POLICY "provisioning_deliveries_select"
  ON public.provisioning_deliveries FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.provisioning_lists pl
      WHERE pl.id = provisioning_deliveries.list_id
        AND public.is_active_tenant_member(pl.tenant_id, auth.uid())
    )
  );

CREATE POLICY "provisioning_deliveries_insert"
  ON public.provisioning_deliveries FOR INSERT TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.provisioning_lists pl
      WHERE pl.id = provisioning_deliveries.list_id
        AND public.is_active_tenant_member(pl.tenant_id, auth.uid())
    )
  );

CREATE POLICY "provisioning_deliveries_update"
  ON public.provisioning_deliveries FOR UPDATE TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.provisioning_lists pl
      WHERE pl.id = provisioning_deliveries.list_id
        AND public.is_active_tenant_member(pl.tenant_id, auth.uid())
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.provisioning_lists pl
      WHERE pl.id = provisioning_deliveries.list_id
        AND public.is_active_tenant_member(pl.tenant_id, auth.uid())
    )
  );

CREATE POLICY "provisioning_deliveries_delete"
  ON public.provisioning_deliveries FOR DELETE TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM public.provisioning_lists pl
      JOIN public.tenant_members tm ON tm.tenant_id = pl.tenant_id
      WHERE pl.id              = provisioning_deliveries.list_id
        AND tm.user_id         = auth.uid()
        AND tm.active IS NOT FALSE
        AND tm.permission_tier = 'COMMAND'
    )
  );

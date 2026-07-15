-- Per-item activity log for laundry: who actioned an item and when.
-- Rows are appended on create / status change / edit. Idempotent.

CREATE TABLE IF NOT EXISTS public.laundry_item_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  item_id uuid NOT NULL REFERENCES public.laundry_items(id) ON DELETE CASCADE,
  action text NOT NULL,            -- created | ready | delivered | reopened | edited
  actor_id uuid,
  actor_name text,
  at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.laundry_item_events ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS laundry_item_events_tenant ON public.laundry_item_events;
CREATE POLICY laundry_item_events_tenant ON public.laundry_item_events
  FOR ALL USING (public.is_tenant_member(tenant_id))
  WITH CHECK (public.is_tenant_member(tenant_id));

CREATE INDEX IF NOT EXISTS laundry_item_events_item_at ON public.laundry_item_events (item_id, at);
CREATE INDEX IF NOT EXISTS laundry_item_events_tenant_at ON public.laundry_item_events (tenant_id, at DESC);

-- Recoverable "trash" for deleted inventory folders. A deleted folder's rows
-- (its inventory_locations + inventory_items subtree) are snapshotted here and
-- physically removed from the live tables, so normal reads never see them.
-- Restore re-inserts the snapshot; records are purged after 30 days.
CREATE TABLE IF NOT EXISTS public.inventory_trash (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  deleted_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  deleted_at timestamptz NOT NULL DEFAULT now(),
  folder_name text NOT NULL,
  parent_segments jsonb NOT NULL DEFAULT '[]'::jsonb,
  folder_path text,
  item_count integer NOT NULL DEFAULT 0,
  folder_count integer NOT NULL DEFAULT 0,
  payload jsonb NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_inventory_trash_tenant_deleted
  ON public.inventory_trash (tenant_id, deleted_at DESC);

ALTER TABLE public.inventory_trash ENABLE ROW LEVEL SECURITY;

CREATE POLICY "inventory_trash_select"
  ON public.inventory_trash FOR SELECT TO authenticated
  USING (
    tenant_id IN (
      SELECT tm.tenant_id FROM public.tenant_members tm
      WHERE tm.user_id = auth.uid() AND tm.active = true
    )
  );

CREATE POLICY "inventory_trash_insert"
  ON public.inventory_trash FOR INSERT TO authenticated
  WITH CHECK (
    tenant_id IN (
      SELECT tm.tenant_id FROM public.tenant_members tm
      WHERE tm.user_id = auth.uid() AND tm.active = true
    )
  );

CREATE POLICY "inventory_trash_delete"
  ON public.inventory_trash FOR DELETE TO authenticated
  USING (
    tenant_id IN (
      SELECT tm.tenant_id FROM public.tenant_members tm
      WHERE tm.user_id = auth.uid() AND tm.active = true
    )
  );

-- Server-side safety net: purge trash older than 30 days.
CREATE OR REPLACE FUNCTION public.purge_old_inventory_trash()
RETURNS void LANGUAGE sql SECURITY DEFINER AS $$
  DELETE FROM public.inventory_trash WHERE deleted_at < now() - interval '30 days';
$$;

-- Schedule the daily purge (best-effort; ignored if pg_cron/permissions absent).
DO $$
BEGIN
  PERFORM cron.schedule('purge-inventory-trash', '17 3 * * *', 'select public.purge_old_inventory_trash();');
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'Could not schedule purge-inventory-trash: %', SQLERRM;
END $$;

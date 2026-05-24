-- ============================================================
-- route_return_to_portal — RPC for crew-side return routing
--
-- Part 2 of the Cargo-supplier return-routing sprint.
--
-- Single-transaction RPC that atomically:
--   1. LOCKS the originating delivery_inbox rows (FOR UPDATE) so
--      two concurrent route_return_to_portal calls on the same
--      rows serialize. This eliminates the race window between the
--      double-submit SELECT and the INSERT, and also prevents the
--      same return being routed-to-portal and slip-generated
--      simultaneously by two crew on different clients (realistic
--      on a satellite link where the first response is slow and
--      the crew click again or React re-fires).
--   2. Checks for an existing supplier_return_tasks row covering
--      the exact same set of source_delivery_inbox_ids (double-
--      submit guard — set-equality via mutual array containment,
--      order-insensitive).
--   3. If none → INSERTs the supplier_return_tasks row.
--   4. UPDATEs the delivery_inbox rows to status='archived',
--      archive_reason='routed_to_portal' so they exit the active
--      Returns stages. They're represented from now on by the
--      supplier_return_tasks card on both the supplier portal
--      and the crew Returns surfaces (Part 4 wires the latter).
--
-- Either everything commits or everything rolls back — no partial
-- state, no duplicate tasks, no orphaned archived rows.
--
-- SECURITY INVOKER: runs with the caller's permissions, so all
-- existing RLS regimes still gate every statement:
--   - INSERT supplier_return_tasks → crew_insert policy
--   - UPDATE delivery_inbox        → tenant_update policy
--   - SELECT supplier_return_tasks → crew_read   policy (guard)
--   - SELECT delivery_inbox        → tenant_read policy (lock)
--
-- Idempotent (CREATE OR REPLACE).
-- ============================================================

CREATE OR REPLACE FUNCTION public.route_return_to_portal(
  p_supplier_id uuid,
  p_tenant_id   uuid,
  p_inbox_ids   uuid[],
  p_items       jsonb,
  p_created_by  uuid
) RETURNS uuid
LANGUAGE plpgsql
SECURITY INVOKER
AS $$
DECLARE
  existing_task_id uuid;
  new_task_id      uuid;
BEGIN
  -- (1) Lock the originating delivery_inbox rows for the duration of
  -- this transaction. Two concurrent calls on the same inbox rows
  -- serialize on this lock — the second call will not begin its
  -- double-submit SELECT until the first call has committed (or
  -- rolled back), so the guard query below sees a consistent state.
  PERFORM 1 FROM public.delivery_inbox
  WHERE id = ANY(p_inbox_ids)
  FOR UPDATE;

  -- (2) Double-submit guard. If a task already exists covering
  -- exactly the same set of source_delivery_inbox_ids for this
  -- supplier+tenant, return its id instead of creating a duplicate.
  -- Set equality via mutual array containment is order-insensitive.
  SELECT id INTO existing_task_id
  FROM   public.supplier_return_tasks
  WHERE  supplier_id = p_supplier_id
    AND  tenant_id   = p_tenant_id
    AND  source_delivery_inbox_ids @> p_inbox_ids
    AND  source_delivery_inbox_ids <@ p_inbox_ids
  LIMIT  1;

  IF existing_task_id IS NOT NULL THEN
    RETURN existing_task_id;
  END IF;

  -- (3) Create the task. Crew-side INSERT policy on
  -- supplier_return_tasks requires tenant_id IN tenant_members of
  -- auth.uid() — the caller must satisfy this or the INSERT fails
  -- with RLS violation and the whole function rolls back.
  INSERT INTO public.supplier_return_tasks (
    supplier_id, tenant_id, source_delivery_inbox_ids,
    items, status, created_by
  ) VALUES (
    p_supplier_id, p_tenant_id, p_inbox_ids,
    p_items, 'sent', p_created_by
  )
  RETURNING id INTO new_task_id;

  -- (4) Archive the originating delivery_inbox rows. The redundant
  -- tenant_id check is defence-in-depth; the tenant_update RLS
  -- policy already gates this. Idempotent: re-running on already-
  -- archived rows just no-ops the SET.
  UPDATE public.delivery_inbox
  SET    status         = 'archived',
         archive_reason = 'routed_to_portal'
  WHERE  id = ANY(p_inbox_ids)
    AND  tenant_id = p_tenant_id;

  RETURN new_task_id;
END;
$$;

GRANT EXECUTE
  ON FUNCTION public.route_return_to_portal(uuid, uuid, uuid[], jsonb, uuid)
  TO authenticated;

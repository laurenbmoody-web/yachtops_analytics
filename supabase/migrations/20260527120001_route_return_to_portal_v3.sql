-- ============================================================
-- route_return_to_portal v3 — accepts optional p_order_id.
--
-- Third signature change. v1 (5-arg) shipped in 20260524120000.
-- v2 (6-arg) added p_slip_metadata in 20260526120000. v3 (7-arg)
-- adds p_order_id so the slip page's Cargo confirm dialog can
-- carry the crew's optional order selection into the new
-- supplier_return_tasks.order_id column.
--
-- ALL existing guards survive verbatim — only the column write
-- changes:
--   (0) Empty/null p_inbox_ids → RAISE EXCEPTION (defensive).
--   (1) FOR UPDATE lock on the originating delivery_inbox rows
--       so two concurrent calls on the same rows serialize.
--   (2) Set-equality double-submit guard via mutual array
--       containment (@> + <@) — if a task already exists with
--       the same source_delivery_inbox_ids for this supplier+
--       tenant, return its id and skip the rest.
--   (3) INSERT supplier_return_tasks with slip_metadata snapshot.
--   (4) UPDATE delivery_inbox rows to archived/routed_to_portal.
--   SECURITY INVOKER preserved — caller's RLS gates every
--   statement.
--   GRANT EXECUTE TO authenticated.
--
-- Drop the v2 6-arg signature explicitly so the function name has
-- exactly one callable shape. IF EXISTS makes that safe on a fresh
-- DB (no prior function exists).
-- ============================================================

DROP FUNCTION IF EXISTS public.route_return_to_portal(uuid, uuid, uuid[], jsonb, uuid, jsonb);

CREATE OR REPLACE FUNCTION public.route_return_to_portal(
  p_supplier_id   uuid,
  p_tenant_id     uuid,
  p_inbox_ids     uuid[],
  p_items         jsonb,
  p_created_by    uuid,
  p_slip_metadata jsonb,
  p_order_id      uuid
) RETURNS uuid
LANGUAGE plpgsql
SECURITY INVOKER
AS $$
DECLARE
  existing_task_id uuid;
  new_task_id      uuid;
BEGIN
  -- (0) Defensive guard. Empty inbox-id array would create an orphan
  -- task that archives nothing — silently bad. Fail loud on miscall.
  IF p_inbox_ids IS NULL OR cardinality(p_inbox_ids) = 0 THEN
    RAISE EXCEPTION 'route_return_to_portal: p_inbox_ids must not be empty';
  END IF;

  -- (1) Lock the originating delivery_inbox rows for the duration of
  -- this transaction so concurrent calls on the same inbox rows
  -- serialize between the double-submit SELECT and the INSERT.
  PERFORM 1 FROM public.delivery_inbox
  WHERE id = ANY(p_inbox_ids)
  FOR UPDATE;

  -- (2) Double-submit guard. Set-equality match on
  -- source_delivery_inbox_ids — if a task already exists covering
  -- exactly the same set for this supplier+tenant, return its id.
  --
  -- NOTE: the guard intentionally does NOT also key on order_id.
  -- A second call with a different order picked but the same inbox
  -- ids still represents the same return — we won't allow two
  -- distinct tasks for the same set of source rows. The first
  -- call's order pick wins; if the crew need to amend it, that's
  -- a future "edit return" surface, not a re-route.
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

  -- (3) Create the task with the slip metadata snapshot AND the
  -- optional order link. Crew-side INSERT policy on
  -- supplier_return_tasks requires tenant_id IN tenant_members of
  -- auth.uid().
  INSERT INTO public.supplier_return_tasks (
    supplier_id, tenant_id, source_delivery_inbox_ids,
    items, status, created_by, slip_metadata, order_id
  ) VALUES (
    p_supplier_id, p_tenant_id, p_inbox_ids,
    p_items, 'sent', p_created_by, p_slip_metadata, p_order_id
  )
  RETURNING id INTO new_task_id;

  -- (4) Archive the originating delivery_inbox rows. Redundant
  -- tenant_id check is defence-in-depth; RLS already gates this.
  UPDATE public.delivery_inbox
  SET    status         = 'archived',
         archive_reason = 'routed_to_portal'
  WHERE  id = ANY(p_inbox_ids)
    AND  tenant_id = p_tenant_id;

  RETURN new_task_id;
END;
$$;

GRANT EXECUTE
  ON FUNCTION public.route_return_to_portal(uuid, uuid, uuid[], jsonb, uuid, jsonb, uuid)
  TO authenticated;

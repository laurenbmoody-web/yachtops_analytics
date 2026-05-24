-- ============================================================
-- supplier_return_tasks.slip_metadata + route_return_to_portal v2
--
-- Part of the "one slip, branch at Send" sprint. The corrected
-- model: every return — Cargo supplier or not — goes through the
-- existing ReturnSlipPage with the same fields, reasons, and
-- vessel signature. Only the final Send action branches by whether
-- the supplier has a Cargo portal account. The Cargo path now has
-- to carry everything the email recipient sees (signature + the
-- attribution context) into supplier_return_tasks so the supplier
-- portal can render an equivalent signed-slip view.
--
-- (1) NEW COLUMN supplier_return_tasks.slip_metadata jsonb
--     A self-contained snapshot of the slip context at signing
--     time. Shape:
--       {
--         "vessel_name":       text,
--         "vessel_imo":        text | null,
--         "vessel_flag":       text | null,
--         "signer_name":       text,
--         "signer_job_title":  text | null,
--         "slip_date":         text,        -- pre-formatted display string
--         "vessel_signature":  text | null  -- base64 PNG data URL
--       }
--     A return is an audit artefact — it has to show what was true
--     when signed, frozen. Joining out to live vessels / roles /
--     profiles later lets attribution drift if anyone's job title
--     or vessel name changes. Snapshotting here preserves the
--     audit trail exactly as the email recipient would have seen
--     it.
--
-- (2) REPLACED FUNCTION route_return_to_portal(...)
--     Existing signature was (uuid, uuid, uuid[], jsonb, uuid).
--     New signature adds a p_slip_metadata jsonb parameter so the
--     slip page can write the snapshot atomically with the task
--     creation. All other behaviour preserved: same FOR UPDATE
--     lock, same double-submit guard, same archive of originating
--     delivery_inbox rows, same RLS-gated SECURITY INVOKER posture.
--     We DROP the old 5-arg signature explicitly so the function
--     name has exactly one callable shape and Postgres can't
--     resolve to a stale overload.
--
-- IDEMPOTENT: ADD COLUMN IF NOT EXISTS, DROP FUNCTION IF EXISTS,
-- CREATE OR REPLACE FUNCTION, GRANT EXECUTE (re-runnable).
-- ============================================================


-- ─── (1) slip_metadata column ───────────────────────────────
ALTER TABLE public.supplier_return_tasks
  ADD COLUMN IF NOT EXISTS slip_metadata jsonb;

COMMENT ON COLUMN public.supplier_return_tasks.slip_metadata IS
  'Snapshot of the slip context at signing time — vessel name, IMO, flag, signer name + job title, slip date, and the vessel signature (base64 PNG data URL). Frozen at creation so the supplier portal renders the return exactly as it was authorised, even if vessel / role / signer attributes later change.';


-- ─── (2) route_return_to_portal — replaced signature ────────
-- Drop the old 5-arg signature so the function name has exactly
-- one callable shape. IF EXISTS makes this safe on a fresh DB
-- (where no prior function exists).
DROP FUNCTION IF EXISTS public.route_return_to_portal(uuid, uuid, uuid[], jsonb, uuid);

CREATE OR REPLACE FUNCTION public.route_return_to_portal(
  p_supplier_id   uuid,
  p_tenant_id     uuid,
  p_inbox_ids     uuid[],
  p_items         jsonb,
  p_created_by    uuid,
  p_slip_metadata jsonb
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

  -- (3) Create the task with the slip metadata snapshot. Crew-side
  -- INSERT policy on supplier_return_tasks requires tenant_id IN
  -- tenant_members of auth.uid().
  INSERT INTO public.supplier_return_tasks (
    supplier_id, tenant_id, source_delivery_inbox_ids,
    items, status, created_by, slip_metadata
  ) VALUES (
    p_supplier_id, p_tenant_id, p_inbox_ids,
    p_items, 'sent', p_created_by, p_slip_metadata
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
  ON FUNCTION public.route_return_to_portal(uuid, uuid, uuid[], jsonb, uuid, jsonb)
  TO authenticated;

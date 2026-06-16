-- ─────────────────────────────────────────────────────────────────────────────
-- 20260616182000_provisioning_approval_routing.sql
--
-- PR 1 of the approval-routing feature.
--
-- Adds the DB foundation for routing "Submit for Approval" requests on
-- provisioning boards to the right reviewer:
--
--   1. tenants.approval_routing jsonb — per-vessel config for who routes
--      where. Lazy / opt-in: a NULL or empty config means the helper RPC
--      falls back to the default ladder (CREW/HOD → dept CHIEF, CHIEF →
--      COMMAND).
--
--   2. public.provisioning_approval_requests — one row per submission.
--      Lifecycle: pending → approved | changes_requested | cancelled.
--      Indexed on (list_id) and (approver_id, status) so the approver's
--      inbox query is a B-tree lookup.
--
--   3. RLS — submitter can SELECT their own, approver can SELECT + UPDATE
--      their assigned rows, command-tier members can SELECT all in their
--      vessel (oversight). All policies use the existing
--      tenant_members.permission_tier ladder.
--
--   4. public.resolve_provisioning_approver(p_list_id, p_submitter_id)
--      returns uuid — the SECURITY DEFINER helper PR2 will call when
--      writing the request row. Honours the routing config + dept
--      overrides, with a COMMAND fallback so submission never
--      no-ops silently.
--
-- IDEMPOTENT: every CREATE uses IF NOT EXISTS / CREATE OR REPLACE.
-- ─────────────────────────────────────────────────────────────────────────────


-- ── 1. tenants.approval_routing ────────────────────────────────────────────

ALTER TABLE public.tenants
  ADD COLUMN IF NOT EXISTS approval_routing jsonb NOT NULL DEFAULT '{}'::jsonb;

COMMENT ON COLUMN public.tenants.approval_routing IS
  'Per-vessel routing config for provisioning Submit for Approval. Shape:
   {
     "crew_to_dept_chief":   bool,   -- default true
     "hod_to_dept_chief":    bool,   -- default true
     "chief_to_command":     bool,   -- default true
     "dept_overrides":       { "<dept_name>": "<user_uuid>", ... },
     "command_inbox_user_ids": ["<uuid>", ...]  -- empty = any COMMAND member
   }
   Missing keys fall back to the defaults above; an empty {} config is
   the safe default (resolve_provisioning_approver still works).';


-- ── 2. provisioning_approval_requests ──────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.provisioning_approval_requests (
  id            uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  list_id       uuid        NOT NULL REFERENCES public.provisioning_lists(id) ON DELETE CASCADE,
  tenant_id     uuid        NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  submitter_id  uuid        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  approver_id   uuid        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  status        text        NOT NULL DEFAULT 'pending'
                CHECK (status IN ('pending', 'approved', 'changes_requested', 'cancelled')),
  comment       text,
  created_at    timestamptz NOT NULL DEFAULT now(),
  decided_at    timestamptz
);

COMMENT ON TABLE public.provisioning_approval_requests IS
  'One row per Submit for Approval on a provisioning_lists board. Status
   ladders pending → approved | changes_requested | cancelled. The
   submitter writes the row (via resolve_provisioning_approver); the
   approver updates status + decided_at when they decide.';

CREATE INDEX IF NOT EXISTS provisioning_approval_requests_list_idx
  ON public.provisioning_approval_requests (list_id);

-- Approver inbox query: WHERE approver_id = me AND status = 'pending'.
CREATE INDEX IF NOT EXISTS provisioning_approval_requests_approver_status_idx
  ON public.provisioning_approval_requests (approver_id, status)
  WHERE status = 'pending';


-- ── 3. RLS ────────────────────────────────────────────────────────────────

ALTER TABLE public.provisioning_approval_requests ENABLE ROW LEVEL SECURITY;

-- SELECT: submitter, approver, or COMMAND-tier member of the tenant.
DROP POLICY IF EXISTS provisioning_approval_requests_select
  ON public.provisioning_approval_requests;
CREATE POLICY provisioning_approval_requests_select
  ON public.provisioning_approval_requests
  FOR SELECT
  TO authenticated
  USING (
    submitter_id = auth.uid()
    OR approver_id = auth.uid()
    OR EXISTS (
      SELECT 1
      FROM public.tenant_members tm
      WHERE tm.user_id = auth.uid()
        AND tm.tenant_id = provisioning_approval_requests.tenant_id
        AND tm.active IS NOT FALSE
        AND public._hor_tier_rank(tm.permission_tier) >= 3  -- COMMAND
    )
  );

-- INSERT: submitter only, with submitter_id matching auth.uid() (the
-- caller can't impersonate). The actual insert happens via PR2's
-- submit_for_approval RPC which runs SECURITY DEFINER, but we keep a
-- defensive policy here for any direct INSERT path.
DROP POLICY IF EXISTS provisioning_approval_requests_insert
  ON public.provisioning_approval_requests;
CREATE POLICY provisioning_approval_requests_insert
  ON public.provisioning_approval_requests
  FOR INSERT
  TO authenticated
  WITH CHECK (
    submitter_id = auth.uid()
    AND EXISTS (
      SELECT 1
      FROM public.tenant_members tm
      WHERE tm.user_id = auth.uid()
        AND tm.tenant_id = provisioning_approval_requests.tenant_id
        AND tm.active IS NOT FALSE
    )
  );

-- UPDATE: approver only, can change status/comment/decided_at. Submitter
-- gets a separate path (PR2's cancel RPC) so they can withdraw their
-- own request without UPDATE permission on the row.
DROP POLICY IF EXISTS provisioning_approval_requests_update
  ON public.provisioning_approval_requests;
CREATE POLICY provisioning_approval_requests_update
  ON public.provisioning_approval_requests
  FOR UPDATE
  TO authenticated
  USING (approver_id = auth.uid())
  WITH CHECK (approver_id = auth.uid());


-- ── 4. resolve_provisioning_approver ──────────────────────────────────────
--
-- SECURITY DEFINER so the caller doesn't need direct SELECT on
-- tenant_members for other users (we only return the approver's uuid,
-- not their profile).
--
-- Algorithm:
--   1. Load the list's tenant_id + first department name.
--   2. Load the submitter's tier from tenant_members.
--   3. Load the tenant's approval_routing config (lazy-read).
--   4. If dept_overrides has the list's dept → use that uuid.
--   5. Else apply the ladder:
--        CHIEF  → COMMAND (chief_to_command unless disabled).
--        Other  → dept CHIEF in the submitter's dept (subject to the
--                 crew_to_dept_chief / hod_to_dept_chief toggles).
--   6. Fall back to ANY COMMAND member of the tenant so we never return
--      NULL (caller would have to throw, breaking the submit flow).

CREATE OR REPLACE FUNCTION public.resolve_provisioning_approver(
  p_list_id      uuid,
  p_submitter_id uuid
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
DECLARE
  v_tenant_id       uuid;
  v_dept_name       text;
  v_dept_id         uuid;
  v_submitter_tier  text;
  v_config          jsonb;
  v_override_uuid   uuid;
  v_target          uuid;
  v_crew_to_chief   boolean;
  v_hod_to_chief    boolean;
  v_chief_to_cmd    boolean;
BEGIN
  IF p_list_id IS NULL OR p_submitter_id IS NULL THEN
    RAISE EXCEPTION 'list_id and submitter_id are both required';
  END IF;

  -- 1. List → tenant + primary department (first element of dept array).
  SELECT pl.tenant_id, COALESCE(pl.department[1], NULL)
    INTO v_tenant_id, v_dept_name
  FROM public.provisioning_lists pl
  WHERE pl.id = p_list_id;

  IF v_tenant_id IS NULL THEN
    RAISE EXCEPTION 'Provisioning list % not found', p_list_id USING ERRCODE = 'P0002';
  END IF;

  -- 2. Submitter tier (UPPER for safety; the table convention is upper).
  SELECT upper(tm.permission_tier) INTO v_submitter_tier
  FROM public.tenant_members tm
  WHERE tm.user_id = p_submitter_id
    AND tm.tenant_id = v_tenant_id
    AND tm.active IS NOT FALSE
  LIMIT 1;

  IF v_submitter_tier IS NULL THEN
    RAISE EXCEPTION 'Submitter % is not an active member of tenant %',
                    p_submitter_id, v_tenant_id;
  END IF;

  -- 3. Routing config (lazy-read with sensible defaults).
  SELECT t.approval_routing INTO v_config
  FROM public.tenants t
  WHERE t.id = v_tenant_id;
  v_config := COALESCE(v_config, '{}'::jsonb);

  v_crew_to_chief := COALESCE((v_config ->> 'crew_to_dept_chief')::boolean, true);
  v_hod_to_chief  := COALESCE((v_config ->> 'hod_to_dept_chief')::boolean,  true);
  v_chief_to_cmd  := COALESCE((v_config ->> 'chief_to_command')::boolean,   true);

  -- 4. Per-dept override wins over everything else.
  IF v_dept_name IS NOT NULL THEN
    v_override_uuid := NULLIF(v_config -> 'dept_overrides' ->> v_dept_name, '')::uuid;
    IF v_override_uuid IS NOT NULL THEN
      RETURN v_override_uuid;
    END IF;

    SELECT d.id INTO v_dept_id
    FROM public.departments d
    WHERE d.name = v_dept_name
    LIMIT 1;
  END IF;

  -- 5. Apply the ladder.
  IF v_submitter_tier = 'CHIEF' AND v_chief_to_cmd THEN
    -- Chief → COMMAND. Prefer the explicit command_inbox_user_ids list
    -- (first element) when configured; otherwise pick any COMMAND member.
    v_target := NULLIF((v_config -> 'command_inbox_user_ids' ->> 0), '')::uuid;
    IF v_target IS NULL THEN
      SELECT tm.user_id INTO v_target
      FROM public.tenant_members tm
      WHERE tm.tenant_id = v_tenant_id
        AND tm.active IS NOT FALSE
        AND upper(tm.permission_tier) = 'COMMAND'
      ORDER BY tm.created_at NULLS LAST
      LIMIT 1;
    END IF;
  ELSIF (v_submitter_tier = 'HOD'  AND v_hod_to_chief)
     OR (v_submitter_tier = 'CREW' AND v_crew_to_chief)
     OR v_submitter_tier NOT IN ('CHIEF', 'COMMAND') THEN
    -- Crew / HOD → dept CHIEF (when one exists).
    IF v_dept_id IS NOT NULL THEN
      SELECT tm.user_id INTO v_target
      FROM public.tenant_members tm
      WHERE tm.tenant_id = v_tenant_id
        AND tm.department_id = v_dept_id
        AND tm.active IS NOT FALSE
        AND upper(tm.permission_tier) = 'CHIEF'
      ORDER BY tm.created_at NULLS LAST
      LIMIT 1;
    END IF;
  END IF;

  -- 6. Final fallback: any active COMMAND member in the tenant. Keeps
  -- submission flow from failing on misconfigured vessels.
  IF v_target IS NULL THEN
    SELECT tm.user_id INTO v_target
    FROM public.tenant_members tm
    WHERE tm.tenant_id = v_tenant_id
      AND tm.active IS NOT FALSE
      AND upper(tm.permission_tier) = 'COMMAND'
    ORDER BY tm.created_at NULLS LAST
    LIMIT 1;
  END IF;

  IF v_target IS NULL THEN
    RAISE EXCEPTION
      'No eligible approver in tenant %. Vessel needs at least one active COMMAND member.',
      v_tenant_id USING ERRCODE = 'P0003';
  END IF;

  RETURN v_target;
END;
$function$;

COMMENT ON FUNCTION public.resolve_provisioning_approver(uuid, uuid) IS
  'Resolves the auth.users.id who should review a Submit for Approval
   on the given provisioning_lists row. Honours tenants.approval_routing
   config, with the default ladder CREW/HOD → dept CHIEF, CHIEF → COMMAND,
   and a final fallback to any active COMMAND member so submission never
   no-ops. Throws P0002 (list not found) or P0003 (no command in vessel).';

GRANT EXECUTE ON FUNCTION public.resolve_provisioning_approver(uuid, uuid)
  TO authenticated;

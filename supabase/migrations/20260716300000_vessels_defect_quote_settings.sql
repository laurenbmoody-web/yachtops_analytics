-- ─────────────────────────────────────────────────────────────────────────────
-- 20260716300000_vessels_defect_quote_settings.sql
--
-- WHAT: Make the repair-quote sign-off configurable per vessel (was hardcoded
--       COMMAND/CHIEF/HOD + a 1000 constant in JS):
--   • defect_quote_approver_tier       — lowest tier that may sign off (equal or
--                                         higher always can). Default 'HOD' → HOD,
--                                         Chief and Command, matching today.
--   • defect_quote_signoff_threshold   — a quote at/above this auto-requires
--                                         sign-off. Default 1000.
--
-- Also enforces the tier server-side (the columns had no RLS gate): a SECURITY
-- DEFINER RPC checks the caller's tier against the vessel setting before writing
-- the decision, so authority isn't only a client-side check.
--
-- Mirrors the hor_approver_tier precedent. Idempotent.
-- ─────────────────────────────────────────────────────────────────────────────
ALTER TABLE public.vessels
  ADD COLUMN IF NOT EXISTS defect_quote_approver_tier text NOT NULL DEFAULT 'HOD'
    CHECK (defect_quote_approver_tier IN ('COMMAND', 'CHIEF', 'HOD')),
  ADD COLUMN IF NOT EXISTS defect_quote_signoff_threshold numeric NOT NULL DEFAULT 1000;

-- Rank helper mirrors authStorage's hierarchy (higher = more authority).
CREATE OR REPLACE FUNCTION public._tier_rank(p_tier text)
RETURNS integer LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE upper(coalesce(p_tier, ''))
           WHEN 'COMMAND' THEN 4 WHEN 'CHIEF' THEN 3 WHEN 'HOD' THEN 2
           WHEN 'CREW' THEN 1 ELSE 0 END;
$$;

-- Approve/decline a repair quote, tier-gated by the vessel's approver setting.
CREATE OR REPLACE FUNCTION public.defect_decide_quote_approval(
  p_defect_id uuid,
  p_approved  boolean,
  p_note      text DEFAULT NULL
) RETURNS public.defects
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_tenant   uuid;
  v_tier     text;
  v_required text;
  v_name     text;
  v_row      public.defects;
BEGIN
  SELECT d.tenant_id INTO v_tenant FROM public.defects d WHERE d.id = p_defect_id;
  IF v_tenant IS NULL THEN RAISE EXCEPTION 'Defect not found'; END IF;

  SELECT tm.permission_tier INTO v_tier
  FROM public.tenant_members tm
  WHERE tm.tenant_id = v_tenant AND tm.user_id = auth.uid() AND tm.active
  LIMIT 1;
  IF v_tier IS NULL THEN RAISE EXCEPTION 'Not a member of this vessel'; END IF;

  SELECT coalesce(v.defect_quote_approver_tier, 'HOD') INTO v_required
  FROM public.vessels v WHERE v.tenant_id = v_tenant;
  v_required := coalesce(v_required, 'HOD');

  IF public._tier_rank(v_tier) < public._tier_rank(v_required) THEN
    RAISE EXCEPTION 'Not permitted to sign off repair quotes';
  END IF;

  SELECT full_name INTO v_name FROM public.profiles WHERE id = auth.uid();

  UPDATE public.defects SET
    quote_approval_status  = CASE WHEN p_approved THEN 'approved' ELSE 'declined' END,
    quote_approved_by      = auth.uid(),
    quote_approved_by_name = v_name,
    quote_approved_at      = now(),
    quote_approval_note    = p_note,
    updated_at             = now()
  WHERE id = p_defect_id
  RETURNING * INTO v_row;

  RETURN v_row;
END;
$$;

GRANT EXECUTE ON FUNCTION public.defect_decide_quote_approval(uuid, boolean, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public._tier_rank(text) TO authenticated;

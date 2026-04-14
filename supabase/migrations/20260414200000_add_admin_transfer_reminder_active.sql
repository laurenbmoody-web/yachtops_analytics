-- Migration: admin-transfer reminder flag + acknowledge RPC
-- Purpose: Support the locked design where signup asks "Will you be Cargo's
--          vessel administrator?" Y/N. When the signer-up says No we flag
--          the tenant so a persistent banner + onboarding checklist item
--          prompt them to transfer admin to the right person.
-- Date: 2026-04-14

-- ─── flag column ───────────────────────────────────────────────────────────
ALTER TABLE public.tenants
  ADD COLUMN IF NOT EXISTS admin_transfer_reminder_active boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN public.tenants.admin_transfer_reminder_active IS
  'True when the person who signed up answered No to "will you be the '
  'vessel admin?". Drives the persistent top-of-app reminder banner '
  'and the onboarding tutorial "transfer admin" step. Clears when '
  'transfer_vessel_admin succeeds or when the admin hits '
  '"Actually, I am the admin" (acknowledge_vessel_admin RPC).';

-- ─── acknowledge RPC ───────────────────────────────────────────────────────
-- Cheap one-shot RPC. Gated on the caller actually being the current admin
-- so a non-admin crew member can't silently clear someone else's reminder.
CREATE OR REPLACE FUNCTION public.acknowledge_vessel_admin(p_tenant_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_admin uuid;
BEGIN
  SELECT current_admin_user_id INTO v_admin
  FROM public.tenants
  WHERE id = p_tenant_id;

  IF v_admin IS NULL THEN
    RAISE EXCEPTION 'tenant % has no current admin', p_tenant_id;
  END IF;

  IF v_admin <> auth.uid() THEN
    RAISE EXCEPTION 'only the current vessel admin may acknowledge';
  END IF;

  UPDATE public.tenants
     SET admin_transfer_reminder_active = false
   WHERE id = p_tenant_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.acknowledge_vessel_admin(uuid) TO authenticated;

COMMENT ON FUNCTION public.acknowledge_vessel_admin IS
  'Clears tenants.admin_transfer_reminder_active for the caller''s tenant. '
  'Powers the "Actually, I am the admin" button on the reminder banner. '
  'Caller must be tenants.current_admin_user_id.';

-- ─── auto-clear on successful transfer ─────────────────────────────────────
-- Inside transfer_vessel_admin we'd normally add `reminder_active = false`
-- to the UPDATE, but to keep this migration additive (no assumptions about
-- the exact body of transfer_vessel_admin across envs) we use a trigger
-- instead: whenever current_admin_user_id changes we clear the flag. The
-- rationale in the locked design is that a successful transfer = the right
-- person is now admin = no further reminder needed.
CREATE OR REPLACE FUNCTION public.clear_admin_reminder_on_transfer()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.current_admin_user_id IS DISTINCT FROM OLD.current_admin_user_id
     AND NEW.admin_transfer_reminder_active = true THEN
    NEW.admin_transfer_reminder_active := false;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_clear_admin_reminder_on_transfer ON public.tenants;
CREATE TRIGGER trg_clear_admin_reminder_on_transfer
  BEFORE UPDATE OF current_admin_user_id ON public.tenants
  FOR EACH ROW
  EXECUTE FUNCTION public.clear_admin_reminder_on_transfer();

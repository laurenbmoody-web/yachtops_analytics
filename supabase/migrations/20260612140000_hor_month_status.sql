-- ─────────────────────────────────────────────────────────────────────────────
-- 20260612140000_hor_month_status.sql
--
-- WHAT: DB-backed Hours-of-Rest monthly confirmation workflow — replaces the
--       per-device localStorage 'cargo_hor_month_confirmations' store.
--
--       Each (vessel/tenant, crew member, calendar month) gets one status row
--       moving through a small state machine:
--
--         open ──submit──▶ submitted ──approve──▶ confirmed ──lock──▶ locked
--           ▲                 │                       │
--           └──── reopen ◀────┴──────── reopen ◀──────┘
--
--       The transitions themselves are SECURITY DEFINER writer RPCs in the
--       companion migration (_141000); this migration is schema + settings +
--       RLS only. Direct INSERT/UPDATE/DELETE is denied — every write goes
--       through a writer so the state machine + authorisation stay atomic.
--
-- PER-VESSEL SETTINGS (on public.vessels, matching the operational_day_start_hour
--       precedent — runtime treats the active tenant as its vessel):
--         hor_confirmation_mode  'require' (approver must confirm) | 'trust'
--                                (crew submit auto-confirms, no approver step).
--         hor_approver_tier      which permission_tier may approve —
--                                'COMMAND' (default) | 'CHIEF' | 'HOD'. COMMAND
--                                may always approve as a fallback regardless of
--                                this value (see _141000).
--
-- IDEMPOTENCY: ADD COLUMN IF NOT EXISTS + CREATE TABLE IF NOT EXISTS + guarded
--       constraints/policies. Safe to re-apply.
-- ─────────────────────────────────────────────────────────────────────────────

-- ── Per-vessel workflow settings ─────────────────────────────────────────────
ALTER TABLE public.vessels
  ADD COLUMN IF NOT EXISTS hor_confirmation_mode text NOT NULL DEFAULT 'require',
  ADD COLUMN IF NOT EXISTS hor_approver_tier    text NOT NULL DEFAULT 'COMMAND';

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint
    WHERE conname = 'vessels_hor_confirmation_mode_check'
      AND conrelid = 'public.vessels'::regclass) THEN
    ALTER TABLE public.vessels ADD CONSTRAINT vessels_hor_confirmation_mode_check
      CHECK (hor_confirmation_mode IN ('require', 'trust'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint
    WHERE conname = 'vessels_hor_approver_tier_check'
      AND conrelid = 'public.vessels'::regclass) THEN
    ALTER TABLE public.vessels ADD CONSTRAINT vessels_hor_approver_tier_check
      CHECK (hor_approver_tier IN ('COMMAND', 'CHIEF', 'HOD'));
  END IF;
END $$;

COMMENT ON COLUMN public.vessels.hor_confirmation_mode IS
  'HOR month confirmation: require (approver confirms) or trust (crew submit auto-confirms).';
COMMENT ON COLUMN public.vessels.hor_approver_tier IS
  'permission_tier permitted to approve HOR months (COMMAND|CHIEF|HOD). COMMAND always allowed.';

-- ── Month status table ───────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.hor_month_status (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id            uuid NOT NULL REFERENCES public.tenants(id)  ON DELETE CASCADE,
  vessel_id            uuid          REFERENCES public.vessels(id)  ON DELETE SET NULL,
  -- The crew member the month belongs to. Matches the crew-profile route id
  -- (profiles.id / auth user id), NOT tenant_members.id.
  subject_user_id      uuid NOT NULL,
  period_year          integer  NOT NULL,
  period_month         smallint NOT NULL,   -- 1–12 (calendar month, not JS 0–11)
  status               text     NOT NULL DEFAULT 'open',
  note                 text,
  dataset_version_hash text,
  submitted_at         timestamptz,
  submitted_by         uuid,
  confirmed_at         timestamptz,
  confirmed_by         uuid,
  locked_at            timestamptz,
  locked_by            uuid,
  created_at           timestamptz NOT NULL DEFAULT now(),
  updated_at           timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT hor_month_status_status_check
    CHECK (status IN ('open', 'submitted', 'confirmed', 'locked')),
  CONSTRAINT hor_month_status_month_check
    CHECK (period_month >= 1 AND period_month <= 12),
  CONSTRAINT hor_month_status_unique
    UNIQUE (tenant_id, subject_user_id, period_year, period_month)
);

CREATE INDEX IF NOT EXISTS hor_month_status_period_idx
  ON public.hor_month_status (tenant_id, period_year, period_month);
CREATE INDEX IF NOT EXISTS hor_month_status_subject_idx
  ON public.hor_month_status (subject_user_id);

-- ── RLS: tenant members read; writes are RPC-only (no write policies) ─────────
ALTER TABLE public.hor_month_status ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'hor_month_status'
      AND policyname = 'hor_month_status_read'
  ) THEN
    CREATE POLICY "hor_month_status_read"
      ON public.hor_month_status
      FOR SELECT
      USING (public.is_active_tenant_member(tenant_id, auth.uid()));
  END IF;
END $$;

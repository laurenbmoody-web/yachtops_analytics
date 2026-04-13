-- Migration: Add Stripe billing fields to tenants and conversion tracking to vessel_registrations
-- Purpose: Support the self-serve payment → onboarding flow launched via /checkout
-- Date: 2026-04-10

-- ─── Stripe fields on public.tenants ────────────────────────────────────────
-- Every vessel on a paid plan has an associated Stripe customer + subscription.
-- subscription_status mirrors Stripe's status values so dunning logic can key
-- off it: active, trialing, past_due, canceled, incomplete, incomplete_expired,
-- unpaid. We use 'active' for paid, 'canceled' for cancelled, and leave room
-- for trial/dunning states without schema changes.

ALTER TABLE public.tenants
  ADD COLUMN IF NOT EXISTS stripe_customer_id text,
  ADD COLUMN IF NOT EXISTS stripe_subscription_id text,
  ADD COLUMN IF NOT EXISTS subscription_status text,
  ADD COLUMN IF NOT EXISTS plan_tier text CHECK (
    plan_tier IS NULL OR plan_tier IN ('under_40m', '40_80m', 'over_80m')
  ),
  ADD COLUMN IF NOT EXISTS billing_period text CHECK (
    billing_period IS NULL OR billing_period IN ('monthly', 'annual')
  );

COMMENT ON COLUMN public.tenants.stripe_customer_id IS 'Stripe customer ID (cus_...)';
COMMENT ON COLUMN public.tenants.stripe_subscription_id IS 'Stripe subscription ID (sub_...)';
COMMENT ON COLUMN public.tenants.subscription_status IS 'Mirrors Stripe subscription status';
COMMENT ON COLUMN public.tenants.plan_tier IS 'Pricing tier at time of subscription (under_40m / 40_80m / over_80m)';
COMMENT ON COLUMN public.tenants.billing_period IS 'monthly or annual — locked at checkout';

-- Index for webhook lookups — when Stripe sends a subscription event we need
-- to find the tenant by subscription ID fast.
CREATE INDEX IF NOT EXISTS idx_tenants_stripe_subscription_id
  ON public.tenants (stripe_subscription_id)
  WHERE stripe_subscription_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_tenants_stripe_customer_id
  ON public.tenants (stripe_customer_id)
  WHERE stripe_customer_id IS NOT NULL;

-- ─── Conversion tracking on public.vessel_registrations ────────────────────
-- When a vessel_registrations row successfully converts to a paying tenant,
-- we record which tenant it became and when. This gives us a lead-to-customer
-- funnel and lets us prevent duplicate conversions.

ALTER TABLE public.vessel_registrations
  ADD COLUMN IF NOT EXISTS tenant_id uuid REFERENCES public.tenants(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS converted_at timestamptz;

COMMENT ON COLUMN public.vessel_registrations.tenant_id IS 'Tenant created from this lead, if converted';
COMMENT ON COLUMN public.vessel_registrations.converted_at IS 'Timestamp when the lead became a paying tenant';

CREATE INDEX IF NOT EXISTS idx_vessel_registrations_tenant_id
  ON public.vessel_registrations (tenant_id)
  WHERE tenant_id IS NOT NULL;

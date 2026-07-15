-- Migration: Add subscription period + pending-cancellation fields to tenants
-- Purpose: Let the membership UI show the renewal date and a "cancelling on
--          <date>" state. Populated from Stripe by the stripe-webhook function
--          (checkout.session.completed, customer.subscription.created/updated).
-- Date: 2026-07-15

ALTER TABLE public.tenants
  ADD COLUMN IF NOT EXISTS current_period_end timestamptz,
  ADD COLUMN IF NOT EXISTS cancel_at_period_end boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN public.tenants.current_period_end IS 'End of the current Stripe billing period (renews or, if cancelling, access ends here)';
COMMENT ON COLUMN public.tenants.cancel_at_period_end IS 'True when the subscription is set to cancel at period end (portal cancel-at-period-end)';

-- Operational storefront fields a provisions supplier shows buyers.
--
-- These are the questions a captain asks before choosing a supplier:
-- how fast, order-by-when, minimum spend, what certifications. They're
-- deliberately framed as TYPICAL / STANDARD, not hard limits — provisioning
-- is relative, a good supplier will rush an order for the right job, which
-- the express_available flag signals.
--
-- Edited in the supplier portal (Storefront settings); surfaced on the
-- buyer storefront (aisle header + supplier detail).

alter table public.supplier_profiles
  add column if not exists lead_time_days     integer,
  add column if not exists order_cutoff       time,
  add column if not exists min_order_value    numeric(12,2),
  add column if not exists min_order_currency text default 'EUR',
  add column if not exists certifications     text[] default '{}',
  add column if not exists express_available  boolean default false;

comment on column public.supplier_profiles.lead_time_days is
  'Typical days from order to delivery (soft, not a hard limit).';
comment on column public.supplier_profiles.order_cutoff is
  'Standard daily order cut-off time for the next delivery cycle.';
comment on column public.supplier_profiles.min_order_value is
  'Typical minimum order value (soft).';
comment on column public.supplier_profiles.certifications is
  'Certifications shown on the storefront (HACCP, Organic/Bio, IFS, cold-chain, …).';
comment on column public.supplier_profiles.express_available is
  'Supplier will take rush / express orders on request — shows a "Rush available" badge.';

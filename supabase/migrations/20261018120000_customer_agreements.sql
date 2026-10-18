-- Customer agreements — the record that a vessel's paying customer accepted
-- the Cargo Terms of Service (incl. the Article 28 data processing terms).
--
-- Accepted with a tick box before payment, in two places:
--   • website checkout (/checkout)       → source 'website_checkout'
--   • in-app upgrade (/membership)       → source 'app_upgrade'
-- The Netlify checkout functions insert the row (service role) when they
-- start the Stripe session; stripe-webhook links it to the tenant once the
-- payment completes and copies the headline fields onto the tenant.
--
-- Clients never write here directly. Command on the vessel can read its
-- history.

create table if not exists public.customer_agreements (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid references public.tenants(id) on delete set null,
  vessel_registration_id uuid,
  source text not null check (source in ('website_checkout', 'app_upgrade')),
  customer_legal_name text not null,
  customer_country text not null,
  terms_version text not null,
  accepted_by_user_id uuid references auth.users(id) on delete set null,
  accepted_by_name text,
  accepted_by_email text,
  accepted_by_role text,
  plan_tier text,
  billing_period text,
  stripe_checkout_session_id text unique,
  ip_address text,
  user_agent text,
  accepted_at timestamptz not null default now(),
  linked_at timestamptz
);

create index if not exists customer_agreements_tenant_idx
  on public.customer_agreements (tenant_id, accepted_at desc);

alter table public.customer_agreements enable row level security;

drop policy if exists customer_agreements_select_command on public.customer_agreements;
create policy customer_agreements_select_command on public.customer_agreements
  for select to authenticated
  using (tenant_id is not null and public.is_command_in_tenant(tenant_id));

-- Headline copy on the tenant, for the Membership page.
alter table public.tenants add column if not exists customer_legal_name text;
alter table public.tenants add column if not exists customer_country text;
alter table public.tenants add column if not exists terms_version text;
alter table public.tenants add column if not exists terms_accepted_at timestamptz;
alter table public.tenants add column if not exists terms_accepted_by_name text;

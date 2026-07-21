-- Crew → Supplier card payments (Stripe Connect) — data model.
--
-- Direct charges on the supplier's Express connected account; the supplier is
-- merchant of record and bears the Stripe fee, Cargo takes a platform fee via
-- application_fee_amount. Cargo never holds funds. See the build spec.
--
-- Idempotent throughout (add column if not exists / create table if not exists).

-- ── 1. Supplier's Stripe Connect account + capability flags ──────────────────
alter table public.supplier_profiles
  add column if not exists stripe_account_id      text,
  add column if not exists stripe_charges_enabled boolean not null default false,
  add column if not exists stripe_payouts_enabled boolean not null default false,
  add column if not exists stripe_onboarded_at    timestamptz;

create index if not exists idx_supplier_profiles_stripe_account
  on public.supplier_profiles(stripe_account_id) where stripe_account_id is not null;

-- ── 2. Card payment attempts (audit + idempotency + reconciliation) ──────────
create table if not exists public.supplier_payments (
  id                       uuid default gen_random_uuid() primary key,
  tenant_id                uuid not null references public.tenants(id)           on delete cascade,  -- buyer (yacht)
  supplier_order_id        uuid references public.supplier_orders(id)            on delete set null,
  supplier_invoice_id      uuid references public.supplier_invoices(id)          on delete set null,
  stripe_account_id        text not null,                 -- the connected (supplier) account charged
  stripe_session_id        text,                          -- Checkout Session id
  stripe_payment_intent_id text,
  amount                   numeric(14,2) not null,
  currency                 text not null default 'EUR',
  application_fee          numeric(14,2) default 0,       -- Cargo's cut
  status                   text not null default 'created'
                           check (status in ('created','processing','succeeded','failed','refunded')),
  created_by               uuid references auth.users(id),
  created_at               timestamptz default now(),
  updated_at               timestamptz default now()
);

create unique index if not exists uq_supplier_payments_pi
  on public.supplier_payments(stripe_payment_intent_id) where stripe_payment_intent_id is not null;
create index if not exists idx_supplier_payments_tenant  on public.supplier_payments(tenant_id);
create index if not exists idx_supplier_payments_invoice on public.supplier_payments(supplier_invoice_id);

drop trigger if exists trg_supplier_payments_updated_at on public.supplier_payments;
create trigger trg_supplier_payments_updated_at
  before update on public.supplier_payments
  for each row execute function public.set_updated_at();

alter table public.supplier_payments enable row level security;

-- Buyer tenant reads its own payment rows; writes are server-side (service role,
-- which bypasses RLS). COMMAND may delete.
drop policy if exists supplier_payments_read on public.supplier_payments;
create policy supplier_payments_read on public.supplier_payments
  for select using (public.is_active_tenant_member(tenant_id, auth.uid()));

drop policy if exists supplier_payments_command_delete on public.supplier_payments;
create policy supplier_payments_command_delete on public.supplier_payments
  for delete using (public.is_active_tenant_member(tenant_id, auth.uid()));

-- ── 3. Tunable platform payment config (single row) ──────────────────────────
-- fee_percent: Cargo's marketplace fee; card_min_amount: floor below which the
-- card option is hidden (single base threshold, compared at par / fx=1).
create table if not exists public.platform_payment_config (
  id              int primary key default 1 check (id = 1),
  fee_percent     numeric(6,3) not null default 0.75,
  card_min_amount numeric(14,2) not null default 50,
  updated_at      timestamptz default now()
);
insert into public.platform_payment_config (id) values (1) on conflict (id) do nothing;

alter table public.platform_payment_config enable row level security;
-- Not sensitive (a fee % and a floor); any signed-in user may read it so the
-- crew UI can decide whether to offer "Pay by card". Writes are server-side.
drop policy if exists platform_payment_config_read on public.platform_payment_config;
create policy platform_payment_config_read on public.platform_payment_config
  for select using (auth.role() = 'authenticated');

grant select on public.platform_payment_config to authenticated;
grant select on public.supplier_payments to authenticated;

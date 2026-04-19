-- Helper: returns the supplier_id for the currently authenticated user
-- SECURITY DEFINER so it can read supplier_contacts without triggering RLS loops
create or replace function public.get_user_supplier_id()
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select supplier_id
  from public.supplier_contacts
  where user_id = auth.uid()
  limit 1;
$$;

-- ─── supplier_catalogue_items ──────────────────────────────────────────────
create table if not exists public.supplier_catalogue_items (
  id             uuid primary key default gen_random_uuid(),
  supplier_id    uuid not null references public.supplier_profiles(id) on delete cascade,
  name           text not null,
  sku            text,
  category       text,
  unit           text,
  unit_price     numeric(10,2),
  currency       text not null default 'EUR',
  description    text,
  in_stock       boolean not null default true,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);

create index if not exists supplier_catalogue_supplier_idx on public.supplier_catalogue_items(supplier_id);

alter table public.supplier_catalogue_items enable row level security;

create policy "supplier_read_own_catalogue" on public.supplier_catalogue_items
  for select using (supplier_id = get_user_supplier_id());

create policy "supplier_insert_catalogue" on public.supplier_catalogue_items
  for insert with check (supplier_id = get_user_supplier_id());

create policy "supplier_update_catalogue" on public.supplier_catalogue_items
  for update using (supplier_id = get_user_supplier_id());

create policy "supplier_delete_catalogue" on public.supplier_catalogue_items
  for delete using (supplier_id = get_user_supplier_id());

-- Vessel crew can read supplier catalogue (for ordering)
create policy "crew_read_supplier_catalogue" on public.supplier_catalogue_items
  for select using (
    exists (
      select 1 from public.tenant_members tm
      where tm.user_id = auth.uid() and tm.active = true
    )
  );

-- ─── supplier_invoices ────────────────────────────────────────────────────
create table if not exists public.supplier_invoices (
  id              uuid primary key default gen_random_uuid(),
  supplier_id     uuid not null references public.supplier_profiles(id) on delete cascade,
  order_id        uuid references public.supplier_orders(id) on delete set null,
  invoice_number  text not null,
  tenant_id       uuid references public.tenants(id) on delete set null,
  yacht_name      text,
  issue_date      date not null default current_date,
  due_date        date,
  amount          numeric(10,2) not null,
  currency        text not null default 'EUR',
  status          text not null default 'draft'
                    check (status in ('draft','sent','paid','overdue','disputed')),
  pdf_url         text,
  notes           text,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

create index if not exists supplier_invoices_supplier_idx on public.supplier_invoices(supplier_id);
create index if not exists supplier_invoices_order_idx on public.supplier_invoices(order_id);

alter table public.supplier_invoices enable row level security;

create policy "supplier_read_own_invoices" on public.supplier_invoices
  for select using (supplier_id = get_user_supplier_id());

create policy "supplier_insert_invoices" on public.supplier_invoices
  for insert with check (supplier_id = get_user_supplier_id());

create policy "supplier_update_invoices" on public.supplier_invoices
  for update using (supplier_id = get_user_supplier_id());

-- Tenant members can read invoices addressed to their vessel
create policy "crew_read_their_invoices" on public.supplier_invoices
  for select using (
    tenant_id in (
      select tenant_id from public.tenant_members
      where user_id = auth.uid() and active = true
    )
  );

-- ─── supplier_deliveries ─────────────────────────────────────────────────
create table if not exists public.supplier_deliveries (
  id               uuid primary key default gen_random_uuid(),
  supplier_id      uuid not null references public.supplier_profiles(id) on delete cascade,
  order_id         uuid references public.supplier_orders(id) on delete set null,
  tenant_id        uuid references public.tenants(id) on delete set null,
  yacht_name       text,
  berth            text,
  scheduled_date   date,
  scheduled_time   time,
  driver           text,
  status           text not null default 'scheduled'
                     check (status in ('scheduled','en_route','delivered','failed','rescheduled')),
  notes            text,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);

create index if not exists supplier_deliveries_supplier_idx on public.supplier_deliveries(supplier_id);
create index if not exists supplier_deliveries_date_idx on public.supplier_deliveries(scheduled_date);

alter table public.supplier_deliveries enable row level security;

create policy "supplier_read_own_deliveries" on public.supplier_deliveries
  for select using (supplier_id = get_user_supplier_id());

create policy "supplier_insert_deliveries" on public.supplier_deliveries
  for insert with check (supplier_id = get_user_supplier_id());

create policy "supplier_update_deliveries" on public.supplier_deliveries
  for update using (supplier_id = get_user_supplier_id());

-- ─── tenant_suppliers ────────────────────────────────────────────────────
-- Junction: which suppliers are approved/favourited by a tenant
create table if not exists public.tenant_suppliers (
  id           uuid primary key default gen_random_uuid(),
  tenant_id    uuid not null references public.tenants(id) on delete cascade,
  supplier_id  uuid not null references public.supplier_profiles(id) on delete cascade,
  status       text not null default 'active'
                 check (status in ('active','paused','blocked')),
  payment_terms text,
  credit_limit  numeric(10,2),
  notes         text,
  created_at    timestamptz not null default now(),
  unique (tenant_id, supplier_id)
);

create index if not exists tenant_suppliers_tenant_idx on public.tenant_suppliers(tenant_id);
create index if not exists tenant_suppliers_supplier_idx on public.tenant_suppliers(supplier_id);

alter table public.tenant_suppliers enable row level security;

create policy "crew_manage_tenant_suppliers" on public.tenant_suppliers
  for all using (
    tenant_id in (
      select tenant_id from public.tenant_members
      where user_id = auth.uid() and active = true
    )
  );

create policy "supplier_read_tenant_suppliers" on public.tenant_suppliers
  for select using (supplier_id = get_user_supplier_id());

-- ─── updated_at triggers ─────────────────────────────────────────────────
create or replace function public.set_supplier_updated_at()
returns trigger language plpgsql as $$
begin new.updated_at = now(); return new; end;
$$;

create trigger supplier_catalogue_updated_at
  before update on public.supplier_catalogue_items
  for each row execute function public.set_supplier_updated_at();

create trigger supplier_invoices_updated_at
  before update on public.supplier_invoices
  for each row execute function public.set_supplier_updated_at();

create trigger supplier_deliveries_updated_at
  before update on public.supplier_deliveries
  for each row execute function public.set_supplier_updated_at();

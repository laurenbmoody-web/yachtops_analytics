-- supplier_orders: one order per supplier per provisioning list
create table if not exists public.supplier_orders (
  id                   uuid primary key default gen_random_uuid(),
  tenant_id            uuid not null references public.tenants(id) on delete cascade,
  list_id              uuid not null references public.provisioning_lists(id) on delete cascade,
  supplier_name        text not null,
  supplier_email       text,
  supplier_phone       text,
  delivery_port        text,
  delivery_date        date,
  delivery_time        time,
  delivery_contact     text,
  special_instructions text,
  currency             text not null default 'USD',
  status               text not null default 'draft'
                         check (status in ('draft','sent','confirmed','partially_confirmed')),
  public_token         uuid not null default gen_random_uuid(),
  sent_at              timestamptz,
  confirmed_at         timestamptz,
  supplier_notes       text,
  created_by           uuid references auth.users(id),
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now()
);

-- supplier_order_items: line items copied from the provisioning list at send time
create table if not exists public.supplier_order_items (
  id                     uuid primary key default gen_random_uuid(),
  order_id               uuid not null references public.supplier_orders(id) on delete cascade,
  item_name              text not null,
  quantity               numeric not null,
  unit                   text,
  notes                  text,
  status                 text not null default 'pending'
                           check (status in ('pending','confirmed','unavailable','substituted')),
  substitute_description text,
  updated_at             timestamptz not null default now()
);

-- Indexes
create index if not exists supplier_orders_tenant_idx  on public.supplier_orders(tenant_id);
create index if not exists supplier_orders_list_idx    on public.supplier_orders(list_id);
create index if not exists supplier_orders_token_idx   on public.supplier_orders(public_token);
create index if not exists supplier_order_items_order_idx on public.supplier_order_items(order_id);

-- updated_at triggers
create or replace function public.set_supplier_order_updated_at()
returns trigger language plpgsql as $$
begin new.updated_at = now(); return new; end;
$$;

create trigger supplier_orders_updated_at
  before update on public.supplier_orders
  for each row execute function public.set_supplier_order_updated_at();

create trigger supplier_order_items_updated_at
  before update on public.supplier_order_items
  for each row execute function public.set_supplier_order_updated_at();

-- RLS
alter table public.supplier_orders      enable row level security;
alter table public.supplier_order_items enable row level security;

-- Authenticated users: full access scoped to their tenant
create policy "tenant members can manage supplier_orders"
  on public.supplier_orders for all
  using (
    tenant_id in (
      select tenant_id from public.tenant_members
      where user_id = auth.uid() and status != 'invited'
    )
  );

create policy "tenant members can manage supplier_order_items"
  on public.supplier_order_items for all
  using (
    order_id in (
      select so.id from public.supplier_orders so
      join public.tenant_members tm on tm.tenant_id = so.tenant_id
      where tm.user_id = auth.uid() and tm.status != 'invited'
    )
  );

-- Anonymous access: supplier can read/update their order via public_token
-- (used by the public confirm page and edge function)
create policy "public token read supplier_orders"
  on public.supplier_orders for select
  using (public_token is not null);

create policy "public token update supplier_orders"
  on public.supplier_orders for update
  using (public_token is not null);

create policy "public token read supplier_order_items"
  on public.supplier_order_items for select
  using (true);

create policy "public token update supplier_order_items"
  on public.supplier_order_items for update
  using (true);

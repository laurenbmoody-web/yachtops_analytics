alter table public.supplier_orders
  add column if not exists sent_via text not null default 'email'
    check (sent_via in ('email', 'whatsapp', 'manual'));

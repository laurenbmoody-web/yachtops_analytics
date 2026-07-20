-- Cargo Accounts — Ledger Part A (manual-entry parity).

-- Optional structured fields on a ledger row (progressive disclosure in the UI).
alter table public.ledger_transactions
  add column if not exists category_code text,   -- MYBA chart code, for deterministic budget bucketing
  add column if not exists department    text,
  add column if not exists vat_amount     numeric(14,2),
  add column if not exists vat_rate       numeric,
  add column if not exists payee          text;

-- Receipt / document attachments for a ledger row. Mirrors defect_documents.
create table if not exists public.ledger_transaction_attachments (
  id                    uuid primary key default gen_random_uuid(),
  tenant_id             uuid not null references public.tenants(id) on delete cascade,
  ledger_transaction_id uuid not null references public.ledger_transactions(id) on delete cascade,
  storage_path          text not null,
  file_name             text,
  mime_type             text,
  size_bytes            bigint,
  uploaded_by           uuid references auth.users(id),
  created_at            timestamptz not null default now()
);
create index if not exists idx_lta_txn on public.ledger_transaction_attachments(ledger_transaction_id);
create index if not exists idx_lta_tenant on public.ledger_transaction_attachments(tenant_id);

alter table public.ledger_transaction_attachments enable row level security;

drop policy if exists lta_select on public.ledger_transaction_attachments;
create policy lta_select on public.ledger_transaction_attachments for select
  using (public.is_active_tenant_member(tenant_id, auth.uid()));

drop policy if exists lta_insert on public.ledger_transaction_attachments;
create policy lta_insert on public.ledger_transaction_attachments for insert
  with check (public.is_active_tenant_member(tenant_id, auth.uid()));

-- Delete is COMMAND-only (backstop; matches ledger_transactions).
drop policy if exists lta_delete on public.ledger_transaction_attachments;
create policy lta_delete on public.ledger_transaction_attachments for delete
  using (exists (
    select 1 from public.tenant_members tm
    where tm.tenant_id = ledger_transaction_attachments.tenant_id
      and tm.user_id = auth.uid()
      and tm.active is not false
      and tm.permission_tier = 'COMMAND'
  ));

-- Private storage bucket for receipts (read via signed URL). Authenticated-only —
-- more private than the app's existing public invoice buckets.
insert into storage.buckets (id, name, public)
  values ('ledger-receipts', 'ledger-receipts', false)
  on conflict (id) do nothing;

drop policy if exists "ledger_receipts_read" on storage.objects;
create policy "ledger_receipts_read" on storage.objects for select to authenticated
  using (bucket_id = 'ledger-receipts');
drop policy if exists "ledger_receipts_insert" on storage.objects;
create policy "ledger_receipts_insert" on storage.objects for insert to authenticated
  with check (bucket_id = 'ledger-receipts');
drop policy if exists "ledger_receipts_delete" on storage.objects;
create policy "ledger_receipts_delete" on storage.objects for delete to authenticated
  using (bucket_id = 'ledger-receipts');
